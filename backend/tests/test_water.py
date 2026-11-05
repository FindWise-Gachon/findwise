import unittest
import numpy as np
from rasterio.warp import transform_geom
from app.osm import water_geometry
from app.access import build_access
from app.movement import can_move

def member(points, role="outer"):
    return {"type": "way", "role": role, "geometry": [{"lon": x, "lat": y} for x,y in points]}

class WaterTest(unittest.TestCase):
    def test_split_reversed_outer_and_island_survive_rasterization(self):
        west, north = 500000, 100
        outer = [(west+10,north-10),(west+90,north-10),(west+90,north-90),(west+10,north-90),(west+10,north-10)]
        inner = [(west+30,north-30),(west+70,north-30),(west+70,north-70),(west+30,north-70),(west+30,north-30)]
        shape = water_geometry({"members":[member(outer[:3]),member(outer[2:][::-1]),member(inner,"inner")]})
        grid = {"schema_version":1,"rows":10,"columns":10,"cell_count":100,"cell_size_m":10,
                "crs":"EPSG:32611","origin_north_west":[west,north],"geo_transform":[west,10,0,north,0,-10]}
        package = {"schema_version":1,"grid":grid,"features":[{"geometry":transform_geom(grid["crs"],"EPSG:4326",shape),"properties":{"status":"blocked","kind":"water"}}]}
        access, _ = build_access(package)
        self.assertEqual(access[2,2],2)
        self.assertEqual(access[5,5],0)
        self.assertEqual(access[0,0],0)

    def test_incomplete_boundary_is_rejected(self):
        with self.assertRaises(ValueError):
            water_geometry({"members":[member([(0,0),(1,0)])]})

class MovementTest(unittest.TestCase):
    def test_blocked_corner_and_explicit_unknown_policy(self):
        access = np.ones((3,3),dtype="uint8")
        self.assertTrue(can_move(access,(0,0),(1,1),allow_unknown=False))
        access[0,1] = 2
        self.assertFalse(can_move(access,(0,0),(1,1),allow_unknown=True))
        access[0,1] = 0
        self.assertFalse(can_move(access,(0,0),(1,1),allow_unknown=False))
        self.assertTrue(can_move(access,(0,0),(1,1),allow_unknown=True))
        self.assertFalse(can_move(access,(0,0),(-1,0),allow_unknown=True))
        self.assertFalse(can_move(access,(0,0),(2,0),allow_unknown=True))
        access[1,1] = 2
        self.assertFalse(can_move(access,(0,0),(1,1),allow_unknown=True))
