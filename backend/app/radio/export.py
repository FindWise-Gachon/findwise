"""확률 격자를 화면용 JSON으로 내보낸다.

두 가지 용도를 구분한다.
  1) map_snapshot()  : API의 '현재 지도' 응답. 지도 버전(map_version)과 현재 확률 셀을 담는다.
                       무전 승인으로 바뀐 지도의 이력은 별도 이력 응답으로 관리하며 시간 프레임이 아니다.
  2) build_timeline(): frontend/src/map/timeline.ts의 readTimeline()이 읽는 '시간별 결과' JSON.
                       프레임의 elapsed_seconds는 마지막 확인 후 실제 경과 시간이어야 한다
                       (모델의 시간별 예측을 파일로 내보내거나 기존 시간별 화면에 넣을 때만 쓴다).

셀 표현 [셀 인덱스, 확률]
  - 인덱스는 row * columns + column (북→남, 서→동)으로 prob.ravel()의 인덱스와 같다.
  - 셀 수 제한을 넘으면 앞쪽 셀을 자르지 않고, 격자를 stride×stride 블록으로 묶어 블록 합계를
    블록 중앙 셀 하나에 담는다(prob_to_cells). 확률 합은 그대로이고 공간적으로 치우치지 않는다.
    이때 stride(블록 한 변의 셀 수)를 함께 돌려주므로 화면이 표본 해상도를 알릴 수 있다.

입력 확률 격자는 유한한 0 이상의 값이며 합이 1이어야 한다(require_unit_sum=True 기본).
어긋나면 정규화하지 않고 오류를 낸다. 합이 1 미만인 모델 출력이라면 require_unit_sum=False로 부르되
합이 0이거나 1을 넘으면 오류다.

timeline 검증 규칙 중 'LKP가 격자 안인가'는 좌표 변환이 필요해 검사하지 않는다(화면이 검사한다).
"""
from __future__ import annotations

import json
import math
import numbers
from datetime import datetime, timezone
from typing import Iterable, Optional

import numpy as np

from .update_map import GridSpec, MapState, top_zones

SCHEMA_VERSION = 1
MAX_MODEL_VERSION_LEN = 100
SUM_TOLERANCE = 1e-8        # 화면의 프레임 합 허용 오차
UNIT_SUM_TOLERANCE = 1e-6   # 입력 확률 격자의 '합이 1' 허용 오차
RESULT_KINDS = ("model", "synthetic")
_MAX_JS_DATE_MS = 8.64e15   # JavaScript Date가 표현할 수 있는 한계


def format_utc(moment: datetime) -> str:
    """시간대가 있는 datetime을 JS toISOString()과 같은 'YYYY-MM-DDTHH:MM:SS.mmmZ'로 바꾼다."""
    if moment.tzinfo is None or moment.utcoffset() is None:
        raise ValueError("last_seen에는 시간대가 있는 datetime이 필요합니다")
    utc = moment.astimezone(timezone.utc)
    return utc.strftime("%Y-%m-%dT%H:%M:%S.") + f"{utc.microsecond // 1000:03d}Z"


def check_prob(prob: np.ndarray, require_unit_sum: bool = True) -> np.ndarray:
    """확률 격자를 검사하고, 합이 1이어야 하면 오차를 없애도록 합으로 나눠 돌려준다."""
    p = np.asarray(prob, dtype=float)
    if p.ndim != 2:
        raise ValueError("확률 격자는 2차원 배열이어야 합니다")
    if not np.all(np.isfinite(p)):
        raise ValueError("확률 격자에 NaN 또는 무한대가 있습니다")
    if np.any(p < 0):
        raise ValueError("확률 격자에 음수가 있습니다")
    total = float(p.sum())
    if total <= 0:
        raise ValueError("확률 격자의 합이 0입니다")
    if require_unit_sum:
        if abs(total - 1.0) > UNIT_SUM_TOLERANCE:
            raise ValueError(f"확률 격자의 합이 1이 아닙니다(합={total:.9f}). 정규화한 격자를 넘겨 주세요")
        return p / total
    if total > 1.0 + SUM_TOLERANCE:
        raise ValueError(f"확률 격자의 합이 1을 넘습니다(합={total:.9f})")
    return p


