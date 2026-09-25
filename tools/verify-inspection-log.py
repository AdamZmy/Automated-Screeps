#!/usr/bin/env python3
"""Behavior tests for the local inspection writer; no network or real archive writes."""

import copy
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
SCRIPT = Path(__file__).with_name("inspection_log.py")
SPEC = importlib.util.spec_from_file_location("inspection_log", SCRIPT)
log = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(log)
START = "2026-01-01T00:00:00.000Z"
LATER = "2026-01-01T00:05:00.000Z"


class InspectionLogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.root = self.base / "archive"
        self.staged = self.base / "staged.json"

    def init(self, title="实际巡检", kind="manual", at=START):
        with patch.object(log, "now_utc", return_value=at):
            return log.initialize(self.root, kind, title)

    def read(self, path):
        return json.loads(path.read_text())

    def stage(self, record):
        self.staged.write_bytes(log.encode_json(record))
        return self.staged

    def write(self, record, at=LATER, direct=None):
        source = self.stage(record) if direct is None else direct
        if direct is not None:
            source.write_bytes(log.encode_json(record))
        with patch.object(log, "now_utc", return_value=at):
            return log.write_record(self.root, source)

    def snapshot(self):
        return {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob("*") if p.is_file()}

    def test_initialization_unique_identity_and_unknown_game(self):
        first = self.init()
        second = self.init()
        self.assertNotEqual(first, second)
        record = self.read(first)
        self.assertEqual(record["startedAt"], START)
        self.assertEqual(record["status"], "running")
        self.assertIsNone(record["completedAt"])
        self.assertIsNone(record["game"])
        self.assertLessEqual(len(record["id"]), 96)
        self.assertTrue(first.with_suffix(".md").exists())
        self.assertEqual(log.validate_archive(self.root), {"ok": True, "runs": 2, "days": 1})
        self.assertIsNone(self.read(self.root / "index.json")["runs"][0]["tick"])

    def test_progress_preserves_identity_and_updates_both_indexes(self):
        path = self.init()
        record = self.read(path)
        identity = {key: record[key] for key in log.IDENTITY}
        record["summary"] = "发现取货等待，Issue 12 正在验收"
        record["game"] = {"shard": "shard1", "rooms": ["W21N26"], "version": "a" * 40, "tick": 12345, "fetchedAt": START}
        record["findings"] = [{"severity": "warning", "title": "等待", "detail": "Memory.rooms.W21N26 boundedMetric=3；版本 " + "a" * 40, "evidence": ["tick=12345 waitTicks=3"], "issue": 12}]
        record["tasks"] = [{"issue": 12, "title": "实测", "status": "verifying", "progress": "已有样本", "next": "观察下一轮", "owner": "协调者"}, {"issue": 2, "title": "基线", "status": "done", "progress": "完成", "next": "", "owner": ""}]
        record["actions"] = [{"at": START, "description": "读取有限遥测", "status": "done", "result": "tick=12345"}]
        record["checks"] = [{"name": "版本", "result": "passed", "detail": "commit " + "f" * 40}]
        record["next"] = ["继续看等待 tick"]
        record["references"] = [{"label": "Issue", "url": log.REPOSITORY + "/issues/12"}, {"label": "监控", "url": "https://" + log.MONITOR_HOST + "/#layout"}]
        self.assertEqual(self.write(record), path)
        actual = self.read(path)
        self.assertEqual({key: actual[key] for key in log.IDENTITY}, identity)
        self.assertEqual(actual["updatedAt"], LATER)
        for index_path in (path.parent / "index.json", self.root / "index.json"):
            summary = self.read(index_path)["runs"][0]
            self.assertEqual(summary["issueNumbers"], [2, 12])
            self.assertEqual(summary["tick"], 12345)
            self.assertEqual(set(summary), log.SUMMARY_KEYS)
        self.assertIn(b"12345", path.with_suffix(".md").read_bytes())
        self.assertEqual(log.validate_archive(self.root)["runs"], 1)

    def test_direct_edit_is_supported_and_identity_is_protected(self):
        path = self.init(kind="scheduled")
        original = self.read(path)
        record = copy.deepcopy(original)
        record["summary"] = "同轮追加进度"
        self.write(record, direct=path)
        self.assertEqual(log.validate_archive(self.root)["runs"], 1)
        for key, value in (("kind", "manual"), ("startedAt", "2026-01-01T00:00:00.001Z"), ("id", original["id"] + "-other")):
            with self.subTest(key=key):
                record = self.read(path)
                good = path.read_bytes()
                record[key] = value
                path.write_bytes(log.encode_json(record))
                with patch.object(log, "now_utc", return_value=LATER), self.assertRaises(log.InspectionError):
                    log.write_record(self.root, path)
                path.write_bytes(good)
        log.validate_archive(self.root)

    def test_terminal_no_change_blocked_skipped_and_failed_records(self):
        for status in ("completed", "blocked", "skipped", "failed"):
            with self.subTest(status=status):
                path = self.init(title=status)
                record = self.read(path)
                record.update(status=status, completedAt=LATER, summary="本轮无变化" if status == "completed" else "本轮未完成：API 没有返回可用数据")
                record["checks"] = [{"name": "采集", "result": "passed" if status == "completed" else "failed", "detail": "保留真实失败与等待条件"}]
                self.write(record)
                self.assertEqual(self.read(path)["status"], status)
                reopened = self.read(path)
                reopened.update(status="running", completedAt=None)
                with self.assertRaises(log.InspectionError):
                    self.write(reopened)
        self.assertEqual(log.validate_archive(self.root)["runs"], 4)

    def test_history_complete_beyond_latest_fifty_and_across_days(self):
        paths = []
        first = datetime(2026, 1, 1, tzinfo=timezone.utc)
        for i in range(53):
            at = (first + timedelta(minutes=i)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            paths.append(self.init(title=f"run-{i}", at=at))
        paths.append(self.init(title="next day", at="2026-01-02T00:00:00.000Z"))
        paths.append(self.init(title="third day", at="2026-01-03T00:00:00.000Z"))
        index = self.read(self.root / "index.json")
        self.assertEqual(len(index["runs"]), 50)
        self.assertEqual(index["days"], ["2026-01-03", "2026-01-02", "2026-01-01"])
        self.assertEqual(len(self.read(paths[0].parent / "index.json")["runs"]), 53)
        self.assertNotIn(paths[0].stem, [row["id"] for row in index["runs"]])
        record = self.read(paths[0])
        record["summary"] = "旧轮次修正，保留原日期和 ID"
        self.write(record, at="2026-01-03T00:05:00.000Z")
        self.assertEqual(len(list(self.root.glob("*/*.md"))), 55)
        self.assertEqual(log.validate_archive(self.root), {"ok": True, "runs": 55, "days": 3})
        self.assertEqual(self.read(self.root / "index.json")["runs"], index["runs"])

    def test_invalid_field_types_enums_limits_and_dates_are_rejected_without_writes(self):
        path = self.init()
        original = self.read(path)
        bad_values = [
            ("schemaVersion", True), ("schemaVersion", 2), ("id", "../escape"), ("id", "2026-01-01T00-00-00Z-" + "a" * 80),
            ("kind", "unknown"), ("status", "success"), ("title", " "), ("title", "x" * 241), ("summary", "x" * 4001),
            ("summary", {"x": 1}), ("startedAt", "2026-02-30T00:00:00Z"), ("updatedAt", "2025-12-31T00:00:00Z"),
            ("updatedAt", "2026-01-01T01:00:00+01:00"), ("updatedAt", "2027-01-01T00:00:00Z"), ("completedAt", LATER),
            ("findings", {}), ("tasks", [None]), ("checks", [None]), ("actions", [] * 0 + [None] * 101),
            ("next", ["a"] * 101), ("next", [""]), ("references", [{"label": "x", "url": "https://example.com"}]),
            ("game", {"shard": "shard1"}), ("summary", "bidi\u202eevil"),
        ]
        before = self.snapshot()
        for key, value in bad_values:
            with self.subTest(field=key, value=str(value)[:30]):
                bad = copy.deepcopy(original)
                bad[key] = value
                with self.assertRaises(log.InspectionError):
                    self.write(bad)
                self.assertEqual(self.snapshot(), before)
        for changed in ({**original, "unexpected": 1}, {k: v for k, v in original.items() if k != "next"}):
            with self.assertRaises(log.InspectionError):
                self.write(changed)

    def test_game_numbers_are_strict_and_unknown_is_null(self):
        record = self.read(self.init())
        record["game"] = {"shard": None, "rooms": None, "version": None, "tick": None, "fetchedAt": None}
        self.write(record)
        for value in (True, -1, 1.5, "123", 9007199254740992):
            record["game"]["tick"] = value
            with self.assertRaises(log.InspectionError):
                self.write(record)
        record["game"]["tick"] = 0
        record["updatedAt"] = LATER
        self.write(record)
        self.assertEqual(self.read(self.root / "index.json")["runs"][0]["tick"], 0)

    def test_nested_fields_limits_status_and_time_validation(self):
        record = self.read(self.init())
        variants = [
            ("findings", [{"severity": "fatal", "title": "x", "detail": "", "evidence": [], "issue": None}]),
            ("findings", [{"severity": "info", "title": "x", "detail": "", "evidence": ["a"] * 51, "issue": None}]),
            ("findings", [{"severity": "info", "title": "x", "detail": "", "evidence": [], "issue": True}]),
            ("tasks", [{"issue": 0, "title": "x", "status": "ready", "progress": "", "next": "", "owner": ""}]),
            ("actions", [{"at": "2025-12-31T23:59:59Z", "description": "x", "status": "done", "result": ""}]),
            ("actions", [{"at": "2026-01-01T00:06:00Z", "description": "x", "status": "done", "result": ""}]),
            ("checks", [{"name": "x", "result": "success", "detail": ""}]),
            ("checks", [{"name": "x", "result": "passed", "detail": "x" * 4001}]),
        ]
        for field, value in variants:
            with self.subTest(field=field, value=str(value)[:50]):
                changed = copy.deepcopy(record)
                changed[field] = value
                with self.assertRaises(log.InspectionError):
                    self.write(changed)
        for completed in (None, "2025-12-31T00:00:00Z", "2026-01-01T01:00:00Z"):
            changed = copy.deepcopy(record)
            changed.update(status="completed", completedAt=completed)
            with self.assertRaises(log.InspectionError):
                self.write(changed)

    def test_sensitive_content_redacted_but_normal_evidence_and_commits_allowed(self):
        record = self.read(self.init())
        for secret in (
            "ghp_" + "a" * 36, "github_pat_" + "a" * 40, "sk-proj-" + "a" * 30,
            "Bearer " + "a" * 40, "SCREEPS_TOKEN=" + "a" * 32, '"api_key": "' + "abc123" * 8 + '"',
            "-----BEGIN RSA PRIVATE KEY-----", "/Users/person/private.txt", "/home/person/token", "C:\\Users\\person\\secret",
            "~/secrets.json", 'Memory = {"creeps": {}}', '"Memory": {"rooms":{}}', '{"creeps": {}, "rooms": {}}',
        ):
            with self.subTest(secret=secret[:20]):
                record["summary"] = secret
                with self.assertRaises(log.InspectionError):
                    self.write(record)
        record["summary"] = "commit " + "a" * 40 + "; token 已脱敏；Memory.rooms.W21N26.waitTicks = 3; tick=987; API_KEY=not-configured"
        self.write(record)
        log.validate_archive(self.root)

    def test_reference_origin_and_path_validation(self):
        record = self.read(self.init())
        for url in (
            "http://github.com/AdamZmy/Automated-Screeps/issues/1", "https://github.com/AdamZmy/Automated-Screeps-evil",
            "https://github.com.evil.test/AdamZmy/Automated-Screeps", "https://github.com@evil.test/AdamZmy/Automated-Screeps",
            "https://user:pass@github.com/AdamZmy/Automated-Screeps", "https://github.com:443/AdamZmy/Automated-Screeps",
            log.REPOSITORY + "/../other", log.REPOSITORY + "/%252e%252e/other", "javascript:alert(1)",
            log.REPOSITORY + "/%zz", log.REPOSITORY + "/%ff", "https://github.com/AdamZmy%2FAutomated-Screeps/issues/1",
            "https://" + log.MONITOR_HOST + "/%0aevil", "https://" + log.MONITOR_HOST + '.evil.test',
        ):
            with self.subTest(url=url):
                record["references"] = [{"label": "关联", "url": url}]
                with self.assertRaises(log.InspectionError):
                    self.write(record)
        record["references"] = [{"label": "有效引用", "url": log.REPOSITORY + "/commit/" + "a" * 40 + "#diff-x"}]
        self.write(record)

    def test_markdown_renders_untrusted_text_without_active_html_or_links(self):
        path = self.init()
        record = self.read(path)
        attack = '<script>alert("x")</script>\n![track](https://evil.example/img)\n[click](javascript:alert(1))\n```html\n# injected\n- list'
        record["title"] = "[fake](javascript:alert(1)) <img src=x onerror=alert(1)>"
        record["summary"] = attack
        record["next"] = [attack]
        record["references"] = [{"label": "](<script>)", "url": log.REPOSITORY + "/issues/1?text=(x)"}]
        self.write(record)
        rendered = path.with_suffix(".md").read_text()
        for active in ("<script>", "<img", "![track]", "[click](javascript:", "```html", "\n# injected", "\n- list"):
            self.assertNotIn(active, rendered)
        self.assertIn("&lt;script&gt;", rendered)
        self.assertIn("%28x%29", rendered)
        log.validate_archive(self.root)

    def test_uninitialized_id_cannot_be_imported(self):
        record = self.read(self.init())
        record["id"] += "-new"
        with self.assertRaisesRegex(log.InspectionError, "initialized"):
            self.write(record)

    def test_duplicate_keys_nonfinite_numbers_and_oversized_files_are_rejected(self):
        self.init()
        for payload in (b'{"id":"x","id":"y"}', b'{"tick": NaN}', b'{"tick": Infinity}', b'{"summary":"' + b'a' * log.MAX_RECORD_BYTES + b'"}', b'\xff', b'{broken'):
            self.staged.write_bytes(payload)
            with self.assertRaises(log.InspectionError):
                log.write_record(self.root, self.staged)
        record = self.read(next(self.root.glob("*/*Z-*.json")))
        record["checks"] = [{"name": "x", "result": "passed", "detail": "x" * 4000} for _ in range(100)]
        with self.assertRaises(log.InspectionError):
            self.write(record)

    def test_corrupt_archives_fail_without_replacing_or_clearing_files(self):
        path = self.init()
        baseline = self.snapshot()
        for target, payload in (
            (self.root / "index.json", b"{broken"), (path.parent / "index.json", b"{}"),
            (path, b"null"), (path.with_suffix(".md"), b"corrupted"),
        ):
            with self.subTest(target=target.name):
                target.write_bytes(payload)
                corrupted = self.snapshot()
                with self.assertRaises(log.InspectionError):
                    log.validate_archive(self.root)
                with self.assertRaises(log.InspectionError):
                    self.init(title="must not create")
                self.assertEqual(self.snapshot(), corrupted)
                for name, content in baseline.items():
                    (self.root / name).write_bytes(content)
        index = self.read(self.root / "index.json")
        index["runs"] = []
        (self.root / "index.json").write_bytes(log.encode_json(index))
        with self.assertRaises(log.InspectionError):
            log.validate_archive(self.root)

    def test_missing_or_orphan_markdown_and_records_fail(self):
        path = self.init()
        md = path.with_suffix(".md")
        content = md.read_bytes()
        md.unlink()
        with self.assertRaises(log.InspectionError):
            log.validate_archive(self.root)
        md.write_bytes(content)
        orphan = md.with_name(md.stem + "-orphan.md")
        orphan.write_text("orphan")
        with self.assertRaises(log.InspectionError):
            log.validate_archive(self.root)

    def test_symlinks_and_traversal_cannot_change_outside_files(self):
        path = self.init()
        outside = self.base / "outside.json"
        outside.write_text("sensitive outside data")
        index = self.root / "index.json"
        original = index.read_bytes()
        index.unlink()
        index.symlink_to(outside)
        with self.assertRaises(log.InspectionError):
            self.init()
        self.assertEqual(outside.read_text(), "sensitive outside data")
        index.unlink()
        index.write_bytes(original)
        link = self.base / "linked.json"
        link.symlink_to(path)
        with self.assertRaises(log.InspectionError):
            log.write_record(self.root, link)
        root_link = self.base / "root-link"
        root_link.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(log.InspectionError):
            log.root_path(root_link)
        with self.assertRaises(log.InspectionError):
            log.root_path(self.root / ".." / "other")
        with self.assertRaises(log.InspectionError):
            log.safe_path(self.root, "../outside.json")
        with self.assertRaises(log.InspectionError):
            log.write_record(self.root, self.root / ".." / path.name)

    def test_atomic_write_failure_rolls_back_previous_files(self):
        path = self.init()
        record = self.read(path)
        record["summary"] = "will roll back"
        before = self.snapshot()
        replace = log.os.replace
        calls = 0

        def fail_once(source, target):
            nonlocal calls
            calls += 1
            if calls == 3:
                raise OSError(5, "injected I/O failure")
            return replace(source, target)

        with patch.object(log.os, "replace", side_effect=fail_once), self.assertRaises(log.InspectionError):
            self.write(record)
        self.assertEqual(self.snapshot(), before)
        log.validate_archive(self.root)

    def test_index_limits_fail_without_truncating_existing_history(self):
        self.init()
        before = self.snapshot()
        root_bytes = len((self.root / "index.json").read_bytes())
        day_bytes = len((self.root / "2026-01-01" / "index.json").read_bytes())
        for limit, value in (("MAX_ROOT_INDEX_BYTES", root_bytes + 10), ("MAX_DAY_INDEX_BYTES", day_bytes + 10), ("MAX_DAY_RUNS", 1)):
            with self.subTest(limit=limit), patch.object(log, limit, value), self.assertRaises(log.InspectionError):
                self.init(title="would exceed index bound")
            self.assertEqual(self.snapshot(), before)
        with patch.object(log, "MAX_DAYS", 1), self.assertRaises(log.InspectionError):
            self.init(at="2026-01-02T00:00:00.000Z")
        self.assertEqual(self.snapshot(), before)
        log.validate_archive(self.root)

    def test_stale_progress_cannot_overwrite_a_newer_revision(self):
        path = self.init()
        original = self.read(path)
        self.write({**original, "summary": "first writer"})
        before = self.snapshot()
        with self.assertRaisesRegex(log.InspectionError, "stale"):
            self.write({**original, "summary": "outdated writer"}, at="2026-01-01T00:06:00.000Z")
        self.assertEqual(self.snapshot(), before)

    def test_cli_and_parallel_initializations_keep_complete_indexes(self):
        def args(*values):
            return [sys.executable, "-B", str(SCRIPT), "--root", str(self.root), *values]

        first = subprocess.run(args("init", "--kind", "setup", "--title", "CLI setup"), capture_output=True, text=True, check=True)
        path = Path(first.stdout.strip())
        self.assertTrue(path.exists())
        processes = [subprocess.Popen(args("init", "--kind", "scheduled", "--title", f"worker-{i}"), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for i in range(8)]
        for process in processes:
            stdout, stderr = process.communicate(timeout=20)
            self.assertEqual(process.returncode, 0, stderr)
            self.assertTrue(Path(stdout.strip()).exists())
        result = subprocess.run(args("validate"), capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(result.stdout)["runs"], 9)
        record = self.read(path)
        record["summary"] = "CLI progress"
        self.stage(record)
        result = subprocess.run(args("write", "--file", str(self.staged)), capture_output=True, text=True, check=True)
        self.assertEqual(result.stdout.strip(), str(path))
        bad = subprocess.run(args("init", "--kind", "manual", "--title", "/Users/private/secret"), capture_output=True, text=True)
        self.assertEqual(bad.returncode, 2)
        self.assertNotIn("/Users/private/secret", bad.stderr)
        self.assertNotIn("Traceback", bad.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
