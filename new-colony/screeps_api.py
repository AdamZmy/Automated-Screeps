#!/usr/bin/env python3
"""Small, standard-library-only Screeps World API client (Python 3.9+).

Examples:
    python3 screeps_api.py identity
    python3 screeps_api.py status
    python3 screeps_api.py memory --path frontier.status
    python3 screeps_api.py code-check --branch frontier24
    python3 screeps_api.py console --file /path/to/expression.js
    python3 screeps_api.py deploy
    python3 screeps_api.py deploy --apply

Deploy is a dry run unless --apply is supplied; it never changes the active branch.
"""

import argparse
import base64
import binascii
from datetime import datetime, timezone
import gzip
import hashlib
import http.client
import io
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request


ORIGIN = "https://screeps.com"
PROJECT_DIR = Path(__file__).resolve().parent
DEFAULT_TOKEN_FILE = Path("/Users/zmy/.config/screepsworld/auth-token")
MODULES = ("main", "planner", "expansion", "monitor", "ledger", "plans")
DEPLOY_BRANCH = "frontier24"
DEPLOY_USERNAME = "AdamZmy"
MAX_BYTES = 16 * 1024 * 1024
MAX_CONSOLE_CHARS = 1024
SECRET_KEYS = {
    "token", "xtoken", "authtoken", "accesstoken", "refreshtoken", "idtoken",
    "password", "passwd", "secret", "clientsecret", "authorization",
    "apikey", "accesskey", "secretkey", "privatekey", "credentials",
    "cookie", "setcookie", "sessiontoken", "sessionkey",
}
SECRET_ASSIGNMENT = re.compile(
    r"(?i)([\"']?(?:x[-_]?token|(?:auth|access|refresh|id|session)[-_]?token|token|"
    r"password|passwd|(?:client[-_]?)?secret|authorization|api[-_]?key|"
    r"(?:access|secret|private|session)[-_]?key|credentials|(?:set[-_]?)?cookie)"
    r"[\"']?\s*[:=]\s*)(?:\"[^\"]*\"|'[^']*'|(?:Bearer|Basic)\s+[^\s,;}]+|[^\s,;}]+)"
)