def _block_sums(p: np.ndarray, stride: int) -> np.ndarray:
    rows, cols = p.shape
    br, bc = -(-rows // stride), -(-cols // stride)
    padded = np.zeros((br * stride, bc * stride))
    padded[:rows, :cols] = p
    return padded.reshape(br, stride, bc, stride).sum(axis=(1, 3))


def prob_to_cells(prob: np.ndarray, max_cells: int = 100_000,
                  require_unit_sum: bool = True) -> tuple[list[list], int]:
    """확률 격자를 ([[셀 인덱스, 확률], ...], stride)로 바꾼다.

    - 확률이 0 초과인 셀(블록)이 max_cells 이하가 되는 가장 작은 stride를 고른다.
      stride가 1이면 모든 셀을 그대로 담는다(손실 없음).
    - stride가 2 이상이면 stride×stride 블록의 확률 합을 블록 중앙 셀의 인덱스에 담는다.
      가장자리의 모자란 블록도 포함하며, 대표 셀은 항상 블록 안에 있다.
    - 확률 합은 입력과 같고, 같은 확률이면 인덱스 순으로 정렬해 결과가 항상 같다.
    """
    if max_cells <= 0:
        raise ValueError("max_cells는 1 이상이어야 합니다")
    p = check_prob(prob, require_unit_sum)
    rows, cols = p.shape
    stride = 1
    while True:
        blocks = _block_sums(p, stride)
        positive = np.argwhere(blocks > 0)
        if len(positive) <= max_cells or stride >= max(rows, cols):
            break
        stride += 1
    br, bc = positive[:, 0], positive[:, 1]
    r0, c0 = br * stride, bc * stride
    r_idx = np.minimum(r0 + stride // 2, np.minimum(r0 + stride, rows) - 1)
    c_idx = np.minimum(c0 + stride // 2, np.minimum(c0 + stride, cols) - 1)
    index = r_idx * cols + c_idx
    mass = blocks[br, bc]
    order = np.lexsort((index, -mass))  # 확률 내림차순, 같으면 인덱스 오름차순
    return [[int(index[i]), float(mass[i])] for i in order], stride


def _grid_info(grid: GridSpec) -> dict:
    return {"grid_id": grid.grid_id, "crs": grid.crs, "origin": [grid.x0, grid.y0],
            "cell_size_m": grid.cell_m, "rows": grid.rows, "columns": grid.cols}


def map_snapshot(grid: GridSpec, state: MapState, *, top_n: int = 3, zone_cells: int = 100,
                 max_cells: int = 100_000) -> dict:
    """API '현재 지도' 응답(dict). 지도 버전, 현재 확률 셀, 우선 수색 구역, 표식을 담는다.

    cells는 지도의 전체 확률을 나타낸다(합 = total_probability ≈ 1). cell_stride가 1보다 크면
    각 셀은 stride×stride 칸 블록의 확률 합을 대표하므로 화면이 표본 해상도임을 알려야 한다.
    """
    if state.prob.shape != grid.shape:
        raise ValueError(f"확률 격자 {state.prob.shape}와 격자 정의 {grid.shape}가 다릅니다")
    cells, stride = prob_to_cells(state.prob, max_cells=max_cells)
    return {
        "map_version": state.version,
        "grid": _grid_info(grid),
        "total_probability": float(sum(m for _, m in cells)),
        "cell_stride": stride,
        "cells": cells,
        "top_zones": top_zones(state.prob, grid, n=top_n, zone_cells=zone_cells),
        "markers": [dict(m) for m in state.markers],
    }


def _check_elapsed(snapshots: list) -> None:
    if len(snapshots) < 2:
        raise ValueError("시간별 결과에는 스냅샷이 2개 이상 필요합니다")
    previous = -1
    for number, (elapsed, _) in enumerate(snapshots):
        if isinstance(elapsed, bool) or not isinstance(elapsed, numbers.Integral):
            raise ValueError(f"{number}번째 elapsed_seconds는 정수여야 합니다(받은 값: {elapsed!r})")
        if elapsed < 0:
            raise ValueError(f"{number}번째 elapsed_seconds는 0 이상이어야 합니다")
        if elapsed <= previous:
            raise ValueError(f"{number}번째 elapsed_seconds가 이전 값보다 커야 합니다(같거나 작음)")
        previous = int(elapsed)


def build_timeline(
    grid: GridSpec,
    snapshots: Iterable[tuple[int, np.ndarray]],
    *,
    lkp_lonlat: tuple[float, float],
    last_seen: datetime,
    model_version: str,
    terrain_revision: Optional[str] = None,
    result_kind: Optional[str] = None,
    max_cells: int = 100_000,
    require_unit_sum: bool = True,
) -> dict:
    """(경과 초, 확률 격자) 목록으로 화면 시간별 결과 JSON(dict)을 만들고 규칙을 검사한다.

    경과 초는 마지막 확인 후 실제 경과 시간이다. 무전 승인으로 생긴 지도 버전 이력을 프레임으로 쓰지 않는다.
    snapshots는 2개 이상, 경과 초는 정수이며 0 이상으로 증가해야 한다. lkp_lonlat은 (경도, 위도).
    """
    snapshots = list(snapshots)
    _check_elapsed(snapshots)
    frames = []
    for elapsed, prob in snapshots:
        prob = np.asarray(prob)
        if prob.shape != grid.shape:
            raise ValueError(f"확률 격자 {prob.shape}와 격자 정의 {grid.shape}가 다릅니다")
        cells, stride = prob_to_cells(prob, max_cells=max_cells, require_unit_sum=require_unit_sum)
        # cell_stride는 화면이 읽지 않는 추가 필드다(표본 해상도 안내용)
        frames.append({"elapsed_seconds": int(elapsed), "cell_stride": stride, "cells": cells})
    timeline: dict = {
        "schema_version": SCHEMA_VERSION,
        "grid_id": grid.grid_id,
        "model_version": model_version,
        "lkp": [float(lkp_lonlat[0]), float(lkp_lonlat[1])],
        "last_seen_utc": format_utc(last_seen),
        "frames": frames,
    }
    if terrain_revision is not None:
        timeline["terrain_revision"] = terrain_revision
    if result_kind is not None:
        timeline["result_kind"] = result_kind
    validate_timeline(timeline, grid)
    return timeline


def validate_timeline(timeline: dict, grid: GridSpec) -> None:
    """frontend readTimeline()과 같은 규칙으로 검사하고, 어긋나면 ValueError를 낸다."""
    def fail(reason: str):
        raise ValueError(f"시간별 결과 JSON 검증 실패: {reason}")

    if timeline.get("schema_version") != SCHEMA_VERSION:
        fail("schema_version은 1이어야 합니다")
    if not grid.grid_id:
        fail("격자 정의에 grid_id가 없습니다")
    if timeline.get("grid_id") != grid.grid_id:
        fail("grid_id가 격자와 다릅니다")
    version = timeline.get("model_version")
    if not isinstance(version, str) or not version.strip() or len(version) > MAX_MODEL_VERSION_LEN:
        fail("model_version은 비어 있지 않은 100자 이하 문자열이어야 합니다")

    lkp = timeline.get("lkp")
    if (not isinstance(lkp, (list, tuple)) or len(lkp) != 2
            or not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in lkp)
            or abs(lkp[0]) > 180 or abs(lkp[1]) > 90):
        fail("lkp는 [경도, 위도] 두 수여야 하며 범위를 넘으면 안 됩니다")

    stamp = timeline.get("last_seen_utc")
    try:
        parsed = datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
        if format_utc(parsed) != stamp:
            raise ValueError
    except (TypeError, ValueError):
        fail("last_seen_utc는 'YYYY-MM-DDTHH:MM:SS.mmmZ' 형식이어야 합니다")
    last_seen_ms = parsed.timestamp() * 1000

    frames = timeline.get("frames")
    if not isinstance(frames, list) or len(frames) < 2:
        fail("frames는 2개 이상이어야 합니다")
    if "terrain_revision" in timeline and (
            not isinstance(timeline["terrain_revision"], str) or not timeline["terrain_revision"]):
        fail("terrain_revision은 비어 있지 않은 문자열이어야 합니다")
    if "result_kind" in timeline and timeline["result_kind"] not in RESULT_KINDS:
        fail("result_kind는 model 또는 synthetic이어야 합니다")

    total_cells = grid.rows * grid.cols
    previous = -1
    for number, frame in enumerate(frames):
        elapsed = frame.get("elapsed_seconds") if isinstance(frame, dict) else None
        if (not isinstance(elapsed, int) or isinstance(elapsed, bool) or elapsed <= previous
                or abs(last_seen_ms + 1000 * elapsed) > _MAX_JS_DATE_MS
                or not isinstance(frame.get("cells"), list)):
            fail(f"{number}번째 프레임의 elapsed_seconds나 cells가 올바르지 않습니다")
        previous = elapsed
        seen: set[int] = set()
        total = 0.0
        for cell in frame["cells"]:
            if not isinstance(cell, (list, tuple)) or len(cell) != 2:
                fail(f"{number}번째 프레임에 [인덱스, 확률] 형식이 아닌 셀이 있습니다")
            index, mass = cell
            if (not isinstance(index, int) or isinstance(index, bool) or index < 0 or index >= total_cells
                    or index in seen):
                fail(f"{number}번째 프레임의 셀 인덱스가 범위를 벗어나거나 중복됩니다")
            if (not isinstance(mass, (int, float)) or isinstance(mass, bool)
                    or not math.isfinite(mass) or mass <= 0 or mass > 1):
                fail(f"{number}번째 프레임의 확률은 0 초과 1 이하여야 합니다")
            seen.add(index)
            total += mass
        if total > 1 + SUM_TOLERANCE:
            fail(f"{number}번째 프레임의 확률 합이 1을 넘습니다")


def dump_timeline(timeline: dict, path) -> None:
    """Timeline dict를 JSON 파일로 저장한다 (화면의 '시간별 결과 불러오기'용)."""
    with open(path, "w", encoding="utf-8") as f:
        json.dump(timeline, f, ensure_ascii=False)
