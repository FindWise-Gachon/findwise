"""무전 시험지로 보고 구조화(extract) 정확도를 잰다.

시험지(JSON)의 각 문장에는 사람이 붙인 정답(이벤트 목록)이 있고, 구조화 결과와 비교해 아래를 계산한다.
  - 유형 분류: 유형별 정밀도·재현율·F1 (이벤트 단위, 순서 무관)
  - 위치 표현 정확도: 유형이 맞은 이벤트 중 위치 표현이 같은 비율 (공백 무시)
  - 확인 강도 정확도: 유형이 맞은 '수색 완료' 이벤트 중 강도가 같은 비율 (강도는 수색 완료의 POD에만 쓰인다)
  - 기록만 정확도: 정답이 '이벤트 없음'인 문장을 이벤트 없이 둔 비율
  - 태그별 유형 일치율, 틀린 문장 목록

실행 (저장소 루트):
    PYTHONPATH=backend python -m app.radio.evaluate data/samples/radio-test-set.json
    PYTHONPATH=backend python -m app.radio.evaluate data/samples/radio-test-set.json --json

나중에 LLM 구조화를 붙이면 같은 시험지·같은 입출력(Predictor)으로 비교한다. 결과에는 시험지 파일의
SHA-256을 함께 적어, 어떤 버전의 시험지로 잰 점수인지 확인할 수 있다.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Callable, Optional

from .extract import extract_report
from .locate import Gazetteer
from .schema import Confidence, EventType
from .update_map import GridSpec

TYPES = [t.value for t in EventType]
CONFIDENCES = [c.value for c in Confidence]
SEARCHED = EventType.SEARCHED.value

# 구조화 함수의 입출력: 문장 -> [{"type": 유형, "location": 위치 표현, "confidence": 강도}, ...]
Predicted = list[dict]
Predictor = Callable[[str], Predicted]


def make_predictor(gazetteer: Optional[Gazetteer] = None, reference_xy: Optional[tuple[float, float]] = None,
                   grid: Optional[GridSpec] = None) -> Predictor:
    """규칙 기반 extract_report를 시험지 비교용 형태로 바꾼다. 사전·기준 좌표를 주면 위치 확정까지 포함해 잰다."""
    def predict(text: str) -> Predicted:
        try:
            extraction = extract_report(text, report_id="eval", gazetteer=gazetteer,
                                        reference_xy=reference_xy, grid=grid)
        except ValueError:
            return []
        return [{"type": e.type.value, "location": e.location.value, "confidence": e.confidence.value}
                for e in extraction.report.events]
    return predict


rule_based_predictor = make_predictor()  # 사전·기준 좌표 없이 (표현만 추출)


def sha256_file(path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


# ---- 시험지 읽기 ---------------------------------------------------------
def _fail(case_id: str, message: str):
    raise ValueError(f"시험지 {case_id}: {message}")


def load_test_set(path) -> tuple[list[dict], str]:
    """(검증된 문항 목록, 파일 SHA-256)을 돌려준다. 형식이 틀리면 ValueError."""
    raw = Path(path).read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    data = json.loads(raw.decode("utf-8"))
    cases = data.get("cases") if isinstance(data, dict) else None
    if not isinstance(cases, list) or not cases:
        raise ValueError("시험지에 'cases' 목록이 없습니다")
    seen = set()
    result = []
    for index, case in enumerate(cases):
        cid = case.get("id") if isinstance(case, dict) else None
        if not isinstance(cid, str) or not cid:
            raise ValueError(f"시험지 {index + 1}번째 문항에 id가 없습니다")
        if cid in seen:
            _fail(cid, "id가 중복됩니다")
        seen.add(cid)
        text = case.get("text")
        if not isinstance(text, str) or not text.strip():
            _fail(cid, "text가 비어 있습니다")
        expected = case.get("expected")
        if not isinstance(expected, list):
            _fail(cid, "expected는 목록이어야 합니다 (이벤트가 없으면 [])")
        events = []
        for event in expected:
            if not isinstance(event, dict) or event.get("type") not in TYPES:
                _fail(cid, f"type은 {TYPES} 중 하나여야 합니다")
            confidence = event.get("confidence", Confidence.NORMAL.value)
            if confidence not in CONFIDENCES:
                _fail(cid, f"confidence는 {CONFIDENCES} 중 하나여야 합니다")
            location = event.get("location", "")
            if not isinstance(location, str):
                _fail(cid, "location은 문자열이어야 합니다 (없으면 \"\")")
            events.append({"type": event["type"], "location": location, "confidence": confidence})
        tags = case.get("tags", [])
        if not isinstance(tags, list) or not all(isinstance(tag, str) for tag in tags):
            _fail(cid, "tags는 문자열 목록이어야 합니다")
        result.append({"id": cid, "text": text, "tags": tags, "expected": events})
    return result, digest


# ---- 점수 계산 -----------------------------------------------------------
def _norm(location: str) -> str:
    return re.sub(r"\s+", "", location or "")


def _prf(tp: int, fp: int, fn: int) -> dict:
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    if precision is None or recall is None:
        f1 = 0.0 if tp + fn else None
    else:
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"tp": tp, "fp": fp, "fn": fn, "precision": precision, "recall": recall, "f1": f1}


def score(cases: list[dict], predictor: Predictor = rule_based_predictor) -> dict:
    counts = {t: Counter() for t in TYPES}
    location = Counter()    # n, correct
    confidence = Counter()  # n, correct
    log_only = Counter()    # n, correct
    by_tag: dict[str, Counter] = {}
    type_exact = full_exact = 0
    failures = []

    for case in cases:
        expected, predicted = case["expected"], predictor(case["text"])
        e_types = Counter(e["type"] for e in expected)
        p_types = Counter(p["type"] for p in predicted)
        for t in TYPES:
            tp = min(e_types[t], p_types[t])
            counts[t]["tp"] += tp
            counts[t]["fp"] += p_types[t] - tp
            counts[t]["fn"] += e_types[t] - tp

        types_ok = e_types == p_types
        fields_ok = True
        for t in TYPES:  # 같은 유형끼리 나온 순서대로 짝지어 위치·강도를 비교한다
            pairs = zip([e for e in expected if e["type"] == t], [p for p in predicted if p["type"] == t])
            for e, p in pairs:
                location["n"] += 1
                if _norm(e["location"]) == _norm(p["location"]):
                    location["correct"] += 1
                else:
                    fields_ok = False
                if t == SEARCHED:
                    confidence["n"] += 1
                    if e["confidence"] == p["confidence"]:
                        confidence["correct"] += 1
                    else:
                        fields_ok = False
        if not expected:
            log_only["n"] += 1
            log_only["correct"] += int(not predicted)

        type_exact += types_ok
        full_exact += types_ok and fields_ok
        for tag in case["tags"]:
            by_tag.setdefault(tag, Counter())["n"] += 1
            by_tag[tag]["type_exact"] += types_ok
        if not (types_ok and fields_ok):
            failures.append({"id": case["id"], "text": case["text"], "tags": case["tags"],
                             "expected": expected, "predicted": predicted})

    per_type = {t: _prf(counts[t]["tp"], counts[t]["fp"], counts[t]["fn"]) for t in TYPES}
    total = Counter()
    for c in counts.values():
        total.update(c)
    present = [v["f1"] for t, v in per_type.items() if counts[t]["tp"] + counts[t]["fn"] > 0]
    return {
        "n_cases": len(cases),
        "types": per_type,
        "micro_f1": _prf(total["tp"], total["fp"], total["fn"])["f1"],
        "macro_f1": sum(present) / len(present) if present else None,
        "type_exact_cases": type_exact,
        "full_exact_cases": full_exact,
        "location": {"n": location["n"], "correct": location["correct"]},
        "confidence": {"n": confidence["n"], "correct": confidence["correct"]},
        "log_only": {"n": log_only["n"], "correct": log_only["correct"]},
        "by_tag": {tag: {"n": c["n"], "type_exact": c["type_exact"]} for tag, c in sorted(by_tag.items())},
        "failures": failures,
    }


# ---- 출력 ----------------------------------------------------------------
def _pct(value: Optional[float]) -> str:
    return "  -  " if value is None else f"{value * 100:5.1f}%"


def _ratio(part: dict) -> str:
    return f"{part['correct']}/{part['n']}" + (f" ({part['correct'] / part['n'] * 100:.1f}%)" if part["n"] else "")


def format_report(result: dict, sha256: str = "", path: str = "", settings: str = "") -> str:
    lines = [f"무전 시험지 평가 · 문항 {result['n_cases']}개"]
    if path or sha256:
        lines.append(f"시험지: {path}  SHA-256 {sha256}")
    if settings:
        lines.append(f"설정: {settings}")
    lines += ["", "[유형 분류]  정밀도  재현율     F1   (TP/FP/FN)"]
    for t, v in result["types"].items():
        lines.append(f"  {t:<8}{_pct(v['precision'])} {_pct(v['recall'])} {_pct(v['f1'])}   ({v['tp']}/{v['fp']}/{v['fn']})")
    lines.append(f"  전체 micro F1 {_pct(result['micro_f1'])} · macro F1 {_pct(result['macro_f1'])}")
    lines += ["", "[문항 단위]",
              f"  유형이 모두 맞음      {result['type_exact_cases']}/{result['n_cases']}",
              f"  유형·위치·강도 모두 맞음 {result['full_exact_cases']}/{result['n_cases']}",
              f"  위치 표현 (유형이 맞은 이벤트)  {_ratio(result['location'])}",
              f"  확인 강도 (맞은 수색 완료)      {_ratio(result['confidence'])}",
              f"  기록만 (정답이 이벤트 없음)     {_ratio(result['log_only'])}"]
    if result["by_tag"]:
        lines += ["", "[태그별 유형 일치]"]
        lines += [f"  {tag:<14}{v['type_exact']}/{v['n']}" for tag, v in result["by_tag"].items()]
    if result["failures"]:
        lines += ["", f"[틀린 문항 {len(result['failures'])}개]"]
        for f in result["failures"]:
            lines.append(f"  {f['id']}  {f['text']}")
            lines.append(f"      정답: {_events(f['expected'])}")
            lines.append(f"      결과: {_events(f['predicted'])}")
    return "\n".join(lines)


def _events(events: list[dict]) -> str:
    if not events:
        return "(이벤트 없음)"
    return " / ".join(f"{e['type']}·{e['location'] or '위치없음'}·{e['confidence']}" for e in events)


def main(argv: Optional[list[str]] = None) -> None:
    parser = argparse.ArgumentParser(description="무전 시험지로 구조화 정확도를 잰다")
    parser.add_argument("test_set", help="시험지 JSON 경로")
    parser.add_argument("--json", action="store_true", help="결과를 JSON으로 출력")
    parser.add_argument("--gazetteer", help="구역명 사전 JSON (위치 확정까지 포함해 잰다)")
    parser.add_argument("--grid", help="격자 JSON (사전 좌표 검사와 lon/lat 변환에 사용)")
    parser.add_argument("--reference", nargs=2, type=float, metavar=("X", "Y"), help="보고 대원의 투영좌표")
    args = parser.parse_args(argv)
    grid = GridSpec.from_json_file(args.grid) if args.grid else None
    gazetteer = Gazetteer.from_json_file(args.gazetteer, grid) if args.gazetteer else None
    reference = tuple(args.reference) if args.reference else None
    cases, digest = load_test_set(args.test_set)
    result = score(cases, make_predictor(gazetteer, reference, grid))
    settings = []
    if args.gazetteer:
        settings.append(f"구역명 사전 {args.gazetteer} (SHA-256 {sha256_file(args.gazetteer)})")
    if args.grid:
        settings.append(f"격자 {args.grid}")
    if reference:
        settings.append(f"기준 좌표 {reference[0]:g}, {reference[1]:g}")
    if args.json:
        print(json.dumps({"test_set": args.test_set, "sha256": digest, "settings": settings, **result},
                         ensure_ascii=False, indent=2))
    else:
        print(format_report(result, digest, args.test_set, "; ".join(settings) or "사전·기준 좌표 없음"))


if __name__ == "__main__":
    main()
