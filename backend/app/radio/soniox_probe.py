"""① Soniox STT 출력 형식 확인용 스크립트 (개발 도구, 운영 코드 아님).

녹음한 무전 문장을 Soniox 비동기 API로 변환해, 이 프로젝트의 추출·위치 확정이 읽을 수 있는 형태인지 확인한다.
  - 숫자가 "200m"처럼 나오는지, "이백 미터"처럼 한글로 나오는지 (locate.py는 아라비아 숫자만 읽는다)
  - 띄어쓰기·구두점이 어떻게 나오는지, 정답 문장과 얼마나 다른지 (글자 오류율)
  - 변환 결과를 extract_report에 넣었을 때 유형·위치가 어떻게 나오는지

API 키는 환경 변수 SONIOX_API_KEY에서만 읽는다. 인자·출력·결과 파일에 남기지 않는다.
외부에서 받은 파일의 무결성: 녹음 파일의 SHA-256을 결과에 기록하고, 같은 경로를 다시 실행할 때 기록과 다르면 중단한다.
결과 JSON(`--out`)에는 Soniox가 돌려준 원본 토큰도 함께 저장한다.

사용
  # 녹음 파일(폴더)을 변환하고 정답 문장과 비교
  SONIOX_API_KEY=... PYTHONPATH=backend python -m app.radio.soniox_probe data/raw/radio-record \
      --script data/samples/radio-record-script.tsv --out data/processed/soniox-probe.json
  # 구역명 사전의 이름을 Soniox에 용어(context.terms)로 알려 지명 인식을 돕고, 이전 결과와 비교
  SONIOX_API_KEY=... PYTHONPATH=backend python -m app.radio.soniox_probe data/raw/radio-record \
      --script data/samples/radio-record-script.tsv --gazetteer data/samples/radio-gazetteer-example.json \
      --baseline data/processed/soniox-probe.json --out data/processed/soniox-probe-context.json
  # 네트워크 없이 문장 하나만 점검 (Soniox 콘솔에서 복사한 결과 등)
  PYTHONPATH=backend python -m app.radio.soniox_probe --analyze-text "여기서 북쪽 이백 미터 수색 완료"
"""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import re
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Optional

from .extract import extract_report
from .locate import Gazetteer, parse_relative

API_BASE = "https://api.soniox.com/v1"
DEFAULT_MODEL = "stt-async-v6"  # 문서(docs.soniox.com)의 비동기 예시 모델. 바뀌었으면 --model로 지정한다
AUDIO_SUFFIXES = {".aac", ".aiff", ".amr", ".asf", ".flac", ".mp3", ".ogg", ".wav", ".webm", ".m4a", ".mp4"}

_KO_NUM = r"[일이삼사오육칠팔구십백천만영공]+"
_UNIT = r"(?:킬로미터|킬로|미터|km|m|㎞|㎜)"
_ARABIC_DIST = re.compile(rf"\d+(?:[.,]\d+)?\s*{_UNIT}", re.IGNORECASE)
_KOREAN_DIST = re.compile(rf"(?<![가-힣]){_KO_NUM}\s*{_UNIT}")
RADIO_TERMS = ("수색 완료", "진입 불가", "낙석 위험", "흔적 발견")  # 무전에서 자주 쓰는 표현 (용어 목록에 함께 보낸다)
_PUNCT = re.compile(r"[\s.,!?~…·'\"“”‘’()\[\]-]+")


class ProbeError(RuntimeError):
    pass


