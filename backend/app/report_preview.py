"""Apply an explicitly approved searched-area report to one ABM snapshot."""
import json
import math
import sys

import numpy as np

from .radio.schema import Confidence, EventType, FieldEvent, Location, Status
from .radio.update_map import GridSpec, apply_event, new_state


def report_preview(grid_manifest, data):
    if not isinstance(data, dict) or data.get("status") != Status.APPROVED.value:
        raise ValueError("승인된 보고만 지도에 반영할 수 있습니다.")
    grid = GridSpec.from_dict(grid_manifest)
    x, y = data["point"]
    radius = data["radius_m"]
    event_id = data["event_id"]
    applied_ids = data["applied_ids"]
    if (not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (x, y)) or
            not (grid.x0 <= x < grid.x0 + grid.cols * grid.cell_m and
                 grid.y0 - grid.rows * grid.cell_m < y <= grid.y0) or
            radius not in (50, 100, 200, 300) or not isinstance(event_id, str) or
            not 1 <= len(event_id) <= 64 or not isinstance(applied_ids, list) or
            len(applied_ids) > 1000 or any(not isinstance(value, str) or len(value) > 64 for value in applied_ids)):
        raise ValueError("보고 위치와 범위를 확인해 주세요.")
    if event_id in applied_ids:
        raise ValueError("이미 반영된 보고입니다.")

    cells = data["cells"]
    if not isinstance(cells, list) or not 1 <= len(cells) <= 512:
        raise ValueError("현재 ABM 시점의 셀 값을 확인해 주세요.")
    probabilities = np.zeros(grid.shape, dtype=float)
    indices = []
    for index, mass in cells:
        if (type(index) is not int or not 0 <= index < probabilities.size or
                not isinstance(mass, (int, float)) or not math.isfinite(mass) or not 0 < mass <= 1 or
                probabilities.flat[index] != 0):
            raise ValueError("현재 ABM 시점의 셀 값을 확인해 주세요.")
        probabilities.flat[index] = mass
        indices.append(index)
    if not math.isclose(float(probabilities.sum()), 1, abs_tol=1e-8):
        raise ValueError("현재 ABM 시점의 셀 값을 확인해 주세요.")
    state = new_state(probabilities)
    event = FieldEvent(event_id, EventType.SEARCHED, Location(x=x, y=y, radius_m=radius),
                       Confidence.NORMAL, status=Status.APPROVED)
    result = apply_event(state, event, grid)
    if event_id not in result.applied_ids:
        raise ValueError("수색 범위가 분석 격자와 겹치지 않습니다.")
    return {
        "event_id": event_id,
        "changed": not np.allclose(state.prob, result.prob, rtol=1e-12, atol=1e-15),
        "cells": [[index, float(result.prob.flat[index])] for index in indices],
    }


if __name__ == "__main__":
    try:
        result = report_preview(json.loads(sys.argv[1]), json.load(sys.stdin))
    except ValueError as error:
        result = {"error": str(error)}
    except (KeyError, TypeError):
        result = {"error": "보고 입력 형식을 확인해 주세요."}
    print(json.dumps(result, allow_nan=False))
