"""②~⑥ 연결: 접수 → 승인 처리 → 지도 반영 → 이력 기록을 한 번에 묶는다.

화면·API는 아직 정해지지 않았으므로 순수 함수로만 둔다. 이력 저장소는 append/reviewed_ids를 가진 객체
(MemoryHistory, JsonlHistory)면 무엇이든 된다.
"""
from __future__ import annotations

from typing import Optional

from .history import HistoryError, event_to_dict
from .review import ReviewError, now_iso, review_event
from .schema import FieldEvent, RadioReport
from .update_map import GridSpec, MapState, apply_event


def receive_report(store, report: RadioReport, at: Optional[str] = None) -> dict:
    """보고 접수를 이력에 남긴다. 같은 report_id를 두 번 접수할 수 없다."""
    for e in store.entries():
        if e["kind"] == "report" and e["payload"]["report"]["report_id"] == report.report_id:
            raise HistoryError(f"이미 접수된 보고: {report.report_id}")
    return store.append("report", {"report": report.to_dict()}, at or now_iso())


def decide(state: MapState, store, grid: GridSpec, event: FieldEvent, action: str, reviewer: str, *,
           edits: Optional[dict] = None, reason: str = "", at: Optional[str] = None,
           **apply_kwargs) -> tuple[MapState, FieldEvent]:
    """이벤트를 승인·수정·거절하고, 반영 대상이면 지도에 반영한 뒤 모두 이력에 남긴다.

    지도 계산과 검증을 먼저 끝낸 다음에 이력을 쓰므로, 오류가 나면 이력도 지도도 바뀌지 않는다.
    같은 event_id를 두 번 처리하려 하면 ReviewError.
    """
    if event.event_id in store.reviewed_ids():
        raise ReviewError(f"이미 처리된 이벤트: {event.event_id}")
    at = at or now_iso()
    after, record = review_event(event, action, reviewer, edits=edits, reason=reason, at=at)
    new_state = apply_event(state, after, grid, **apply_kwargs)  # 미승인이면 log만 남고 확률은 그대로
    last = new_state.log[-1] if new_state.log else {}
    store.append("review", {"record": record, "event": event_to_dict(after)}, at)
    store.append("map", {"event_id": after.event_id, "applied": bool(last.get("applied")),
                         "reason": last.get("reason", ""), "version": new_state.version}, at)
    return new_state, after
