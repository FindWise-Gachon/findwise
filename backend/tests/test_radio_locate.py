"""위치 확정(상대 위치, 구역명 사전) 테스트.

실행 (저장소 루트):
  PYTHONPATH=backend python -m unittest discover -s backend/tests
"""
import math
import unittest
from pathlib import Path

from app.radio.locate import Gazetteer, offset_point, parse_relative, resolve_relative
from app.radio.update_map import GridSpec

# 테스트용 예시. frontend/src/map/config.ts의 개발 격자와 같은 값 (6 km × 6 km)
DEV_GRID = GridSpec(x0=268800.0, y0=4183680.0, cell_m=6.0, rows=1000, cols=1000,
                    crs="EPSG:32611", grid_id="yosemite-valley-dev-6m-v1")
SAMPLE = Path(__file__).resolve().parents[2] / "data" / "samples" / "radio-gazetteer-example.json"
REF = (270000.0, 4182000.0)


class OffsetTest(unittest.TestCase):
    def test_cardinal_and_diagonal(self):
        self.assertEqual(offset_point(0, 0, "북", 200), (0, 200))
        x, y = offset_point(0, 0, "동", 200)
        self.assertAlmostEqual(x, 200)
        self.assertAlmostEqual(y, 0)
        x, y = offset_point(10, 20, "남서", 100)
        self.assertAlmostEqual(x, 10 - 100 / math.sqrt(2))
        self.assertAlmostEqual(y, 20 - 100 / math.sqrt(2))
        x, y = offset_point(0, 0, "북서", 100)
        self.assertLess(x, 0)
        self.assertGreater(y, 0)

    def test_unknown_direction(self):
        with self.assertRaises(ValueError):
            offset_point(0, 0, "위", 10)


class ParseRelativeTest(unittest.TestCase):
    def test_expressions(self):
        cases = {
            "여기서 북쪽 200m": ("북", 200, True),
            "현재 위치에서 동쪽으로 300미터": ("동", 300, True),
            "북동쪽 1km 지점 수색 완료": ("북동", 1000, False),
            "200m 북쪽": ("북", 200, False),
            "삼거리에서 1.5km 남서쪽에서 흔적 발견": ("남서", 1500, False),
            "여기서 서쪽 150 m 수색 완료": ("서", 150, True),
        }
        for text, (direction, distance, has_ref) in cases.items():
            found = parse_relative(text)
            self.assertIsNotNone(found, text)
            self.assertEqual((found.direction, found.distance_m, found.has_reference), (direction, distance, has_ref), text)

    def test_not_relative(self):
        for text in ("동쪽 계곡 수색 완료", "여기 수색 완료했습니다", "계곡에서 100m 올라갔습니다", "수색 완료", ""):
            self.assertIsNone(parse_relative(text), text)


class ResolveRelativeTest(unittest.TestCase):
    def test_resolves_from_reference(self):
        location, warnings = resolve_relative("여기서 북쪽 200m 수색 완료", REF, radius_m=100)
        self.assertEqual(warnings, [])
        self.assertEqual((location.kind, location.value), ("상대위치", "여기서 북쪽 200m"))
        self.assertAlmostEqual(location.x, REF[0])
        self.assertAlmostEqual(location.y, REF[1] + 200)
        self.assertEqual(location.radius_m, 100)
        self.assertTrue(location.resolved)

    def test_without_reference_word_warns_but_resolves(self):
        location, warnings = resolve_relative("북쪽 200m 지점", REF)
        self.assertIsNotNone(location)
        self.assertEqual(len(warnings), 1)
        self.assertIn("가정", warnings[0])

    def test_missing_reference_is_not_guessed(self):
        location, warnings = resolve_relative("여기서 북쪽 200m", None)
        self.assertIsNone(location)
        self.assertIn("기준 위치", warnings[0])
        location, _ = resolve_relative("여기서 북쪽 200m", (float("nan"), 1.0))
        self.assertIsNone(location)

    def test_out_of_range_distance(self):
        for text in ("여기서 북쪽 0m", "여기서 북쪽 50km"):
            location, warnings = resolve_relative(text, REF)
            self.assertIsNone(location, text)
            self.assertEqual(len(warnings), 1)

    def test_not_a_relative_expression(self):
        self.assertEqual(resolve_relative("동쪽 계곡 수색 완료", REF), (None, []))

    def test_result_outside_grid_is_rejected(self):
        location, warnings = resolve_relative("여기서 동쪽 5km", REF, grid=DEV_GRID)
        self.assertIsNone(location)
        self.assertIn("격자 밖", warnings[-1])
        location, _ = resolve_relative("여기서 동쪽 1km", REF, grid=DEV_GRID)
        self.assertIsNotNone(location)


