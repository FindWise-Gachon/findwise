"""실행 (저장소 루트에서)
  macOS/Linux : PYTHONPATH=backend python -m unittest discover -s backend/tests
  PowerShell  : $env:PYTHONPATH = "backend"; python -m unittest discover -s backend/tests
"""
import json
import unittest

from app.radio.extract import classify, extract_report, find_location, main
from app.radio.locate import Gazetteer
from app.radio.schema import Confidence, EventType, RadioReport, Status
from app.radio.update_map import GridSpec


def one(text):
    result = extract_report(text, "r-1", reporter="2조", time="2026-11-20T14:32:00+09:00")
    return result, result.report.events


class PrototypeExamplesTest(unittest.TestCase):
    """index.html 프로토타입의 예시 문장 네 개."""

    def test_searched_example(self):
        result, events = one("동쪽 계곡 수색 완료, 아무것도 없습니다.")
        self.assertEqual(len(events), 1)
        e = events[0]
        self.assertEqual((e.type, e.location.value, e.confidence), (EventType.SEARCHED, "동쪽 계곡", Confidence.NORMAL))
        self.assertEqual((e.note, e.status), ("흔적 없음", Status.PENDING))
        self.assertFalse(e.location.resolved)  # 좌표는 정하지 않는다
        self.assertEqual(result.report.status, Status.PENDING)
        self.assertEqual(result.warnings, ())

    def test_clue_example(self):
        _, events = one("서쪽 능선에서 등산 스틱 발견")
        self.assertEqual((events[0].type, events[0].location.value), (EventType.CLUE, "서쪽 능선"))
        self.assertEqual(events[0].note, "서쪽 능선에서 등산 스틱 발견")

    def test_hazard_example(self):
        _, events = one("북쪽 사면 낙석 위험")
        self.assertEqual((events[0].type, events[0].location.value), (EventType.HAZARD, "북쪽 사면"))

    def test_blocked_example(self):
        _, events = one("동쪽 계곡 절벽으로 진입 불가")
        self.assertEqual((events[0].type, events[0].location.value), (EventType.BLOCKED, "동쪽 계곡"))


class NegationTest(unittest.TestCase):
    def test_not_found_is_not_a_clue(self):
        for text in ("서쪽 능선에서 단서를 발견하지 못했습니다", "서쪽 능선 발견 못 했어요", "서쪽 능선 아무것도 발견되지 않았습니다"):
            with self.subTest(text):
                _, events = one(text)
                self.assertEqual(events[0].type, EventType.SEARCHED)
                self.assertEqual(events[0].note, "흔적 없음")

    def test_no_hazard_is_not_a_hazard(self):
        _, events = one("서쪽 능선 수색 끝, 위험은 없습니다")
        self.assertEqual(events[0].type, EventType.SEARCHED)
        self.assertIsNone(classify("위험 없음 확인"))  # 위험 부정만 있고 다른 단서가 없으면 판단 불가

    def test_negated_hazard_with_other_words(self):
        self.assertIsNone(classify("낙석 위험 없음"))  # 위험이 없다는 말만으로는 유형을 정하지 않는다
        self.assertEqual(classify("북쪽 사면 위험은 없고 수색 완료")[0], EventType.SEARCHED)
        self.assertEqual(classify("북쪽 사면 낙석 위험")[0], EventType.HAZARD)

    def test_incomplete_search_is_not_classified(self):
        result, events = one("동쪽 계곡은 못 갔고 수색 미완료")
        self.assertEqual(events, [])
        self.assertEqual(result.report.status, Status.LOG_ONLY)
        self.assertTrue(result.warnings)


class ConfidenceTest(unittest.TestCase):
    def test_levels(self):
        self.assertEqual(one("동쪽 계곡 꼼꼼히 봤는데 아무것도 없어요")[1][0].confidence, Confidence.THOROUGH)
        self.assertEqual(one("동쪽 계곡 대충 훑었어요 아무것도 없습니다")[1][0].confidence, Confidence.ROUGH)
        self.assertEqual(one("동쪽 계곡 수색 완료")[1][0].confidence, Confidence.NORMAL)


