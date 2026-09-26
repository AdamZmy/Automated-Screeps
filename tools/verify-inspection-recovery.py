#!/usr/bin/env python3
"""Offline regression for journal recovery; writes only TemporaryDirectory fixtures.

Run: python3 -B tools/verify-inspection-recovery.py
This is a regression test, not a command for recovering a real archive.
"""
import argparse
import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


PARSER = argparse.ArgumentParser(description=__doc__)
PARSER.add_argument("--writer", type=Path, default=Path(__file__).with_name("inspection_log.py"))
ARGS, UNITTEST_ARGS = PARSER.parse_known_args()
SPEC = importlib.util.spec_from_file_location("inspection_log_recovery_regression", ARGS.writer)
LOG = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LOG)


class JournalRecoveryRegression(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="inspection-recovery-regression-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.root = self.base / "archive"

    def snapshot(self, root=None):
        root = root or self.root
        self.assertTrue(root.is_relative_to(self.base))
        return {str(p.relative_to(root)): p.read_bytes() for p in root.rglob("*") if p.is_file()}

    def init(self, at="2026-01-01T00:00:00.000Z"):
        with patch.object(LOG, "now_utc", return_value=at):
            return LOG.initialize(self.root, "scheduled", "recovery regression")

    def read(self, path):
        return LOG.read_json(path, LOG.MAX_DAY_INDEX_BYTES)

    def emit(self, path, data):
        self.assertTrue(path.is_relative_to(self.base))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(LOG.encode_json(data))

    def canonical(self):
        return {p.stem: self.read(p) for p in self.root.glob("*/*.json") if p.name != "index.json"}

    def rebuild_derived_fixture(self):
        """Validate every source before touching any derived file in the fixture."""
        records = self.canonical()
        for identifier, data in records.items():
            self.assertEqual(identifier, data["id"])
            LOG.validate_record(data)
        summaries = LOG.ordered([LOG.summarize(data) for data in records.values()])
        days = sorted({row["id"][:10] for row in summaries}, reverse=True)
        stamp = max((row["updatedAt"] for row in summaries), key=lambda x: LOG.timestamp(x, "updatedAt"))
        payloads = {}
        for identifier, data in records.items():
            payloads[self.root / identifier[:10] / (identifier + ".md")] = LOG.render_markdown(data)
        for day in days:
            payloads[self.root / day / "index.json"] = LOG.encode_json({
                "schemaVersion": 1, "updatedAt": stamp, "day": day,
                "runs": [row for row in summaries if row["id"].startswith(day + "T")],
            })
        payloads[self.root / "index.json"] = LOG.encode_json({
            "schemaVersion": 1, "updatedAt": stamp, "days": days, "runs": summaries[:50],
        })
        LOG.atomic_batch(self.root, payloads)

    def assert_failures_preserve(self, expected):
        before = self.snapshot()
        with self.assertRaisesRegex(LOG.InspectionError, expected):
            LOG.validate_archive(self.root)
        self.assertEqual(self.snapshot(), before)
        with patch.object(LOG, "now_utc", return_value="2026-01-01T00:10:00.000Z"):
            with self.assertRaisesRegex(LOG.InspectionError, expected):
                LOG.initialize(self.root, "scheduled", "must not persist")
        self.assertEqual(self.snapshot(), before)

    def verify_normal_write(self, path):
        data = self.read(path)
        status = data["status"]
        identity = {key: data[key] for key in LOG.IDENTITY}
        data["summary"] += " ordinary write succeeds"
        staged = self.base / "incoming.json"
        self.emit(staged, data)
        with patch.object(LOG, "now_utc", return_value="2026-01-01T00:09:00.000Z"):
            LOG.write_record(self.root, staged)
        written = self.read(path)
        self.assertEqual({key: written[key] for key in LOG.IDENTITY}, identity)
        self.assertEqual(written["status"], status)
        self.assertTrue(LOG.validate_archive(self.root)["ok"])

    def test_stale_summary_is_detected_and_only_derived_files_need_repair(self):
        path = self.init()
        data = self.read(path)
        data["updatedAt"] = "2026-01-01T00:01:00.000Z"
        self.emit(path, data)
        path.with_suffix(".md").write_bytes(LOG.render_markdown(data))
        self.assert_failures_preserve("day summary disagrees with record")
        before = self.snapshot()
        self.rebuild_derived_fixture()
        after = self.snapshot()
        self.assertEqual({k for k in before if before[k] != after[k]}, {"index.json", "2026-01-01/index.json"})
        self.assertEqual(LOG.validate_archive(self.root), {"ok": True, "runs": 1, "days": 1})
        self.assertEqual(self.read(path)["status"], "running")
        self.verify_normal_write(path)

    def test_missing_index_entry_is_recovered_without_dropping_records(self):
        first = self.init()
        second = self.init("2026-01-01T00:01:00.000Z")
        for index in [self.root / "index.json", second.parent / "index.json"]:
            data = self.read(index)
            data["runs"] = [row for row in data["runs"] if row["id"] != second.stem]
            self.emit(index, data)
        self.assert_failures_preserve("record missing from day index")
        originals = {str(p): p.read_bytes() for p in [first, second, first.with_suffix(".md"), second.with_suffix(".md")]}
        self.rebuild_derived_fixture()
        self.assertEqual(LOG.validate_archive(self.root), {"ok": True, "runs": 2, "days": 1})
        for filename, content in originals.items():
            self.assertEqual(Path(filename).read_bytes(), content)
        self.verify_normal_write(second)

    def test_two_invalid_time_windows_need_validated_staging_before_rebuild(self):
        failed_path = self.init()
        running_path = self.init("2026-01-01T00:01:00.000Z")
        original_summaries = {row["id"]: row for row in self.read(self.root / "index.json")["runs"]}
        failed = self.read(failed_path)
        failed.update(status="failed", completedAt="2026-01-01T00:02:00.000Z", summary="verified failed outcome")
        running = self.read(running_path)
        running["actions"] = [{"at": "2026-01-01T00:02:00.000Z", "description": "observed action", "status": "done", "result": "preserve evidence"}]
        self.emit(failed_path, failed)
        self.emit(running_path, running)
        self.assert_failures_preserve("completedAt: must fall between")
        before = self.snapshot()
        with self.assertRaises(LOG.InspectionError):
            self.rebuild_derived_fixture()
        self.assertEqual(self.snapshot(), before)
        with patch.object(LOG, "now_utc", return_value="2026-01-01T00:05:00.000Z"):
            with self.assertRaisesRegex(LOG.InspectionError, "actions\\[0\\].at: outside"):
                LOG.write_record(self.root, failed_path)
        self.assertEqual(self.snapshot(), before)

        # Existing write() can normalize each record in its own isolated context.
        # The old valid summary supplies immutable identity and transition checks.
        for number, source in enumerate([failed_path, running_path]):
            isolated = self.base / ("single-" + str(number))
            identifier = source.stem
            day = identifier[:10]
            target = isolated / day / source.name
            semantic_before = self.read(source)
            summary = original_summaries[identifier]
            self.emit(target, semantic_before)
            target.with_suffix(".md").write_bytes(source.with_suffix(".md").read_bytes())
            self.emit(isolated / day / "index.json", {"schemaVersion": 1, "updatedAt": summary["updatedAt"], "day": day, "runs": [summary]})
            self.emit(isolated / "index.json", {"schemaVersion": 1, "updatedAt": summary["updatedAt"], "days": [day], "runs": [summary]})
            with patch.object(LOG, "now_utc", return_value="2026-01-01T00:05:00.000Z"):
                LOG.write_record(isolated, target)
            normalized = self.read(target)
            self.assertEqual(normalized["updatedAt"], "2026-01-01T00:05:00.000Z")
            self.assertEqual({k: v for k, v in normalized.items() if k != "updatedAt"}, {k: v for k, v in semantic_before.items() if k != "updatedAt"})
            self.assertTrue(LOG.validate_archive(isolated)["ok"])
            source.write_bytes(target.read_bytes())
        self.rebuild_derived_fixture()
        self.assertEqual(LOG.validate_archive(self.root), {"ok": True, "runs": 2, "days": 1})
        self.assertEqual(self.read(failed_path)["completedAt"], failed["completedAt"])
        self.assertEqual(self.read(failed_path)["status"], "failed")
        self.assertEqual(self.read(running_path)["status"], "running")
        self.assertEqual(self.read(running_path)["actions"], running["actions"])
        self.verify_normal_write(running_path)


if __name__ == "__main__":
    unittest.main(argv=[__file__, *UNITTEST_ARGS], verbosity=2)
