"""무전 시험지 평가 계산 테스트.

실행 (저장소 루트):
  PYTHONPATH=backend python -m unittest discover -s backend/tests
"""
import json
import tempfile
import unittest
from pathlib import Path

from app.radio.evaluate import format_report, load_test_set, rule_based_predictor, score

SAMPLE = Path(__file__).resolve().parents[2] / "data" / "samples" / "radio-test-set.json"


def case(cid, expected, tags=(), text="문장"):
    return {"id": cid, "text": text, "tags": list(tags), "expected": expected}


def event(kind, location="", confidence="보통"):
    return {"type": kind, "location": location, "confidence": confidence}


class ScoreTest(unittest.TestCase):
    def test_perfect_prediction(self):
        cases = [case("a", [event("수색 완료", "동쪽 계곡", "꼼꼼히")])]
        result = score(cases, lambda text: [event("수색 완료", "동쪽 계곡", "꼼꼼히")])
        self.assertEqual(result["full_exact_cases"], 1)
        self.assertEqual(result["types"]["수색 완료"]["f1"], 1.0)
        self.assertEqual(result["failures"], [])

    def test_empty_prediction_is_a_failure_unless_log_only_expected(self):
        cases = [case("a", [event("수색 완료", "동쪽 계곡")]), case("b", [])]
        result = score(cases, lambda text: [])
        self.assertEqual(result["type_exact_cases"], 1)  # b만 맞음
        self.assertEqual(result["log_only"], {"n": 1, "correct": 1})
        self.assertEqual([f["id"] for f in result["failures"]], ["a"])

    def test_type_counts_ignore_order_and_count_fp_fn(self):
        cases = [case("a", [event("수색 완료", "동쪽 계곡"), event("진입 불가", "서쪽 능선")])]
        result = score(cases, lambda text: [event("진입 불가", "서쪽 능선"), event("위험 요소", "남쪽 사면")])
        types = result["types"]
        self.assertEqual((types["진입 불가"]["tp"], types["진입 불가"]["fp"], types["진입 불가"]["fn"]), (1, 0, 0))
        self.assertEqual((types["수색 완료"]["tp"], types["수색 완료"]["fn"]), (0, 1))
        self.assertEqual((types["위험 요소"]["fp"], types["위험 요소"]["tp"]), (1, 0))
        self.assertEqual(result["type_exact_cases"], 0)
        self.assertEqual(len(result["failures"]), 1)

    def test_location_ignores_spaces_and_confidence_only_for_searched(self):
        cases = [case("a", [event("수색 완료", "동쪽 계곡", "꼼꼼히"), event("위험 요소", "북쪽 절벽", "보통")])]
        predicted = [event("수색 완료", "동쪽계곡", "대충"), event("위험 요소", "북쪽 절벽", "꼼꼼히")]
        result = score(cases, lambda text: predicted)
        self.assertEqual(result["location"], {"n": 2, "correct": 2})
        self.assertEqual(result["confidence"], {"n": 1, "correct": 0})  # 위험 요소의 강도는 세지 않는다
        self.assertEqual(result["full_exact_cases"], 0)
        self.assertEqual(result["type_exact_cases"], 1)

    def test_log_only_and_tags(self):
        cases = [case("a", [], ["log_only"]), case("b", [], ["log_only"])]
        result = score(cases, lambda text: [])
        self.assertEqual(result["log_only"], {"n": 2, "correct": 2})
        self.assertEqual(result["by_tag"]["log_only"], {"n": 2, "type_exact": 2})
        result = score(cases, lambda text: [event("흔적 발견")])
        self.assertEqual(result["log_only"], {"n": 2, "correct": 0})
        self.assertEqual(result["by_tag"]["log_only"], {"n": 2, "type_exact": 0})

    def test_report_text_contains_failures(self):
        cases = [case("x1", [event("수색 완료", "동쪽 계곡")], text="동쪽 계곡 수색 완료")]
        text = format_report(score(cases, lambda t: []), sha256="abc", path="set.json")
        for expected in ("x1", "동쪽 계곡 수색 완료", "(이벤트 없음)", "SHA-256 abc"):
            self.assertIn(expected, text)


class LoadTest(unittest.TestCase):
    def write(self, data):
        handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
        self.addCleanup(lambda: Path(handle.name).unlink(missing_ok=True))
        json.dump(data, handle, ensure_ascii=False)
        handle.close()
        return handle.name

    def test_invalid_sets_are_rejected(self):
        good = {"id": "a", "text": "문장", "expected": []}
        bad_sets = [
            {},                                                       # cases 없음
            {"cases": []},                                            # 비어 있음
            {"cases": [good, good]},                                  # id 중복
            {"cases": [{"id": "a", "text": " ", "expected": []}]},    # 빈 문장
            {"cases": [{"id": "a", "text": "문장"}]},                 # expected 없음
            {"cases": [{"id": "a", "text": "문장", "expected": [{"type": "없는 유형"}]}]},
            {"cases": [{"id": "a", "text": "문장", "expected": [{"type": "수색 완료", "confidence": "매우"}]}]},
        ]
        for data in bad_sets:
            with self.assertRaises(ValueError, msg=str(data)):
                load_test_set(self.write(data))

    def test_hash_changes_with_content(self):
        first = load_test_set(self.write({"cases": [{"id": "a", "text": "문장", "expected": []}]}))[1]
        second = load_test_set(self.write({"cases": [{"id": "a", "text": "문장 2", "expected": []}]}))[1]
        self.assertEqual(len(first), 64)
        self.assertNotEqual(first, second)


class SampleSetTest(unittest.TestCase):
    def test_sample_set_loads_and_scores_in_range(self):
        cases, digest = load_test_set(SAMPLE)
        self.assertGreaterEqual(len(cases), 20)
        self.assertEqual(len(digest), 64)
        result = score(cases, rule_based_predictor)
        self.assertEqual(result["n_cases"], len(cases))
        for value in (result["micro_f1"], result["macro_f1"]):
            self.assertTrue(0.0 <= value <= 1.0)


if __name__ == "__main__":
    unittest.main()