class MultiSentenceTest(unittest.TestCase):
    def test_two_events_and_ids(self):
        _, events = one("동쪽 계곡 수색 완료. 서쪽 능선에서 등산 스틱 발견.")
        self.assertEqual([e.type for e in events], [EventType.SEARCHED, EventType.CLUE])
        self.assertEqual([e.event_id for e in events], ["r-1-0", "r-1-1"])
        self.assertEqual([e.location.value for e in events], ["동쪽 계곡", "서쪽 능선"])

    def test_followup_without_location_attaches_to_previous_search(self):
        _, events = one("동쪽 계곡 수색 완료. 아무것도 없습니다.")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].note, "흔적 없음")

    def test_plain_search_has_empty_note_until_followup(self):
        _, events = one("동쪽 계곡 수색 완료")
        self.assertEqual(events[0].note, "")

    def test_comma_does_not_split(self):
        _, events = one("동쪽 계곡 수색 완료, 서쪽 능선 위험")
        self.assertEqual(len(events), 1)  # 쉼표로는 나누지 않는다(문장 부호 . ! ? ; 줄바꿈만)


class LocationTest(unittest.TestCase):
    def test_forms(self):
        self.assertEqual(find_location("북동 사면에서 확인").value, "북동 사면")
        self.assertEqual(find_location("동쪽에서 수색 완료").value, "동쪽")
        loc = find_location("여기서 수색 완료")
        self.assertEqual((loc.kind, loc.value), ("상대위치", "여기"))

    def test_particle_is_not_a_direction(self):
        # '다리에서 계곡'의 '서'를 방향으로 읽으면 안 된다
        self.assertEqual(find_location("다리에서 계곡 쪽을 확인").value, "")

    def test_missing_location_warns_but_still_creates_event(self):
        result, events = one("아무것도 없습니다")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].location.value, "")
        self.assertTrue(any("위치 표현" in w for w in result.warnings))


class ReportShapeTest(unittest.TestCase):
    def test_empty_text_rejected(self):
        for text in ("", "   ", None):
            with self.subTest(text):
                with self.assertRaises(ValueError):
                    extract_report(text, "r-1")

    def test_json_roundtrip_and_all_pending(self):
        result, events = one("동쪽 계곡 수색 완료. 서쪽 능선에서 등산 스틱 발견.")
        self.assertTrue(all(e.status == Status.PENDING for e in events))
        data = json.loads(json.dumps(result.to_dict(), ensure_ascii=False))
        self.assertEqual(RadioReport.from_dict(data["report"]).to_dict(), result.report.to_dict())
        self.assertEqual(result.report.raw_text, "동쪽 계곡 수색 완료. 서쪽 능선에서 등산 스틱 발견.")

    def test_unclassified_text_is_log_only(self):
        result, events = one("지금 점심 먹고 있습니다")
        self.assertEqual((events, result.report.status), ([], Status.LOG_ONLY))


