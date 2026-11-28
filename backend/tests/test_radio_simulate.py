import math
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

import numpy as np

from app.radio.schema import Confidence, EventType, FieldEvent, Location, Status
from app.radio.simulate import (
    SimConfig, area_fraction, coarsen, default_grid, exclude_circle, format_report, gaussian_prior,
    load_prior_npz, paired_difference, run, run_budget, run_sequential, sweep, wilson,
)
from app.radio.update_map import POD_BY_CONFIDENCE, GridSpec, apply_event, new_state

SMALL = GridSpec(x0=0.0, y0=3000.0, cell_m=30.0, rows=100, cols=100, crs="EPSG:32611", grid_id="t")


def small_prior():
    return gaussian_prior(SMALL, sigma_m=500.0)


class PriorTests(unittest.TestCase):
    def test_gaussian_prior_sums_to_one_and_peaks_at_center(self):
        p = small_prior()
        self.assertAlmostEqual(float(p.sum()), 1.0)
        self.assertEqual(p.shape, SMALL.shape)
        r, c = np.unravel_index(int(p.argmax()), p.shape)
        self.assertLess(abs(r - 50), 2)
        self.assertLess(abs(c - 50), 2)

    def test_invalid_sigma(self):
        with self.assertRaises(ValueError):
            gaussian_prior(SMALL, sigma_m=0)

    def test_load_prior_npz_validation(self):
        with tempfile.TemporaryDirectory() as d:
            ok = Path(d) / "ok.npz"
            np.savez(ok, probability=small_prior())
            self.assertEqual(load_prior_npz(ok, SMALL).shape, SMALL.shape)
            bad_shape = Path(d) / "shape.npz"
            np.savez(bad_shape, probability=np.full((3, 3), 1 / 9))
            with self.assertRaises(ValueError):
                load_prior_npz(bad_shape, SMALL)
            bad_sum = Path(d) / "sum.npz"
            np.savez(bad_sum, probability=small_prior() * 2)
            with self.assertRaises(ValueError):
                load_prior_npz(bad_sum, SMALL)
            missing = Path(d) / "missing.npz"
            np.savez(missing, other=np.zeros(3))
            with self.assertRaises(ValueError):
                load_prior_npz(missing, SMALL)


class HelperTests(unittest.TestCase):
    def test_exclude_circle_zeroes_and_renormalizes(self):
        p = small_prior()
        x, y = 1500.0, 1500.0
        out = exclude_circle(p, SMALL, x, y, 200.0)
        mask = SMALL.circle_mask(x, y, 200.0)
        self.assertTrue(mask.any())
        self.assertTrue((out[mask] == 0).all())
        self.assertAlmostEqual(float(out.sum()), 1.0)

    def test_apply_event_matches_bayes_formula(self):
        p = small_prior()
        x, y, r = 1500.0, 1500.0, 250.0
        event = FieldEvent("e1", EventType.SEARCHED,
                           Location(kind="좌표", value="t", x=x, y=y, radius_m=r),
                           Confidence.NORMAL, status=Status.APPROVED)
        got = apply_event(new_state(p), event, SMALL).prob
        mask = SMALL.circle_mask(x, y, r)
        expect = p.copy()
        expect[mask] *= 1 - POD_BY_CONFIDENCE[Confidence.NORMAL]
        expect /= expect.sum()
        np.testing.assert_allclose(got, expect, atol=1e-12)

    def test_area_fraction_ranks_and_tie_break(self):
        p = np.array([0.1, 0.4, 0.4, 0.1])
        self.assertAlmostEqual(area_fraction(p, 1), 1 / 4)   # 동점은 인덱스가 앞선 셀이 먼저
        self.assertAlmostEqual(area_fraction(p, 2), 2 / 4)
        self.assertAlmostEqual(area_fraction(p, 0), 3 / 4)
        self.assertAlmostEqual(area_fraction(p, 3), 4 / 4)

    def test_wilson_and_paired(self):
        p, lo, hi = wilson(50, 100)
        self.assertAlmostEqual(p, 0.5)
        self.assertLess(lo, 0.5)
        self.assertGreater(hi, 0.5)
        self.assertTrue(all(math.isnan(v) for v in wilson(0, 0)))
        d = paired_difference(np.array([0, 0, 1, 1]), np.array([1, 0, 1, 1]))
        self.assertAlmostEqual(d["mean"], 0.25)
        self.assertTrue(math.isnan(paired_difference(np.array([1.0]), np.array([2.0]))["lo"]))


class ConfigTests(unittest.TestCase):
    def test_validation(self):
        for bad in (dict(trials=0), dict(steps=0), dict(radius_m=0), dict(pod_scale=0), dict(location_error_m=-1)):
            with self.assertRaises(ValueError):
                replace(SimConfig(), **bad).validate()

    def test_true_pod_is_scaled_and_capped(self):
        self.assertAlmostEqual(SimConfig(pod_scale=0.5).true_pod, 0.25)
        self.assertEqual(SimConfig(confidence=Confidence.THOROUGH, pod_scale=2.0).true_pod, 1.0)

    def test_default_grid_is_valid(self):
        g = default_grid()
        self.assertEqual(g.shape, (200, 200))