# ---- 파일 무결성 ---------------------------------------------------------
def sha256_file(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def verify_against_previous(audio_hashes: dict[str, str], previous: dict) -> list[str]:
    """이전 결과에 기록된 해시와 다른 파일 이름 목록. (처음 보는 파일은 문제 아님)"""
    return [name for name, digest in audio_hashes.items()
            if name in previous and previous[name] != digest]


# ---- Soniox 컨텍스트 -----------------------------------------------------
def build_context(gazetteer_path) -> dict:
    """구역명 사전의 이름·별칭을 context.terms로 만든다 (형식: docs.soniox.com/stt/concepts/context).
    사전 파일은 읽는 순간 SHA-256을 함께 돌려준다."""
    raw = Path(gazetteer_path).read_bytes()
    gazetteer = Gazetteer.from_dict(json.loads(raw.decode("utf-8")))  # 형식 검증 (격자 없이)
    terms: list[str] = []
    for place in gazetteer.places:
        for name in (place.name, *place.aliases):
            if name not in terms:
                terms.append(name)
    for term in RADIO_TERMS:
        if term not in terms:
            terms.append(term)
    return {"general": [{"key": "domain", "value": "산악 실종자 수색 구조 무전"},
                        {"key": "language", "value": "Korean"}],
            "terms": terms, "_gazetteer_sha256": hashlib.sha256(raw).hexdigest()}


def api_context(context: Optional[dict]) -> Optional[dict]:
    """요청에 넣을 context (내부용 키 `_`로 시작하는 항목은 뺀다)."""
    return None if not context else {k: v for k, v in context.items() if not k.startswith("_")}


# ---- 텍스트 점검 (네트워크 없음) ------------------------------------------
def normalize(text: str) -> str:
    return _PUNCT.sub("", text)


def edit_distance(a: str, b: str) -> int:
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def char_error_rate(expected: str, got: str) -> float:
    """띄어쓰기·구두점을 뺀 글자 오류율. 정답이 비어 있으면 nan."""
    e, g = normalize(expected), normalize(got)
    return edit_distance(e, g) / len(e) if e else float("nan")


def number_style(text: str) -> str:
    """거리 표현의 숫자 형태: arabic(200m) / korean(이백 미터) / both / none."""
    a, k = bool(_ARABIC_DIST.search(text)), bool(_KOREAN_DIST.search(text))
    return "both" if a and k else "arabic" if a else "korean" if k else "none"


def analyze_text(text: str, expected: Optional[str] = None) -> dict:
    """변환 결과 한 문장을 점검한다. extract_report 결과와 locate가 거리를 읽는지도 본다."""
    result: dict = {"text": text, "number_style": number_style(text),
                    "relative_parsed": None, "events": [], "warnings": []}
    offset = parse_relative(text)
    result["relative_parsed"] = (None if offset is None else
                                 {"direction": offset.direction, "distance_m": offset.distance_m})
    if text.strip():
        extraction = extract_report(text, "probe")
        result["events"] = [{"type": e.type.value, "location": e.location.value, "confidence": e.confidence.value}
                            for e in extraction.report.events]
        result["warnings"] = list(extraction.warnings)
    result["has_punctuation"] = bool(re.search(r"[.?!,]", text))
    result["has_latin"] = bool(re.search(r"[A-Za-z]", text))
    if expected is not None:
        e, g = normalize(expected), normalize(text)
        result["expected"] = expected
        result["cer"] = char_error_rate(expected, text)
        result["exact_ignoring_space_punct"] = e == g
        strip = lambda x: re.sub(r"[.,!?~…]", "", x).split()
        result["spacing_differs_only"] = e == g and strip(expected) != strip(text)
        result["expected_number_style"] = number_style(expected)
    return result


def summarize(items: list[dict]) -> dict:
    styles = {}
    for item in items:
        styles[item["number_style"]] = styles.get(item["number_style"], 0) + 1
    cers = [i["cer"] for i in items if "cer" in i and i["cer"] == i["cer"]]
    korean_only = [i["text"] for i in items if i["number_style"] == "korean" and not i["relative_parsed"]]
    return {"n": len(items), "number_styles": styles,
            "mean_cer": (sum(cers) / len(cers)) if cers else None,
            "exact_matches": sum(1 for i in items if i.get("exact_ignoring_space_punct")),
            "korean_numerals_unparsed": korean_only}


# ---- Soniox REST (표준 라이브러리만 사용) -----------------------------------
class SonioxClient:
    def __init__(self, api_key: str, base: str = API_BASE, transport=None):
        if not api_key:
            raise ProbeError("SONIOX_API_KEY 환경 변수가 없습니다")
        self._key, self._base = api_key, base.rstrip("/")
        self._transport = transport or self._urllib

    def _urllib(self, method: str, url: str, headers: dict, body: Optional[bytes]):
        req = urllib.request.Request(url, data=body, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read()
        except urllib.error.URLError as exc:
            raise ProbeError(f"Soniox에 연결하지 못했습니다: {exc.reason}") from None

    def _request(self, method: str, path: str, *, json_body=None, multipart=None, expect=(200, 201, 204)):
        headers = {"Authorization": f"Bearer {self._key}"}
        body = None
        if json_body is not None:
            headers["Content-Type"] = "application/json"
            body = json.dumps(json_body).encode("utf-8")
        elif multipart is not None:
            boundary = uuid.uuid4().hex
            headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
            body = _encode_multipart(boundary, multipart)
        status, payload = self._transport(method, f"{self._base}{path}", headers, body)
        if status not in expect:
            detail = payload.decode("utf-8", "replace")[:300] if payload else ""
            raise ProbeError(f"Soniox 요청 실패 {method} {path}: HTTP {status} {detail}")
        return json.loads(payload) if payload else {}

    def upload(self, path: Path) -> dict:
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        return self._request("POST", "/files", multipart={"file": (path.name, mime, path.read_bytes())})

    def create(self, file_id: str, model: str, language_hints: list[str], context: Optional[dict] = None) -> dict:
        body = {"model": model, "file_id": file_id, "language_hints": language_hints}
        if context:
            body["context"] = context
        return self._request("POST", "/transcriptions", json_body=body)

    def get(self, transcription_id: str) -> dict:
        return self._request("GET", f"/transcriptions/{transcription_id}")

    def transcript(self, transcription_id: str) -> dict:
        return self._request("GET", f"/transcriptions/{transcription_id}/transcript")

    def delete_transcription(self, transcription_id: str) -> None:
        self._request("DELETE", f"/transcriptions/{transcription_id}", expect=(200, 204, 404))

    def delete_file(self, file_id: str) -> None:
        self._request("DELETE", f"/files/{file_id}", expect=(200, 204, 404))

    def wait(self, transcription_id: str, timeout_s: float = 180.0, interval_s: float = 1.5, sleep=time.sleep) -> dict:
        waited = 0.0
        while True:
            info = self.get(transcription_id)
            status = info.get("status")
            if status == "completed":
                return info
            if status in ("error", "failed"):
                raise ProbeError(f"변환 실패: {info.get('error_type') or ''} {info.get('error_message') or ''}".strip())
            if waited >= timeout_s:
                raise ProbeError(f"{timeout_s:g}초 안에 끝나지 않았습니다 (상태: {status})")
            sleep(interval_s)
            waited += interval_s


def _encode_multipart(boundary: str, fields: dict) -> bytes:
    out = bytearray()
    for name, (filename, mime, data) in fields.items():
        out += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\n".encode()
        out += f"Content-Type: {mime}\r\n\r\n".encode() + data + b"\r\n"
    out += f"--{boundary}--\r\n".encode()
    return bytes(out)


def transcript_text(payload: dict) -> str:
    """결과에서 문장을 만든다. text가 있으면 그것을, 없으면 토큰 text를 이어 붙인다."""
    if isinstance(payload.get("text"), str):
        return payload["text"].strip()
    return "".join(t.get("text", "") for t in payload.get("tokens", [])).strip()


# ---- 입력 수집 -----------------------------------------------------------
def load_script(path) -> dict[str, str]:
    """정답 문장표: 한 줄에 `파일이름(확장자 없이)<TAB>문장`. #로 시작하는 줄은 주석."""
    script = {}
    for n, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, sep, sentence = line.partition("\t")
        if not sep or not key.strip() or not sentence.strip():
            raise ProbeError(f"문장표 {n}행 형식 오류: '파일이름<TAB>문장'이어야 합니다")
        script[key.strip()] = sentence.strip()
    return script


def collect_audio(paths: list[str]) -> list[Path]:
    files: list[Path] = []
    for raw in paths:
        p = Path(raw)
        if p.is_dir():
            files += sorted(f for f in p.iterdir() if f.suffix.lower() in AUDIO_SUFFIXES)
        elif p.is_file():
            files.append(p)
        else:
            raise ProbeError(f"파일이나 폴더가 없습니다: {raw}")
    if not files:
        raise ProbeError("변환할 오디오 파일이 없습니다")
    return files


def run_probe(files: list[Path], client: SonioxClient, *, model: str, script: dict[str, str],
              previous_hashes: dict[str, str], keep: bool = False, context: Optional[dict] = None,
              sleep=time.sleep) -> dict:
    hashes = {f.name: sha256_file(f) for f in files}
    changed = verify_against_previous(hashes, previous_hashes)
    if changed:
        raise ProbeError(f"이전 실행과 해시가 다른 녹음 파일: {', '.join(changed)} (파일이 바뀌었으면 결과 파일을 새로 만드세요)")
    items = []
    for f in files:
        uploaded = client.upload(f)
        created = client.create(uploaded["id"], model, ["ko"], api_context(context))
        try:
            client.wait(created["id"], sleep=sleep)
            payload = client.transcript(created["id"])
        finally:
            if not keep:
                client.delete_transcription(created["id"])
                client.delete_file(uploaded["id"])
        analysis = analyze_text(transcript_text(payload), script.get(f.stem))
        items.append({"file": f.name, "audio_sha256": hashes[f.name], "model": model, "context_used": bool(context),
                      "transcription_id": created["id"], "tokens": payload.get("tokens", []), **analysis})
    return {"model": model, "audio_sha256": hashes, "summary": summarize(items), "items": items,
            "context": api_context(context), "gazetteer_sha256": (context or {}).get("_gazetteer_sha256")}


def compare_with_baseline(result: dict, baseline: dict) -> list[dict]:
    """이전 결과(baseline)와 문장이 달라진 파일만 돌려준다. 같은 파일 이름끼리 비교한다."""
    before = {i["file"]: i for i in baseline.get("items", [])}
    diffs = []
    for item in result["items"]:
        old = before.get(item["file"])
        if old is None or old["audio_sha256"] != item["audio_sha256"]:
            continue  # 새 파일이거나 녹음이 바뀌었으면 비교하지 않는다
        if normalize(old["text"]) != normalize(item["text"]) or old["text"] != item["text"]:
            diffs.append({"file": item["file"], "before": old["text"], "after": item["text"],
                          "cer_before": old.get("cer"), "cer_after": item.get("cer")})
    return diffs


# ---- 출력 ----------------------------------------------------------------
def format_summary(result: dict) -> str:
    s = result["summary"]
    lines = [f"Soniox 출력 형식 확인 · 파일 {s['n']}개 · 모델 {result['model']}"]
    lines.append("거리 숫자 형태: " + ", ".join(f"{k} {v}개" for k, v in sorted(s["number_styles"].items())))
    if s["mean_cer"] is not None:
        lines.append(f"평균 글자 오류율(띄어쓰기·구두점 제외): {s['mean_cer'] * 100:.1f}% · 정답과 완전 일치 {s['exact_matches']}개")
    if s["korean_numerals_unparsed"]:
        lines.append("한글 수사로 나와 locate가 거리를 못 읽는 문장: " + " / ".join(s["korean_numerals_unparsed"]))
    lines.append("")
    for item in result["items"]:
        mark = "" if "cer" not in item else f"  [오류율 {item['cer'] * 100:.0f}%]"
        lines.append(f"{item['file']}{mark}")
        if "expected" in item:
            lines.append(f"  정답: {item['expected']}")
        lines.append(f"  결과: {item['text']}")
        events = " / ".join(f"{e['type']}·{e['location'] or '위치없음'}·{e['confidence']}" for e in item["events"]) or "(이벤트 없음)"
        rel = "" if not item["relative_parsed"] else f" · 상대위치 {item['relative_parsed']['direction']} {item['relative_parsed']['distance_m']:g}m"
        lines.append(f"  추출: {events}{rel}")
    return "\n".join(lines)


def format_diffs(diffs: list[dict]) -> str:
    if not diffs:
        return "이전 결과와 달라진 문장이 없습니다."
    def pct(v):
        return "-" if v is None else f"{v * 100:.0f}%"
    lines = [f"이전 결과와 달라진 문장 {len(diffs)}개"]
    for d in diffs:
        lines += [f"{d['file']}  [오류율 {pct(d['cer_before'])} → {pct(d['cer_after'])}]",
                  f"  이전: {d['before']}", f"  이후: {d['after']}"]
    return "\n".join(lines)


def main(argv: Optional[list[str]] = None) -> None:
    parser = argparse.ArgumentParser(description="Soniox 출력 형식 확인 (녹음 → 변환 → 추출 점검)")
    parser.add_argument("audio", nargs="*", help="오디오 파일 또는 폴더")
    parser.add_argument("--script", help="정답 문장표 (파일이름<TAB>문장)")
    parser.add_argument("--out", help="결과 JSON 저장 경로 (원본 토큰 포함). 같은 경로가 있으면 녹음 파일 해시를 검증한다")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--gazetteer", help="구역명 사전 JSON: 이름·별칭을 Soniox 용어(context.terms)로 보낸다")
    parser.add_argument("--baseline", help="이전 결과 JSON: 달라진 문장만 비교해 보여 준다")
    parser.add_argument("--keep", action="store_true", help="Soniox에 올린 파일과 변환 결과를 지우지 않는다")
    parser.add_argument("--analyze-text", help="네트워크 없이 문장 하나만 점검")
    args = parser.parse_args(argv)

    if args.analyze_text is not None:
        item = analyze_text(args.analyze_text)
        print(json.dumps(item, ensure_ascii=False, indent=2))
        return
    if not args.audio:
        parser.error("오디오 파일/폴더 또는 --analyze-text가 필요합니다")
    try:
        files = collect_audio(args.audio)
        script = load_script(args.script) if args.script else {}
        previous = {}
        if args.out and Path(args.out).exists():
            previous = json.loads(Path(args.out).read_text(encoding="utf-8")).get("audio_sha256", {})
        context = build_context(args.gazetteer) if args.gazetteer else None
        baseline = json.loads(Path(args.baseline).read_text(encoding="utf-8")) if args.baseline else None
        client = SonioxClient(os.environ.get("SONIOX_API_KEY", ""))
        result = run_probe(files, client, model=args.model, script=script, previous_hashes=previous, keep=args.keep,
                           context=context)
    except ProbeError as exc:
        print(f"오류: {exc}", file=sys.stderr)
        raise SystemExit(1)
    print(format_summary(result))
    if baseline is not None:
        print("\n" + format_diffs(compare_with_baseline(result, baseline)))
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n결과 저장: {args.out}")


if __name__ == "__main__":
    main()
