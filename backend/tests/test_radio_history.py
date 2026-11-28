import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from app.radio.history import (
    HistoryError, JsonlHistory, MemoryHistory, event_from_dict, event_to_dict, replay, verify_entries,
)
from app.radio.review import APPROVE, EDIT, REJECT, ReviewError
from app.radio.schema import Confidence, EventType, FieldEvent, Location, RadioReport, Status
from app.radio.update_map import GridSpec, new_state
from app.radio.workflow import decide, receive_report

GRID = GridSpec(x0=0.0, y0=3000.0, cell_m=30.0, rows=100, cols=100, crs="EPSG:32611", grid_id="t")
PRIOR = np.full(GRID.shape, 1.0 / (100 * 100))
T = "2026-11-26T05:00:00+00:00"


def searched(eid, x=1500.0, y=1500.0, r=300.0):
    return FieldEvent(eid, EventType.SEARCHED, Location(kind="좌표", value="t", x=x, y=y, radius_m=r), Confidence.NORMAL)


class EventDictTests(unittest.TestCase):
    def test_roundtrip(self):
        e = FieldEvent("e1", EventType.CLUE, Location(kind="지명", value="계곡", x=1.0, y=2.0, radius_m=50.0),
                       Confidence.ROUGH, "메모", Status.EDITED)
        self.assertEqual(event_from_dict(json.loads(json.dumps(event_to_dict(e), ensure_ascii=False))), e)


