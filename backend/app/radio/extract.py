"""텍스트 무전 보고를 이벤트 후보로 구조화한다 (규칙 기반, 1단계).

프로토타입(index.html의 parseReport) 규칙을 모듈로 옮기고 아래를 보완했다.
  - 부정 표현 처리: "발견하지 못했다"는 흔적 발견이 아니라 수색 완료(미발견), "위험은 없다"는 위험 요소가 아니다
  - 여러 문장이면 문장마다 이벤트 후보를 만든다 (쉼표로는 나누지 않는다)
  - 위치 표현을 문자열로 뽑는다 (예: "동쪽 계곡"). 좌표(x, y)는 정하지 않는다
    → 지도 클릭이나 구역 사전(locate)이 정하고, 없으면 승인해도 지도에 반영되지 않고 기록만 남는다
  - 분류하지 못한 보고는 이벤트를 만들지 않고 '기록만'으로 둔다

이 모듈은 AI가 아니며, 결과는 모두 '승인 대기'다. 지휘관이 유형·위치·확인 강도를 확인하고 고친 뒤에만
지도에 반영한다(AGENTS.md: 현장 보고는 검토·승인 후에만 반영).

명령줄(개발용 미리보기에서 호출할 때):
    PYTHONPATH=backend python -m app.radio.extract "동쪽 계곡 수색 완료, 아무것도 없습니다."
"""
from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from .schema import Confidence, EventType, FieldEvent, Location, RadioReport, Status

# ---- 위치 표현 ---------------------------------------------------------
_B = r"(?<![가-힣A-Za-z0-9])"  # 단어 시작 (예: '에서'의 '서'를 방향으로 읽지 않기 위해)
_DIR = r"(?:북서|북동|남서|남동|동|서|남|북)"
_FEATURE = r"(?:계곡|능선|사면|등산로|절벽|폭포|정상|봉우리|숲|개울|하천|임도|갈림길|주차장|전망대|바위|암벽)"
_LOC_FULL = re.compile(rf"{_B}{_DIR}(?:쪽|부)?\s*{_FEATURE}")
_LOC_DIR = re.compile(rf"{_B}{_DIR}(?:쪽|부)")
_LOC_RELATIVE = re.compile(r"여기|현재\s*위치|제\s*위치|우리\s*위치")

# ---- 유형 규칙 (위에서부터 먼저 맞는 것) ----------------------------------
_INCOMPLETE = re.compile(r"못\s*갔.*(봤|수색)|미완료|완료\s*아님")
_HAZARD_NEGATED = re.compile(r"(위험|낙석|붕괴)\S{0,3}\s*(없|아니)")
_HAZARD = re.compile(r"낙석|위험|붕괴")
_BLOCKED = re.compile(r"진입\s*불가|접근\s*불가|통행\s*불가|못\s*내려|못\s*갔")
_NOT_FOUND = re.compile(
    r"미발견|아무것도\s*없|흔적\s*없|단서\s*없|없어요|없습니다|없음"
    r"|발견\s*(?:하지\s*)?못|발견되지\s*않|찾지\s*못|찾을\s*수\s*없")
_CLUE = re.compile(r"발견|습득|찾았")
_SEARCHED = re.compile(r"수색.*(?:완료|끝|마쳤)|꼼꼼히.*봤|대충.*훑|확인.*완료|살펴\s*봤|훑어\s*봤")

# ---- 확인 강도 ---------------------------------------------------------
_THOROUGH = re.compile(r"꼼꼼|정밀")
_ROUGH = re.compile(r"대충|훑")

_SENTENCE_SPLIT = re.compile(r"[.!?;\n]+")


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
    if _INCOMPLETE.search(sentence):
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
    for pattern, kind in ((_LOC_FULL, "지명"), (_LOC_DIR, "지명"), (_LOC_RELATIVE, "상대위치")):
        found = pattern.search(sentence)
        if found:
            return Location(kind=kind, value=re.sub(r"\s+", " ", found.group(0)).strip())
    return Location(kind="지명", value="")


def find_confidence(sentence: str) -> Confidence:
    if _THOROUGH.search(sentence):
        return Confidence.THOROUGH
    if _ROUGH.search(sentence):
        return Confidence.ROUGH
    return Confidence.NORMAL


def extract_report(text: str, report_id: str, reporter: str = "",
                   time: Optional[str] = None) -> Extraction:
    """무전 텍스트를 RadioReport(이벤트 후보)로 구조화한다."""
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
        location = find_location(sentence)
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
    args = sys.argv[1:] if argv is None else argv
    text = " ".join(args) if args else sys.stdin.read()
    try:
        output = extract_report(text, report_id="preview").to_dict()
    except ValueError as error:
        output = {"error": str(error)}
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    main()
