"""무전 이벤트 스키마 (명세서 5.2 형식).

표준 라이브러리만 사용한다. 백엔드 API에 연결할 때는 to_dict()/from_dict()를 쓰거나
같은 필드를 가진 pydantic 모델로 바꿔도 된다.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class EventType(str, Enum):
    SEARCHED = "수색 완료"
    BLOCKED = "진입 불가"
    HAZARD = "위험 요소"
    CLUE = "흔적 발견"


class Confidence(str, Enum):
    THOROUGH = "꼼꼼히"
    NORMAL = "보통"
    ROUGH = "대충"


class Status(str, Enum):
    PENDING = "승인 대기"
    APPROVED = "승인"
    EDITED = "수정 후 승인"
    REJECTED = "거절"
    LOG_ONLY = "기록만"  # 위치·유형 불명 등 지도 반영 불가


# 사람이 승인한 상태만 지도에 반영한다 (AGENTS.md: 현장 보고는 검토·승인 후에만 반영)
APPLICABLE_STATUS = {Status.APPROVED, Status.EDITED}


@dataclass
class Location:
    kind: str = "지명"            # 지명 / 좌표 / 상대위치
    value: str = ""               # 원문 표현 (예: "동쪽 계곡")
    lat: Optional[float] = None   # WGS84 (화면 표시용)
    lon: Optional[float] = None
    x: Optional[float] = None     # 분석 격자와 같은 투영좌표 (m). 지도 갱신은 이 값을 쓴다
    y: Optional[float] = None
    radius_m: Optional[float] = None  # 영역을 원으로 근사할 때의 반경

    @property
    def resolved(self) -> bool:
        return self.x is not None and self.y is not None


@dataclass
class FieldEvent:
    event_id: str
    type: EventType
    location: Location
    confidence: Confidence = Confidence.NORMAL
    note: str = ""
    status: Status = Status.PENDING


@dataclass
class RadioReport:
    report_id: str
    time: str                     # ISO 8601
    reporter: str
    raw_text: str
    events: list[FieldEvent] = field(default_factory=list)
    status: Status = Status.PENDING

    def to_dict(self) -> dict:
        return {
            "report_id": self.report_id,
            "time": self.time,
            "reporter": self.reporter,
            "raw_text": self.raw_text,
            "events": [
                {
                    "event_id": e.event_id,
                    "type": e.type.value,
                    "location": {k: v for k, v in vars(e.location).items() if v is not None},
                    "confidence": e.confidence.value,
                    "note": e.note,
                    "status": e.status.value,
                }
                for e in self.events
            ],
            "status": self.status.value,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "RadioReport":
        events = [
            FieldEvent(
                event_id=e.get("event_id", f"{d['report_id']}-{i}"),
                type=EventType(e["type"]),
                location=Location(**e.get("location", {})),
                confidence=Confidence(e.get("confidence", Confidence.NORMAL.value)),
                note=e.get("note", ""),
                status=Status(e.get("status", Status.PENDING.value)),
            )
            for i, e in enumerate(d.get("events", []))
        ]
        return cls(
            report_id=d["report_id"],
            time=d["time"],
            reporter=d.get("reporter", ""),
            raw_text=d.get("raw_text", ""),
            events=events,
            status=Status(d.get("status", Status.PENDING.value)),
        )
