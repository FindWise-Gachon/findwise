"""텍스트 무전 보고를 이벤트 후보로 구조화한다 (규칙 기반, 1단계).

프로토타입(index.html의 parseReport) 규칙을 모듈로 옮기고 아래를 보완했다.
  - 부정 표현 처리: "발견하지 못했다"는 흔적 발견이 아니라 수색 완료(미발견), "위험은 없다"는 위험 요소가 아니다
  - 여러 문장이면 문장마다 이벤트 후보를 만든다 (쉼표로는 나누지 않는다)
  - 위치 표현을 문자열로 뽑는다 (예: "동쪽 계곡"). 좌표(x, y)는 구역명 사전이나 보고 대원의 기준 좌표를 넘겼을 때만
    locate가 채운다(지명 하나, 또는 '여기서 북쪽 200m'). 그 밖에는 좌표 없이 표현만 남기고, 좌표가 없으면
    승인해도 지도에 반영되지 않고 기록만 남는다 (지도 클릭으로 지정)
  - 분류하지 못한 보고는 이벤트를 만들지 않고 '기록만'으로 둔다

이 모듈은 AI가 아니며, 결과는 모두 '승인 대기'다. 지휘관이 유형·위치·확인 강도를 확인하고 고친 뒤에만
지도에 반영한다(AGENTS.md: 현장 보고는 검토·승인 후에만 반영).

명령줄(개발용 미리보기에서 호출할 때):
    PYTHONPATH=backend python -m app.radio.extract "동쪽 계곡 수색 완료, 아무것도 없습니다."
    PYTHONPATH=backend python -m app.radio.extract "여기서 북쪽 200m 수색 완료" --reference 270000 4182000
    PYTHONPATH=backend python -m app.radio.extract "두 번째 갈림길 수색 완료" --gazetteer data/samples/radio-gazetteer-example.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from .locate import Gazetteer, Place, parse_relative, resolve_from_place, resolve_relative
from .schema import Confidence, EventType, FieldEvent, Location, RadioReport, Status
from .update_map import GridSpec

# ---- 위치 표현 ---------------------------------------------------------
_B = r"(?<![가-힣A-Za-z0-9])"  # 단어 시작 (예: '에서'의 '서'를 방향으로 읽지 않기 위해)
_DIR = r"(?:북서|북동|남서|남동|동|서|남|북)"
_FEATURE = r"(?:계곡|능선|사면|등산로|절벽|폭포|정상|봉우리|숲|개울|하천|임도|갈림길|주차장|전망대|바위|암벽)"
_LOC_FULL = re.compile(rf"{_B}{_DIR}(?:쪽|부)?\s*{_FEATURE}")
_LOC_DIR = re.compile(rf"{_B}{_DIR}(?:쪽|부)")
_LOC_ZONE = re.compile(rf"{_B}(?:제\s*)?\d+\s*(?:구역|구간|지구)")  # "3구역" 같은 번호 구역
_LOC_RELATIVE = re.compile(r"여기|현재\s*위치|제\s*위치|우리\s*위치")

# ---- 유형 규칙 (위에서부터 먼저 맞는 것) ----------------------------------
_INCOMPLETE = re.compile(r"못\s*갔.*(봤|수색)|미완료|완료\s*아님|안\s*끝|끝나지\s*(?:않|못)|완료되지\s*않|마치지\s*(?:못|않)")
# 이미 해소된 위험·통제는 새 이벤트가 아니다 (기록만)
_RESOLVED = re.compile(r"(?:위험|낙석|붕괴|통제|통행|진입)\S{0,4}\s*(?:해제|해소|사라|없어졌|풀렸|치웠|복구)")
# "위험은 없다", "위험한 곳은 없었고"처럼 위험 바로 뒤에서 부정하는 표현 (곳·지역 같은 말 한 마디만 사이에 허용:
# 아무 말이나 허용하면 "낙석 위험, 길도 없습니다"의 위험을 놓친다)
_HAZARD_NEGATED = re.compile(r"(위험|낙석|붕괴)\S{0,3}\s*(?:(?:곳|지역|구간|부분|데|것)\S{0,2}\s*)?(없|아니)")
_HAZARD = re.compile(r"낙석|위험|붕괴")
_BLOCKED = re.compile(
    r"진입\s*불가|접근\s*불가|통행\s*불가|못\s*내려|못\s*갔"
    r"|(?:올라갈|건널|건너갈|지나갈|지날|통과할|들어갈|내려갈|넘을|갈|진입할|접근할|통행할)\s*수(?:가)?\s*없"
    r"|(?:진입|접근|통행|통과)(?:이|가)?\s*안\s*(?:됩|돼|된)|막혀|막혔|막고\s*있|끊겨|끊겼|끊어졌")
_NOT_FOUND = re.compile(
    r"미발견|아무것도\s*없|흔적\s*없|단서\s*없|없어요|없습니다|없음"
    r"|발견\s*(?:하지\s*)?못|발견되지\s*않|찾지\s*못|찾을\s*수\s*없|못\s*(?:찾|발견)")
_CLUE = re.compile(
    r"발견|습득|찾았"
    r"|(?:발자국|자국|신발|장갑|모자|스틱|물병|로프|배낭|옷|흔적).{0,12}(?:보이|보입|있습|있어|떨어져|봤)")
_SEARCHED = re.compile(
    r"수색.*(?:완료|끝|마쳤|종료|마무리)|꼼꼼(?:히|하게).*봤|대충.*훑|확인.*완료|살펴\s*봤|훑어\s*봤"
    r"|둘러\s*봤|둘러봤|다\s*봤|클리어")

# ---- 확인 강도 ---------------------------------------------------------
_THOROUGH = re.compile(r"꼼꼼|정밀")
_ROUGH = re.compile(r"대충|훑")

# 소수점("1.5 km")은 문장 끝이 아니다: 숫자 사이의 마침표는 나누지 않는다
_SENTENCE_SPLIT = re.compile(r"(?:[!?;\n]|\.(?!\d)|(?<!\d)\.)+")


@dataclass(frozen=True)
class Extraction:
    """구조화 결과. report의 모든 이벤트는 '승인 대기'이며, warnings는 지휘관 확인 화면에 보여 줄 안내다."""
    report: RadioReport
    warnings: tuple[str, ...] = ()

    def to_dict(self) -> dict:
        return {"report": self.report.to_dict(), "warnings": list(self.warnings)}


def classify(sentence: str) -> Optional[tuple[EventType, str]]:
    """한 문장의 (이벤트 유형, 일치한 규칙 이름). 판단할 수 없으면 None.

    '위험은 없다'처럼 위험을 부정하는 표현은 위험 요소가 아니며, 같은 표현을 '아무것도 없다(미발견)'로도
    읽지 않도록 그 부분을 뺀 나머지 문장으로 다른 규칙을 판단한다.
    """
    if _INCOMPLETE.search(sentence) or _RESOLVED.search(sentence):
        return None
    negated = _HAZARD_NEGATED.search(sentence)
    if _HAZARD.search(sentence) and not negated:
        return EventType.HAZARD, "hazard"
    rest = _HAZARD_NEGATED.sub(" ", sentence) if negated else sentence
    if _BLOCKED.search(rest):
        return EventType.BLOCKED, "blocked"
    if _NOT_FOUND.search(rest):
        return EventType.SEARCHED, "not_found"
    if _CLUE.search(rest):
        return EventType.CLUE, "clue"
    if _SEARCHED.search(rest):
        return EventType.SEARCHED, "searched"
    return None


def find_location(sentence: str) -> Location:
    """문장에서 위치 표현을 찾는다. 좌표는 정하지 않는다(x, y 없음)."""
    for pattern, kind in ((_LOC_FULL, "지명"), (_LOC_DIR, "지명"), (_LOC_ZONE, "지명"), (_LOC_RELATIVE, "상대위치")):
        found = pattern.search(sentence)
        if found:
            return Location(kind=kind, value=re.sub(r"\s+", " ", found.group(0)).strip())
    return Location(kind="지명", value="")


def locate_sentence(sentence: str, gazetteer: Optional[Gazetteer] = None,
                    reference_xy: Optional[tuple[float, float]] = None,
                    grid: Optional[GridSpec] = None) -> tuple[Location, list[str]]:
    """한 문장의 위치를 (Location, 경고)로 정한다. 좌표를 못 정해도 위치 표현은 남긴다.

    우선순위: 구역명 사전의 지명 > '여기서 북쪽 200m' 같은 상대 위치 > 방향+지형 단어.
    기준을 말하지 않은 상대 위치("동쪽 계곡에서 북쪽 200m")는 어디서부터인지 알 수 없어 계산하지 않는다.
    다만 사전의 지명 뒤에 "에서/부터/기준"이 붙으면("두 번째 갈림길에서 북쪽 200m") 그 지명 좌표에서 계산한다.
    """
    warnings: list[str] = []
    place = None
    if gazetteer is not None:
        place, place_warnings = gazetteer.resolve(sentence)
        warnings += place_warnings
    relative = parse_relative(sentence)
    if relative is None:
        return (place if place is not None else find_location(sentence)), warnings

    start, end = relative.span
    landmark = place if place is not None else find_location(sentence[:start] + " " + sentence[end:])
    if relative.has_reference or not landmark.value:
        # 기준을 말했거나, 기준이 될 만한 다른 위치가 없으면 보고 대원 위치에서 계산한다
        location, relative_warnings = resolve_relative(sentence, reference_xy, grid=grid)
        warnings += relative_warnings
        return (location if location is not None else Location(kind="상대위치", value=relative.text)), warnings
    # 사전의 지명 바로 뒤에 "에서/부터/기준"이 붙은 상대 위치("두 번째 갈림길에서 북쪽 200m")는 그 지명 좌표에서 계산한다
    anchor = _anchor_place(sentence[:start], gazetteer, sentence)
    if anchor is not None:
        location, anchor_warnings = resolve_from_place(sentence, anchor, grid=grid)
        warnings += anchor_warnings
        if location is not None:
            return location, warnings
        return Location(kind="상대위치", value=f"{anchor.name}에서 {relative.text}"), warnings
    warnings.append(f"'{relative.text}'는 기준 지점이 불분명해 계산하지 않았습니다. 지도에서 위치를 지정해 주세요")
    return landmark, warnings


_ANCHOR_SUFFIXES = ("에서부터", "으로부터", "에서", "서부터", "부터", "기준으로", "기준에서", "기준")


def _anchor_place(prefix: str, gazetteer: Optional[Gazetteer], sentence: str) -> Optional[Place]:
    """prefix(상대 위치 표현 앞부분)가 사전 지명 + 기준 조사로 끝나면 그 지명을 돌려준다.
    문장에 사전 지명이 정확히 하나일 때만 인정한다(여럿이면 어느 것이 기준인지 알 수 없다)."""
    if gazetteer is None:
        return None
    found = gazetteer.find(sentence)
    if len(found) != 1:
        return None
    place, _ = found[0]
    compact = re.sub(r"\s+", "", prefix).lower()
    for name in (place.name, *place.aliases):
        key = re.sub(r"\s+", "", name).lower()
        if any(compact.endswith(key + suffix) for suffix in _ANCHOR_SUFFIXES):
            return place
    return None


def find_confidence(sentence: str) -> Confidence:
    if _THOROUGH.search(sentence):
        return Confidence.THOROUGH
    if _ROUGH.search(sentence):
        return Confidence.ROUGH
    return Confidence.NORMAL


def extract_report(text: str, report_id: str, reporter: str = "",
                   time: Optional[str] = None, *, gazetteer: Optional[Gazetteer] = None,
                   reference_xy: Optional[tuple[float, float]] = None,
                   grid: Optional[GridSpec] = None) -> Extraction:
    """무전 텍스트를 RadioReport(이벤트 후보)로 구조화한다.

    gazetteer, reference_xy(보고 대원의 투영좌표), grid를 주면 위치 좌표도 가능한 만큼 채운다(locate_sentence).
    """
    raw = (text or "").strip()
    if not raw:
        raise ValueError("보고 내용이 비어 있습니다")

    warnings: list[str] = []
    events: list[FieldEvent] = []
    for sentence in (s.strip() for s in _SENTENCE_SPLIT.split(raw)):
        if not sentence:
            continue
        result = classify(sentence)
        if result is None:
            warnings.append(f"유형을 판단하지 못한 문장: '{sentence}'")
            continue
        kind, rule = result
        location, location_warnings = locate_sentence(sentence, gazetteer, reference_xy, grid)
        warnings += location_warnings
        # 위치 없이 '아무것도 없다'만 말한 문장은 바로 앞 수색 완료 이벤트의 설명으로 붙인다
        if (rule == "not_found" and not location.value and events
                and events[-1].type == EventType.SEARCHED):
            events[-1].note = events[-1].note or "흔적 없음"
            continue
        if kind == EventType.SEARCHED:
            note = "흔적 없음" if rule == "not_found" else ""  # 뒤 문장의 '아무것도 없다'가 붙을 수 있게 비워 둔다
        else:
            note = sentence
        if not location.value:
            warnings.append(f"위치 표현을 찾지 못했습니다: '{sentence}' (지도에서 위치를 지정해야 반영됩니다)")
        events.append(FieldEvent(
            event_id=f"{report_id}-{len(events)}", type=kind, location=location,
            confidence=find_confidence(sentence), note=note, status=Status.PENDING))

    if not events:
        warnings.append("이벤트를 만들지 못했습니다. 기록만 남기고 지도는 바꾸지 않습니다")
    stamp = time or datetime.now(timezone.utc).isoformat(timespec="seconds")
    report = RadioReport(report_id=report_id, time=stamp, reporter=reporter, raw_text=raw, events=events,
                         status=Status.PENDING if events else Status.LOG_ONLY)
    return Extraction(report=report, warnings=tuple(warnings))


def main(argv: Optional[list[str]] = None) -> None:
    parser = argparse.ArgumentParser(description="무전 텍스트를 이벤트 후보로 구조화한다")
    parser.add_argument("text", nargs="*", help="무전 문장 (없으면 표준입력)")
    parser.add_argument("--gazetteer", help="구역명 사전 JSON")
    parser.add_argument("--grid", help="격자 JSON (사전 좌표 검사, lon/lat 변환, 상대 위치의 격자 밖 검사)")
    parser.add_argument("--reference", nargs=2, type=float, metavar=("X", "Y"), help="보고 대원의 투영좌표")
    args = parser.parse_args(argv)
    text = " ".join(args.text) if args.text else sys.stdin.read()
    try:
        grid = GridSpec.from_json_file(args.grid) if args.grid else None
        gazetteer = Gazetteer.from_json_file(args.gazetteer, grid) if args.gazetteer else None
        output = extract_report(text, report_id="preview", gazetteer=gazetteer, grid=grid,
                                reference_xy=tuple(args.reference) if args.reference else None).to_dict()
    except (ValueError, OSError) as error:
        output = {"error": str(error)}
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    main()
