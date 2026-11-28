import unittest

from app.radio.review import (
    APPROVE, EDIT, REJECT, ReviewError, pending_events, report_status, review_event,
)
from app.radio.schema import Confidence, EventType, FieldEvent, Location, RadioReport, Status

AT = "2026-11-26T05:00:00+00:00"


def event(eid="e1", status=Status.PENDING, **kw):
    loc = kw.pop("location", Location(kind="좌표", value="동쪽 계곡", x=100.0, y=200.0, radius_m=150.0))
    return FieldEvent(eid, kw.pop("type", EventType.SEARCHED), loc, kw.pop("confidence", Confidence.NORMAL),
                      kw.pop("note", ""), status)


class ApproveRejectTests(unittest.TestCase):
    def test_approve(self):
        e = event()
        after, rec = review_event(e, APPROVE, "지휘관A", at=AT)
        self.assertEqual(after.status, Status.APPROVED)
        self.assertEqual(e.status, Status.PENDING)          # 원본은 그대로
        self.assertEqual((rec["status_before"], rec["status_after"]), ("승인 대기", "승인"))
        self.assertEqual((rec["reviewer"], rec["at"], rec["action"]), ("지휘관A", AT, APPROVE))

    def test_reject_keeps_reason(self):
        after, rec = review_event(event(), REJECT, "지휘관A", reason="위치 오인", at=AT)
        self.assertEqual(after.status, Status.REJECTED)
        self.assertEqual(rec["reason"], "위치 오인")

    def test_reviewer_required(self):
        for bad in ("", "  ", None):
            with self.assertRaises(ReviewError):
                review_event(event(), APPROVE, bad)

    def test_unknown_action(self):
        with self.assertRaises(ReviewError):
            review_event(event(), "보류", "A")

    def test_cannot_review_twice(self):
        for done in (Status.APPROVED, Status.EDITED, Status.REJECTED):
            for action in (APPROVE, REJECT):
                with self.assertRaises(ReviewError):
                    review_event(event(status=done), action, "A")
            with self.assertRaises(ReviewError):
                review_event(event(status=done), EDIT, "A", edits={"note": "x"})

    def test_approve_not_allowed_on_log_only(self):
        with self.assertRaises(ReviewError):
            review_event(event(status=Status.LOG_ONLY), APPROVE, "A")

    def test_edits_only_with_edit_action(self):
        with self.assertRaises(ReviewError):
            review_event(event(), APPROVE, "A", edits={"note": "x"})


class EditTests(unittest.TestCase):
    def test_edit_location_and_confidence(self):
        e = event()
        after, rec = review_event(e, EDIT, "A", at=AT,
                                  edits={"confidence": "꼼꼼히", "location": {"x": 500.0, "radius_m": 80}})
        self.assertEqual(after.status, Status.EDITED)
        self.assertEqual(after.confidence, Confidence.THOROUGH)
        self.assertEqual((after.location.x, after.location.y, after.location.radius_m), (500.0, 200.0, 80))
        self.assertEqual(after.location.value, "동쪽 계곡")  # 안 건드린 항목은 유지
        self.assertEqual(e.location.x, 100.0)                # 원본 불변
        self.assertEqual(rec["status_after"], "수정 후 승인")

    def test_edit_can_fill_location_of_log_only_event(self):
        e = event(status=Status.LOG_ONLY, location=Location(kind="지명", value="어딘가"))
        after, _ = review_event(e, EDIT, "A", edits={"location": {"x": 1.0, "y": 2.0, "radius_m": 100.0}})
        self.assertTrue(after.location.resolved)
        self.assertEqual(after.status, Status.EDITED)

    def test_edit_type_and_note(self):
        after, _ = review_event(event(), EDIT, "A", edits={"type": "흔적 발견", "note": "신발 한 짝"})
        self.assertEqual((after.type, after.note), (EventType.CLUE, "신발 한 짝"))

    def test_requires_edits(self):
        for bad in (None, {}):
            with self.assertRaises(ReviewError):
                review_event(event(), EDIT, "A", edits=bad)

    def test_no_change_is_error(self):
        with self.assertRaises(ReviewError):
            review_event(event(), EDIT, "A", edits={"note": ""})
        with self.assertRaises(ReviewError):
            review_event(event(), EDIT, "A", edits={"location": {"x": 100.0}})

    def test_rejects_forbidden_and_invalid_values(self):
        bad_edits = [
            {"event_id": "other"}, {"status": "승인"}, {"type": "없는 유형"}, {"confidence": "몰라"},
            {"note": 5}, {"location": "동쪽"}, {"location": {"foo": 1}},
            {"location": {"x": float("nan")}}, {"location": {"x": float("inf")}}, {"location": {"x": True}},
            {"location": {"radius_m": 0}}, {"location": {"radius_m": -5}},
            {"location": {"x": None}},      # y만 남는 경우
            {"location": {"lat": 37.0}},    # lon 없이 lat만
        ]
        for edits in bad_edits:
            with self.subTest(edits=edits), self.assertRaises(ReviewError):
                review_event(event(), EDIT, "A", edits=edits)


class ListingTests(unittest.TestCase):
    def test_pending_events_and_report_status(self):
        r1 = RadioReport("r1", AT, "팀1", "", [event("a"), event("b", Status.APPROVED)])
        r2 = RadioReport("r2", AT, "팀2", "", [event("c", Status.REJECTED)])
        self.assertEqual([(rid, e.event_id) for rid, e in pending_events([r1, r2])], [("r1", "a")])
        self.assertEqual(report_status(r1), Status.PENDING)
        self.assertEqual(report_status(r2), Status.REJECTED)

    def test_report_status_combinations(self):
        def rep(*statuses):
            return RadioReport("r", AT, "", "", [event(f"e{i}", s) for i, s in enumerate(statuses)])
        self.assertEqual(report_status(rep()), Status.LOG_ONLY)
        self.assertEqual(report_status(rep(Status.APPROVED, Status.REJECTED)), Status.APPROVED)
        self.assertEqual(report_status(rep(Status.APPROVED, Status.EDITED)), Status.EDITED)
        self.assertEqual(report_status(rep(Status.LOG_ONLY, Status.REJECTED)), Status.LOG_ONLY)


if __name__ == "__main__":
    unittest.main()
