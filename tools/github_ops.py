#!/usr/bin/env python3
"""Issue records for the fixed repository; worker coordination stays with Codex."""
import argparse
import datetime
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
REPO = "AdamZmy/Automated-Screeps"
BASE = "repos/" + REPO
STATES = ("planned", "ready", "in-progress", "verifying", "blocked", "done")
CHECKPOINT = "<!-- screeps-work-checkpoint:v1 -->"


def api(endpoint, method="GET", payload=None, pages=False):
    command = ["gh", "api", endpoint, "--method", method]
    if pages:
        command += ["--paginate", "--slurp"]
    if payload is not None:
        command += ["--input", "-"]
    result = subprocess.run(command, input=json.dumps(payload) if payload is not None else None,
                            text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "GitHub request failed; read back before retrying a write")
    value = json.loads(result.stdout) if result.stdout.strip() else None
    return [item for page in value for item in page] if pages else value


def plan():
    value = json.loads((ROOT / "operations/roadmap.json").read_text())
    if value["repository"] != REPO:
        raise ValueError("Unexpected repository")
    keys = [item["key"] for item in value["issues"]]
    if len(set(keys)) != len(keys):
        raise ValueError("Duplicate roadmap key")
    if any(item["status"] not in STATES[:-1] for item in value["issues"]):
        raise ValueError("Roadmap seeds must be open work; close completed Issues with a checkpoint")
    return value


def marker(key):
    return "<!-- screeps-work-item:" + key + " -->"


def all_issues():
    return [item for item in api(BASE + "/issues?state=all&per_page=100", pages=True)
            if "pull_request" not in item]


def match(items, key):
    hits = [item for item in items if marker(key) in (item.get("body") or "")]
    if len(hits) > 1:
        raise ValueError("Duplicate Issue markers for " + key + "; reconcile before writing")
    return hits[0] if hits else None


def sync(apply=False):
    data = plan()
    issues = all_issues()
    labels = {item["name"] for item in api(BASE + "/labels?per_page=100", pages=True)}
    milestones = {item["title"]: item["number"] for item in
                  api(BASE + "/milestones?state=all&per_page=100", pages=True)}
    # Validate duplicates before any mutation.
    for item in data["issues"]:
        match(issues, item["key"])
    desired = {"status:" + state: "8250df" for state in STATES}
    desired.update({"area:" + item["area"]: "0969da" for item in data["issues"]})
    desired.update({"priority:p1": "d73a4a", "priority:p2": "fbca04", "priority:p3": "c5def5"})
    changes = []
    for name, color in desired.items():
        if name not in labels:
            changes.append({"createLabel": name})
            if apply:
                api(BASE + "/labels", "POST", {"name": name, "color": color})
    for item in data["milestones"]:
        if item["title"] not in milestones:
            changes.append({"createMilestone": item["title"]})
            if apply:
                created = api(BASE + "/milestones", "POST", item)
                milestones[item["title"]] = created["number"]
    for item in data["issues"]:
        existing = match(issues, item["key"])
        if existing:
            changes.append({"preserved": item["key"], "number": existing["number"]})
            continue
        changes.append({"createIssue": item["key"], "title": item["title"]})
        if apply:
            created = api(BASE + "/issues", "POST", {
                "title": item["title"],
                "body": marker(item["key"]) + "\n\n" + item["body"],
                "labels": ["status:" + item["status"], "area:" + item["area"], "priority:" + item["priority"]],
                "milestone": milestones[item["milestone"]],
            })
            issues.append(created)
            changes[-1].update(number=created["number"], url=created["html_url"])
    return {"applied": apply, "changes": changes}


def latest_checkpoint(number):
    comments = api(BASE + "/issues/" + str(number) + "/comments?per_page=100", pages=True)
    for comment in reversed(comments):
        body = comment.get("body") or ""
        if not body.startswith(CHECKPOINT + "\n\n```json\n"):
            continue
        try:
            value = json.loads(body.split("```json\n", 1)[1].split("\n```", 1)[0])
            if isinstance(value, dict) and value.get("status") in STATES:
                return value
        except (ValueError, IndexError):
            pass
    return None


