#!/usr/bin/env python3
"""Offline Issue workflow regressions. No gh process, network, or credentials."""

import argparse
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location("github_ops", Path(__file__).with_name("github_ops.py"))
ops = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ops)
PROJECT_ROOT = ops.ROOT


class FakeGitHub:
    """Small stateful API double; responses are detached like real JSON reads."""

    def __init__(self):
        self.issues = []
        self.labels = []
        self.milestones = []
        self.comments = {}
        self.calls = []
        self.fail_next_patch = False

    @property
    def writes(self):
        return [call for call in self.calls if call[1] != "GET"]

    def issue(self, key="alpha", *, labels=None, state="open", body=None):
        number = len(self.issues) + 1
        value = {
            "number": number,
            "title": "Maintainer's current title",
            "body": body if body is not None else ops.marker(key) + "\n\nEdited acceptance criteria",
            "labels": [{"name": name} for name in (labels or ["status:ready", "area:operations"])],
            "state": state,
            "state_reason": "completed" if state == "closed" else None,
            "html_url": "https://example.invalid/issues/" + str(number),
            "repository_url": "https://api.github.com/" + ops.BASE,
            "updated_at": "2026-01-01T00:00:00Z",
            "milestone": {"number": 99, "title": "Maintainer milestone"},
        }
        self.issues.append(value)
        self.comments[number] = []
        return value

    def __call__(self, endpoint, method="GET", payload=None, pages=False):
        self.calls.append((endpoint, method, copy.deepcopy(payload), pages))
        if method == "GET":
            if endpoint == ops.BASE + "/issues?state=all&per_page=100":
                value = self.issues
            elif endpoint == ops.BASE + "/labels?per_page=100":
                value = self.labels
            elif endpoint == ops.BASE + "/milestones?state=all&per_page=100":
                value = self.milestones
            elif endpoint.endswith("/comments?per_page=100"):
                number = int(endpoint.split("/")[-2])
                value = self.comments[number]
            elif endpoint.startswith(ops.BASE + "/issues/"):
                if pages:
                    raise AssertionError("Single Issue reads must not paginate")
                number = int(endpoint.split("/")[-1])
                value = next((item for item in self.issues if item["number"] == number), None)
                if value is None:
                    raise RuntimeError("Synthetic GitHub 404: Issue does not exist")
                return copy.deepcopy(value)
            else:
                raise AssertionError("Unexpected read: " + endpoint)
            if not pages:
                raise AssertionError("All list reads must use pagination")
            return copy.deepcopy(value)
        if method == "POST" and endpoint == ops.BASE + "/labels":
            value = copy.deepcopy(payload)
            self.labels.append(value)
        elif method == "POST" and endpoint == ops.BASE + "/milestones":
            value = {**payload, "number": len(self.milestones) + 1}
            self.milestones.append(value)
        elif method == "POST" and endpoint == ops.BASE + "/issues":
            value = self.issue(body=payload["body"], labels=payload["labels"])
            value.update(title=payload["title"], milestone={"number": payload["milestone"]})
        elif method == "POST" and endpoint.endswith("/comments"):
            number = int(endpoint.split("/")[-2])
            value = {**payload, "id": len(self.comments[number]) + 1}
            self.comments[number].append(value)
        elif method == "PATCH" and endpoint.startswith(ops.BASE + "/issues/"):
            if self.fail_next_patch:
                self.fail_next_patch = False
                raise RuntimeError("Synthetic PATCH failure after comment persisted")
            number = int(endpoint.split("/")[-1])
            value = next(issue for issue in self.issues if issue["number"] == number)
            value.update(copy.deepcopy(payload))
            value["labels"] = [{"name": name} for name in payload["labels"]]
        else:
            raise AssertionError("Unexpected write: " + method + " " + endpoint)
        return copy.deepcopy(value)


class GitHubOpsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="github-ops-offline-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / "operations").mkdir()
        self.roadmap = {
            "repository": ops.REPO,
            "milestones": [{"title": "First milestone", "description": "Synthetic scope"}],
            "issues": [
                {"key": key, "title": "Seed " + key, "body": "Synthetic acceptance",
                 "status": "ready", "area": "operations", "priority": "p1",
                 "milestone": "First milestone"}
                for key in ("alpha", "beta")
            ],
        }
        self.save_roadmap()
        root = mock.patch.object(ops, "ROOT", self.root)
        root.start()
        self.addCleanup(root.stop)
        # Any unexpected escape from the fake API fails before gh can execute.
        process = mock.patch.object(ops.subprocess, "run", side_effect=AssertionError("External processes forbidden"))
        process.start()
        self.addCleanup(process.stop)
        self.github = FakeGitHub()
        api = mock.patch.object(ops, "api", side_effect=self.github)
        api.start()
        self.addCleanup(api.stop)

    def save_roadmap(self):
        (self.root / "operations/roadmap.json").write_text(json.dumps(self.roadmap), encoding="utf-8")

    def args(self, **overrides):
        values = {
            "key": "alpha", "number": None, "status": "in-progress", "owner_kind": "agent", "owner": "offline-worker",
            "files": ["tools/github_ops.py"], "next": "Run the regression suite",
            "evidence": "Synthetic test fixture; no live result claimed",
        }
        values.update(overrides)
        return argparse.Namespace(**values)

    def test_committed_roadmap_has_valid_unique_references(self):
        with mock.patch.object(ops, "ROOT", PROJECT_ROOT):
            data = ops.plan()
        titles = [item["title"] for item in data["milestones"]]
        self.assertEqual(len(titles), len(set(titles)))
        self.assertTrue(data["issues"])
        for item in data["issues"]:
            self.assertIn(item["milestone"], titles)
            self.assertIn(item["status"], ops.STATES)
            self.assertIn(item["priority"], ("p1", "p2", "p3"))
            for field in ("key", "title", "body", "area"):
                self.assertTrue(item[field].strip(), field)
        self.assertEqual(self.github.calls, [])

    def test_sync_dry_run_reports_missing_records_without_writes(self):
        result = ops.sync()
        self.assertFalse(result["applied"])
        self.assertEqual(sum("createIssue" in item for item in result["changes"]), 2)
        self.assertTrue(any("createLabel" in item for item in result["changes"]))
        self.assertTrue(any("createMilestone" in item for item in result["changes"]))
        self.assertEqual(self.github.writes, [])

    def test_repeated_sync_preserves_open_and_closed_maintainer_changes(self):
        ops.sync(apply=True)
        self.assertEqual(len(self.github.issues), 2)
        alpha, beta = self.github.issues
        alpha.update(title="Completed by maintainer", body=ops.marker("alpha") + "\nNew evidence", state="closed")
        alpha["labels"] = [{"name": name} for name in ("status:done", "keep-me")]
        beta.update(title="Actively investigated", body=ops.marker("beta") + "\nIndependent notes")
        beta["labels"] = [{"name": name} for name in ("status:blocked", "priority:p2", "custom")]
        before = copy.deepcopy((self.github.issues, self.github.labels, self.github.milestones))
        self.github.calls.clear()
        for _ in range(2):
            result = ops.sync(apply=True)
            self.assertEqual({item["preserved"] for item in result["changes"]}, {"alpha", "beta"})
        self.assertEqual((self.github.issues, self.github.labels, self.github.milestones), before)
        self.assertEqual(self.github.writes, [])

    def test_duplicate_issue_markers_abort_before_labels_milestones_or_issue_writes(self):
        self.github.issue("alpha")
        self.github.issue("alpha", state="closed")
        with self.assertRaisesRegex(ValueError, "Duplicate Issue markers"):
            ops.sync(apply=True)
        self.assertEqual(self.github.writes, [])
        with self.assertRaisesRegex(ValueError, "Duplicate Issue markers"):
            ops.checkpoint(self.args())
        self.assertEqual(self.github.writes, [])

    def test_duplicate_roadmap_keys_abort_before_api_reads(self):
        self.roadmap["issues"].append(copy.deepcopy(self.roadmap["issues"][0]))
        self.save_roadmap()
        with self.assertRaisesRegex(ValueError, "Duplicate roadmap key"):
            ops.sync(apply=True)
        self.assertEqual(self.github.calls, [])

    def test_done_roadmap_seed_is_rejected_before_api_reads(self):
        self.roadmap["issues"][0]["status"] = "done"
        self.save_roadmap()
        with self.assertRaisesRegex(ValueError, "Roadmap seeds must be open work"):
            ops.sync(apply=True)
        self.assertEqual(self.github.calls, [])

    def test_pull_request_marker_does_not_replace_an_issue(self):
        pull = self.github.issue("alpha")
        pull["pull_request"] = {"url": "https://example.invalid/pulls/1"}
        result = ops.sync(apply=True)
        self.assertEqual({item["createIssue"] for item in result["changes"] if "createIssue" in item}, {"alpha", "beta"})
        self.assertEqual(len(ops.all_issues()), 2)

    def test_checkpoint_preserves_other_labels_and_closes_then_reopens(self):
        item = self.github.issue(labels=["area:operations", "priority:p1", "keep-me", "status:ready", "status:blocked"])
        before = {key: item[key] for key in ("title", "body", "milestone")}
        result = ops.checkpoint(self.args(status="done"))
        self.assertEqual(result["number"], item["number"])
        self.assertEqual(item["state"], "closed")
        self.assertEqual(item["state_reason"], "completed")
        self.assertEqual([label["name"] for label in item["labels"]], ["area:operations", "priority:p1", "keep-me", "status:done"])
        ops.checkpoint(self.args(status="ready", evidence="Follow-up work identified"))
        self.assertEqual(item["state"], "open")
        self.assertEqual([label["name"] for label in item["labels"]], ["area:operations", "priority:p1", "keep-me", "status:ready"])
        self.assertEqual({key: item[key] for key in before}, before)
        self.assertEqual(len(self.github.comments[item["number"]]), 2)
        self.assertEqual({call[1] for call in self.github.writes}, {"POST", "PATCH"})

    def test_identical_checkpoint_does_not_add_comments_or_patch_again(self):
        item = self.github.issue()
        args = self.args()
        ops.checkpoint(args)
        checkpoint = copy.deepcopy(self.github.comments[item["number"]])
        self.github.calls.clear()
        for _ in range(3):
            ops.checkpoint(args)
        self.assertEqual(self.github.comments[item["number"]], checkpoint)
        self.assertEqual(self.github.writes, [])
        self.assertIn("at", ops.latest_checkpoint(item["number"]))

    def test_comment_success_then_patch_failure_retries_without_duplicate_comment(self):
        item = self.github.issue()
        args = self.args(status="done")
        self.github.fail_next_patch = True
        with self.assertRaisesRegex(RuntimeError, "Synthetic PATCH failure"):
            ops.checkpoint(args)
        self.assertEqual(len(self.github.comments[item["number"]]), 1)
        self.assertEqual(item["state"], "open")
        self.assertIn({"name": "status:ready"}, item["labels"])
        first_comment = copy.deepcopy(self.github.comments[item["number"]][0])
        self.github.calls.clear()
        ops.checkpoint(args)
        self.assertEqual(self.github.comments[item["number"]], [first_comment])
        self.assertEqual(item["state"], "closed")
        self.assertEqual([call[1] for call in self.github.writes], ["PATCH"])
        self.github.calls.clear()
        ops.checkpoint(args)
        self.assertEqual(self.github.writes, [])

    def test_changed_evidence_adds_one_comment_without_unnecessary_state_patch(self):
        item = self.github.issue()
        ops.checkpoint(self.args())
        self.github.calls.clear()
        ops.checkpoint(self.args(evidence="Additional measured evidence"))
        self.assertEqual(len(self.github.comments[item["number"]]), 2)
        self.assertEqual([call[1] for call in self.github.writes], ["POST"])

    def test_unrelated_or_malformed_comments_do_not_break_repeat_detection(self):
        item = self.github.issue()
        args = self.args()
        ops.checkpoint(args)
        valid = ops.latest_checkpoint(item["number"])
        for body in ("Ordinary maintainer discussion", ops.CHECKPOINT + "\n\n```json\nnot-json\n```",
                     ops.CHECKPOINT + '\n\n```json\n{"status":"invented"}\n```'):
            self.github.comments[item["number"]].append({"body": body})
        self.github.calls.clear()
        self.assertEqual(ops.latest_checkpoint(item["number"]), valid)
        ops.checkpoint(args)
        self.assertEqual(self.github.writes, [])

    def test_invalid_checkpoint_inputs_never_write(self):
        self.github.issue()
        for overrides in ({"key": "unknown"}, {"next": "  "}, {"evidence": "\n"},
                          {"files": ["/outside/file.py"]}, {"files": ["tools/../../outside.py"]}):
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                ops.checkpoint(self.args(**overrides))
            self.assertEqual(self.github.writes, [])

    def test_unseeded_issue_number_updates_without_roadmap_or_duplicate_issue(self):
        item = self.github.issue(body="A manually reported incident without a seed marker",
                                 labels=["incident", "area:operations", "status:ready"])
        original_body = item["body"]
        args = self.args(key=None, number=item["number"], status="blocked")
        with mock.patch.object(ops, "plan", side_effect=AssertionError("Manual Issues do not require roadmap seeds")):
            result = ops.checkpoint(args)
            self.assertEqual(result["number"], item["number"])
            self.assertEqual(ops.latest_checkpoint(item["number"])["key"], None)
            self.assertEqual([label["name"] for label in item["labels"]],
                             ["incident", "area:operations", "status:blocked"])
            self.github.calls.clear()
            ops.checkpoint(args)
            self.assertEqual(self.github.writes, [])
        self.assertEqual(len(self.github.issues), 1)
        self.assertEqual(item["body"], original_body)
        self.assertEqual(len(self.github.comments[item["number"]]), 1)

    def test_issue_number_retry_after_patch_failure_does_not_duplicate_comment(self):
        item = self.github.issue(body="Manual incident")
        args = self.args(key=None, number=item["number"], status="done")
        self.github.fail_next_patch = True
        with self.assertRaisesRegex(RuntimeError, "Synthetic PATCH failure"):
            ops.checkpoint(args)
        self.github.calls.clear()
        ops.checkpoint(args)
        self.assertEqual(item["state"], "closed")
        self.assertEqual(len(self.github.comments[item["number"]]), 1)
        self.assertEqual([call[1] for call in self.github.writes], ["PATCH"])
        ops.checkpoint(self.args(key=None, number=item["number"], status="ready"))
        self.assertEqual(item["state"], "open")

    def test_missing_issue_number_and_pull_requests_are_rejected_before_writes(self):
        with self.assertRaisesRegex(RuntimeError, "404"):
            ops.checkpoint(self.args(key=None, number=123))
        self.assertEqual(self.github.writes, [])
        pull = self.github.issue()
        pull["pull_request"] = {"url": "https://example.invalid/pulls/1"}
        with self.assertRaisesRegex(ValueError, "Pull Requests"):
            ops.checkpoint(self.args(key=None, number=pull["number"]))
        self.assertEqual(self.github.writes, [])
        self.assertTrue(all(call[0].startswith(ops.BASE + "/issues/") for call in self.github.calls))

    def test_number_must_resolve_to_same_issue_in_fixed_repository(self):
        for response in (None, {}, {"number": 42, "repository_url": "https://api.github.com/" + ops.BASE},
                         {"number": 1, "repository_url": "https://api.github.com/repos/another/project"}):
            with self.subTest(response=response), mock.patch.object(ops, "api", return_value=response) as api:
                with self.assertRaisesRegex(ValueError, "did not resolve"):
                    ops.checkpoint(self.args(key=None, number=1))
                api.assert_called_once_with(ops.BASE + "/issues/1")

    def test_number_requires_positive_integer_and_exclusive_target_before_api(self):
        for overrides in ({"key": None, "number": 0}, {"key": None, "number": -1},
                          {"key": None, "number": "1"}, {"key": None, "number": True},
                          {"key": None, "number": None}, {"key": "alpha", "number": 1}):
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                ops.checkpoint(self.args(**overrides))
            self.assertEqual(self.github.calls, [])

    def test_checkpoint_cli_supports_number_and_requires_exactly_one_target(self):
        item = self.github.issue(body="Manual incident")
        common = ["github_ops.py", "checkpoint", "--status", "verifying", "--owner-kind", "root",
                  "--owner", "offline-root", "--next", "Inspect evidence", "--evidence", "Offline sample"]
        for target in ([], ["--key", "alpha", "--number", "1"]):
            with self.subTest(target=target), mock.patch.object(ops.sys, "argv", common + target):
                with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as stopped:
                    ops.main()
                self.assertEqual(stopped.exception.code, 2)
                self.assertEqual(self.github.calls, [])
        output = io.StringIO()
        with mock.patch.object(ops.sys, "argv", common + ["--number", str(item["number"])]):
            with contextlib.redirect_stdout(output):
                self.assertEqual(ops.main(), 0)
        self.assertEqual(json.loads(output.getvalue())["status"], "verifying")
        self.assertEqual([label["name"] for label in item["labels"]], ["area:operations", "status:verifying"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
