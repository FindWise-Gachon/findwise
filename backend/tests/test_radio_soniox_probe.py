import json
import tempfile
import unittest
from pathlib import Path

from app.radio.soniox_probe import (
    api_context, build_context, compare_with_baseline, format_diffs,
    ProbeError, SonioxClient, analyze_text, char_error_rate, collect_audio, edit_distance, load_script,
    normalize, number_style, run_probe, sha256_file, summarize, transcript_text, verify_against_previous,
)


class TextCheckTests(unittest.TestCase):
    def test_number_style(self):
        self.assertEqual(number_style("여기서 북쪽 200m 수색 완료"), "arabic")
        self.assertEqual(number_style("북쪽 300 미터"), "arabic")
        self.assertEqual(number_style("여기서 북쪽 이백 미터 수색 완료"), "korean")
        self.assertEqual(number_style("200m 그리고 삼백 미터"), "both")
        self.assertEqual(number_style("동쪽 계곡 수색 완료"), "none")
        self.assertEqual(number_style("두 번째 갈림길"), "none")  # 서수는 거리 표현이 아니다

    def test_edit_distance_and_cer(self):
        self.assertEqual(edit_distance("abc", "abd"), 1)
        self.assertEqual(edit_distance("", "abc"), 3)
        self.assertEqual(char_error_rate("동쪽 계곡 수색 완료.", "동쪽계곡 수색완료"), 0.0)
        self.assertAlmostEqual(char_error_rate("수색완료", "수색완로"), 0.25)
        self.assertNotEqual(char_error_rate("", "x"), char_error_rate("", "x"))  # nan

    def test_normalize_drops_space_and_punctuation(self):
        self.assertEqual(normalize("동쪽 계곡, 수색 완료!"), "동쪽계곡수색완료")

    def test_analyze_arabic_relative_is_parsed(self):
        r = analyze_text("여기서 북쪽 200m 수색 완료", "여기서 북쪽 200m 수색 완료.")
        self.assertEqual(r["number_style"], "arabic")
        self.assertEqual(r["relative_parsed"], {"direction": "북", "distance_m": 200.0})
        self.assertTrue(r["exact_ignoring_space_punct"])
        self.assertEqual(r["events"][0]["type"], "수색 완료")

    def test_analyze_korean_numeral_is_not_parsed(self):
        r = analyze_text("여기서 북쪽 이백 미터 수색 완료")
        self.assertEqual(r["number_style"], "korean")
        self.assertIsNone(r["relative_parsed"])
        s = summarize([r])
        self.assertEqual(s["korean_numerals_unparsed"], ["여기서 북쪽 이백 미터 수색 완료"])

    def test_spacing_only_difference(self):
        r = analyze_text("동쪽계곡 수색완료", "동쪽 계곡 수색 완료.")
        self.assertTrue(r["exact_ignoring_space_punct"])
        self.assertTrue(r["spacing_differs_only"])

    def test_empty_text_does_not_crash(self):
        r = analyze_text("")
        self.assertEqual(r["events"], [])


