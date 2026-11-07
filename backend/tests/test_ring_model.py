import json
import math
import unittest

import numpy as np

from app.ring_model import DEFAULT_PROFILES, load_profile, read_distances, ring_probability

# Synthetic quantiles, not ISRID values.
DISTANCES = [100.0, 200.0, 300.0, 500.0]


def make_grid(rows, columns, cell=10, west=500000, north=4000000):
    return {
        "schema_version": 1, "crs": "EPSG:32611", "rows": rows, "columns": columns,
        "origin_north_west": [west, north], "cell_size_m": cell, "cell_count": rows * columns,
    }


def center_distance(grid, lkp):
    west, north = grid["origin_north_west"]
    cell = grid["cell_size_m"]
    centers_x = west + (np.arange(grid["columns"]) + 0.5) * cell
    centers_y = north - (np.arange(grid["rows"]) + 0.5) * cell
    return np.hypot(centers_x[np.newaxis, :] - lkp[0], centers_y[:, np.newaxis] - lkp[1])


class RingProbabilityTest(unittest.TestCase):
    def test_sums_to_one_and_splits_mass_by_percentile(self):
        grid = make_grid(200, 200)
        lkp = (501000, 3999000)
        probability, in_grid_mass = ring_probability(grid, lkp, DISTANCES)

        self.assertEqual(probability.shape, (200, 200))
        self.assertTrue((probability > 0).all())
        self.assertAlmostEqual(probability.sum(), 1.0, places=12)
        self.assertAlmostEqual(in_grid_mass, 1.0, delta=0.01)

        distance = center_distance(grid, lkp)
        inner = 0
        for outer, expected in zip(DISTANCES, (0.25, 0.25, 0.25, 0.20)):
            ring = (distance > inner) & (distance <= outer)
            self.assertAlmostEqual(probability[ring].sum(), expected, delta=0.01)
            inner = outer
        self.assertAlmostEqual(probability[distance > DISTANCES[-1]].sum(), 0.05, delta=0.01)

    def test_inner_rings_have_higher_cell_probability(self):
        probability, _ = ring_probability(make_grid(200, 200), (501000, 3999000), DISTANCES)
        self.assertGreater(probability[100, 100], probability[100, 125])
        self.assertGreater(probability[100, 125], probability[100, 130])
        self.assertGreater(probability[100, 130], probability[100, 170])
        self.assertEqual(probability[100, 170], probability[0, 0])

    def test_drops_mass_outside_grid_and_renormalises(self):
        # LKP on the west edge: about half of every ring falls outside.
        probability, in_grid_mass = ring_probability(make_grid(200, 200), (500005, 3999000), DISTANCES)
        self.assertAlmostEqual(probability.sum(), 1.0, places=12)
        self.assertAlmostEqual(in_grid_mass, 0.5 * 0.95 + 0.05, delta=0.03)

    def test_grid_inside_95_percent_ring_has_no_outside_cells(self):
        grid = make_grid(20, 20)
        lkp = (500100, 3999900)
        probability, in_grid_mass = ring_probability(grid, lkp, DISTANCES)
        self.assertTrue((center_distance(grid, lkp) <= DISTANCES[-1]).all())
        self.assertAlmostEqual(probability.sum(), 1.0, places=12)
        self.assertLess(in_grid_mass, 0.95)

    def test_is_deterministic(self):
        first, _ = ring_probability(make_grid(50, 60), (500300, 3999700), DISTANCES)
        second, _ = ring_probability(make_grid(50, 60), (500300, 3999700), DISTANCES)
        np.testing.assert_array_equal(first, second)

    def test_rejects_lkp_outside_grid(self):
        with self.assertRaisesRegex(ValueError, "outside the grid"):
            ring_probability(make_grid(10, 10), (499999, 3999950), DISTANCES)
        with self.assertRaisesRegex(ValueError, "outside the grid"):
            ring_probability(make_grid(10, 10), (500050, 4000000.5), DISTANCES)
        with self.assertRaisesRegex(ValueError, "finite"):
            ring_probability(make_grid(10, 10), (math.nan, 3999950), DISTANCES)

    def test_rejects_bad_grid(self):
        with self.assertRaisesRegex(ValueError, "inconsistent geometry"):
            ring_probability({**make_grid(10, 10), "cell_count": 1}, (500050, 3999950), DISTANCES)
        with self.assertRaisesRegex(ValueError, "Unsupported grid schema"):
            ring_probability({**make_grid(10, 10), "schema_version": 2}, (500050, 3999950), DISTANCES)


class ProfileTest(unittest.TestCase):
    def test_rejects_unfilled_and_unordered_distances(self):
        with self.assertRaisesRegex(ValueError, "no distance for 75, 95"):
            read_distances({"distance_m": {"25": 1, "50": 2, "75": None, "95": None}}, "hiker")
        with self.assertRaisesRegex(ValueError, "strictly increasing"):
            read_distances({"distance_m": {"25": 1, "50": 2, "75": 2, "95": 4}}, "hiker")
        self.assertEqual(read_distances({"distance_m": dict(zip(("25", "50", "75", "95"), DISTANCES))}), DISTANCES)

    def test_shipped_profiles_are_well_formed(self):
        profiles = json.loads(DEFAULT_PROFILES.read_text(encoding="utf-8"))
        names = sorted(profiles["profiles"])
        self.assertEqual(names, [
            "dementia_dry_mountain", "dementia_temperate_mountain",
            "despondent_dry_mountain", "despondent_temperate_mountain",
            "hiker_dry_mountain", "hiker_temperate_mountain",
        ])
        for name in names:
            profile = load_profile(profiles, name)
            self.assertEqual(profile["source"]["title"], "Lost Person Behavior")
            self.assertIn(profile["domain"], ("temperate", "dry"))
            self.assertEqual(sorted(profile["distance_m"]), ["25", "50", "75", "95"])
        self.assertEqual(read_distances(load_profile(profiles, "hiker_dry_mountain")), [1600, 3200, 6400, 19200])
        self.assertEqual(read_distances(load_profile(profiles, "hiker_temperate_mountain")), [1100, 3100, 5800, 18200])
        with self.assertRaisesRegex(ValueError, "Unknown subject type"):
            load_profile(profiles, "child")
