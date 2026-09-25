#!/usr/bin/env python3
"""Bounded, local-only inspection archive writer. Python standard library only."""

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import unicodedata
from urllib.parse import quote, unquote, urlsplit
import uuid

DEFAULT_ROOT = Path(__file__).resolve().parents[1] / "operations" / "inspections"
REPOSITORY = "https://github.com/AdamZmy/Automated-Screeps"
MONITOR_HOST = "screeps-energy-observatory.vercel.app"
MAX_RECORD_BYTES = 256 * 1024
MAX_ROOT_INDEX_BYTES = 1024 * 1024
MAX_DAY_INDEX_BYTES = 8 * 1024 * 1024
MAX_DAYS = 10000
MAX_DAY_RUNS = 10000
MAX_MARKDOWN_BYTES = 2 * 1024 * 1024
ID_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)-([a-z0-9]+(?:-[a-z0-9]+)*)$")
DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$")
KINDS = {"scheduled", "manual", "backfill", "setup"}
STATUSES = {"running", "completed", "blocked", "skipped", "failed"}
IDENTITY = ("id", "startedAt", "kind")
SUMMARY_KEYS = {"id", "kind", "startedAt", "updatedAt", "completedAt", "status", "title", "summary", "tick", "issueNumbers"}
RECORD_KEYS = {"schemaVersion", "id", "kind", "startedAt", "updatedAt", "completedAt", "status", "title", "summary", "game", "findings", "tasks", "actions", "checks", "next", "references"}


class InspectionError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise InspectionError(message)


def now_utc():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def exact_keys(value, keys, label):
    require(type(value) is dict, f"{label}: expected an object")
    require(set(value) == set(keys), f"{label}: missing or unknown fields")


def timestamp(value, label):
    require(type(value) is str and TIME_RE.fullmatch(value), f"{label}: expected ISO8601 UTC with Z")
    try:
        return datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        raise InspectionError(f"{label}: invalid UTC date/time") from None


def sensitive_text(value, label):
    # Detect likely accidental disclosure without flagging commit hashes or bounded telemetry.
    patterns = (
        r"-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----",
        r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b",
        r"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b",
        r"\bBearer\s+[A-Za-z0-9._~+/=-]{12,}",
        r"(?:/Users/|/home/|/root/|/private/|/var/folders/|[A-Za-z]:[\\/]Users[\\/]|file://|(?<!\w)~/)",
        r"(?:[\"']?\b(?:RawMemory|Memory)[\"']?\s*[:=]\s*[\[{])",
    )
    require(not any(re.search(p, value, re.IGNORECASE) for p in patterns), f"{label}: possible credential, private path or raw Memory; redact before publishing")
    assignments = re.finditer(r"\b(?:[A-Z_]*TOKEN|[A-Z_]*API[_-]?KEY|[A-Z_]*SECRET|[A-Z_]*PASSWORD)\b[\"']?\s*[:=]\s*[\"']?([A-Za-z0-9_./+=-]{12,})", value, re.IGNORECASE)
    for match in assignments:
        secret = match.group(1).lower()
        require(secret in {"not-configured", "not-available", "your-token-here", "your-api-key-here"} or "redacted" in secret or "placeholder" in secret, f"{label}: possible credential assignment; redact before publishing")
    if value.lstrip().startswith("{"):
        try:
            embedded = json.loads(value)
        except (ValueError, RecursionError):
            embedded = None
        if isinstance(embedded, dict):
            require(len(set(embedded) & {"creeps", "rooms", "spawns", "flags", "powerCreeps"}) < 2, f"{label}: possible raw Memory object; use bounded evidence")


def string(value, label, maximum=4000, nonempty=False):
    require(type(value) is str, f"{label}: expected text")
    require(len(value) <= maximum, f"{label}: text exceeds {maximum} characters")
    require(not nonempty or bool(value.strip()), f"{label}: text must not be empty")
    require(not any(unicodedata.category(c) in {"Cc", "Cf", "Cs"} and c not in "\n\t" for c in value), f"{label}: control or invisible formatting character")
    sensitive_text(value, label)