class GazetteerTest(unittest.TestCase):
    def make(self, places, grid=None):
        return Gazetteer.from_dict({"places": places}, grid)

    def test_resolves_name_alias_and_spacing(self):
        gazetteer = self.make([{"name": "두 번째 갈림길", "aliases": ["2번 갈림길"], "x": 10, "y": 20, "radius_m": 150}])
        for text in ("두 번째 갈림길 수색 완료", "두번째갈림길 수색 완료", "2번 갈림길 진입 불가"):
            location, warnings = gazetteer.resolve(text)
            self.assertEqual(warnings, [], text)
            self.assertEqual((location.kind, location.value, location.x, location.y, location.radius_m),
                             ("지명", "두 번째 갈림길", 10, 20, 150), text)

    def test_no_match_returns_nothing(self):
        gazetteer = self.make([{"name": "두 번째 갈림길", "x": 10, "y": 20}])
        self.assertEqual(gazetteer.resolve("동쪽 계곡 수색 완료"), (None, []))

    def test_longer_name_wins_over_contained_name(self):
        gazetteer = self.make([{"name": "갈림길", "x": 1, "y": 1}, {"name": "두 번째 갈림길", "x": 2, "y": 2}])
        location, warnings = gazetteer.resolve("두 번째 갈림길 수색 완료")
        self.assertEqual((location.value, warnings), ("두 번째 갈림길", []))
        location, _ = gazetteer.resolve("갈림길 수색 완료")
        self.assertEqual(location.value, "갈림길")

    def test_two_places_are_not_guessed(self):
        gazetteer = self.make([{"name": "동쪽 주차장", "x": 1, "y": 1}, {"name": "두 번째 갈림길", "x": 2, "y": 2}])
        location, warnings = gazetteer.resolve("동쪽 주차장에서 두 번째 갈림길 쪽으로 이동")
        self.assertIsNone(location)
        self.assertIn("여러 개", warnings[0])

    def test_same_place_twice_is_one_match(self):
        gazetteer = self.make([{"name": "두 번째 갈림길", "aliases": ["2번 갈림길"], "x": 2, "y": 2}])
        location, warnings = gazetteer.resolve("2번 갈림길, 두 번째 갈림길 수색 완료")
        self.assertIsNotNone(location)
        self.assertEqual(warnings, [])

    def test_invalid_dictionaries(self):
        bad = [
            {"places": []},
            {},
            {"places": [{"name": "", "x": 1, "y": 1}]},
            {"places": [{"name": "가", "x": 1}]},                                     # y 없음
            {"places": [{"name": "가"}]},                                              # 좌표 없음
            {"places": [{"name": "가", "x": float("nan"), "y": 1}]},
            {"places": [{"name": "가", "x": 1, "y": 1, "radius_m": 0}]},
            {"places": [{"name": "가", "x": 1, "y": 1, "radius_m": True}]},
            {"places": [{"name": "가", "x": 1, "y": 1, "aliases": "나"}]},
            {"places": [{"name": "가 나", "x": 1, "y": 1}, {"name": "가나", "x": 2, "y": 2}]},  # 이름 겹침
            {"places": [{"name": "가", "aliases": ["나"], "x": 1, "y": 1}, {"name": "나", "x": 2, "y": 2}]},
        ]
        for data in bad:
            with self.assertRaises(ValueError, msg=str(data)):
                Gazetteer.from_dict(data)

    def test_place_outside_grid_is_rejected(self):
        with self.assertRaises(ValueError):
            self.make([{"name": "가", "x": 0, "y": 0}], DEV_GRID)
        self.make([{"name": "가", "x": 270000, "y": 4182000}], DEV_GRID)

    def test_lon_lat_needs_crs_and_round_trips(self):
        with self.assertRaises(ValueError):
            self.make([{"name": "가", "lon": -119.5, "lat": 37.7}])  # 격자 없음
        from rasterio.warp import transform
        x, y = 271800.0, 4180680.0  # 개발 격자 안의 한 점
        lons, lats = transform("EPSG:32611", "EPSG:4326", [x], [y])
        gazetteer = self.make([{"name": "가", "lon": lons[0], "lat": lats[0]}], DEV_GRID)
        location, _ = gazetteer.resolve("가 수색 완료")
        self.assertAlmostEqual(location.x, x, delta=0.5)
        self.assertAlmostEqual(location.y, y, delta=0.5)
        self.assertAlmostEqual(location.lon, lons[0])
        self.assertAlmostEqual(location.lat, lats[0])

    def test_sample_file_loads_and_resolves(self):
        gazetteer = Gazetteer.from_json_file(SAMPLE, DEV_GRID)
        location, warnings = gazetteer.resolve("두 번째 갈림길 수색 완료.")
        self.assertEqual(warnings, [])
        self.assertEqual((location.x, location.y, location.radius_m), (270000.0, 4182000.0, 150.0))
        location, _ = gazetteer.resolve("동쪽 주차장 진입 불가")
        self.assertIsNone(location.radius_m)


if __name__ == "__main__":
    unittest.main()
