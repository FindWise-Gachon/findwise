"""실행 (저장소 루트에서)
  macOS/Linux : PYTHONPATH=backend python -m unittest discover -s backend/tests
  PowerShell  : $env:PYTHONPATH = "backend"; python -m unittest discover -s backend/tests
"""
import json
import unittest
from datetime import datetime, timedelta, timezone

import numpy as np

from app.radio.export import (build_timeline, check_prob, format_utc, map_snapshot, prob_to_cells,
                              validate_timeline)
from app.radio.schema import Confidence, EventType, FieldEvent, Location, Status
from app.radio.update_map import GridSpec, apply_event, new_state

GRID = GridSpec(x0=0, y0=1000, cell_m=10, rows=100, cols=100, crs="EPSG:32611", grid_id="test-grid-v1")
KST = timezone(timedelta(hours=9))
LAST_SEEN = datetime(2026, 11, 20, 14, 32, 0, tzinfo=KST)
LKP = (-119.59, 37.745)


def uniform(rows=100, cols=100):
    return np.ones((rows, cols)) / (rows * cols)


def valid_timeline():
    a = uniform()
    b = a.copy()
    b[:50] *= 0.5
    b /= b.sum()
    return build_timeline(GRID, [(0, a), (3600, b)], lkp_lonlat=LKP, last_seen=LAST_SEEN,
                          model_version="timeline-test", result_kind="synthetic", max_cells=10000)


class CheckProbTest(unittest.TestCase):
    def test_rejects_bad_grids(self):
        bad = {
            "nan": np.where(np.arange(10000).reshape(100, 100) == 0, np.nan, 1.0),
            "inf": np.where(np.arange(10000).reshape(100, 100) == 0, np.inf, 0.0),
            "negative": uniform() - 2e-4,
            "all zero": np.zeros((100, 100)),
            "sum not one": np.ones((100, 100)) / 5000,
        }
        for name, prob in bad.items():
            with self.subTest(name):
                with self.assertRaises(ValueError):
                    check_prob(prob)
        with self.assertRaises(ValueError):
            check_prob(np.ones(5))  # 2차원이 아님

    def test_unit_sum_optional_but_never_above_one(self):
        half = uniform() / 2
        self.assertAlmostEqual(float(check_prob(half, require_unit_sum=False).sum()), 0.5)
        with self.assertRaises(ValueError):
            check_prob(uniform() * 2, require_unit_sum=False)

    def test_small_float_error_is_removed(self):
        p = uniform() * (1 + 5e-7)
        self.assertAlmostEqual(float(check_prob(p).sum()), 1.0, places=12)