class ExtractLocateTest(unittest.TestCase):
    """위치 확정(locate)과의 연결: 사전·기준 좌표를 주면 좌표를 채우고, 아니면 표현만 남긴다."""

    GRID = GridSpec(x0=268800.0, y0=4183680.0, cell_m=6.0, rows=1000, cols=1000, crs="EPSG:32611")
    REF = (270000.0, 4182000.0)

    def gazetteer(self, *places):
        return Gazetteer.from_dict({"places": list(places)})

    def location_of(self, text, **kwargs):
        result = extract_report(text, "r", **kwargs)
        return result.report.events[0].location, result.warnings

    def test_place_name_gets_coordinates(self):
        gazetteer = self.gazetteer({"name": "두 번째 갈림길", "x": 270000, "y": 4182000, "radius_m": 150})
        location, warnings = self.location_of("두 번째 갈림길 수색 완료", gazetteer=gazetteer)
        self.assertEqual((location.kind, location.value, location.x, location.y, location.radius_m),
                         ("지명", "두 번째 갈림길", 270000.0, 4182000.0, 150.0))
        self.assertEqual(warnings, ())

    def test_place_name_without_gazetteer_is_not_resolved(self):
        location, _ = self.location_of("두 번째 갈림길 수색 완료")
        self.assertFalse(location.resolved)
        self.assertEqual(location.value, "")

    def test_relative_with_reference_gets_coordinates(self):
        location, warnings = self.location_of("여기서 북쪽 200m 수색 완료", reference_xy=self.REF)
        self.assertEqual((location.kind, location.value), ("상대위치", "여기서 북쪽 200m"))
        self.assertAlmostEqual(location.x, 270000.0)
        self.assertAlmostEqual(location.y, 4182200.0)
        self.assertEqual(warnings, ())

    def test_relative_without_reference_keeps_expression_and_warns(self):
        location, warnings = self.location_of("여기서 북쪽 200m 수색 완료")
        self.assertEqual((location.kind, location.value, location.resolved), ("상대위치", "여기서 북쪽 200m", False))
        self.assertTrue(any("기준 위치" in w for w in warnings))

    def test_relative_without_base_but_landmark_is_not_guessed(self):
        # '동쪽 계곡에서 북쪽 200m'는 보고 대원이 아니라 계곡이 기준일 수 있으므로 계산하지 않는다
        location, warnings = self.location_of("동쪽 계곡에서 북쪽 200m 수색 완료", reference_xy=self.REF)
        self.assertEqual((location.value, location.resolved), ("동쪽 계곡", False))
        self.assertTrue(any("기준 지점이 불분명" in w for w in warnings))

    def test_relative_without_base_and_without_landmark_uses_reporter(self):
        location, warnings = self.location_of("북쪽 200m 수색 완료", reference_xy=self.REF)
        self.assertTrue(location.resolved)
        self.assertTrue(any("가정" in w for w in warnings))

    def test_relative_outside_grid_is_not_resolved(self):
        location, warnings = self.location_of("여기서 동쪽 5km 수색 완료", reference_xy=self.REF, grid=self.GRID)
        self.assertEqual((location.value, location.resolved), ("여기서 동쪽 5km", False))
        self.assertTrue(any("격자 밖" in w for w in warnings))

    def test_two_places_fall_back_to_expression_with_warning(self):
        gazetteer = self.gazetteer({"name": "동쪽 주차장", "x": 1, "y": 1}, {"name": "두 번째 갈림길", "x": 2, "y": 2})
        result = extract_report("동쪽 주차장 근처 두 번째 갈림길 수색 완료", "r", gazetteer=gazetteer)
        self.assertEqual(len(result.report.events), 1)  # 이벤트는 만들고 위치만 비운다
        self.assertFalse(result.report.events[0].location.resolved)
        self.assertTrue(any("여러 개" in w for w in result.warnings))

    def test_without_options_matches_previous_behavior(self):
        location, warnings = self.location_of("동쪽 계곡 수색 완료")
        self.assertEqual((location.kind, location.value, location.resolved), ("지명", "동쪽 계곡", False))
        self.assertEqual(warnings, ())

    def test_command_line_options(self):
        import io
        from contextlib import redirect_stdout
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            main(["여기서 북쪽 200m 수색 완료", "--reference", "270000", "4182000"])
        event = json.loads(buffer.getvalue())["report"]["events"][0]
        self.assertAlmostEqual(event["location"]["y"], 4182200.0)
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            main(["수색 완료", "--gazetteer", "/없는/파일.json"])
        self.assertIn("error", json.loads(buffer.getvalue()))


class DecimalSentenceTest(unittest.TestCase):
    """STT가 "1.5 km"처럼 소수점이 있는 거리를 돌려줘도 문장이 쪼개지지 않아야 한다 (Soniox 실측에서 발견)."""

    def test_decimal_distance_is_not_split(self):
        result, events = one("여기서 북동쪽 1.5 km 지점 수색 완료.")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].type, EventType.SEARCHED)
        self.assertEqual(events[0].location.value, "여기서 북동쪽 1.5 km")
        # 문장이 쪼개져 생기는 경고는 없고, 기준 좌표가 없다는 경고만 남는다
        self.assertEqual(len(result.warnings), 1)
        self.assertIn("기준 위치", result.warnings[0])

    def test_period_between_sentences_still_splits(self):
        _, events = one("북쪽 능선 수색 완료.남쪽 계곡 진입 불가. 동쪽 숲에서 발자국 발견.")
        self.assertEqual([e.type for e in events], [EventType.SEARCHED, EventType.BLOCKED, EventType.CLUE])

    def test_number_then_period_then_sentence(self):
        _, events = one("여기서 북쪽 200m 수색 완료. 2번 갈림길 진입 불가.")
        self.assertEqual([e.type for e in events], [EventType.SEARCHED, EventType.BLOCKED])


