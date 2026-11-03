import tempfile
import unittest
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

from app.terrain import align_terrain


class AlignTerrainTest(unittest.TestCase):
    def test_resamples_plane_and_preserves_missing_terrain(self):
        source_transform = from_origin(500000, 100, 5, 5)
        grid = {
            "schema_version": 1, "crs": "EPSG:32611", "rows": 8, "columns": 9,
            "origin_north_west": [499990, 110], "cell_size_m": 10,
            "geo_transform": [499990, 10, 0, 110, 0, -10], "cell_count": 72,
        }
        values = np.tile(np.arange(16, dtype=np.float32) * 5, (16, 1))
        values[6:12, 6:12] = -9999
        with tempfile.TemporaryDirectory() as directory:
            dem = Path(directory) / "plane.tif"
            with rasterio.open(
                dem, "w", driver="GTiff", width=16, height=16, count=1,
                dtype="float32", crs=grid["crs"], transform=source_transform, nodata=-9999,
            ) as dataset:
                dataset.write(values, 1)

            elevation, slope, valid, source = align_terrain(dem, grid)
            self.assertEqual(elevation.shape, (8, 9))
            self.assertEqual(source["pixel_size"], [5, 5])
            self.assertTrue(np.isnan(elevation[0]).all())
            self.assertTrue(np.isnan(elevation[:, 0]).all())
            self.assertAlmostEqual(elevation[2, 3], 22.5)
            self.assertAlmostEqual(slope[2, 3], 45.0, delta=0.001)
            self.assertTrue(np.isnan(elevation[5, 5]))
            self.assertFalse(valid[5, 5])
            self.assertFalse(valid[5, 6])
            np.testing.assert_array_equal(valid, np.isfinite(slope))

            with self.assertRaisesRegex(ValueError, "inconsistent geometry"):
                align_terrain(dem, {**grid, "cell_count": 1})
