#!/usr/bin/env python3
"""Offline API regression tests. Only temporary fake token files are read."""

import base64
import contextlib
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import urllib.error
import urllib.parse

import screeps_api as api


class APITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.token = "FAKE-PRIVATE-TOKEN-for-offline-tests-12345"
        self.token_file = self.directory / "token"
        self.token_file.write_text(self.token + "\n", encoding="utf-8")
        self.token_file.chmod(0o600)
        project = mock.patch.object(api, "PROJECT_DIR", self.directory)
        project.start()
        self.addCleanup(project.stop)
        opener = mock.patch.object(api.urllib.request, "build_opener")
        self.build_opener = opener.start()
        self.addCleanup(opener.stop)
        self.opener = self.build_opener.return_value
        # Guard against accidental alternative network access in any test.
        direct = mock.patch.object(api.urllib.request, "urlopen", side_effect=AssertionError("Network forbidden"))
        direct.start()
        self.addCleanup(direct.stop)

    def response(self, payload):
        self.opener.open.return_value = io.BytesIO(json.dumps(payload).encode("utf-8"))

    def run_cli(self, *args):
        output, errors = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            result = api.main(["--token-file", str(self.token_file)] + list(args))
        self.assertNotIn(self.token, output.getvalue() + errors.getvalue())
        return result, output.getvalue(), errors.getvalue()

    def last_request(self):
        return self.opener.open.call_args.args[0]

    def responses(self, *payloads):
        self.opener.open.side_effect = [item if isinstance(item, Exception) else io.BytesIO(json.dumps(item).encode("utf-8"))
                                       for item in payloads]

    def deployment_data(self):
        local = {name: "// PRIVATE LOCAL SOURCE " + name + "\r\n" for name in api.MODULES}
        for name, source in local.items():
            (self.directory / (name + ".js")).write_bytes(source.encode("utf-8"))
        remote = {name: "// PRIVATE REMOTE SOURCE " + name + "\n" for name in api.MODULES}
        remote.update({"custom": "module.exports = 7;", "binary": {"binary": "AQID"}})
        merged = dict(remote, **local)
        return local, remote, merged

    def code_response(self, modules):
        return {"ok": 1, "branch": "frontier24", "modules": modules, "token": "SERVER-RESPONSE-SECRET"}

    def post_requests(self):
        return [call.args[0] for call in self.opener.open.call_args_list if call.args[0].get_method() == "POST"]

    def test_identity_filters_response_and_auth_is_header_only(self):
        self.response({"ok": 1, "username": "AdamZmy", "_id": "user-1", "cpu": 20,
                       "token": "OTHER-SERVER-TOKEN", "password": "password-secret", "email": "hidden@example.com"})
        result, output, errors = self.run_cli("identity")
        self.assertEqual(result, 0)
        self.assertEqual(json.loads(output), {"username": "AdamZmy", "id": "user-1", "cpu": 20})
        self.assertEqual(errors, "")
        req = self.last_request()
        self.assertEqual(req.full_url, "https://screeps.com/api/auth/me")
        self.assertEqual(req.get_header("X-token"), self.token)
        self.assertNotIn(self.token, req.full_url)
        self.assertIsNone(req.data)
        self.assertEqual(self.opener.open.call_args.kwargs["timeout"], 15)
        self.assertIsInstance(self.build_opener.call_args.args[0], api.NoRedirect)

    def test_gzip_memory_query_and_secret_redaction(self):
        memory = {"cpu": 4.2, "token": "OTHER-TOKEN", "api_key": "OTHER-API-KEY",
                  "nested": [{"message": "prefix " + self.token + " suffix", "password": "PASSWORD"}],
                  "text": "authorization=Bearer BEARERSECRET token='OTHER-EMBEDDED-TOKEN'"}
        data = "gz:" + base64.b64encode(gzip.compress(json.dumps(memory).encode())).decode()
        self.response({"ok": 1, "data": data})
        result, output, _ = self.run_cli("memory", "--path", "frontier.status", "--shard", "shard2")
        self.assertEqual(result, 0)
        for secret in ("OTHER-TOKEN", "OTHER-API-KEY", "PASSWORD", "BEARERSECRET", "OTHER-EMBEDDED-TOKEN"):
            self.assertNotIn(secret, output)
        self.assertEqual(json.loads(output)["cpu"], 4.2)
        self.assertEqual(urllib.parse.parse_qs(urllib.parse.urlsplit(self.last_request().full_url).query),
                         {"path": ["frontier.status"], "shard": ["shard2"]})

    def test_plain_json_memory_and_missing_path(self):
        self.assertEqual(api.decode_memory('{"progress": 12}'), {"progress": 12})
        self.assertEqual(api.decode_memory({"progress": 12}), {"progress": 12})
        self.assertIsNone(api.decode_memory(None))
        for invalid in ("gz:!!!", "gz:" + base64.b64encode(b"bad gzip").decode(), "Incorrect memory path"):
            with self.assertRaisesRegex(api.APIError, "Cannot decode memory"):
                api.decode_memory(invalid)

    def test_status_summary_saves_only_redacted_selected_data(self):
        frontier = {
            "status": {"tick": 123, "cpu": 5, "token": "STATUS-SECRET"},
            "rooms": {"W21N26": {"plan": {"veryLarge": True}, "economy": {"phase": "develop"}},
                      "W22N26": {"plan": {"candidateLayout": True}}},
            "candidates": {"W21N26": [{"room": "W22N26", "score": 200}]},
            "expansion": {"home": "W21N26", "target": "W22N26", "state": "blocked"},
            "performance": {"samples": 20, "mean": 4.2, "_private": "unused", "token": "PERFORMANCE-SECRET",
                            "stages": {"memory": {"perTick": 0.8}}, "history": [{"tick": tick} for tick in range(12)]},
            "telemetry": {"tick": 123, "cpuEMA": 4.9, "bucket": 10000,
                "alerts": {"W21N26:backlog": {"message": "stock rising", "authorization": "ALERT-SECRET"}},
                "rooms": {"W21N26": {
                    "rcl": 2, "progress": 40000, "roleCounts": {"hauler": 3},
                    "mining": [{"stock": 3200}], "roads": {"built": 10},
                    "hauling": {"count": 3, "units": [{"name": "hauler1", "pickup": {"id": "drop1"}}]},
                    "constructionByType": {"road": {"sites": 2}},
                    "history": [{"t": tick} for tick in range(12)],
                }}}
        }
        self.response({"ok": 1, "data": "gz:" + base64.b64encode(gzip.compress(json.dumps(frontier).encode())).decode()})
        result, output, _ = self.run_cli("status")
        self.assertEqual(result, 0)
        summary = json.loads(output)
        self.assertRegex(summary["fetchedAt"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
        room = summary["rooms"]["W21N26"]
        self.assertNotIn("W22N26", summary["rooms"])
        self.assertEqual(summary["candidates"]["W21N26"][0]["room"], "W22N26")
        self.assertEqual(summary["expansion"]["state"], "blocked")
        self.assertEqual(summary["performance"]["samples"], 20)
        self.assertEqual(summary["performance"]["stages"]["memory"]["perTick"], 0.8)
        self.assertEqual(summary["performance"]["history"], [{"tick": tick} for tick in range(6, 12)])
        self.assertNotIn("_private", summary["performance"])
        self.assertEqual(room["economy"], {"phase": "develop"})
        self.assertEqual(room["mining"], [{"stock": 3200}])
        self.assertEqual(room["roads"]["built"], 10)
        self.assertEqual(room["hauling"]["count"], 3)
        self.assertEqual(room["construction"]["road"]["sites"], 2)
        self.assertEqual(room["history"], [{"t": tick} for tick in range(6, 12)])
        self.assertNotIn("veryLarge", output)
        self.assertNotIn("candidateLayout", output)
        saved = self.directory / "state" / "api-frontier.json"
        self.assertEqual(json.loads(saved.read_text()), summary)
        self.assertEqual(saved.stat().st_mode & 0o077, 0)
        for secret in (self.token, "STATUS-SECRET", "ALERT-SECRET", "PERFORMANCE-SECRET"):
            self.assertNotIn(secret, output + saved.read_text())

    def test_status_rooms_can_supply_owned_room_before_telemetry(self):
        summary = api.status_summary({"status": {"rooms": [{"name": "W21N26"}]},
                                      "rooms": {"W21N26": {"economy": {"phase": "develop"}},
                                                "W22N26": {"plan": {}}}}, "shard1")
        self.assertEqual(list(summary["rooms"]), ["W21N26"])
        self.assertEqual(summary["rooms"]["W21N26"]["economy"], {"phase": "develop"})

    def test_401_and_429_are_clear_safe_and_not_retried(self):
        for status in (401, 429):
            with self.subTest(status=status):
                self.opener.open.reset_mock()
                self.opener.open.side_effect = urllib.error.HTTPError(
                    "https://screeps.com/api/auth/me", status, "leaked " + self.token,
                    {"Retry-After": "30", "X-Token": "OTHER-SERVER-TOKEN"}, io.BytesIO(self.token.encode()))
                result, output, errors = self.run_cli("identity")
                self.assertEqual(result, 2)
                self.assertEqual(output, "")
                self.assertIn("HTTP " + str(status), errors)
                self.assertIn("authentication" if status == 401 else "rate limited", errors)
                self.assertNotIn("OTHER-SERVER-TOKEN", errors)
                self.assertEqual(self.opener.open.call_count, 1)
                if status == 429:
                    self.assertIn("30 seconds", errors)

    def test_transport_and_api_errors_do_not_echo_secrets(self):
        self.opener.open.side_effect = urllib.error.URLError("bad response " + self.token)
        result, _, errors = self.run_cli("identity")
        self.assertEqual(result, 2)
        self.assertIn("connection failed", errors)
        self.opener.open.side_effect = None
        self.response({"error": "token not found: " + self.token, "password": "hidden"})
        result, _, errors = self.run_cli("identity")
        self.assertEqual(result, 2)
        self.assertIn("authentication refused", errors)
        self.assertNotIn("hidden", errors)

    def test_redirects_are_refused_without_exposing_destination(self):
        handler = api.NoRedirect()
        for code in (301, 302, 303, 307, 308):
            with self.subTest(code=code):
                with self.assertRaisesRegex(api.APIError, "Redirect refused") as caught:
                    handler.redirect_request(None, None, code, "moved", {}, "https://evil.example/" + self.token)
                self.assertNotIn(self.token, str(caught.exception))
        self.opener.open.side_effect = urllib.error.HTTPError(
            "https://screeps.com/api/auth/me", 302, "moved", {"Location": "https://evil.example/" + self.token}, None)
        result, _, errors = self.run_cli("identity")
        self.assertEqual(result, 2)
        self.assertIn("Redirect refused", errors)
        self.assertEqual(self.opener.open.call_count, 1)

    def test_permission_check_precedes_token_read_and_network(self):
        self.token_file.chmod(0o640)
        with mock.patch.object(api.os, "fdopen") as read:
            result, _, errors = self.run_cli("identity")
        self.assertEqual(result, 2)
        self.assertIn("chmod 600", errors)
        read.assert_not_called()
        self.build_opener.assert_not_called()

    def test_newlines_and_nonfinite_timeouts_rejected(self):
        self.token_file.write_text(self.token + "\nSECOND-TOKEN", encoding="utf-8")
        result, _, errors = self.run_cli("identity")
        self.assertEqual(result, 2)
        self.assertIn("without whitespace", errors)
        for timeout in ("nan", "inf", "0", "61"):
            result, _, errors = self.run_cli("identity", "--timeout", timeout)
            self.assertEqual(result, 2)
            self.assertIn("between 1 and 60", errors)
        self.build_opener.assert_not_called()

    def test_code_check_matches_hashes_and_never_prints_source(self):
        modules = {name: "// PRIVATE SOURCE " + name + "\n" for name in api.MODULES}
        for name, content in modules.items():
            (self.directory / (name + ".js")).write_text(content, encoding="utf-8")
        self.response({"ok": 1, "branch": "frontier24", "modules": modules})
        result, output, _ = self.run_cli("code-check")
        self.assertEqual(result, 0)
        report = json.loads(output)
        self.assertTrue(report["all_match"])
        self.assertEqual(report["modules"]["main"]["local_sha256"], hashlib.sha256(modules["main"].encode()).hexdigest())
        self.assertNotIn("PRIVATE SOURCE", output)
        self.assertEqual(self.last_request().full_url, "https://screeps.com/api/user/code?branch=frontier24")
        modules["main"] += "// changed"
        del modules["monitor"]
        self.response({"ok": 1, "modules": modules})
        result, output, _ = self.run_cli("code-check")
        self.assertEqual(result, 1)
        report = json.loads(output)
        self.assertFalse(report["modules"]["main"]["match"])
        self.assertEqual(report["modules"]["monitor"]["remote_state"], "missing_or_nontext")
        self.assertNotIn("PRIVATE SOURCE", output)

    def test_console_payload_is_exact_and_only_acceptance_is_printed(self):
        expression = 'console.log("literal `$()` and unicode 中文");\nMemory.example = 1;\n'
        expression_file = self.directory / "expression.js"
        expression_file.write_text(expression, encoding="utf-8")
        self.response({"ok": 1, "result": "PRIVATE-CONSOLE-RESULT", "token": "OTHER-TOKEN"})
        result, output, errors = self.run_cli("console", "--file", str(expression_file))
        self.assertEqual(result, 0)
        self.assertEqual(errors, "")
        self.assertEqual(json.loads(output), {"accepted": True})
        req = self.last_request()
        self.assertEqual(req.full_url, "https://screeps.com/api/user/console")
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(json.loads(req.data), {"expression": expression, "shard": "shard1"})
        self.assertNotIn("PRIVATE-CONSOLE-RESULT", output)

    def test_console_requires_explicit_acceptance(self):
        expression_file = self.directory / "expression.js"
        expression_file.write_text("console.log(Game.time)", encoding="utf-8")
        self.response({})
        result, output, errors = self.run_cli("console", "--file", str(expression_file))
        self.assertEqual(result, 2)
        self.assertEqual(output, "")
        self.assertIn("acceptance is unknown", errors)

    def test_console_server_length_limit_counts_json_escaping_and_utf16(self):
        expression_file = self.directory / "expression.js"
        for expression in ("a" * 1023, "\\" * 512, "🙂" * 512):
            expression_file.write_text(expression, encoding="utf-8")
            result, output, errors = self.run_cli("console", "--file", str(expression_file))
            self.assertEqual(result, 2)
            self.assertEqual(output, "")
            self.assertIn("1024 JSON characters", errors)
        self.opener.open.assert_not_called()

    def test_no_arbitrary_endpoint_or_credential_query(self):
        client = api.ScreepsAPI(self.token_file)
        for endpoint, query in (("https://evil.example", None), ("/api/user/memory", {"path": self.token})):
            with self.assertRaises(api.APIError):
                client.request(endpoint, query)
        self.opener.open.assert_not_called()

    def test_deploy_defaults_to_dry_run_hashes_without_backup_or_write(self):
        local, remote, _ = self.deployment_data()
        self.responses({"ok": 1, "username": "AdamZmy"}, self.code_response(remote))
        result, output, errors = self.run_cli("deploy")
        self.assertEqual(result, 0)
        self.assertEqual(errors, "")
        report = json.loads(output)
        self.assertEqual(report["status"], "dry-run")
        self.assertEqual(report["changed_modules"], list(api.MODULES))
        self.assertEqual(report["modules"]["main"]["after_sha256"], hashlib.sha256(local["main"].encode()).hexdigest())
        self.assertEqual(report["modules"]["main"]["before_sha256"], hashlib.sha256(remote["main"].encode()).hexdigest())
        self.assertEqual(report["preserved_remote_modules"], ["binary", "custom"])
        self.assertNotIn("PRIVATE", output)
        self.assertFalse((self.directory / "backups").exists())
        self.assertEqual(self.post_requests(), [])
        self.assertEqual(self.opener.open.call_count, 2)

    def test_deploy_rejects_other_account_or_branch(self):
        self.response({"ok": 1, "username": "OtherAccount"})
        result, _, errors = self.run_cli("deploy", "--apply")
        self.assertEqual(result, 2)
        self.assertIn("must be AdamZmy", errors)
        self.assertEqual(self.opener.open.call_count, 1)
        self.assertEqual(self.post_requests(), [])
        self.opener.open.reset_mock()
        result, _, errors = self.run_cli("deploy", "--apply", "--branch", "default")
        self.assertEqual(result, 2)
        self.assertIn("restricted to branch frontier24", errors)
        self.opener.open.assert_not_called()

    def test_deploy_apply_backs_up_all_remote_modules_before_post_and_verifies(self):
        _, remote, merged = self.deployment_data()
        payloads = iter([{"ok": 1, "username": "AdamZmy"}, self.code_response(remote),
                         {"ok": 1}, self.code_response(merged)])

        def respond(request, timeout):
            if request.get_method() == "POST":
                backups = list((self.directory / "backups").glob("api-deploy-*/remote-code.json"))
                self.assertEqual(len(backups), 1)
                self.assertEqual(json.loads(backups[0].read_text())["modules"], remote)
            return io.BytesIO(json.dumps(next(payloads)).encode("utf-8"))

        self.opener.open.side_effect = respond
        result, output, errors = self.run_cli("deploy", "--apply")
        self.assertEqual(result, 0)
        self.assertEqual(errors, "")
        report = json.loads(output)
        self.assertEqual(report["status"], "verified")
        self.assertTrue(report["verified"])
        backup = Path(report["backup"])
        self.assertEqual(json.loads(backup.read_text())["modules"], remote)
        self.assertEqual(backup.stat().st_mode & 0o077, 0)
        self.assertEqual(backup.parent.stat().st_mode & 0o077, 0)
        self.assertNotIn(self.token, backup.read_text())
        self.assertNotIn("SERVER-RESPONSE-SECRET", backup.read_text() + output)
        posts = self.post_requests()
        self.assertEqual(len(posts), 1)
        self.assertEqual(json.loads(posts[0].data), {"branch": "frontier24", "modules": merged})
        self.assertEqual(self.opener.open.call_count, 4)
        self.assertEqual(self.last_request().full_url, "https://screeps.com/api/user/code?branch=frontier24")
        self.assertNotIn("PRIVATE", output)

    def test_deploy_readback_must_match_every_module_including_preserved_extras(self):
        _, remote, merged = self.deployment_data()
        del merged["custom"]
        self.responses({"ok": 1, "username": "AdamZmy"}, self.code_response(remote),
                       {"ok": 1}, self.code_response(merged))
        result, output, errors = self.run_cli("deploy", "--apply")
        self.assertEqual(result, 2)
        self.assertEqual(output, "")
        self.assertIn("Readback modules do not match", errors)
        self.assertIn("code-check --branch frontier24", errors)
        self.assertEqual(len(self.post_requests()), 1)
        self.assertEqual(self.opener.open.call_count, 4)

    def test_deploy_write_failure_or_missing_ack_is_not_retried(self):
        _, remote, _ = self.deployment_data()
        failures = [urllib.error.URLError("timeout " + self.token),
                    urllib.error.HTTPError("https://screeps.com/api/user/code", 429, "rate limit", {}, None),
                    api.http.client.IncompleteRead(b"private response " + self.token.encode()), {}]
        for failure in failures:
            with self.subTest(failure=type(failure).__name__):
                self.opener.open.reset_mock()
                self.responses({"ok": 1, "username": "AdamZmy"}, self.code_response(remote), failure)
                result, output, errors = self.run_cli("deploy", "--apply")
                self.assertEqual(result, 2)
                self.assertEqual(output, "")
                self.assertIn("No write retry was made", errors)
                self.assertIn("code-check --branch frontier24", errors)
                self.assertEqual(len(self.post_requests()), 1)
                self.assertEqual(self.opener.open.call_count, 3)

    def test_deploy_unchanged_does_not_post_even_with_extra_modules(self):
        _, _, merged = self.deployment_data()
        for flags in ([], ["--apply"]):
            self.opener.open.reset_mock()
            self.responses({"ok": 1, "username": "AdamZmy"}, self.code_response(merged))
            result, output, _ = self.run_cli("deploy", *flags)
            self.assertEqual(result, 0)
            self.assertEqual(json.loads(output)["status"], "unchanged")
            self.assertEqual(json.loads(output)["changed_modules"], [])
            self.assertEqual(self.post_requests(), [])
            self.assertEqual(self.opener.open.call_count, 2)
        self.assertFalse((self.directory / "backups").exists())

    def test_deploy_backup_failure_prevents_write(self):
        _, remote, _ = self.deployment_data()
        self.responses({"ok": 1, "username": "AdamZmy"}, self.code_response(remote))
        with mock.patch.object(api.os, "fsync", side_effect=OSError("disk full")):
            result, _, errors = self.run_cli("deploy", "--apply")
        self.assertEqual(result, 2)
        self.assertIn("no deployment write was made", errors)
        self.assertEqual(self.post_requests(), [])

    def test_deploy_refuses_to_copy_authentication_data_to_backup_or_code(self):
        _, remote, _ = self.deployment_data()
        remote["custom"] = self.token
        self.responses({"ok": 1, "username": "AdamZmy"}, self.code_response(remote))
        result, _, errors = self.run_cli("deploy", "--apply")
        self.assertEqual(result, 2)
        self.assertIn("code contains authentication data", errors)
        self.assertFalse((self.directory / "backups").exists())
        self.assertEqual(self.post_requests(), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