def enum(value, choices, label):
    require(type(value) is str and value in choices, f"{label}: invalid enum value")


def integer(value, label, minimum=0, maximum=9007199254740991, nullable=False):
    if value is None and nullable:
        return
    require(type(value) is int and minimum <= value <= maximum, f"{label}: expected integer in [{minimum}, {maximum}]")


def array(value, label, maximum):
    require(type(value) is list and len(value) <= maximum, f"{label}: expected array with at most {maximum} entries")


def issue(value, label):
    integer(value, label, 1, 2147483647, nullable=True)


def identity_and_times(data):
    identifier = data["id"]
    require(type(identifier) is str and len(identifier) <= 96 and ID_RE.fullmatch(identifier), "id: invalid ID")
    enum(data["kind"], KINDS, "kind")
    enum(data["status"], STATUSES, "status")
    start = timestamp(data["startedAt"], "startedAt")
    update = timestamp(data["updatedAt"], "updatedAt")
    require(identifier.startswith(start.strftime("%Y-%m-%dT%H-%M-%SZ") + "-"), "id: prefix must match startedAt UTC second")
    require(start <= update, "updatedAt: precedes startedAt")
    if data["status"] == "running":
        require(data["completedAt"] is None, "completedAt: running record must use null")
    else:
        completed = timestamp(data["completedAt"], "completedAt")
        require(start <= completed <= update, "completedAt: must fall between startedAt and updatedAt")
    string(data["title"], "title", 240, True)
    string(data["summary"], "summary", 4000)
    return start, update


def reference_url(value, label):
    string(value, label, 2048, True)
    require(not re.search(r"[\s<>\"\\]", value), f"{label}: invalid URL characters")
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        raise InspectionError(f"{label}: invalid URL") from None
    require(parsed.scheme == "https" and parsed.username is None and parsed.password is None and port is None, f"{label}: HTTPS without credentials or port required")
    decoded = parsed.path
    for _ in range(4):
        decoded = unquote(decoded)
    require(not any(part in {".", ".."} for part in decoded.split("/")) and "\\" not in decoded and not any(ord(c) < 32 for c in decoded), f"{label}: unsafe URL path")
    repo_path = "/AdamZmy/Automated-Screeps"
    require((parsed.netloc == "github.com" and (decoded == repo_path or decoded.startswith(repo_path + "/"))) or parsed.netloc == MONITOR_HOST, f"{label}: URL is outside the repository and monitoring site")


def encode_json(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + "\n").encode("utf-8")