class ProbToCellsTest(unittest.TestCase):
    def test_hot_cell_index_is_row_major(self):
        p = np.zeros(GRID.shape)
        p[3, 7] = 1.0
        cells, stride = prob_to_cells(p)
        self.assertEqual((cells, stride), ([[3 * GRID.cols + 7, 1.0]], 1))

    def test_all_cells_kept_when_they_fit(self):
        cells, stride = prob_to_cells(uniform(), max_cells=10000)
        self.assertEqual((len(cells), stride), (10000, 1))
        self.assertEqual(len({i for i, _ in cells}), 10000)

    def test_sparse_map_stays_full_resolution(self):
        p = np.zeros(GRID.shape)
        p[:5, :5] = 1 / 25
        cells, stride = prob_to_cells(p, max_cells=100)
        self.assertEqual((len(cells), stride), (25, 1))

    def test_uniform_over_limit_is_spatially_even(self):
        # 10,000셀을 2,500개로 제한 → 앞쪽(북서)만 자르지 않고 전체를 고르게 대표해야 한다
        cells, stride = prob_to_cells(uniform(), max_cells=2500)
        self.assertEqual(stride, 2)
        self.assertEqual(len(cells), 2500)
        self.assertAlmostEqual(sum(m for _, m in cells), 1.0, places=12)
        rows = np.array([i // 100 for i, _ in cells])
        cols = np.array([i % 100 for i, _ in cells])
        for rmask in (rows < 50, rows >= 50):
            for cmask in (cols < 50, cols >= 50):
                self.assertEqual(int((rmask & cmask).sum()), 625)  # 네 사분면에 같은 수
        self.assertGreater(rows.max(), 95)
        self.assertGreater(cols.max(), 95)

    def test_block_sums_and_representative_cells(self):
        p = np.arange(1, 17, dtype=float).reshape(4, 4) / 136  # 모든 칸이 양수, 합 1
        cells, stride = prob_to_cells(p, max_cells=4)
        self.assertEqual(stride, 2)
        got = {i: round(m * 136, 9) for i, m in cells}
        # 2×2 블록 합계가 블록 중앙 칸(오른쪽 아래 칸)의 인덱스에 담긴다
        self.assertEqual(got, {5: 14.0, 7: 22.0, 13: 46.0, 15: 54.0})

    def test_few_positive_cells_keep_full_resolution(self):
        p = np.zeros((4, 4))
        p[0, 0], p[1, 1], p[2, 3], p[3, 3] = 0.1, 0.2, 0.3, 0.4
        cells, stride = prob_to_cells(p, max_cells=4)  # 양수 칸이 4개라 제한 안에 들어간다
        self.assertEqual(stride, 1)
        self.assertEqual({i: round(m, 9) for i, m in cells}, {0: 0.1, 5: 0.2, 11: 0.3, 15: 0.4})

    def test_edge_blocks_are_included_and_inside_grid(self):
        p = uniform(5, 7)
        cells, stride = prob_to_cells(p, max_cells=6)
        self.assertGreaterEqual(stride, 2)
        self.assertAlmostEqual(sum(m for _, m in cells), 1.0, places=12)
        self.assertTrue(all(0 <= i < 5 * 7 for i, _ in cells))
        self.assertEqual(len({i for i, _ in cells}), len(cells))

    def test_sorted_and_deterministic(self):
        rng = np.random.default_rng(0)
        p = rng.random((100, 100))
        p /= p.sum()
        first, _ = prob_to_cells(p, max_cells=2500)
        second, _ = prob_to_cells(p, max_cells=2500)
        self.assertEqual(first, second)
        masses = [m for _, m in first]
        self.assertEqual(masses, sorted(masses, reverse=True))

    def test_invalid_max_cells(self):
        with self.assertRaises(ValueError):
            prob_to_cells(uniform(), max_cells=0)


class MapSnapshotTest(unittest.TestCase):
    def test_snapshot_after_event(self):
        s1 = new_state(np.ones(GRID.shape))
        marker = FieldEvent("m1", EventType.BLOCKED, Location(value="t", x=300, y=300, radius_m=50),
                            status=Status.APPROVED)
        search = FieldEvent("e1", EventType.SEARCHED, Location(value="t", x=500, y=500, radius_m=200),
                            Confidence.THOROUGH, status=Status.APPROVED)
        s3 = apply_event(apply_event(s1, search, GRID), marker, GRID)
        snap = map_snapshot(GRID, s3, top_n=3, zone_cells=20, max_cells=2500)
        self.assertEqual(snap["map_version"], 3)
        self.assertEqual(snap["grid"]["grid_id"], "test-grid-v1")
        self.assertEqual(snap["cell_stride"], 2)
        self.assertAlmostEqual(snap["total_probability"], 1.0, places=9)
        self.assertEqual(len(snap["top_zones"]), 3)
        self.assertEqual(len(snap["markers"]), 1)
        self.assertEqual(json.loads(json.dumps(snap)), snap)

    def test_shape_mismatch(self):
        with self.assertRaises(ValueError):
            map_snapshot(GRID, new_state(np.ones((5, 5))))


class BuildTimelineTest(unittest.TestCase):
    def test_format_and_roundtrip(self):
        t = valid_timeline()
        self.assertEqual(t["last_seen_utc"], "2026-11-20T05:32:00.000Z")
        self.assertEqual(format_utc(datetime(2026, 1, 1, 0, 0, 0, 123456, tzinfo=timezone.utc)),
                         "2026-01-01T00:00:00.123Z")
        self.assertEqual(json.loads(json.dumps(t)), t)
        self.assertEqual([f["elapsed_seconds"] for f in t["frames"]], [0, 3600])
        self.assertTrue(all(f["cell_stride"] == 1 for f in t["frames"]))

    def test_naive_datetime_rejected(self):
        with self.assertRaises(ValueError):
            format_utc(datetime(2026, 11, 20, 14, 32))

    def test_snapshot_count(self):
        kwargs = dict(lkp_lonlat=LKP, last_seen=LAST_SEEN, model_version="x")
        with self.assertRaises(ValueError):
            build_timeline(GRID, [], **kwargs)
        with self.assertRaises(ValueError):
            build_timeline(GRID, [(0, uniform())], **kwargs)

    def test_elapsed_must_be_strict_integers(self):
        kwargs = dict(lkp_lonlat=LKP, last_seen=LAST_SEEN, model_version="x")
        p = uniform()
        for name, pair in {
            "float": [(0, p), (1.5, p)],
            "bool": [(0, p), (True, p)],
            "negative": [(-1, p), (5, p)],
            "duplicate": [(0, p), (0, p)],
            "decreasing": [(5, p), (3, p)],
        }.items():
            with self.subTest(name):
                with self.assertRaises(ValueError):
                    build_timeline(GRID, pair, **kwargs)
        # numpy 정수는 허용
        t = build_timeline(GRID, [(np.int64(0), p), (np.int64(60), p)], max_cells=10000, **kwargs)
        self.assertEqual([f["elapsed_seconds"] for f in t["frames"]], [0, 60])

    def test_bad_probability_rejected(self):
        kwargs = dict(lkp_lonlat=LKP, last_seen=LAST_SEEN, model_version="x")
        with self.assertRaises(ValueError):
            build_timeline(GRID, [(0, uniform()), (1, uniform() * 2)], **kwargs)
        with self.assertRaises(ValueError):
            build_timeline(GRID, [(0, uniform()), (1, np.zeros(GRID.shape))], **kwargs)

    def test_uniform_over_limit_is_even_and_total_one(self):
        t = build_timeline(GRID, [(0, uniform()), (60, uniform())], lkp_lonlat=LKP, last_seen=LAST_SEEN,
                           model_version="x", max_cells=2500)
        frame = t["frames"][0]
        self.assertEqual(frame["cell_stride"], 2)
        self.assertAlmostEqual(sum(m for _, m in frame["cells"]), 1.0, places=9)

    def test_with_apply_event_snapshots(self):
        s1 = new_state(np.ones(GRID.shape))
        event = FieldEvent("e1", EventType.SEARCHED, Location(value="t", x=500, y=500, radius_m=200),
                           Confidence.THOROUGH, status=Status.APPROVED)
        s2 = apply_event(s1, event, GRID)
        t = build_timeline(GRID, [(0, s1.prob), (600, s2.prob)], lkp_lonlat=LKP, last_seen=LAST_SEEN,
                           model_version="demo", terrain_revision="rev-1", max_cells=10000)
        self.assertEqual(t["terrain_revision"], "rev-1")

    def test_shape_mismatch(self):
        with self.assertRaises(ValueError):
            build_timeline(GRID, [(0, np.ones((5, 5)) / 25), (1, np.ones((5, 5)) / 25)], lkp_lonlat=LKP,
                           last_seen=LAST_SEEN, model_version="x")


class ValidateTimelineTest(unittest.TestCase):
    def check_rejected(self, mutate):
        t = valid_timeline()
        mutate(t)
        with self.assertRaises(ValueError):
            validate_timeline(t, GRID)

    def test_valid_passes(self):
        validate_timeline(valid_timeline(), GRID)

    def test_rejections(self):
        self.check_rejected(lambda t: t.update(schema_version=2))
        self.check_rejected(lambda t: t.update(grid_id="other"))
        self.check_rejected(lambda t: t.update(model_version="  "))
        self.check_rejected(lambda t: t.update(model_version="x" * 101))
        self.check_rejected(lambda t: t.update(lkp=[200, 0]))
        self.check_rejected(lambda t: t.update(lkp=[0, 91]))
        self.check_rejected(lambda t: t.update(lkp=[0.0]))
        self.check_rejected(lambda t: t.update(last_seen_utc="2026-11-20T05:32:00Z"))
        self.check_rejected(lambda t: t.update(last_seen_utc="2026-11-20T05:32:00.000+09:00"))
        self.check_rejected(lambda t: t.update(frames=t["frames"][:1]))
        self.check_rejected(lambda t: t.update(terrain_revision=""))
        self.check_rejected(lambda t: t.update(result_kind="other"))

    def test_frame_rejections(self):
        self.check_rejected(lambda t: t["frames"][1].update(elapsed_seconds=0))
        self.check_rejected(lambda t: t["frames"][0].update(elapsed_seconds=-1))
        self.check_rejected(lambda t: t["frames"][0].update(elapsed_seconds=1.5))
        self.check_rejected(lambda t: t["frames"][0]["cells"].append([0, 0.5]))
        self.check_rejected(lambda t: t["frames"][0]["cells"].append([10000, 0.1]))
        self.check_rejected(lambda t: t["frames"][0]["cells"].append([-1, 0.1]))
        self.check_rejected(lambda t: t["frames"][0].update(cells=[[0, 0.0]]))
        self.check_rejected(lambda t: t["frames"][0].update(cells=[[0, 1.5]]))
        self.check_rejected(lambda t: t["frames"][0].update(cells=[[0, 0.6], [1, 0.6]]))
        self.check_rejected(lambda t: t["frames"][0].update(cells=[[0, 0.5, 1]]))

    def test_grid_without_id_rejected(self):
        no_id = GridSpec(x0=0, y0=1000, cell_m=10, rows=100, cols=100)
        with self.assertRaises(ValueError):
            validate_timeline(valid_timeline(), no_id)


if __name__ == "__main__":
    unittest.main()