class SequentialTests(unittest.TestCase):
    CFG = SimConfig(trials=120, steps=5, radius_m=250.0, seed=7)

    def test_deterministic(self):
        a = run_sequential(self.CFG, SMALL, small_prior())
        b = run_sequential(self.CFG, SMALL, small_prior())
        self.assertEqual(a, b)

    def test_first_step_equal_across_conditions(self):
        by_step = run_sequential(self.CFG, SMALL, small_prior())["detection_by_step"]
        self.assertEqual(by_step["none"][0], by_step["exclude"][0])
        self.assertEqual(by_step["none"][0], by_step["update"][0])

    def test_cumulative_is_monotone_and_bounded(self):
        for series in run_sequential(self.CFG, SMALL, small_prior())["detection_by_step"].values():
            self.assertEqual(series, sorted(series))
            self.assertTrue(all(0.0 <= v <= 1.0 for v in series))

    def test_certain_prior_and_perfect_pod_finds_at_step_one(self):
        delta = np.zeros(SMALL.shape)
        delta[50, 50] = 1.0
        # 우선 구역은 격자에 맞춘 블록이라 정점이 모서리에 있으면 중심이 반경 밖일 수 있다 → 격자 전체를 덮는 반경
        cfg = replace(self.CFG, radius_m=2000.0, confidence=Confidence.THOROUGH, pod_scale=1 / 0.8)  # 실제 POD = 1
        res = run_sequential(cfg, SMALL, delta)
        for cond in ("none", "exclude", "update"):
            self.assertEqual(res["detection_by_step"][cond][0], 1.0)

    def test_update_beats_static_map_in_plain_setting(self):
        cfg = replace(self.CFG, trials=400, steps=8, radius_m=250.0)
        res = run_sequential(cfg, SMALL, small_prior())
        self.assertGreater(res["final"]["update"]["rate"], res["final"]["none"]["rate"])


class BudgetTests(unittest.TestCase):
    CFG = SimConfig(trials=150, steps=4, radius_m=250.0, seed=11)

    def test_counts_add_up_and_values_in_range(self):
        res = run_budget(self.CFG, SMALL, small_prior())
        self.assertEqual(res["kept"] + res["discovered_during_plan"], self.CFG.trials)
        for cond, row in res["inclusion"].items():
            for v in row.values():
                self.assertTrue(0.0 <= v <= 1.0)
        for cond in ("none", "exclude", "update"):
            vals = [res["inclusion"][cond][k] for k in sorted(res["inclusion"][cond], key=float)]
            self.assertEqual(vals, sorted(vals))  # 예산이 클수록 포함 비율은 줄지 않는다

    def test_deterministic(self):
        self.assertEqual(run_budget(self.CFG, SMALL, small_prior()), run_budget(self.CFG, SMALL, small_prior()))


class ReportTests(unittest.TestCase):
    def test_run_and_format(self):
        cfg = SimConfig(trials=40, steps=3, radius_m=250.0, seed=3)
        result = run(cfg, SMALL, small_prior())
        text = format_report(result, "테스트")
        self.assertIn("미반영", text)
        self.assertIn("확률 보정", text)
        self.assertIn("합성 시나리오", text)

    def test_sweep_keys(self):
        cfg = SimConfig(trials=30, steps=2, radius_m=250.0, seed=3)
        rows = sweep(cfg, SMALL, small_prior(), "pod-scale", [1.0, 0.5])
        self.assertEqual([r["value"] for r in rows], [1.0, 0.5])
        self.assertAlmostEqual(rows[1]["config"]["pod_scale"], 0.5)
        with self.assertRaises(ValueError):
            sweep(cfg, SMALL, small_prior(), "unknown", [1.0])


class CoarsenTests(unittest.TestCase):
    def test_mass_is_preserved_and_grid_scaled(self):
        prior = small_prior()
        grid, merged = coarsen(SMALL, prior, 5)
        self.assertEqual(merged.shape, (20, 20))
        self.assertEqual((grid.rows, grid.cols, grid.cell_m), (20, 20, 150.0))
        self.assertEqual((grid.x0, grid.y0), (SMALL.x0, SMALL.y0))
        self.assertAlmostEqual(float(merged.sum()), 1.0)
        self.assertAlmostEqual(float(merged[0, 0]), float(prior[:5, :5].sum()))
        self.assertTrue(grid.grid_id.endswith("-x5"))

    def test_factor_one_is_identity_and_bad_factors_fail(self):
        prior = small_prior()
        self.assertIs(coarsen(SMALL, prior, 1)[1], prior)
        for bad in (0, -2, 3, 1.5, True):  # 100은 3으로 나누어떨어지지 않는다
            with self.subTest(factor=bad), self.assertRaises(ValueError):
                coarsen(SMALL, prior, bad)
        with self.assertRaises(ValueError):
            coarsen(SMALL, np.full((5, 5), 1 / 25), 5)

    def test_simulation_runs_on_coarsened_grid(self):
        grid, merged = coarsen(SMALL, small_prior(), 5)
        res = run(SimConfig(trials=30, steps=2, radius_m=400.0, seed=1), grid, merged)
        self.assertEqual(res["grid"]["cell_m"], 150.0)


if __name__ == "__main__":
    unittest.main()