def validate_record(data):
    exact_keys(data, RECORD_KEYS, "record")
    require(type(data["schemaVersion"]) is int and data["schemaVersion"] == 1, "schemaVersion: expected 1")
    start, update = identity_and_times(data)
    game = data["game"]
    if game is not None:
        exact_keys(game, {"shard", "rooms", "version", "tick", "fetchedAt"}, "game")
        if game["shard"] is not None:
            string(game["shard"], "game.shard", 40, True)
            require(re.fullmatch(r"[A-Za-z0-9_-]+", game["shard"]), "game.shard: invalid shard")
        if game["rooms"] is not None:
            array(game["rooms"], "game.rooms", 100)
            for room in game["rooms"]:
                require(type(room) is str and re.fullmatch(r"(?:[WE]\d{1,5}[NS]\d{1,5}|sim)", room), "game.rooms: invalid room name")
            require(len(set(game["rooms"])) == len(game["rooms"]), "game.rooms: duplicate room")
        if game["version"] is not None:
            string(game["version"], "game.version", 240, True)
        integer(game["tick"], "game.tick", nullable=True)
        if game["fetchedAt"] is not None:
            require(timestamp(game["fetchedAt"], "game.fetchedAt") <= update, "game.fetchedAt: later than updatedAt")
    array(data["findings"], "findings", 100)
    for i, item in enumerate(data["findings"]):
        label = f"findings[{i}]"
        exact_keys(item, {"severity", "title", "detail", "evidence", "issue"}, label)
        enum(item["severity"], {"info", "warning", "critical"}, label + ".severity")
        string(item["title"], label + ".title", 240, True)
        string(item["detail"], label + ".detail", 4000)
        array(item["evidence"], label + ".evidence", 50)
        for evidence in item["evidence"]:
            string(evidence, label + ".evidence[]", 2000, True)
        issue(item["issue"], label + ".issue")
    array(data["tasks"], "tasks", 100)
    for i, item in enumerate(data["tasks"]):
        label = f"tasks[{i}]"
        exact_keys(item, {"issue", "title", "status", "progress", "next", "owner"}, label)
        issue(item["issue"], label + ".issue")
        enum(item["status"], {"planned", "ready", "in-progress", "verifying", "blocked", "done"}, label + ".status")
        for key, limit in (("title", 240), ("progress", 4000), ("next", 4000), ("owner", 240)):
            string(item[key], label + "." + key, limit, key == "title")
    array(data["actions"], "actions", 100)
    for i, item in enumerate(data["actions"]):
        label = f"actions[{i}]"
        exact_keys(item, {"at", "description", "status", "result"}, label)
        require(start <= timestamp(item["at"], label + ".at") <= update, label + ".at: outside this run's time window")
        enum(item["status"], {"planned", "in-progress", "done", "failed"}, label + ".status")
        string(item["description"], label + ".description", 4000, True)
        string(item["result"], label + ".result", 4000)
    array(data["checks"], "checks", 100)
    for i, item in enumerate(data["checks"]):
        label = f"checks[{i}]"
        exact_keys(item, {"name", "result", "detail"}, label)
        string(item["name"], label + ".name", 240, True)
        enum(item["result"], {"passed", "failed", "pending"}, label + ".result")
        string(item["detail"], label + ".detail", 4000)
    array(data["next"], "next", 100)
    for value in data["next"]:
        string(value, "next[]", 4000, True)
    array(data["references"], "references", 100)
    for i, item in enumerate(data["references"]):
        label = f"references[{i}]"
        exact_keys(item, {"label", "url"}, label)
        string(item["label"], label + ".label", 240, True)
        reference_url(item["url"], label + ".url")
    require(len(encode_json(data)) <= MAX_RECORD_BYTES, "record: exceeds 256 KiB")
    return data


def summarize(data):
    result = {key: data[key] for key in SUMMARY_KEYS - {"tick", "issueNumbers"}}
    result["tick"] = None if data["game"] is None else data["game"]["tick"]
    result["issueNumbers"] = sorted({item["issue"] for key in ("findings", "tasks") for item in data[key] if item["issue"] is not None})
    return {key: result[key] for key in ("id", "kind", "startedAt", "updatedAt", "completedAt", "status", "title", "summary", "tick", "issueNumbers")}


def validate_summary(data):
    exact_keys(data, SUMMARY_KEYS, "index summary")
    identity_and_times(data)
    integer(data["tick"], "index summary.tick", nullable=True)
    array(data["issueNumbers"], "index summary.issueNumbers", 200)
    for number in data["issueNumbers"]:
        integer(number, "index summary.issueNumbers[]", 1, 2147483647)
    require(data["issueNumbers"] == sorted(set(data["issueNumbers"])), "index summary.issueNumbers: must be sorted and unique")


def plain(value):
    value = str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return re.sub(r"([\\`*_{}\[\]()#+.!|~>-])", r"\\\1", value)


def paragraph(value):
    return plain(value or "—").replace("\n", "\n\n")


def issue_link(number):
    return "无关联 Issue" if number is None else f"[Issue #{number}]({REPOSITORY}/issues/{number})"


