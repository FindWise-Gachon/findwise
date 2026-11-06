"""실행 (저장소 루트에서)
  macOS/Linux : PYTHONPATH=backend python -m unittest discover -s backend/tests
  PowerShell  : $env:PYTHONPATH = "backend"; python -m unittest discover -s backend/tests
"""
import unittest

import numpy as np

from app.radio.schema import Confidence, EventType, FieldEvent, Location, RadioReport, Status
from app.radio.update_map import GridSpec, apply_event, new_state, top_zones

SMALL = GridSpec(x0=0, y0=1000, cell_m=10, rows=100, cols=100)  # 1km × 1km
# 테스트용 예시. frontend/src/map/config.ts의 개발 격자와 같은 값 (실제 분석에서는 격자 JSON을 읽는다)
DEV_GRID = GridSpec(x0=268800.0, y0=4183680.0, cell_m=6.0, rows=1000, cols=1000,
                    crs="EPSG:32611", grid_id="yosemite-valley-dev-6m-v1")


def ev(eid, typ, x, y, r=None, conf=Confidence.NORMAL, status=Status.APPROVED):
    return FieldEvent(eid, typ, Location(value="테스트", x=x, y=y, radius_m=r), conf, status=status)


class UpdateMapTest(unittest.TestCase):
    def test_spec_example(self):
        # 명세서 예시: A 10%, 나머지 90%, POD 0.8 → A ≈ 2.2%
        prob = np.ones((100, 100))
        a = SMALL.circle_mask(500, 500, 100)
        prob[a] *= 0.10 / prob[a].sum()
        prob[~a] *= 0.90 / prob[~a].sum()
        s2 = apply_event(new_state(prob), ev("e1", EventType.SEARCHED, 500, 500, 100, Confidence.THOROUGH), SMALL)
        self.assertAlmostEqual(float(s2.prob.sum()), 1.0, places=9)
        self.assertAlmostEqual(float(s2.prob[a].sum()), 0.02 / 0.92, places=9)
        self.assertGreater(float(s2.prob[a].min()), 0.0)  # 0으로 만들지 않음
        self.assertEqual(s2.version, 2)

    def test_unapproved_and_duplicate(self):
        s = new_state(np.ones((100, 100)))
        pending = ev("e2", EventType.SEARCHED, 500, 500, 100, status=Status.PENDING)
        self.assertTrue(np.array_equal(apply_event(s, pending, SMALL).prob, s.prob))
        ok = ev("e3", EventType.SEARCHED, 500, 500, 100)
        s2 = apply_event(s, ok, SMALL)
        s3 = apply_event(s2, ok, SMALL)  # 같은 승인 카드를 다시 적용
        self.assertTrue(np.array_equal(s2.prob, s3.prob))
        self.assertEqual(s3.version, s2.version)

    def test_clue_raises_nearby(self):
        s = new_state(np.ones((100, 100)))
        s2 = apply_event(s, ev("e4", EventType.CLUE, 250, 750), SMALL)
        r, c = int((1000 - 750) // 10), int(250 // 10)
        self.assertGreater(s2.prob[r, c], s.prob[r, c])
        self.assertAlmostEqual(float(s2.prob.sum()), 1.0, places=9)

    def test_blocked_keeps_prob_adds_marker(self):
        s = new_state(np.ones((100, 100)))
        s2 = apply_event(s, ev("e5", EventType.BLOCKED, 300, 300, 50), SMALL)
        self.assertTrue(np.array_equal(s2.prob, s.prob))
        self.assertEqual(len(s2.markers), 1)

    def test_unlocated_is_log_only(self):
        s = new_state(np.ones((100, 100)))
        e = FieldEvent("e6", EventType.SEARCHED, Location(value="어딘가"), status=Status.APPROVED)
        s2 = apply_event(s, e, SMALL)
        self.assertTrue(np.array_equal(s2.prob, s.prob))
        self.assertFalse(s2.log[-1]["applied"])

    def test_shape_mismatch_raises(self):
        s = new_state(np.ones((50, 50)))
        with self.assertRaises(ValueError):
            apply_event(s, ev("e9", EventType.CLUE, 250, 750), SMALL)

    def test_top_zones_and_json_roundtrip(self):
        s = new_state(np.ones((100, 100)))
        s = apply_event(s, ev("e7", EventType.SEARCHED, 500, 500, 200, Confidence.THOROUGH), SMALL)
        zones = top_zones(s.prob, SMALL, n=3)
        self.assertEqual(len(zones), 3)
        self.assertGreaterEqual(zones[0]["prob"], zones[1]["prob"])
        rep = RadioReport("r-1", "2026-11-20T14:32:00+09:00", "2조", "동쪽 계곡 수색 끝났는데 아무것도 없어요",
                          [ev("e8", EventType.SEARCHED, 500, 500, 100)])
        self.assertEqual(RadioReport.from_dict(rep.to_dict()).to_dict(), rep.to_dict())

    def test_dev_grid_matches_frontend_convention(self):
        g = DEV_GRID
        self.assertEqual((g.rows, g.cols, g.cell_m), (1000, 1000, 6.0))
        self.assertEqual((g.x0, g.y0), (268800.0, 4183680.0))
        # 북서쪽 첫 셀의 중심은 원점에서 동쪽·남쪽으로 반 칸
        X, Y = g.centers()
        self.assertEqual((X[0, 0], Y[0, 0]), (268803.0, 4183677.0))
        s = apply_event(new_state(np.ones(g.shape)),
                        ev("d1", EventType.SEARCHED, 271800, 4180680, 300, Confidence.NORMAL), g)
        self.assertAlmostEqual(float(s.prob.sum()), 1.0, places=9)

    def test_top_zones_includes_edge_cells(self):
        # 105×105는 10으로 나누어떨어지지 않는다 → 가장자리 남는 칸도 포함되어야 한다
        g = GridSpec(x0=0, y0=1050, cell_m=10, rows=105, cols=105)
        prob = np.ones((105, 105)) / (105 * 105)
        zones = top_zones(prob, g, n=1000, zone_cells=10)
        self.assertEqual(len(zones), 11 * 11)
        self.assertAlmostEqual(sum(z["prob"] for z in zones), 1.0, places=9)
        self.assertLessEqual(max(z["x_max"] for z in zones), 1050)
        self.assertGreaterEqual(min(z["y_min"] for z in zones), 0)
        # 가장자리 한 칸에만 확률이 몰려 있어도 1순위로 잡힌다
        edge = np.zeros((105, 105)); edge[104, 104] = 1.0
        self.assertEqual(top_zones(edge, g, n=1)[0]["prob"], 1.0)

    def test_top_zones_and_mask_validation(self):
        s = new_state(np.ones((100, 100)))
        with self.assertRaises(ValueError):
            top_zones(s.prob, SMALL, zone_cells=0)
        with self.assertRaises(ValueError):
            top_zones(np.ones((50, 50)), SMALL)
        with self.assertRaises(ValueError):
            apply_event(s, ev("m1", EventType.SEARCHED, 500, 500, 100), SMALL,
                        area_mask=np.ones((50, 50), dtype=bool))

    def test_grid_from_dict(self):
        # 실제 frontend/src/map/config.ts의 analysisGrid 필드명
        g = GridSpec.from_dict({"id": "yosemite-valley-dev-6m-v1", "crs": "EPSG:32611",
                                "projection": "+proj=utm +zone=11 +datum=WGS84 +units=m +no_defs",
                                "origin": [268800, 4183680], "cellSizeM": 6, "rows": 1000,
                                "columns": 1000})
        self.assertEqual((g.x0, g.y0, g.cell_m, g.shape), (268800.0, 4183680.0, 6.0, (1000, 1000)))
        self.assertEqual((g.crs, g.grid_id), ("EPSG:32611", "yosemite-valley-dev-6m-v1"))

        # 이전 snake_case 및 x0/y0 형식도 계속 지원
        g2 = GridSpec.from_dict({"x0": 0, "y0": 100, "cell_m": 10, "rows": 10, "cols": 10})
        self.assertEqual(g2.shape, (10, 10))
        with self.assertRaises(ValueError):
            GridSpec.from_dict({"rows": 10})

if __name__ == "__main__":
    unittest.main()
