"""실행 (저장소 루트에서)
  macOS/Linux : PYTHONPATH=backend python -m unittest discover -s backend/tests
  PowerShell  : $env:PYTHONPATH = "backend"; python -m unittest discover -s backend/tests
"""
import json
import unittest

from app.radio.extract import classify, extract_report, find_location
from app.radio.schema import Confidence, EventType, RadioReport, Status


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


if __name__ == "__main__":
    unittest.main()