def render_markdown(data):
    lines = ["# " + plain(data["title"]), "", f"- ID：`{data['id']}`", f"- 类型：{data['kind']}", f"- 本轮状态：{data['status']}", f"- 开始时间（UTC）：{data['startedAt']}", f"- 更新时间（UTC）：{data['updatedAt']}", f"- 结束时间（UTC）：{data['completedAt'] or '进行中'}", "", "## 本轮结论", "", paragraph(data["summary"]), "", "## 游戏观测", ""]
    game = data["game"]
    if game is None:
        lines += ["未记录游戏观测。"]
    else:
        for name, key in (("Shard", "shard"), ("房间", "rooms"), ("版本", "version"), ("Tick", "tick"), ("采集时间（UTC）", "fetchedAt")):
            value = game[key]
            if type(value) is list:
                value = ", ".join(value) or "无"
            lines += [f"- {name}：{plain('未知' if value is None else value)}"]
    for section, key in (("发现", "findings"), ("待办进度", "tasks"), ("动作", "actions"), ("检查", "checks")):
        lines += ["", "## " + section, ""]
        if not data[key]:
            lines += ["无。"]
        for item in data[key]:
            if key == "findings":
                lines += ["### " + plain(item["title"]), "", f"严重度：{item['severity']} · {issue_link(item['issue'])}", "", paragraph(item["detail"]), "", "证据：", ""]
                lines += ["- " + plain(e).replace("\n", "\n  ") for e in item["evidence"]] or ["无。"]
            elif key == "tasks":
                lines += ["### " + plain(item["title"]), "", f"状态：{item['status']} · {issue_link(item['issue'])}", "", "负责人：" + paragraph(item["owner"]), "", "进度：" + paragraph(item["progress"]), "", "下一步：" + paragraph(item["next"])]
            elif key == "actions":
                lines += [f"### {item['at']} · {item['status']}", "", paragraph(item["description"]), "", "结果：" + paragraph(item["result"])]
            else:
                lines += ["### " + plain(item["name"]), "", "结果：" + item["result"], "", paragraph(item["detail"])]
            lines += [""]
    lines += ["", "## 下一轮", ""]
    lines += ["- " + plain(value).replace("\n", "\n  ") for value in data["next"]] or ["无。"]
    lines += ["", "## 引用", ""]
    lines += ["- [" + plain(item["label"]) + "](" + quote(item["url"], safe=":/?&=#%.-_~") + ")" for item in data["references"]] or ["无。"]
    return ("\n".join(lines).rstrip() + "\n").encode("utf-8")


def no_duplicate_pairs(pairs):
    data = {}
    for key, value in pairs:
        require(key not in data, "JSON: duplicate object key")
        data[key] = value
    return data


def read_bytes(path, limit):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            require(stat.S_ISREG(info.st_mode), "archive/input: expected a regular file")
            require(info.st_size <= limit, "archive/input: file exceeds size limit")
            value = stream.read(limit + 1)
        require(len(value) <= limit, "archive/input: file exceeds size limit")
        return value
    except OSError as exc:
        raise InspectionError(f"archive/input: cannot safely read file ({exc.strerror})") from None


def read_json(path, limit=MAX_RECORD_BYTES):
    try:
        return json.loads(read_bytes(path, limit), object_pairs_hook=no_duplicate_pairs, parse_constant=lambda _: (_ for _ in ()).throw(InspectionError("JSON: non-finite number")))
    except (UnicodeError, ValueError, RecursionError) as exc:
        if isinstance(exc, InspectionError):
            raise
        raise InspectionError("archive/input: malformed JSON") from None


def root_path(value):
    raw = Path(value).expanduser()
    require(".." not in raw.parts, "root: parent traversal is not allowed")
    require(not raw.is_symlink(), "root: symbolic links are not allowed")
    return raw.resolve()