class RuleImprovementTest(unittest.TestCase):
    """실제 Soniox 변환 결과(s19, s20)와 점검에서 드러난 약점에 대한 회귀 테스트.
    위험한 오분류(진입 불가를 수색 완료로, 미완료를 수색 완료로, '못 찾았다'를 흔적 발견으로)를 막는다."""

    def kinds(self, text):
        return [e.type for e in one(text)[1]]

    def test_cannot_pass_is_blocked_not_searched(self):
        for text in ("북쪽 사면은 눈이 많아서 올라갈 수가 없습니다.",   # 실제 STT 결과(s20)
                     "서쪽 개울 물이 많아 들어갈 수 없어요.",
                     "동쪽 임도는 진입이 안 돼요.",
                     "남쪽 계곡 길이 막혀 있습니다.",
                     "북쪽 능선 길이 끊겨서 통과가 안 됩니다."):
            with self.subTest(text=text):
                self.assertEqual(self.kinds(text), [EventType.BLOCKED])

    def test_passable_or_unblocked_stays_log_only(self):
        for text in ("남쪽 임도 진입 가능합니다.", "동쪽 능선 길은 막히지 않았습니다."):
            with self.subTest(text=text):
                self.assertEqual(self.kinds(text), [])

    def test_existing_not_found_still_searched(self):
        self.assertEqual(self.kinds("북쪽 능선 수색 완료, 아무것도 없습니다."), [EventType.SEARCHED])
        self.assertEqual(self.kinds("동쪽 숲 흔적을 찾을 수 없습니다."), [EventType.SEARCHED])

    def test_could_not_find_is_not_a_clue(self):
        for text in ("서쪽 계곡에서 단서를 못 찾았습니다.", "북쪽 숲에서 별다른 것은 발견하지 못했습니다."):
            with self.subTest(text=text):
                self.assertEqual(self.kinds(text), [EventType.SEARCHED])

    def test_unfinished_search_is_not_searched(self):
        self.assertEqual(self.kinds("서쪽 능선 수색은 아직 안 끝났습니다."), [])
        self.assertEqual(self.kinds("남쪽 사면 수색이 끝나지 않았습니다."), [])
        self.assertEqual(self.kinds("수색 중입니다."), [])

    def test_hazard_during_search_is_not_dropped(self):
        self.assertEqual(self.kinds("수색 중 남쪽 계곡에서 낙석 위험이 있습니다."), [EventType.HAZARD])
        self.assertEqual(self.kinds("북쪽 능선 낙석 위험, 길도 없습니다."), [EventType.HAZARD])  # 위험을 부정으로 읽지 않는다

    def test_negated_hazard_with_place_word(self):
        events = one("위험한 곳은 없었고 북쪽 사면 수색 끝냈습니다.")[1]
        self.assertEqual([e.type for e in events], [EventType.SEARCHED])

    def test_resolved_hazard_is_log_only(self):
        self.assertEqual(self.kinds("남쪽 계곡 낙석 위험이 해소됐습니다."), [])
        self.assertEqual(self.kinds("동쪽 임도 통제가 풀렸습니다."), [])

    def test_search_wording_variants(self):
        for text in ("동쪽 능선 수색 종료합니다. 이상 무.",            # 실제 STT 결과(s19)
                     "서쪽 사면 수색 마무리했습니다.", "남쪽 계곡 라인 클리어.", "북쪽 숲 한 바퀴 둘러봤습니다."):
            with self.subTest(text=text):
                self.assertEqual(self.kinds(text)[:1], [EventType.SEARCHED])
        self.assertEqual(one("북쪽 능선 꼼꼼하게 다 봤습니다.")[1][0].confidence, Confidence.THOROUGH)

    def test_clue_without_the_word_found(self):
        for text in ("동쪽 계곡에 장갑이 떨어져 있습니다.", "남쪽 능선에 발자국이 보입니다."):
            with self.subTest(text=text):
                self.assertEqual(self.kinds(text), [EventType.CLUE])

    def test_numbered_zone_location(self):
        self.assertEqual(find_location("3구역 수색 완료").value, "3구역")
        self.assertEqual(find_location("제 2 구간 진입 불가").value, "제 2 구간")


