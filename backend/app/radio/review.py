"""④ 지휘관 승인: 이벤트의 승인 · 수정 후 승인 · 거절 상태 전이.

입력 이벤트는 바꾸지 않고 새 FieldEvent와 기록용 dict를 돌려준다. 화면·API와 무관한 순수 로직이다.
규칙
  - 처리자(reviewer)는 필수다.
  - 승인은 '승인 대기'에서만 가능하다. 이미 처리된 이벤트는 다시 처리할 수 없다.
  - 수정 후 승인·거절은 '승인 대기'와 '기록만'(위치·유형 불명)에서 가능하다. 지휘관이 위치를 채워 반영할 수 있어야 하기 때문이다.
  - 수정 가능한 항목은 type, confidence, note, location(좌표·반경·표시용 값)뿐이다. event_id 등은 바꿀 수 없다.
  - '수정 후 승인'은 실제로 값이 바뀌어야 한다. 바뀐 게 없으면 승인을 쓰라는 오류를 낸다.
  - 사람이 승인한 상태(승인, 수정 후 승인)만 update_map이 지도에 반영한다.
"""
from __future__ import annotations

import math
from dataclasses import replace
from datetime import datetime, timezone
from typing import Iterable, Optional

from .schema import APPLICABLE_STATUS, Confidence, EventType, FieldEvent, Location, RadioReport, Status

APPROVE, EDIT, REJECT = "승인", "수정", "거절"
ACTIONS = (APPROVE, EDIT, REJECT)
EDITABLE_FIELDS = {"type", "confidence", "note", "location"}
LOCATION_FIELDS = {"kind", "value", "lat", "lon", "x", "y", "radius_m"}


class ReviewError(ValueError):
    """승인 규칙을 어긴 요청."""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _finite(name: str, v) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise ReviewError(f"{name}은 유한한 숫자여야 합니다")
    return float(v)


def _apply_edits(event: FieldEvent, edits: dict) -> FieldEvent:
    unknown = set(edits) - EDITABLE_FIELDS
    if unknown:
        raise ReviewError(f"수정할 수 없는 항목: {sorted(unknown)}")
    new = event
    if "type" in edits:
        try:
            new = replace(new, type=EventType(edits["type"]))
        except ValueError:
            raise ReviewError(f"알 수 없는 유형: {edits['type']!r}") from None
    if "confidence" in edits:
        try:
            new = replace(new, confidence=Confidence(edits["confidence"]))
        except ValueError:
            raise ReviewError(f"알 수 없는 확인 강도: {edits['confidence']!r}") from None
    if "note" in edits:
        if not isinstance(edits["note"], str):
            raise ReviewError("note는 문자열이어야 합니다")
        new = replace(new, note=edits["note"])
    if "location" in edits:
        loc_edits = edits["location"]
        if not isinstance(loc_edits, dict):
            raise ReviewError("location은 dict여야 합니다")
        unknown = set(loc_edits) - LOCATION_FIELDS
        if unknown:
            raise ReviewError(f"수정할 수 없는 위치 항목: {sorted(unknown)}")
        merged = {**vars(new.location), **loc_edits}
        for key in ("lat", "lon", "x", "y", "radius_m"):
            if merged[key] is not None:
                _finite(key, merged[key])
        if (merged["x"] is None) != (merged["y"] is None):
            raise ReviewError("x와 y는 함께 있어야 합니다")
        if (merged["lat"] is None) != (merged["lon"] is None):
            raise ReviewError("lat과 lon은 함께 있어야 합니다")
        if merged["radius_m"] is not None and not merged["radius_m"] > 0:
            raise ReviewError("radius_m은 0보다 커야 합니다")
        new = replace(new, location=Location(**merged))
    return new


def _record(event_before: FieldEvent, event_after: FieldEvent, action: str, reviewer: str, at: str,
            reason: str) -> dict:
    return {"event_id": event_before.event_id, "action": action, "reviewer": reviewer, "at": at,
            "reason": reason, "status_before": event_before.status.value,
            "status_after": event_after.status.value}


def review_event(event: FieldEvent, action: str, reviewer: str, *, edits: Optional[dict] = None,
                 reason: str = "", at: Optional[str] = None) -> tuple[FieldEvent, dict]:
    """이벤트 1건을 처리하고 (새 이벤트, 기록 dict)를 돌려준다."""
    if action not in ACTIONS:
        raise ReviewError(f"알 수 없는 처리: {action!r} (승인/수정/거절 중 하나)")
    if not isinstance(reviewer, str) or not reviewer.strip():
        raise ReviewError("처리자(reviewer)가 필요합니다")
    at = at or now_iso()
    allowed = {APPROVE: {Status.PENDING}, EDIT: {Status.PENDING, Status.LOG_ONLY},
               REJECT: {Status.PENDING, Status.LOG_ONLY}}[action]
    if event.status not in allowed:
        raise ReviewError(f"'{event.status.value}' 상태의 이벤트는 {action} 처리할 수 없습니다")
    if action != EDIT and edits:
        raise ReviewError("수정 내용은 '수정' 처리에서만 줄 수 있습니다")

    if action == APPROVE:
        after = replace(event, status=Status.APPROVED)
    elif action == REJECT:
        after = replace(event, status=Status.REJECTED)
    else:
        if not edits:
            raise ReviewError("수정 처리에는 edits가 필요합니다")
        after = replace(_apply_edits(event, edits), status=Status.EDITED)
        if after == replace(event, status=Status.EDITED):
            raise ReviewError("바뀐 값이 없습니다. 그대로 반영하려면 '승인'을 쓰세요")
    return after, _record(event, after, action, reviewer.strip(), at, reason)


def pending_events(reports: Iterable[RadioReport]) -> list[tuple[str, FieldEvent]]:
    """승인 대기 이벤트 목록 (report_id, event). 입력 순서를 유지한다."""
    return [(r.report_id, e) for r in reports for e in r.events if e.status == Status.PENDING]


def report_status(report: RadioReport) -> Status:
    """이벤트 상태로 보고 전체 상태를 계산한다."""
    statuses = [e.status for e in report.events]
    if not statuses:
        return Status.LOG_ONLY
    if Status.PENDING in statuses:
        return Status.PENDING
    if any(s in APPLICABLE_STATUS for s in statuses):
        return Status.EDITED if Status.EDITED in statuses else Status.APPROVED
    if all(s == Status.REJECTED for s in statuses):
        return Status.REJECTED
    return Status.LOG_ONLY