def safe_path(root, *parts):
    path = root.joinpath(*parts)
    require(path.is_relative_to(root), "archive: path escapes root")
    current = root
    for part in parts:
        require(part not in {"", ".", ".."} and "/" not in part and "\\" not in part, "archive: unsafe path component")
        current = current / part
        require(not current.is_symlink(), "archive: symbolic links are not allowed")
    return path


@contextmanager
def archive_lock(root, create=False):
    if create:
        root.mkdir(parents=True, exist_ok=True)
    require(root.is_dir() and not root.is_symlink(), "root: archive directory does not exist")
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        # Lock the directory itself, avoiding a persistent lock file in the archive.
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def ordered(summaries):
    return sorted(summaries, key=lambda item: (timestamp(item["startedAt"], "startedAt"), item["id"]), reverse=True)


def validate_index(data, day=None):
    exact_keys(data, {"schemaVersion", "updatedAt", "runs", "day" if day else "days"}, "index")
    require(type(data["schemaVersion"]) is int and data["schemaVersion"] == 1, "index.schemaVersion: expected 1")
    updated = timestamp(data["updatedAt"], "index.updatedAt")
    require(type(data["runs"]) is list, "index.runs: expected array")
    for row in data["runs"]:
        validate_summary(row)
        require(timestamp(row["updatedAt"], "updatedAt") <= updated, "index.updatedAt: older than included record")
    require(data["runs"] == ordered(data["runs"]) and len({row["id"] for row in data["runs"]}) == len(data["runs"]), "index.runs: must be unique and newest first")
    if day:
        require(len(data["runs"]) <= MAX_DAY_RUNS, "day index: exceeds 10000 runs")
        require(data["day"] == day and all(row["id"].startswith(day + "T") for row in data["runs"]), "index.day: date mismatch")
    else:
        require(len(data["runs"]) <= 50, "root index: more than 50 summaries")
        require(type(data["days"]) is list and len(data["days"]) <= MAX_DAYS and all(type(d) is str and DAY_RE.fullmatch(d) for d in data["days"]), "root index.days: invalid dates or exceeds 10000 days")
        require(data["days"] == sorted(set(data["days"]), reverse=True), "root index.days: must be unique and newest first")


def load_archive(root, edited_id=None):
    records, original_summaries, days = {}, {}, []
    for entry in sorted(root.iterdir()):
        require(not entry.is_symlink(), "archive: symbolic links are not allowed")
        if entry.name.startswith("."):
            continue
        if entry.name == "index.json":
            continue
        require(entry.is_dir() and DAY_RE.fullmatch(entry.name), "archive: unexpected root entry")
        day = entry.name
        try:
            datetime.strptime(day, "%Y-%m-%d")
        except ValueError:
            raise InspectionError("archive: invalid date directory") from None
        index = read_json(safe_path(root, day, "index.json"), MAX_DAY_INDEX_BYTES)
        validate_index(index, day)
        summaries = {row["id"]: row for row in index["runs"]}
        seen, md_ids = set(), set()
        for child in sorted(entry.iterdir()):
            require(not child.is_symlink(), "archive: symbolic links are not allowed")
            if child.name.startswith(".") or child.name == "index.json":
                continue
            require(child.is_file() and child.suffix in {".json", ".md"} and ID_RE.fullmatch(child.stem) and child.stem.startswith(day + "T"), "archive: unexpected day entry")
            if child.suffix == ".md":
                md_ids.add(child.stem)
                continue
            data = read_json(child)
            identifier = child.stem
            require(type(data) is dict and data.get("id") == identifier, "archive: record ID does not match filename")
            require(identifier in summaries, "archive: record missing from day index")
            if identifier != edited_id:
                validate_record(data)
                require(summarize(data) == summaries[identifier], "archive: day summary disagrees with record")
                require(read_bytes(child.with_suffix(".md"), MAX_MARKDOWN_BYTES) == render_markdown(data), "archive: Markdown disagrees with record")
            else:
                read_bytes(child.with_suffix(".md"), MAX_MARKDOWN_BYTES)
            records[identifier] = data
            original_summaries[identifier] = summaries[identifier]
            seen.add(identifier)
        require(seen == set(summaries) == md_ids, "archive: missing or orphan record/Markdown/summary")
        require(bool(seen), "archive: empty day directory")
        days.append(day)
    index_path = safe_path(root, "index.json")
    if records or index_path.exists():
        index = read_json(index_path, MAX_ROOT_INDEX_BYTES)
        validate_index(index)
        require(index["days"] == sorted(days, reverse=True), "archive: root day list is incomplete or inconsistent")
        require(index["runs"] == ordered(original_summaries.values())[:50], "archive: root summaries are inconsistent")
    return records, original_summaries