def listing():
    items = all_issues()
    known = {item["key"] for item in plan()["issues"]}
    result = []
    for item in items:
        key = next((key for key in known if marker(key) in (item.get("body") or "")), None)
        statuses = [label["name"][7:] for label in item["labels"] if label["name"].startswith("status:")]
        # Include unseeded incidents as well; a roadmap is not the whole backlog.
        entry = {"key": key, "number": item["number"], "title": item["title"],
                 "url": item["html_url"], "state": item["state"], "statuses": statuses,
                 "labels": [label["name"] for label in item["labels"]],
                 "updatedAt": item["updated_at"]}
        if item["state"] == "open" and any(s in statuses for s in ("in-progress", "verifying", "blocked", "ready")):
            entry["checkpoint"] = latest_checkpoint(item["number"])
        if len(statuses) != 1:
            entry["needsReconciliation"] = "Expected exactly one status label"
        result.append(entry)
    return result


def checkpoint(args):
    key, number = getattr(args, "key", None), getattr(args, "number", None)
    if (key is None) == (number is None):
        raise ValueError("Select exactly one Issue with --key or --number")
    if key is not None:
        if key not in {item["key"] for item in plan()["issues"]}:
            raise ValueError("Unknown stable key; add a scoped work item to roadmap.json first")
        item = match(all_issues(), key)
        if not item:
            raise ValueError("Issue missing; sync first")
    else:
        if type(number) is not int or number < 1:
            raise ValueError("Issue number must be a positive integer")
        item = api(BASE + "/issues/" + str(number))
        # Issue endpoints can also return PRs or redirect transferred Issues.
        # A direct number must still belong to this fixed repository.
        expected_repository = "https://api.github.com/" + BASE
        if (not isinstance(item, dict) or item.get("number") != number
                or str(item.get("repository_url", "")).casefold() != expected_repository.casefold()):
            raise ValueError("Issue number did not resolve in " + REPO)
        if "pull_request" in item:
            raise ValueError("Pull Requests cannot receive Issue checkpoints")
    if not args.next.strip() or not args.evidence.strip():
        raise ValueError("Next checkpoint and actual evidence are required")
    for name in args.files:
        path = Path(name)
        if path.is_absolute() or ".." in path.parts:
            raise ValueError("File ownership must use repository-relative paths")
    value = {"key": key, "status": args.status, "ownerKind": args.owner_kind,
             "owner": args.owner, "files": args.files, "next": args.next, "evidence": args.evidence}
    previous = latest_checkpoint(item["number"])
    previous_comparable = {k: v for k, v in (previous or {}).items() if k != "at"}
    if value != previous_comparable:
        value["at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        body = CHECKPOINT + "\n\n```json\n" + json.dumps(value, ensure_ascii=False, indent=2) + "\n```"
        api(BASE + "/issues/" + str(item["number"]) + "/comments", "POST", {"body": body})
    names = [label["name"] for label in item["labels"] if not label["name"].startswith("status:")]
    names.append("status:" + args.status)
    state = "closed" if args.status == "done" else "open"
    patch = {"labels": names, "state": state}
    if state == "closed":
        patch["state_reason"] = "completed"
    if set(names) != {label["name"] for label in item["labels"]} or state != item["state"]:
        api(BASE + "/issues/" + str(item["number"]), "PATCH", patch)
    return {"number": item["number"], "url": item["html_url"], "status": args.status}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    sync_command = commands.add_parser("sync")
    sync_command.add_argument("--apply", action="store_true")
    commands.add_parser("list")
    write = commands.add_parser("checkpoint")
    target = write.add_mutually_exclusive_group(required=True)
    target.add_argument("--key", help="Stable key from operations/roadmap.json")
    target.add_argument("--number", type=int, help="Existing Issue number in " + REPO)
    write.add_argument("--status", choices=STATES, required=True)
    write.add_argument("--owner-kind", choices=("root", "agent", "thread"), required=True)
    write.add_argument("--owner", required=True)
    write.add_argument("--files", nargs="*", default=[])
    write.add_argument("--next", required=True)
    write.add_argument("--evidence", required=True)
    args = parser.parse_args()
    try:
        value = sync(args.apply) if args.command == "sync" else listing() if args.command == "list" else checkpoint(args)
        print(json.dumps(value, ensure_ascii=False, indent=2))
    except (RuntimeError, ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
