import base64
import json
import unittest

import numpy as np

from app.ring_model import DEFAULT_PROFILES, load_profile, read_distances, ring_probability
from app.ring_preview import SUBJECT_TYPE, ring_preview


class RingPreviewTest(unittest.TestCase):
    def test_wire_result_preserves_model_probabilities_and_coverage(self):
        grid = {
            "schema_version": 1,
            "grid_id": "sample",
            "origin_north_west": [0, 4000],
            "cell_size_m": 100,
            "rows": 40,
            "columns": 50,
        }
        point = (800, 3000)
        profiles = json.loads(DEFAULT_PROFILES.read_text(encoding="utf-8"))
        distances = read_distances(load_profile(profiles, SUBJECT_TYPE), SUBJECT_TYPE)
        expected, coverage = ring_probability(grid, point, distances)

        result = ring_preview(grid, point)
        indices = np.frombuffer(base64.b64decode(result["cell_indices"], validate=True), dtype=np.uint8)
        actual = np.asarray(result["palette"])[indices].reshape(expected.shape)
        np.testing.assert_array_equal(actual, expected)
        self.assertEqual(result["grid_id"], grid["grid_id"])
        self.assertAlmostEqual(result["in_grid_mass"], coverage)
        self.assertLess(coverage, 1)