def atomic_batch(root, payloads):
    staged, replaced, previous, created_dirs = {}, [], {}, set()
    succeeded = False
    try:
        for path, content in payloads.items():
            require(path.is_relative_to(root) and not path.is_symlink(), "archive: unsafe destination")
            if not path.parent.exists():
                path.parent.mkdir()
                created_dirs.add(path.parent)
            require(not path.parent.is_symlink(), "archive: symbolic directory")
            previous[path] = read_bytes(path, MAX_DAY_INDEX_BYTES) if path.exists() else None
            fd, temp_name = tempfile.mkstemp(prefix=".inspection-", suffix=".tmp", dir=path.parent)
            staged[path] = Path(temp_name)
            with os.fdopen(fd, "wb") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(temp_name, 0o644)
        for path, temp in staged.items():
            os.replace(temp, path)
            replaced.append(path)
        for directory in {path.parent for path in payloads}:
            fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        succeeded = True
    except OSError as exc:
        # Roll back a synchronous error; abrupt power/process loss remains detectable by validate.
        for path in reversed(replaced):
            old = previous[path]
            if old is None:
                path.unlink(missing_ok=True)
            else:
                fd, temp_name = tempfile.mkstemp(prefix=".inspection-rollback-", dir=path.parent)
                with os.fdopen(fd, "wb") as stream:
                    stream.write(old)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.chmod(temp_name, 0o644)
                os.replace(temp_name, path)
        raise InspectionError(f"archive: write failed ({exc.strerror}); inspect archive before retry") from None
    finally:
        for temp in staged.values():
            temp.unlink(missing_ok=True)
        if not succeeded:
            for directory in created_dirs:
                if not any(directory.iterdir()):
                    directory.rmdir()


def persist(root, records, data):
    records = {**records, data["id"]: data}
    summaries = ordered([summarize(value) for value in records.values()])
    days = sorted({row["id"][:10] for row in summaries}, reverse=True)
    day = data["id"][:10]
    day_runs = [row for row in summaries if row["id"].startswith(day + "T")]
    require(len(days) <= MAX_DAYS, "archive: exceeds 10000 days; existing history was not truncated")
    require(len(day_runs) <= MAX_DAY_RUNS, "archive: exceeds 10000 runs in this day; existing history was not truncated")
    # Unchanged day indexes remain intact; root retains every date.
    stamp = max((row["updatedAt"] for row in summaries), key=lambda value: timestamp(value, "updatedAt"))
    json_path = safe_path(root, day, data["id"] + ".json")
    payloads = {
        json_path: encode_json(data),
        safe_path(root, day, data["id"] + ".md"): render_markdown(data),
        safe_path(root, day, "index.json"): encode_json({"schemaVersion": 1, "updatedAt": stamp, "day": day, "runs": day_runs}),
        safe_path(root, "index.json"): encode_json({"schemaVersion": 1, "updatedAt": stamp, "days": days, "runs": summaries[:50]}),
    }
    require(len(payloads[safe_path(root, "index.json")]) <= MAX_ROOT_INDEX_BYTES, "archive: root index exceeds 1 MiB; existing history was not truncated")
    require(len(payloads[safe_path(root, day, "index.json")]) <= MAX_DAY_INDEX_BYTES, "archive: day index exceeds 8 MiB; existing history was not truncated")
    atomic_batch(root, payloads)
    return json_path