class ScriptAndFilesTests(unittest.TestCase):
    def test_load_script(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "s.tsv"
            p.write_text("# 주석\n\ns01\t동쪽 계곡 수색 완료.\ns02\t낙석 위험.\n", encoding="utf-8")
            self.assertEqual(load_script(p), {"s01": "동쪽 계곡 수색 완료.", "s02": "낙석 위험."})
            p.write_text("s01 공백만\n", encoding="utf-8")
            with self.assertRaises(ProbeError):
                load_script(p)

    def test_sample_script_in_repo_is_valid(self):
        path = Path(__file__).resolve().parents[2] / "data" / "samples" / "radio-record-script.tsv"
        script = load_script(path)
        self.assertEqual(len(script), 20)
        self.assertEqual(list(script)[0], "s01")

    def test_collect_audio_filters_and_sorts(self):
        with tempfile.TemporaryDirectory() as d:
            for name in ("s02.m4a", "s01.wav", "notes.txt"):
                (Path(d) / name).write_bytes(b"x")
            self.assertEqual([f.name for f in collect_audio([d])], ["s01.wav", "s02.m4a"])
            with self.assertRaises(ProbeError):
                collect_audio([str(Path(d) / "missing")])
            with tempfile.TemporaryDirectory() as empty, self.assertRaises(ProbeError):
                collect_audio([empty])

    def test_hash_verification(self):
        self.assertEqual(verify_against_previous({"a": "1", "b": "2", "c": "3"}, {"a": "1", "b": "9"}), ["b"])

    def test_transcript_text(self):
        self.assertEqual(transcript_text({"text": " 안녕 "}), "안녕")
        self.assertEqual(transcript_text({"tokens": [{"text": "동쪽"}, {"text": " 계곡"}]}), "동쪽 계곡")


class FakeApi:
    """Soniox REST를 흉내 내는 가짜 전송 계층."""

    def __init__(self, texts, statuses=("processing", "completed")):
        self.texts, self.statuses, self.calls, self.deleted = list(texts), list(statuses), [], []
        self._polls = 0
        self.headers_seen = []

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url))
        self.headers_seen.append(headers)
        path = url.split("/v1", 1)[1]
        if (method, path) == ("POST", "/files"):
            return 201, json.dumps({"id": f"file-{len(self.calls)}"}).encode()
        if (method, path) == ("POST", "/transcriptions"):
            payload = json.loads(body)
            assert payload["language_hints"] == ["ko"] and payload["file_id"].startswith("file-")
            return 200, json.dumps({"id": "tr-1", "status": "queued"}).encode()
        if method == "GET" and path == "/transcriptions/tr-1":
            status = self.statuses[min(self._polls, len(self.statuses) - 1)]
            self._polls += 1
            return 200, json.dumps({"id": "tr-1", "status": status}).encode()
        if method == "GET" and path == "/transcriptions/tr-1/transcript":
            text = self.texts.pop(0)
            return 200, json.dumps({"text": text, "tokens": [{"text": text}]}).encode()
        if method == "DELETE":
            self.deleted.append(path)
            return 204, b""
        return 404, b"{}"


class RunProbeTests(unittest.TestCase):
    def _files(self, d, n=2):
        paths = []
        for i in range(n):
            p = Path(d) / f"s{i + 1:02d}.m4a"
            p.write_bytes(f"audio{i}".encode())
            paths.append(p)
        return paths

    def test_end_to_end_with_fake_api(self):
        with tempfile.TemporaryDirectory() as d:
            files = self._files(d)
            api = FakeApi(["여기서 북쪽 이백 미터 수색 완료.", "동쪽 계곡 수색 완료."])
            client = SonioxClient("secret-key", transport=api)
            result = run_probe(files, client, model="m", script={"s01": "여기서 북쪽 200m 수색 완료.", "s02": "동쪽 계곡 수색 완료."},
                               previous_hashes={}, sleep=lambda s: None)
            self.assertEqual(result["summary"]["n"], 2)
            self.assertEqual(result["items"][0]["number_style"], "korean")
            self.assertEqual(result["items"][1]["exact_ignoring_space_punct"], True)
            self.assertEqual(result["audio_sha256"]["s01.m4a"], sha256_file(files[0]))
            self.assertTrue(any(p.startswith("/transcriptions/") for p in api.deleted))
            self.assertTrue(any(p.startswith("/files/") for p in api.deleted))
            self.assertTrue(all(h["Authorization"] == "Bearer secret-key" for h in api.headers_seen))
            self.assertNotIn("secret-key", json.dumps(result))  # 키는 결과에 남지 않는다

    def test_keep_flag_skips_deletion(self):
        with tempfile.TemporaryDirectory() as d:
            api = FakeApi(["동쪽 계곡 수색 완료."])
            run_probe(self._files(d, 1), SonioxClient("k", transport=api), model="m", script={},
                      previous_hashes={}, keep=True, sleep=lambda s: None)
            self.assertEqual(api.deleted, [])

    def test_changed_audio_is_refused_before_any_request(self):
        with tempfile.TemporaryDirectory() as d:
            files = self._files(d, 1)
            api = FakeApi(["x"])
            with self.assertRaises(ProbeError):
                run_probe(files, SonioxClient("k", transport=api), model="m", script={},
                          previous_hashes={"s01.m4a": "0" * 64}, sleep=lambda s: None)
            self.assertEqual(api.calls, [])

    def test_failed_transcription_still_cleans_up(self):
        with tempfile.TemporaryDirectory() as d:
            api = FakeApi([], statuses=("error",))
            with self.assertRaises(ProbeError):
                run_probe(self._files(d, 1), SonioxClient("k", transport=api), model="m", script={},
                          previous_hashes={}, sleep=lambda s: None)
            self.assertTrue(api.deleted)

    def test_timeout(self):
        api = FakeApi([], statuses=("processing",))
        client = SonioxClient("k", transport=api)
        with self.assertRaises(ProbeError):
            client.wait("tr-1", timeout_s=3, interval_s=1, sleep=lambda s: None)

    def test_missing_key_and_http_error(self):
        with self.assertRaises(ProbeError):
            SonioxClient("")
        client = SonioxClient("k", transport=lambda *a: (401, b'{"error_type":"unauthenticated"}'))
        with self.assertRaises(ProbeError) as ctx:
            client.get("x")
        self.assertIn("401", str(ctx.exception))
        self.assertNotIn("Bearer", str(ctx.exception))