class APIError(Exception):
    """An intentionally safe error message; never include raw transport errors."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never send X-Token to a redirected endpoint, including same-origin URLs.
        raise APIError("Redirect refused; API requests must stay at https://screeps.com.")


def read_token(path):
    """Check the opened file itself, before reading any credential bytes."""
    fd = None
    try:
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
        fd = os.open(os.fspath(path), flags)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
            raise APIError("Token file must be a regular private file (chmod 600; no group/other permissions).")
        with os.fdopen(fd, "r", encoding="utf-8") as handle:
            fd = None
            token = handle.read(4097).strip()
        if not token or len(token) > 4096 or any(ch.isspace() for ch in token):
            raise APIError("Token file must contain one nonempty token without whitespace.")
        # HTTP header encoding must not fail later with credential-bearing details.
        if not token.isascii() or any(ord(ch) < 33 or ord(ch) > 126 for ch in token):
            raise APIError("Token file contains an invalid token format.")
        return token
    except (OSError, UnicodeError):
        raise APIError("Cannot read the private token file; check its location and permissions.") from None
    finally:
        if fd is not None:
            os.close(fd)


def redact(value, token):
    """Sanitize both structured secret fields and credentials embedded in text."""
    def text(value):
        value = value.replace(token, "[REDACTED]") if token else value
        return SECRET_ASSIGNMENT.sub(lambda match: match.group(1) + "[REDACTED]", value)

    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            key = str(key)
            normalized = re.sub(r"[^a-z0-9]", "", key.lower())
            result[text(key)] = "[REDACTED]" if normalized in SECRET_KEYS else redact(item, token)
        return result
    if isinstance(value, list):
        return [redact(item, token) for item in value]
    if isinstance(value, str):
        return text(value)
    return value


def decode_memory(data):
    if data is None or isinstance(data, (dict, list, int, float, bool)):
        return data
    if not isinstance(data, str):
        raise APIError("Memory response has an unsupported format.")
    try:
        if data.startswith("gz:"):
            packed = base64.b64decode(data[3:], validate=True)
            with gzip.GzipFile(fileobj=io.BytesIO(packed)) as handle:
                unpacked = handle.read(MAX_BYTES + 1)
            if len(unpacked) > MAX_BYTES:
                raise APIError("Decoded memory exceeds the size limit.")
            data = unpacked.decode("utf-8")
        return json.loads(data)
    except (ValueError, UnicodeError, OSError, EOFError, binascii.Error):
        raise APIError("Cannot decode memory; check the memory path and response format.") from None


class ScreepsAPI:
    def __init__(self, token_file=DEFAULT_TOKEN_FILE, timeout=15):
        if not math.isfinite(timeout) or not 1 <= timeout <= 60:
            raise APIError("Timeout must be between 1 and 60 seconds.")
        self.token = read_token(token_file)
        self.timeout = timeout
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, endpoint, query=None, payload=None):
        allowed = {
            "/api/auth/me": ("GET",), "/api/user/memory": ("GET",),
            "/api/user/code": ("GET", "POST"), "/api/user/console": ("POST",),
        }
        method = "POST" if payload is not None else "GET"
        if method not in allowed.get(endpoint, ()):
            raise APIError("Unsupported API operation.")
        url = ORIGIN + endpoint
        if query:
            url += "?" + urllib.parse.urlencode(query)
        if self.token in url or urllib.parse.quote(self.token, safe="") in url:
            raise APIError("Refusing to include authentication data in a URL.")
        headers = {"X-Token": self.token, "Accept": "application/json"}
        body = None
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                raw = response.read(MAX_BYTES + 1)
        except urllib.error.HTTPError as error:
            if 300 <= error.code < 400:
                raise APIError("Redirect refused; API requests must stay at https://screeps.com.") from None
            if error.code in (401, 403):
                raise APIError("HTTP {}: authentication refused; check token validity and API permissions.".format(error.code)) from None
            if error.code == 429:
                wait = error.headers.get("Retry-After", "") if error.headers else ""
                hint = " Retry after {} seconds.".format(wait) if re.fullmatch(r"[0-9]{1,6}", wait) else " Retry later."
                raise APIError("HTTP 429: rate limited; no automatic retry." + hint) from None
            raise APIError("HTTP {}: API request failed.".format(error.code)) from None
        except (urllib.error.URLError, OSError, ValueError, http.client.HTTPException):
            raise APIError("API connection failed or timed out; no automatic retry.") from None
        if len(raw) > MAX_BYTES:
            raise APIError("API response exceeds the size limit.")
        try:
            result = json.loads(raw)
        except (ValueError, UnicodeError):
            raise APIError("API returned invalid JSON.") from None
        if not isinstance(result, dict):
            raise APIError("API returned an unexpected response shape.")
        if result.get("error") or ("ok" in result and result["ok"] != 1):
            # Never echo arbitrary server errors, which may contain credentials.
            error = str(result.get("error", "")).lower()
            if "token" in error or "unauthorized" in error:
                raise APIError("API authentication refused; check token validity and API permissions.")
            raise APIError("API rejected the request; check command arguments and account permissions.")
        return result

    def identity(self):
        result = self.request("/api/auth/me")
        return {"username": result.get("username"), "id": result.get("_id", result.get("id")), "cpu": result.get("cpu")}

    def memory(self, shard="shard1", path="frontier"):
        result = self.request("/api/user/memory", {"shard": shard, "path": path})
        return decode_memory(result.get("data"))

    def code_check(self, branch="frontier24"):
        result = self.request("/api/user/code", {"branch": branch})
        remote = result.get("modules")
        if not isinstance(remote, dict):
            raise APIError("Code response has no modules object.")
        modules = {}
        for name in MODULES:
            try:
                local = (PROJECT_DIR / (name + ".js")).read_bytes()
            except OSError:
                raise APIError("Cannot read one of the local game modules.") from None
            source = remote.get(name)
            remote_hash = hashlib.sha256(source.encode("utf-8")).hexdigest() if isinstance(source, str) else None
            local_hash = hashlib.sha256(local).hexdigest()
            modules[name] = {
                "local_sha256": local_hash, "remote_sha256": remote_hash,
                "match": local_hash == remote_hash,
                "remote_state": "present" if isinstance(source, str) else "missing_or_nontext",
            }
        extra = sorted(set(remote) - set(MODULES))
        return {"branch": result.get("branch", branch), "modules": modules,
                "extra_remote_modules": extra,
                "all_match": all(item["match"] for item in modules.values()) and not extra}

    def console(self, expression_file, shard="shard1"):
        try:
            expression = Path(expression_file).read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            raise APIError("Cannot read the UTF-8 console expression file.") from None
        if not expression.strip():
            raise APIError("Console expression file is empty.")
        # The server limits JSON.stringify(expression).length, in UTF-16 units.
        expression_size = len(json.dumps(expression, ensure_ascii=False).encode("utf-16-le")) // 2
        if expression_size > MAX_CONSOLE_CHARS:
            raise APIError("Console expression exceeds 1024 JSON characters; split it into smaller queries.")
        result = self.request("/api/user/console", payload={"expression": expression, "shard": shard})
        if result.get("ok") != 1:
            raise APIError("Console request was not acknowledged; acceptance is unknown.")
        return {"accepted": True}

    def deploy(self, apply=False, branch=DEPLOY_BRANCH):
        if branch != DEPLOY_BRANCH:
            raise APIError("Deployment is restricted to branch frontier24.")
        if self.identity().get("username") != DEPLOY_USERNAME:
            raise APIError("Deployment refused: authenticated account must be AdamZmy.")
        current = self.request("/api/user/code", {"branch": DEPLOY_BRANCH})
        remote = current.get("modules")
        if current.get("branch") != DEPLOY_BRANCH or not isinstance(remote, dict):
            raise APIError("Deployment refused: remote branch or modules could not be verified.")
        try:
            local = {name: (PROJECT_DIR / (name + ".js")).read_bytes().decode("utf-8") for name in MODULES}
        except (OSError, UnicodeError):
            raise APIError("Cannot read the local game modules as UTF-8.") from None
        merged = dict(remote)
        merged.update(local)
        changes = {}
        for name in MODULES:
            old = remote.get(name)
            old_hash = hashlib.sha256(old.encode("utf-8")).hexdigest() if isinstance(old, str) else None
            changes[name] = {"before_sha256": old_hash,
                             "after_sha256": hashlib.sha256(local[name].encode("utf-8")).hexdigest(),
                             "changed": old != local[name]}
        changed = [name for name in MODULES if changes[name]["changed"]]
        report = {"status": "dry-run" if changed else "unchanged", "branch": DEPLOY_BRANCH,
                  "modules": changes, "changed_modules": changed,
                  "preserved_remote_modules": sorted(set(remote) - set(MODULES))}
        if not apply or not changed:
            return report

        # Do not redact source: the backup must restore the exact remote modules.
        # Refuse the operation if credential bytes would enter either code snapshot.
        encoded_token = json.dumps(self.token, ensure_ascii=False)[1:-1]
        if encoded_token in json.dumps(merged, ensure_ascii=False) or encoded_token in json.dumps(remote, ensure_ascii=False):
            raise APIError("Deployment refused: code contains authentication data; no backup or write was made.")
        backup = backup_code(remote)
        try:
            result = self.request("/api/user/code", payload={"branch": DEPLOY_BRANCH, "modules": merged})
            if result.get("ok") != 1:
                raise APIError("Write acceptance is unknown.")
            observed = self.request("/api/user/code", {"branch": DEPLOY_BRANCH})
            if observed.get("branch") != DEPLOY_BRANCH or observed.get("modules") != merged:
                raise APIError("Readback modules do not match the deployment payload.")
        except APIError as error:
            raise APIError(
                "Deployment write failed or could not be verified. {} No write retry was made. "
                "Run code-check --branch frontier24 before any further deployment. Backup: {}".format(error, backup)
            ) from None
        report.update({"status": "verified", "verified": True, "backup": str(backup)})
        return report


def backup_code(modules):
    """Save all remote modules, excluding API response headers and auth metadata."""
    now = datetime.now(timezone.utc)
    directory = PROJECT_DIR / "backups" / ("api-deploy-" + now.strftime("%Y%m%dT%H%M%S.%fZ"))
    target = directory / "remote-code.json"
    snapshot = {"fetchedAt": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
                "branch": DEPLOY_BRANCH, "modules": modules}
    try:
        directory.mkdir(mode=0o700, parents=True, exist_ok=False)
        descriptor = os.open(str(target), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(snapshot, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
    except (OSError, UnicodeError):
        raise APIError("Cannot complete the remote code backup; no deployment write was made.") from None
    return target


def status_summary(frontier, shard):
    if not isinstance(frontier, dict):
        raise APIError("Memory.frontier is unavailable or is not an object.")
    telemetry = frontier.get("telemetry") or {}
    if not isinstance(telemetry, dict):
        raise APIError("Memory.frontier.telemetry has an unexpected format.")
    telemetry_rooms = telemetry.get("rooms") or {}
    frontier_rooms = frontier.get("rooms") or {}
    status = frontier.get("status") or {}
    # frontier.rooms also contains planned scouting targets, not just owned rooms.
    room_names = set(telemetry_rooms)
    for item in status.get("rooms", []):
        if isinstance(item, dict) and isinstance(item.get("name"), str):
            room_names.add(item["name"])
    rooms = {}
    fields = (
        "tick", "rcl", "progress", "total", "upgradeRate", "upgradeEMA", "stagnant",
        "roleCounts", "energy", "capacity", "storage", "buffers", "dropped",
        "upkeep", "harvestPotential", "constructionSites", "planComplete", "builtExtensions",
    )
    for name in sorted(room_names):
        room = telemetry_rooms.get(name) or {}
        state = frontier_rooms.get(name) or {}
        if not isinstance(room, dict) or not isinstance(state, dict):
            continue
        summary = {key: room[key] for key in fields if key in room}
        summary.update({
            "economy": room.get("economy", state.get("economy", {})),
            "mining": room.get("mining", []), "roads": room.get("roads", {}),
            "hauling": room.get("hauling", {}),
            "construction": room.get("constructionByType", {}),
            "history": (room.get("history") or [])[-6:],
            "northStar": {k: (v[-6:] if k == "history" and isinstance(v, list) else v) for k, v in (((frontier.get("energy") or {}).get("rooms") or {}).get(name) or {}).items() if not k.startswith("_")},
        })
        rooms[name] = summary
    return {"fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "shard": shard, "status": status,
            "telemetry": {key: telemetry[key] for key in ("tick", "version", "cpuEMA", "bucket", "capturedAt") if key in telemetry},
            "performance": {k: (v[-6:] if k == "history" and isinstance(v, list) else v) for k, v in (frontier.get("performance") or {}).items() if not k.startswith("_")},
            "rooms": rooms, "alerts": telemetry.get("alerts", {}),
            "candidates": frontier.get("candidates", {}), "expansion": frontier.get("expansion")}


def save_status(summary):
    """Write only the already-redacted summary, atomically, with private mode."""
    target = PROJECT_DIR / "state" / "api-frontier.json"
    temporary = None
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=str(target.parent), delete=False) as handle:
            temporary = handle.name
            json.dump(summary, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temporary, target)
    except OSError:
        raise APIError("Cannot save state/api-frontier.json.") from None
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def parser():
    common = argparse.ArgumentParser(add_help=False)
    # SUPPRESS allows common options either before or after the subcommand.
    common.add_argument("--token-file", type=Path, default=argparse.SUPPRESS,
                        help="private token file (default: ~/.config/screepsworld/auth-token)")
    common.add_argument("--timeout", type=float, default=argparse.SUPPRESS, help="request timeout, 1–60 seconds (default: 15)")
    common.add_argument("--shard", default=argparse.SUPPRESS, help="default: shard1")
    common.add_argument("--branch", default=argparse.SUPPRESS, help="default: frontier24")
    result = argparse.ArgumentParser(description=__doc__, parents=[common], formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = result.add_subparsers(dest="command", required=True)
    for command in ("identity", "status", "memory", "code-check", "console", "deploy"):
        child = sub.add_parser(command, parents=[common])
        if command == "memory":
            child.add_argument("--path", default="frontier")
        if command == "console":
            child.add_argument("--file", required=True, type=Path)
        if command == "deploy":
            child.add_argument("--apply", action="store_true", help="back up, write frontier24, and verify (default: dry run)")
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    client = None
    try:
        client = ScreepsAPI(getattr(args, "token_file", DEFAULT_TOKEN_FILE), getattr(args, "timeout", 15))
        shard = getattr(args, "shard", "shard1")
        branch = getattr(args, "branch", "frontier24")
        if args.command == "identity":
            result = client.identity()
        elif args.command == "memory":
            result = client.memory(shard, args.path)
        elif args.command == "status":
            result = status_summary(client.memory(shard), shard)
        elif args.command == "code-check":
            result = client.code_check(branch)
        elif args.command == "deploy":
            result = client.deploy(args.apply, branch)
        else:
            result = client.console(args.file, shard)
        result = redact(result, client.token)
        if args.command == "status":
            save_status(result)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 1 if args.command == "code-check" and not result["all_match"] else 0
    except APIError as error:
        # All APIError messages are authored locally; this is a final safety net.
        print("Error: " + str(redact(str(error), client.token if client else "")), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
