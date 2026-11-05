import unittest
from rasterio.warp import transform_geom
from app.access import build_access

class AccessTest(unittest.TestCase):
    def test_water_bridge_override_and_unknown_background(self):
        grid = {"schema_version": 1, "rows": 5, "columns": 5, "cell_count": 25,
                "cell_size_m": 10, "crs": "EPSG:32611", "origin_north_west": [500000,100],
                "geo_transform": [500000,10,0,100,0,-10]}
        def feature(geometry, state, kind):
            return {"geometry": transform_geom(grid["crs"], "EPSG:4326", geometry),
                    "properties": {"status": state, "kind": kind}}
        water = feature({"type": "Polygon", "coordinates": [[[500010,90],[500040,90],[500040,60],[500010,60],[500010,90]]]}, "blocked", "water")
        bridge = feature({"type": "LineString", "coordinates": [[500000,75],[500050,75]]}, "allowed", "road")
        package = {"base_feature_count": 1, "schema_version": 1, "grid": grid, "features": [water,bridge]}
        access, linear = build_access(package)
        self.assertEqual(access[0,0], 0)
        self.assertEqual(access[2,2], 1)
        self.assertEqual(access[1,2], 2)
        self.assertEqual(linear[2,2], 1)
        access, _ = build_access({**package, "features": [water]})
        self.assertEqual(access[2,2], 2)
