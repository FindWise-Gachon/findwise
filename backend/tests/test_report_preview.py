import unittest

from app.report_preview import report_preview


class ReportPreviewTest(unittest.TestCase):
    def test_updates_only_after_explicit_approval_and_rejects_duplicates(self):
        grid = {"grid_id": "sample", "origin_north_west": [0, 200], "cell_size_m": 100, "rows": 2, "columns": 2}
        data = {"status": "승인 대기", "event_id": "report-1", "point": [50, 150], "radius_m": 50,
                "cells": [[0, 0.5], [1, 0.5]], "applied_ids": []}
        with self.assertRaisesRegex(ValueError, "승인된"):
            report_preview(grid, data)
        approved = report_preview(grid, {**data, "status": "승인"})
        self.assertTrue(approved["changed"])
        self.assertAlmostEqual(approved["cells"][0][1], 1 / 3)
        self.assertAlmostEqual(approved["cells"][1][1], 2 / 3)
        self.assertEqual(data["cells"], [[0, 0.5], [1, 0.5]])
        with self.assertRaisesRegex(ValueError, "이미 반영"):
            report_preview(grid, {**data, "status": "승인", "applied_ids": ["report-1"]})