class ContextTests(unittest.TestCase):
    GAZ = {"places": [{"name": "두 번째 갈림길", "aliases": ["2번 갈림길"], "x": 1, "y": 2},
                      {"name": "하프돔 아래 계곡", "x": 3, "y": 4}]}

    def _write(self, d, data):
        p = Path(d) / "g.json"
        p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return p

    def test_build_context_has_names_aliases_and_hash(self):
        with tempfile.TemporaryDirectory() as d:
            p = self._write(d, self.GAZ)
            ctx = build_context(p)
            self.assertIn("하프돔 아래 계곡", ctx["terms"])
            self.assertIn("2번 갈림길", ctx["terms"])
            self.assertIn("수색 완료", ctx["terms"])
            self.assertEqual(len(ctx["terms"]), len(set(ctx["terms"])))
            self.assertEqual(ctx["_gazetteer_sha256"], sha256_file(p))
            sent = api_context(ctx)
            self.assertNotIn("_gazetteer_sha256", sent)
            self.assertEqual(sent["general"][0]["key"], "domain")
            self.assertIsNone(api_context(None))

    def test_bad_gazetteer_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                build_context(self._write(d, {"places": []}))

    def test_context_is_sent_in_request_and_recorded(self):
        with tempfile.TemporaryDirectory() as d:
            audio = Path(d) / "s01.m4a"
            audio.write_bytes(b"a")
            sent = {}

            class Api(FakeApi):
                def __call__(self, method, url, headers, body):
                    if method == "POST" and url.endswith("/transcriptions"):
                        sent.update(json.loads(body))
                    return super().__call__(method, url, headers, body)

            ctx = build_context(self._write(d, self.GAZ))
            result = run_probe([audio], SonioxClient("k", transport=Api(["x"])), model="m", script={},
                               previous_hashes={}, context=ctx, sleep=lambda s: None)
            self.assertIn("terms", sent["context"])
            self.assertNotIn("_gazetteer_sha256", sent["context"])
            self.assertTrue(result["items"][0]["context_used"])
            self.assertEqual(result["gazetteer_sha256"], ctx["_gazetteer_sha256"])

    def test_no_context_means_no_context_field(self):
        with tempfile.TemporaryDirectory() as d:
            audio = Path(d) / "s01.m4a"
            audio.write_bytes(b"a")
            sent = {}

            class Api(FakeApi):
                def __call__(self, method, url, headers, body):
                    if method == "POST" and url.endswith("/transcriptions"):
                        sent.update(json.loads(body))
                    return super().__call__(method, url, headers, body)

            run_probe([audio], SonioxClient("k", transport=Api(["x"])), model="m", script={},
                      previous_hashes={}, sleep=lambda s: None)
            self.assertNotIn("context", sent)


class BaselineTests(unittest.TestCase):
    def test_only_changed_same_audio_files_are_reported(self):
        base = {"items": [
            {"file": "s01.m4a", "audio_sha256": "h1", "text": "하프던 말의 계곡", "cer": 0.17},
            {"file": "s02.m4a", "audio_sha256": "h2", "text": "같은 문장", "cer": 0.0},
            {"file": "s03.m4a", "audio_sha256": "old", "text": "다른 녹음", "cer": 0.0}]}
        new = {"items": [
            {"file": "s01.m4a", "audio_sha256": "h1", "text": "하프돔 아래 계곡", "cer": 0.0},
            {"file": "s02.m4a", "audio_sha256": "h2", "text": "같은 문장", "cer": 0.0},
            {"file": "s03.m4a", "audio_sha256": "new", "text": "바뀐 녹음", "cer": 0.0},
            {"file": "s04.m4a", "audio_sha256": "h4", "text": "새 파일", "cer": 0.0}]}
        diffs = compare_with_baseline(new, base)
        self.assertEqual([d["file"] for d in diffs], ["s01.m4a"])
        self.assertIn("하프돔 아래 계곡", format_diffs(diffs))
        self.assertIn("17% → 0%", format_diffs(diffs))
        self.assertIn("없습니다", format_diffs([]))


if __name__ == "__main__":
    unittest.main()
