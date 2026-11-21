import unittest

from app.abm_preview import PreviewInputError, abm_preview


class AbmPreviewTest(unittest.TestCase):
    def test_stationary_directional_and_backtracking_previews(self):
        grid = {
            "schema_version": 1, "grid_id": "sample", "origin_north_west": [0, 600],
            "cell_size_m": 6, "rows": 100, "columns": 100,
        }
        case = {"point": [303, 297], "lkp": [-119.59, 37.76],
                "last_seen_utc": "2026-11-08T12:00:00.000Z", "hours": 1}
        stationary = abm_preview(grid, {**case, "behavior": "sp"}, samples=8)
        self.assertEqual([frame["cells"] for frame in stationary["frames"]], [[[5050, 1.0]]] * 2)

        walk = abm_preview(grid, case, samples=8)
        directional = abm_preview(grid, {**case, "behavior": "dt"}, samples=8)
        self.assertNotEqual(walk["frames"], directional["frames"])

        retrace = abm_preview(grid, {**case, "behavior": "bt", "hours": 2}, samples=8)
        self.assertEqual(retrace["frames"][0], walk["frames"][0])
        self.assertTrue(all(
            abs(index // 100 - 50) <= 1 and abs(index % 100 - 50) <= 1
            for index, _ in retrace["frames"][1]["cells"]
        ))
        self.assertEqual(retrace["frames"][-1]["cells"], [[5050, 1.0]])

    def test_route_preview_uses_projected_trail_with_or_without_access_policy(self):
        from rasterio.warp import transform_geom

        grid = {
            "schema_version": 1, "grid_id": "sample", "crs": "EPSG:32611",
            "origin_north_west": [500000, 600], "cell_size_m": 6, "rows": 100, "columns": 100,
            "cell_count": 10000, "geo_transform": [500000, 6, 0, 600, 0, -6],
        }
        case = {"point": [500003, 297], "lkp": [-117, 0.0027], "behavior": "rt",
                "last_seen_utc": "2026-11-08T12:00:00.000Z", "hours": 1}
        with self.assertRaisesRegex(PreviewInputError, "선형 지형 자료"):
            abm_preview(grid, case, samples=8)
        terrain = {"schema_version": 1, "revision": "test-trail", "features": []}
        with self.assertRaisesRegex(PreviewInputError, "사용할 선형 지형이 없습니다"):
            abm_preview(grid, {**case, "terrain": terrain}, samples=8)

        trail = transform_geom("EPSG:32611", "EPSG:4326", {
            "type": "LineString", "coordinates": [[500001, 297], [500599, 297]],
        })
        terrain["features"] = [{"geometry": trail, "properties": {"status": "allowed", "kind": "trail"}}]
        route_only = abm_preview(grid, {**case, "terrain": terrain, "apply_access": False}, samples=16)
        walk = abm_preview(grid, {**case, "behavior": "rw"}, samples=16)
        self.assertNotEqual(route_only["frames"], walk["frames"])
        self.assertEqual(route_only["terrain_revision"], "test-trail")
        self.assertNotIn("access_mode", route_only["abm_preview"])

        restricted = abm_preview(grid, {**case, "terrain": terrain, "allow_unknown": False}, samples=8)
        self.assertTrue(all(index // 100 == 50 for frame in restricted["frames"] for index, _ in frame["cells"]))
        self.assertEqual(restricted["abm_preview"]["access_mode"], "known-only")

    def test_frames_are_reproducible_and_count_all_agents_inside_the_grid(self):
        grid = {
            "schema_version": 1, "grid_id": "sample", "origin_north_west": [0, 600],
            "cell_size_m": 6, "rows": 100, "columns": 100,
        }
        case = {
            "point": [301, 301], "lkp": [-119.59, 37.76],
            "last_seen_utc": "2026-11-08T12:00:00.000Z", "hours": 2,
        }
        result = abm_preview(grid, case, samples=8)
        self.assertEqual(result, abm_preview(grid, case, samples=8))
        self.assertEqual(result["lkp"], case["lkp"])
        shorter = abm_preview(grid, {**case, "hours": 1}, samples=8)
        self.assertEqual(shorter["frames"], result["frames"][:2])
        self.assertEqual([frame["elapsed_seconds"] for frame in result["frames"]], [1800, 3600, 5400, 7200])
        for frame in result["frames"]:
            self.assertAlmostEqual(sum(value for _, value in frame["cells"]), 1)
            self.assertTrue(all(0 <= index < 10_000 for index, _ in frame["cells"]))
        self.assertNotEqual(result["frames"][0]["cells"], result["frames"][-1]["cells"])

    def test_applied_wall_blocks_same_seed_paths_and_corners(self):
        from rasterio.warp import transform_geom

        grid = {
            "schema_version": 1, "grid_id": "sample", "crs": "EPSG:32611",
            "origin_north_west": [500000, 600], "cell_size_m": 6, "rows": 100, "columns": 100,
            "cell_count": 10000, "geo_transform": [500000, 6, 0, 600, 0, -6],
        }
        case = {"point": [500295, 301], "lkp": [-117, 0.0027],
                "last_seen_utc": "2026-11-08T12:00:00.000Z", "hours": 1}
        geometry = transform_geom("EPSG:32611", "EPSG:4326", {"type": "Polygon", "coordinates": [[
            [500301, -10], [500305, -10], [500305, 610], [500301, 610], [500301, -10],
        ]]})
        terrain = {"schema_version": 1, "revision": "wall", "base_feature_count": 0,
                   "features": [{"geometry": geometry, "properties": {"status": "blocked", "kind": "override"}}]}
        baseline = abm_preview(grid, case, samples=16)
        blocked = abm_preview(grid, {**case, "terrain": terrain}, samples=16)
        self.assertTrue(any(index % 100 > 50 for frame in baseline["frames"] for index, _ in frame["cells"]))
        self.assertTrue(all(index % 100 < 50 for frame in blocked["frames"] for index, _ in frame["cells"]))
        self.assertEqual(blocked["terrain_revision"], "wall")

        import numpy as np
        from app.abm_preview import ReviewedGrid
        from app.abm_reproduction.config import ABMConfig
        access = np.array([[1, 2], [2, 1]], dtype=np.uint8)
        movement = ReviewedGrid(ABMConfig(grid_rows=2, grid_cols=2), access, np.ones((2, 2), bool), True)
        self.assertFalse(movement.can_move((0, 0), (1, 1)))

    def test_explains_an_unknown_start_and_marks_an_isolated_start(self):
        from unittest.mock import patch
        import numpy as np

        grid = {
            "schema_version": 1, "grid_id": "sample", "origin_north_west": [0, 18],
            "cell_size_m": 6, "rows": 3, "columns": 3,
        }
        case = {
            "point": [9, 9], "lkp": [-119.59, 37.76], "last_seen_utc": "2026-11-08T12:00:00.000Z",
            "hours": 1, "allow_unknown": False, "terrain": {"revision": "test"},
        }
        access = np.zeros((3, 3), dtype=np.uint8)
        with patch("app.abm_preview.build_access", return_value=(access, None)):
            with self.assertRaisesRegex(PreviewInputError, "통행 상태가 미확인"):
                abm_preview(grid, case, samples=2)
            access[1, 1] = 1
            result = abm_preview(grid, case, samples=2)
            self.assertIs(result["abm_preview"]["can_depart"], False)
            self.assertEqual([frame["cells"] for frame in result["frames"]], [[[4, 1.0]], [[4, 1.0]]])
            access[1, 1] = 2
            with self.assertRaisesRegex(PreviewInputError, "통행 불가로 지정"):
                abm_preview(grid, case, samples=2)

    def test_elevation_preview_uses_aligned_dem_and_slope_mask(self):
        import json
        from pathlib import Path
        from tempfile import TemporaryDirectory

        import numpy as np
        grid = {
            "schema_version": 1, "grid_id": "sample", "crs": "EPSG:32611",
            "origin_north_west": [0, 60], "cell_size_m": 6, "rows": 10, "columns": 10,
        }
        case = {"point": [31, 31], "lkp": [-119.59, 37.76], "behavior": "ve", "slope_limit": 35,
                "last_seen_utc": "2026-11-08T12:00:00.000Z", "hours": 1}
        elevation = np.tile(np.arange(10), (10, 1))
        slope = np.zeros((10, 10))
        slope[:, 8:] = 40
        with TemporaryDirectory() as directory:
            dem = Path(directory) / "dem.npz"
            metadata = {"terrain_schema_version": 1, "grid": grid, "source": {"elevation_unit": "m", "version": "test-dem"}}
            np.savez(dem, elevation_m=elevation, slope_deg=slope, metadata=json.dumps(metadata))
            result = abm_preview(grid, case, samples=8, dem_path=dem)
            self.assertEqual(result["abm_preview"]["dem_version"], "test-dem")
            self.assertEqual(result["abm_preview"]["slope_limit_deg"], 35)
            self.assertTrue(all(index % 10 < 8 for frame in result["frames"] for index, _ in frame["cells"]))
            self.assertTrue(any(index % 10 > 5 for index, _ in result["frames"][0]["cells"]))
            with self.assertRaises(PreviewInputError):
                abm_preview({**grid, "grid_id": "other"}, case, samples=8, dem_path=dem)