def initialize(root, kind, title):
    enum(kind, KINDS, "kind")
    string(title, "title", 240, True)
    with archive_lock(root, create=True):
        records, _ = load_archive(root)
        started = now_utc()
        prefix = timestamp(started, "startedAt").strftime("%Y-%m-%dT%H-%M-%SZ")
        slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40].rstrip("-") or "run"
        identifier = prefix + "-" + slug + "-" + uuid.uuid4().hex[:12]
        require(identifier not in records, "id: collision; rerun init")
        data = {"schemaVersion": 1, "id": identifier, "kind": kind, "startedAt": started, "updatedAt": started, "completedAt": None, "status": "running", "title": title, "summary": "", "game": None, "findings": [], "tasks": [], "actions": [], "checks": [], "next": [], "references": []}
        validate_record(data)
        return persist(root, records, data)


def write_record(root, source):
    source = Path(source).expanduser()
    require(".." not in source.parts and not source.is_symlink(), "file: traversal and symbolic links are not allowed")
    source = source.absolute()
    with archive_lock(root):
        data = read_json(source)
        exact_keys(data, RECORD_KEYS, "record")
        # Check the supplied time's shape/order; actions and completion may be newly added.
        incoming_update = timestamp(data["updatedAt"], "updatedAt")
        require(timestamp(data["startedAt"], "startedAt") <= incoming_update, "updatedAt: precedes startedAt")
        current = now_utc()
        require(incoming_update <= timestamp(current, "now"), "updatedAt: cannot be in the future")
        data["updatedAt"] = current
        validate_record(data)
        canonical = safe_path(root, data["id"][:10], data["id"] + ".json")
        if source.is_relative_to(root):
            require(source == canonical, "file: managed path must match record ID and UTC day")
        direct_edit = source == canonical
        records, summaries = load_archive(root, data["id"] if direct_edit else None)
        require(data["id"] in records, "id: no initialized run; use init first")
        original = summaries[data["id"]]
        require(all(data[key] == original[key] for key in IDENTITY), "record: id, startedAt and kind are immutable")
        require(timestamp(original["updatedAt"], "updatedAt") <= incoming_update, "updatedAt: stale input; reload the latest record before editing")
        require(timestamp(original["updatedAt"], "updatedAt") <= timestamp(current, "now"), "archive: existing updatedAt is in the future")
        require(original["status"] == "running" or data["status"] != "running", "status: a terminal run cannot return to running")
        return persist(root, records, data)


def validate_archive(root):
    with archive_lock(root):
        records, _ = load_archive(root)
    return {"ok": True, "runs": len(records), "days": len({identifier[:10] for identifier in records})}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=str(DEFAULT_ROOT), help="archive directory (default: repository operations/inspections)")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("init", "write", "validate"):
        child = commands.add_parser(name)
        child.add_argument("--root", default=argparse.SUPPRESS, help="override archive directory")
        if name == "init":
            child.add_argument("--kind", required=True, choices=sorted(KINDS))
            child.add_argument("--title", required=True)
        elif name == "write":
            child.add_argument("--file", required=True, help="complete JSON, either staged copy or initialized record")
    args = parser.parse_args(argv)
    try:
        root = root_path(args.root)
        if args.command == "init":
            print(initialize(root, args.kind, args.title))
        elif args.command == "write":
            print(write_record(root, args.file))
        else:
            print(json.dumps(validate_archive(root), ensure_ascii=False))
        return 0
    except (InspectionError, OSError, RecursionError) as exc:
        message = str(exc) if isinstance(exc, InspectionError) else "filesystem or nesting error; inspect local input/archive"
        print("inspection_log: " + message, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