class PlaceAnchoredRelativeTest(unittest.TestCase):
    """"두 번째 갈림길에서 북쪽 200m"처럼 사전 지명을 기준으로 한 상대 위치."""

    GRID = GridSpec(x0=269000.0, y0=4183000.0, cell_m=30.0, rows=100, cols=100, crs="EPSG:32611")  # 3 km 격자
    GAZ = Gazetteer.from_dict({"places": [
        {"name": "두 번째 갈림길", "aliases": ["2번 갈림길"], "x": 270000, "y": 4182000, "radius_m": 150},
        {"name": "동쪽 주차장", "x": 271800, "y": 4181000}]})

    def loc(self, text, grid=None):
        result = extract_report(text, "r", gazetteer=self.GAZ, grid=grid)
        return result.report.events[0].location, result.warnings

    def test_computed_from_place_coordinates(self):
        location, warnings = self.loc("두 번째 갈림길에서 북쪽 200m 수색 완료", self.GRID)
        self.assertEqual((location.kind, location.x, location.y), ("상대위치", 270000.0, 4182200.0))
        self.assertEqual(location.value, "두 번째 갈림길에서 북쪽 200m")
        self.assertEqual(warnings, ())

    def test_alias_and_other_connectives(self):
        for text, expect_x in (("2번 갈림길 기준 동쪽 300미터 수색 완료", 270300.0),
                               ("두 번째 갈림길부터 동쪽 300 m 진입 불가", 270300.0),
                               ("두 번째 갈림길 에서 동쪽 300m 수색 완료", 270300.0)):
            with self.subTest(text=text):
                location, _ = self.loc(text)
                self.assertAlmostEqual(location.x, expect_x)
                self.assertAlmostEqual(location.y, 4182000.0)

    def test_without_connective_it_is_not_computed(self):
        location, warnings = self.loc("두 번째 갈림길 근처 북쪽 200m 수색 완료")
        self.assertEqual((location.kind, location.value), ("지명", "두 번째 갈림길"))
        self.assertEqual((location.x, location.y), (270000.0, 4182000.0))  # 지명 자체의 위치만 쓴다
        self.assertTrue(any("기준 지점이 불분명" in w for w in warnings))

    def test_two_places_means_no_guess(self):
        location, warnings = self.loc("두 번째 갈림길에서 동쪽 주차장 쪽 북쪽 200m 수색 완료")
        self.assertFalse(location.resolved)
        self.assertTrue(any("여러 개" in w for w in warnings))

    def test_without_gazetteer_is_still_not_computed(self):
        result = extract_report("동쪽 계곡에서 북쪽 200m 수색 완료", "r")
        location = result.report.events[0].location
        self.assertFalse(location.resolved)
        self.assertTrue(any("기준 지점이 불분명" in w for w in result.warnings))

    def test_result_outside_grid_is_dropped_with_warning(self):
        location, warnings = self.loc("두 번째 갈림길에서 북쪽 2km 수색 완료", self.GRID)  # y=4184000, 격자 위쪽 밖
        self.assertFalse(location.resolved)
        self.assertEqual(location.value, "두 번째 갈림길에서 북쪽 2km")
        self.assertTrue(any("격자 밖" in w for w in warnings))

    def test_distance_out_of_range_is_dropped_with_warning(self):
        location, warnings = self.loc("두 번째 갈림길에서 북쪽 8km 수색 완료")
        self.assertFalse(location.resolved)
        self.assertTrue(any("범위를 벗어났습니다" in w for w in warnings))

    def test_reporter_reference_still_wins(self):
        result = extract_report("두 번째 갈림길 쪽에서 여기서 북쪽 200m 수색 완료", "r", gazetteer=self.GAZ,
                                reference_xy=(271000.0, 4181000.0))
        location = result.report.events[0].location
        self.assertEqual((location.x, location.y), (271000.0, 4181200.0))


if __name__ == "__main__":
    unittest.main()
