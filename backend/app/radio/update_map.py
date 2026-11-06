"""M5 지도 갱신: 승인된 현장 이벤트를 확률 격자에 반영한다.

규칙 (명세서 4장)
  - 수색 완료 : 영역 셀 × (1 − POD)  → 0으로 만들지 않는다 (POD 상한 0.95)
  - 흔적 발견 : 발견 지점 주변 셀 가중치 증가
  - 진입 불가 / 위험 요소 : 확률은 유지하고 표식만 추가
  - 확률이 바뀐 뒤에는 정규화 (격자 전체 합 = 1)
  - 승인되지 않은 이벤트는 반영하지 않고, 같은 이벤트의 중복 반영은 막는다

격자 규약은 frontend/README.md '분석 격자 기반'과 같다. 실제 분석에서는 지도에서 내보낸
격자 JSON(GridSpec.from_json_file)을 읽어 쓰고, 값을 코드에 고정하지 않는다.
  - 좌표계 EPSG:32611, 북서쪽 원점 [268800, 4183680] m, 6 m 셀, 1,000행 × 1,000열
  - 배열은 북→남 행 순서, 각 행은 서→동. 행 우선 인덱스 = row * columns + column
    (prob.ravel()의 인덱스와 같다)
순수 함수라 입력 state는 바뀌지 않고 새 state를 돌려준다.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Optional

import numpy as np

from .schema import APPLICABLE_STATUS, Confidence, EventType, FieldEvent

# ---- 잠정 값 (소방 실무자 자문 후 확정) --------------------------------
POD_BY_CONFIDENCE = {
    Confidence.THOROUGH: 0.8,
    Confidence.NORMAL: 0.5,
    Confidence.ROUGH: 0.3,
}
POD_MAX = 0.95  # 수색해도 지나쳤을 수 있으므로 0으로 만들지 않는다


@dataclass(frozen=True)
class ClueParams:
    sigma_m: float = 300.0  # 흔적 주변 영향 반경(가우시안 표준편차, m)
    gain: float = 3.0       # 발견 지점에서의 증가 배율 (중심 셀은 1+gain 배)


@dataclass(frozen=True)
class GridSpec:
    """투영좌표(m) 기준 격자. (x0, y0)는 북서쪽 모서리, 행이 늘수록 y가 줄어든다."""
    x0: float
    y0: float
    cell_m: float
    rows: int
    cols: int
    crs: str = ""
    grid_id: str = ""

    @classmethod
    def from_dict(cls, d: dict) -> "GridSpec":
        """지도에서 내보낸 격자 JSON(dict)으로 GridSpec을 만든다.

        프론트엔드 analysisGrid 형식(origin, cellSizeM, rows, columns, crs, id)과 이전 snake_case 별칭을 모두 지원한다.
        필수 값이 없으면 오류로 알린다.
          원점: x0/y0 또는 origin / origin_xy / northwest_origin = [x, y] (북서쪽 모서리, m)
          셀 크기: cellSizeM / cell_m / cell_size_m / cell_size
          크기: rows, cols 또는 columns
          선택: crs(epsg), id(grid_id)
        """
        def pick(*keys):
            for k in keys:
                if k in d and d[k] is not None:
                    return d[k]
            return None

        origin = pick("origin", "origin_xy", "northwest_origin")
        x0 = pick("x0") if origin is None else origin[0]
        y0 = pick("y0") if origin is None else origin[1]
        cell = pick("cellSizeM", "cell_m", "cell_size_m", "cell_size")
        rows, cols = pick("rows"), pick("cols", "columns")
        missing = [name for name, v in (("origin(x0,y0)", x0 if x0 is not None and y0 is not None else None),
                                        ("cell_m", cell), ("rows", rows), ("cols", cols)) if v is None]
        if missing:
            raise ValueError(f"격자 JSON에서 필수 값을 찾지 못했습니다: {', '.join(missing)}")
        crs = pick("crs", "epsg")
        return cls(x0=float(x0), y0=float(y0), cell_m=float(cell), rows=int(rows), cols=int(cols),
                   crs=str(crs) if crs is not None else "", grid_id=str(pick("grid_id", "id") or ""))

    @classmethod
    def from_json_file(cls, path) -> "GridSpec":
        import json
        with open(path, encoding="utf-8") as f:
            return cls.from_dict(json.load(f))

    @property
    def shape(self) -> tuple[int, int]:
        return (self.rows, self.cols)

    def centers(self) -> tuple[np.ndarray, np.ndarray]:
        xs = self.x0 + (np.arange(self.cols) + 0.5) * self.cell_m
        ys = self.y0 - (np.arange(self.rows) + 0.5) * self.cell_m
        return np.meshgrid(xs, ys)  # X[row, col], Y[row, col]

    def circle_mask(self, x: float, y: float, radius_m: float) -> np.ndarray:
        X, Y = self.centers()
        return (X - x) ** 2 + (Y - y) ** 2 <= radius_m ** 2


@dataclass
class MapState:
    prob: np.ndarray                      # 합이 1인 확률 격자
    version: int = 1
    applied_ids: frozenset = frozenset()  # 반영 완료된 event_id (중복 방지)
    markers: tuple = ()                   # 진입 불가·위험 요소 표식
    log: tuple = ()                       # 반영/미반영 이력


def normalize(p: np.ndarray) -> np.ndarray:
    s = float(p.sum())
    if not np.isfinite(s) or s <= 0:
        raise ValueError("확률 격자의 합이 0 이하이거나 유효하지 않습니다")
    return p / s


def new_state(prob: np.ndarray) -> MapState:
    return MapState(prob=normalize(np.asarray(prob, dtype=float)))


def _area_mask(event: FieldEvent, grid: GridSpec, area_mask: Optional[np.ndarray]):
    if area_mask is not None:
        if area_mask.shape != grid.shape:
            raise ValueError(f"영역 마스크 {area_mask.shape}와 격자 정의 {grid.shape}가 다릅니다")
        return area_mask
    loc = event.location
    if loc.resolved and loc.radius_m:
        return grid.circle_mask(loc.x, loc.y, loc.radius_m)
    return None


def _skip(state: MapState, event: FieldEvent, reason: str) -> MapState:
    entry = {"event_id": event.event_id, "applied": False, "reason": reason, "version": state.version}
    return replace(state, log=state.log + (entry,))


def apply_event(
    state: MapState,
    event: FieldEvent,
    grid: GridSpec,
    area_mask: Optional[np.ndarray] = None,
    pod_table: dict = POD_BY_CONFIDENCE,
    clue: ClueParams = ClueParams(),
) -> MapState:
    """승인된 이벤트 1건을 반영한 새 MapState를 돌려준다."""
    if state.prob.shape != grid.shape:
        raise ValueError(f"확률 격자 {state.prob.shape}와 격자 정의 {grid.shape}가 다릅니다")
    if event.status not in APPLICABLE_STATUS:
        return _skip(state, event, f"미승인 상태({event.status.value})")
    if event.event_id in state.applied_ids:
        return _skip(state, event, "이미 반영된 이벤트")

    prob = state.prob.copy()
    markers = state.markers
    loc = event.location

    if event.type == EventType.SEARCHED:
        mask = _area_mask(event, grid, area_mask)
        if mask is None or not mask.any():
            return _skip(state, event, "위치 불명(영역 없음)")
        pod = min(pod_table[event.confidence], POD_MAX)
        prob[mask] *= (1.0 - pod)

    elif event.type == EventType.CLUE:
        if not loc.resolved:
            return _skip(state, event, "위치 불명(좌표 없음)")
        X, Y = grid.centers()
        d2 = (X - loc.x) ** 2 + (Y - loc.y) ** 2
        prob *= 1.0 + clue.gain * np.exp(-d2 / (2.0 * clue.sigma_m ** 2))

    elif event.type in (EventType.BLOCKED, EventType.HAZARD):
        if not loc.resolved:
            return _skip(state, event, "위치 불명(좌표 없음)")
        markers = markers + ({
            "event_id": event.event_id, "type": event.type.value,
            "x": loc.x, "y": loc.y, "radius_m": loc.radius_m, "note": event.note,
        },)  # 확률은 유지한다

    if event.type in (EventType.SEARCHED, EventType.CLUE):
        prob = normalize(prob)  # 확률이 바뀐 경우에만 정규화 (표식만 추가할 때는 값 유지)
    version = state.version + 1
    entry = {"event_id": event.event_id, "applied": True, "type": event.type.value, "version": version}
    return MapState(
        prob=prob,
        version=version,
        applied_ids=state.applied_ids | {event.event_id},
        markers=markers,
        log=state.log + (entry,),
    )


def top_zones(prob: np.ndarray, grid: GridSpec, n: int = 3, zone_cells: int = 10) -> list[dict]:
    """우선 수색 구역 Top-N. zone_cells×zone_cells 블록의 확률 합이 큰 순서(겹치지 않음).

    행·열 수가 zone_cells로 나누어떨어지지 않아도 가장자리의 남는 칸을 작은 구역으로 포함한다.
    """
    if zone_cells <= 0:
        raise ValueError("zone_cells는 1 이상이어야 합니다")
    if prob.shape != grid.shape:
        raise ValueError(f"확률 격자 {prob.shape}와 격자 정의 {grid.shape}가 다릅니다")
    rows, cols = prob.shape
    zr, zc = -(-rows // zone_cells), -(-cols // zone_cells)  # 올림 나눗셈
    padded = np.zeros((zr * zone_cells, zc * zone_cells))
    padded[:rows, :cols] = prob
    blocks = padded.reshape(zr, zone_cells, zc, zone_cells).sum(axis=(1, 3))
    order = np.argsort(blocks, axis=None)[::-1][:n]
    out = []
    for flat in order:
        br, bc = divmod(int(flat), zc)
        r0, c0 = br * zone_cells, bc * zone_cells
        r1, c1 = min(r0 + zone_cells, rows), min(c0 + zone_cells, cols)  # 격자 밖으로 나가지 않게 자른다
        out.append({
            "rank": len(out) + 1,
            "prob": float(blocks[br, bc]),
            "x_min": grid.x0 + c0 * grid.cell_m,
            "x_max": grid.x0 + c1 * grid.cell_m,
            "y_max": grid.y0 - r0 * grid.cell_m,
            "y_min": grid.y0 - r1 * grid.cell_m,
        })
    return out