class StoreTests(unittest.TestCase):
    def test_append_builds_valid_chain(self):
        s = MemoryHistory()
        for i in range(3):
            s.append("report", {"i": i}, T)
        self.assertEqual([e["seq"] for e in s.entries()], [1, 2, 3])
        self.assertEqual(s.verify(), [])

    def test_tamper_detected(self):
        s = MemoryHistory()
        for i in range(3):
            s.append("report", {"i": i}, T)
        edited = s.entries()
        edited[1] = {**edited[1], "payload": {"i": 99}}
        self.assertTrue(verify_entries(edited))
        with self.assertRaises(HistoryError):
            MemoryHistory(edited)

    def test_removed_entry_detected(self):
        s = MemoryHistory()
        for i in range(3):
            s.append("report", {"i": i}, T)
        entries = s.entries()
        self.assertTrue(verify_entries([entries[0], entries[2]]))

    def test_payload_is_copied_and_must_be_json(self):
        s = MemoryHistory()
        payload = {"a": [1]}
        s.append("report", payload, T)
        payload["a"].append(2)
        self.assertEqual(s.entries()[0]["payload"], {"a": [1]})
        with self.assertRaises(TypeError):
            s.append("report", {"bad": object()}, T)
        with self.assertRaises(HistoryError):
            s.append("", {}, T)

    def test_jsonl_persists_and_reopens(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "sub" / "history.jsonl"
            s = JsonlHistory(path)
            s.append("report", {"x": "한글"}, T)
            s.append("report", {"x": 2}, T)
            reopened = JsonlHistory(path)
            self.assertEqual(reopened.entries(), s.entries())
            reopened.append("report", {"x": 3}, T)
            self.assertEqual(len(JsonlHistory(path).entries()), 3)
            self.assertEqual(len(path.read_text(encoding="utf-8").splitlines()), 3)

    def test_jsonl_corrupt_line_and_tamper(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "h.jsonl"
            s = JsonlHistory(path)
            s.append("report", {"x": 1}, T)
            s.append("report", {"x": 2}, T)
            lines = path.read_text(encoding="utf-8").splitlines()
            path.write_text(lines[0] + "\n" + lines[1][:-5] + "\n", encoding="utf-8")
            with self.assertRaises(HistoryError) as ctx:
                JsonlHistory(path)
            self.assertIn("2행", str(ctx.exception))
            path.write_text(lines[0].replace('"x":1', '"x":9') + "\n" + lines[1] + "\n", encoding="utf-8")
            with self.assertRaises(HistoryError):
                JsonlHistory(path)


class WorkflowTests(unittest.TestCase):
    def test_approved_event_is_applied_and_logged(self):
        store, state = MemoryHistory(), new_state(PRIOR)
        state, after = decide(state, store, GRID, searched("e1"), APPROVE, "A", at=T)
        self.assertEqual(after.status, Status.APPROVED)
        self.assertEqual(state.version, 2)
        self.assertLess(float(state.prob[GRID.circle_mask(1500.0, 1500.0, 300.0)].sum()),
                        float(PRIOR[GRID.circle_mask(1500.0, 1500.0, 300.0)].sum()))
        kinds = [e["kind"] for e in store.entries()]
        self.assertEqual(kinds, ["review", "map"])
        self.assertTrue(store.entries()[1]["payload"]["applied"])

    def test_rejected_event_leaves_map_unchanged_but_is_logged(self):
        store, state = MemoryHistory(), new_state(PRIOR)
        new, _ = decide(state, store, GRID, searched("e1"), REJECT, "A", reason="오인", at=T)
        np.testing.assert_array_equal(new.prob, state.prob)
        self.assertEqual(new.version, state.version)
        entry = store.entries()[1]["payload"]
        self.assertFalse(entry["applied"])
        self.assertIn("거절", entry["reason"])
        self.assertEqual(store.entries()[0]["payload"]["record"]["reason"], "오인")

    def test_edit_applies_edited_values(self):
        store, state = MemoryHistory(), new_state(PRIOR)
        ev = searched("e1", x=100.0, y=100.0)
        new, after = decide(state, store, GRID, ev, EDIT, "A", edits={"location": {"x": 2000.0, "y": 2000.0}}, at=T)
        self.assertEqual(after.status, Status.EDITED)
        near_new = GRID.circle_mask(2000.0, 2000.0, 300.0)
        self.assertLess(new.prob[near_new].sum(), PRIOR[near_new].sum())

    def test_second_decision_on_same_event_is_blocked_and_leaves_no_trace(self):
        store, state = MemoryHistory(), new_state(PRIOR)
        state, _ = decide(state, store, GRID, searched("e1"), APPROVE, "A", at=T)
        n = len(store.entries())
        stale = searched("e1")  # 낡은 사본 (상태가 아직 '승인 대기')
        with self.assertRaises(ReviewError):
            decide(state, store, GRID, stale, APPROVE, "B", at=T)
        self.assertEqual(len(store.entries()), n)

    def test_invalid_request_writes_nothing(self):
        store, state = MemoryHistory(), new_state(PRIOR)
        with self.assertRaises(ReviewError):
            decide(state, store, GRID, searched("e1"), EDIT, "A", edits={"event_id": "x"}, at=T)
        self.assertEqual(store.entries(), [])

    def test_wrong_grid_writes_nothing(self):
        store = MemoryHistory()
        state = new_state(np.full((5, 5), 1 / 25))
        with self.assertRaises(ValueError):
            decide(state, store, GRID, searched("e1"), APPROVE, "A", at=T)
        self.assertEqual(store.entries(), [])

    def test_receive_report_rejects_duplicate(self):
        store = MemoryHistory()
        report = RadioReport("r1", T, "팀1", "원문", [searched("e1")])
        receive_report(store, report, at=T)
        self.assertEqual(store.entries()[0]["kind"], "report")
        with self.assertRaises(HistoryError):
            receive_report(store, report, at=T)


class ReplayTests(unittest.TestCase):
    def _session(self, store):
        state = new_state(PRIOR)
        steps = [
            (searched("e1", 1500, 1500, 300), APPROVE, None),
            (searched("e2", 600, 2400, 250), EDIT, {"confidence": "꼼꼼히"}),
            (searched("e3", 900, 900, 200), REJECT, None),
            (FieldEvent("e4", EventType.CLUE, Location(kind="좌표", value="t", x=2000.0, y=1000.0), Confidence.NORMAL), APPROVE, None),
            (FieldEvent("e5", EventType.HAZARD, Location(kind="좌표", value="t", x=500.0, y=500.0, radius_m=60.0), Confidence.NORMAL), APPROVE, None),
        ]
        for ev, action, edits in steps:
            state, _ = decide(state, store, GRID, ev, action, "A", edits=edits, at=T)
        return state

    def test_replay_reproduces_live_state(self):
        store = MemoryHistory()
        live = self._session(store)
        rebuilt = replay(PRIOR, GRID, store.entries())
        np.testing.assert_allclose(rebuilt.prob, live.prob, atol=1e-15)
        self.assertEqual(rebuilt.version, live.version)
        self.assertEqual(rebuilt.applied_ids, live.applied_ids)
        self.assertEqual(rebuilt.markers, live.markers)
        self.assertEqual(rebuilt.log, live.log)

    def test_replay_from_file(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "h.jsonl"
            live = self._session(JsonlHistory(path))
            rebuilt = replay(PRIOR, GRID, JsonlHistory(path).entries())
            np.testing.assert_allclose(rebuilt.prob, live.prob, atol=1e-15)

    def test_replay_refuses_tampered_history(self):
        store = MemoryHistory()
        self._session(store)
        entries = store.entries()
        entries[0] = {**entries[0], "payload": {**entries[0]["payload"], "record": {"event_id": "e1"}}}
        with self.assertRaises(HistoryError):
            replay(PRIOR, GRID, entries)


if __name__ == "__main__":
    unittest.main()
