"""⑥ 이력 저장: 추가만 가능한 이력 + 이력으로 지도 상태 재생.

항목은 순번(seq), 시각, 종류(kind), 내용(payload), 직전 항목의 해시(prev), 자기 해시(hash)를 가진다.
해시 체인이라 중간 항목을 고치거나 빼면 verify()가 찾아낸다 (SHA-256).

종류
  report   : 무전 보고 접수 (RadioReport dict)
  review   : 승인/수정/거절 처리 (기록 dict + 처리 후 이벤트 스냅샷)
  map      : 지도 반영 결과 (applied, reason, version)

저장소는 두 가지다. MemoryHistory(메모리, 테스트·시연용)와 JsonlHistory(파일, 한 줄에 한 항목).
서버리스 배포처럼 파일이 유지되지 않는 환경에서는 같은 인터페이스(append, entries)로 DB 구현을 붙이면 된다.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Iterable, Optional

from .schema import Confidence, EventType, FieldEvent, Location, Status
from .update_map import GridSpec, MapState, apply_event, new_state

GENESIS = "0" * 64


class HistoryError(ValueError):
    """이력이 손상됐거나 잘못된 항목을 넣으려 했을 때."""


def event_to_dict(e: FieldEvent) -> dict:
    return {"event_id": e.event_id, "type": e.type.value,
            "location": {k: v for k, v in vars(e.location).items() if v is not None},
            "confidence": e.confidence.value, "note": e.note, "status": e.status.value}


def event_from_dict(d: dict) -> FieldEvent:
    return FieldEvent(event_id=d["event_id"], type=EventType(d["type"]), location=Location(**d.get("location", {})),
                      confidence=Confidence(d.get("confidence", Confidence.NORMAL.value)),
                      note=d.get("note", ""), status=Status(d.get("status", Status.PENDING.value)))


def _digest(seq: int, at: str, kind: str, payload: dict, prev: str) -> str:
    body = json.dumps({"seq": seq, "at": at, "kind": kind, "payload": payload, "prev": prev},
                      sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def verify_entries(entries: Iterable[dict]) -> list[str]:
    """해시 체인과 순번을 검사해 문제 목록을 돌려준다 (비어 있으면 정상)."""
    problems, prev, expected_seq = [], GENESIS, 1
    for entry in entries:
        seq = entry.get("seq")
        if seq != expected_seq:
            problems.append(f"순번 {expected_seq}이어야 하는데 {seq}")
        if entry.get("prev") != prev:
            problems.append(f"#{seq}: 직전 해시가 맞지 않음")
        try:
            ok = _digest(entry["seq"], entry["at"], entry["kind"], entry["payload"], entry["prev"]) == entry.get("hash")
        except KeyError:
            ok = False
        if not ok:
            problems.append(f"#{seq}: 내용이 해시와 맞지 않음")
        prev, expected_seq = entry.get("hash", ""), expected_seq + 1
    return problems


class MemoryHistory:
    def __init__(self, entries: Optional[list[dict]] = None):
        self._entries: list[dict] = list(entries or [])
        problems = verify_entries(self._entries)
        if problems:
            raise HistoryError("; ".join(problems))

    def _persist(self, entry: dict) -> None:
        pass

    def append(self, kind: str, payload: dict, at: str) -> dict:
        if not kind or not isinstance(payload, dict):
            raise HistoryError("kind와 dict payload가 필요합니다")
        prev = self._entries[-1]["hash"] if self._entries else GENESIS
        seq = len(self._entries) + 1
        payload = json.loads(json.dumps(payload, ensure_ascii=False))  # JSON으로 표현 가능한 값만 허용, 복사본 저장
        entry = {"seq": seq, "at": at, "kind": kind, "payload": payload, "prev": prev,
                 "hash": _digest(seq, at, kind, payload, prev)}
        self._persist(entry)
        self._entries.append(entry)
        return entry

    def entries(self) -> list[dict]:
        return list(self._entries)

    def verify(self) -> list[str]:
        return verify_entries(self._entries)

    def reviewed_ids(self) -> set[str]:
        return {e["payload"]["record"]["event_id"] for e in self._entries if e["kind"] == "review"}


class JsonlHistory(MemoryHistory):
    """파일에 한 줄씩 덧붙인다. 열 때 전체를 읽어 검증하고, 손상됐으면 HistoryError."""

    def __init__(self, path):
        self.path = Path(path)
        entries = []
        if self.path.exists():
            for n, line in enumerate(self.path.read_text(encoding="utf-8").splitlines(), 1):
                if not line.strip():
                    continue
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError as exc:
                    raise HistoryError(f"{self.path} {n}행을 읽을 수 없습니다: {exc.msg}") from None
        super().__init__(entries)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _persist(self, entry: dict) -> None:
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False, separators=(",", ":")) + "\n")
            f.flush()
            os.fsync(f.fileno())


def replay(prior, grid: GridSpec, entries: Iterable[dict], **apply_kwargs) -> MapState:
    """이력의 review 항목을 순서대로 다시 적용해 지도 상태를 복원한다.
    prior는 처음 확률 격자(합 1)다. 같은 격자·같은 사전 확률이어야 같은 결과가 나온다."""
    entries = list(entries)
    problems = verify_entries(entries)
    if problems:
        raise HistoryError("이력 검증 실패: " + "; ".join(problems))
    state = new_state(prior)
    for entry in entries:
        if entry["kind"] == "review":
            state = apply_event(state, event_from_dict(entry["payload"]["event"]), grid, **apply_kwargs)
    return state
