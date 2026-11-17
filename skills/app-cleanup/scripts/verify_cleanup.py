#!/usr/bin/env python3
"""Read-only, standard-library cleanup verification. Python 3.9+.

Exit 0: every assertion passes. Exit 1: a definite assertion fails.
Exit 2: invalid input, capture error, or an unverifiable assertion (takes precedence).
No subprocesses, deletion, credential access, network, or platform-specific APIs.
"""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
from datetime import datetime, timezone


VERSION = 1
KINDS = {"absent", "moved", "preserved", "json", "sqlite", "sqlite_integrity", "native"}


def canonical(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key: " + key)
        result[key] = value
    return result


def load_json(path):
    with open(path, "r", encoding="utf-8") as source:
        return json.load(source, object_pairs_hook=no_duplicates,
                         parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Nonfinite JSON: " + value)))


def absolute(value):
    if not isinstance(value, str) or not value or not Path(value).is_absolute():
        raise ValueError("An explicit absolute local path is required")
    return value


def validate_manifest(manifest):
    if not isinstance(manifest, dict) or set(manifest) != {"version", "scope", "checks"}:
        raise ValueError("Manifest requires exactly version, scope and checks")
    if type(manifest["version"]) is not int or manifest["version"] != VERSION:
        raise ValueError("Unsupported manifest version")
    if not isinstance(manifest["scope"], str) or not manifest["scope"].strip():
        raise ValueError("scope must describe the confirmed category and observation boundary")
    checks = manifest["checks"]
    if not isinstance(checks, list) or not checks:
        raise ValueError("At least one check is required; zero coverage cannot pass")
    ids = set()
    for check in checks:
        if not isinstance(check, dict):
            raise ValueError("Each check must be an object")
        cid, kind = check.get("id"), check.get("kind")
        if not isinstance(cid, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", cid) or cid in ids:
            raise ValueError("Each check needs a unique, stable id")
        ids.add(cid)
        if kind not in KINDS:
            raise ValueError("Unknown check kind: " + str(kind))
        allowed = {"id", "kind", "path"}
        if kind in {"moved", "preserved"}:
            allowed.add("permissions")
            if "permissions" in check and type(check["permissions"]) is not bool:
                raise ValueError("permissions must be boolean")
        if kind == "moved":
            allowed.add("destination")
            if "destination" in check:
                absolute(check["destination"])
        if kind == "json":
            allowed |= {"selector", "rule", "expected"}
            selector = check.get("selector")
            if not isinstance(selector, list) or any(type(x) not in (str, int) or (type(x) is int and x < 0) for x in selector):
                raise ValueError("JSON selector is a list of literal keys or nonnegative array indexes")
            if check.get("rule") not in {"absent", "unchanged", "equals"}:
                raise ValueError("Invalid JSON rule")
            if (check["rule"] == "equals") != ("expected" in check):
                raise ValueError("JSON equals requires expected; other rules must not provide it")
        if kind == "sqlite":
            allowed |= {"query", "params", "rule", "expected_rows", "ordered", "allow_empty"}
            if not isinstance(check.get("query"), str) or not re.match(r"^\s*(SELECT|WITH)\b", check["query"], re.I):
                raise ValueError("SQLite checks require a SELECT or read-only WITH query")
            params = check.get("params", [])
            if not isinstance(params, list) or any(type(x) not in (str, int, float, bool, type(None)) for x in params):
                raise ValueError("SQLite params must be a JSON array of scalar values")
            if check.get("rule") not in {"unchanged", "equals"}:
                raise ValueError("Invalid SQLite rule")
            if (check["rule"] == "equals") != ("expected_rows" in check):
                raise ValueError("SQLite equals requires expected_rows; unchanged must not provide it")
            if "expected_rows" in check and (not isinstance(check["expected_rows"], list)
                    or any(not isinstance(row, list) for row in check["expected_rows"])):
                raise ValueError("expected_rows must be a list of row arrays")
            for key in ["ordered", "allow_empty"]:
                if key in check and type(check[key]) is not bool:
                    raise ValueError(key + " must be boolean")
        if kind == "native":
            allowed = {"id", "kind", "reason"}
            if not isinstance(check.get("reason"), str) or not check["reason"].strip():
                raise ValueError("Native check needs the missing checker or access requirement")
        else:
            absolute(check.get("path"))
        if set(check) - allowed:
            raise ValueError("Unknown options for check " + cid + ": " + ", ".join(sorted(set(check) - allowed)))
    canonical(manifest)
    return manifest


def identity(st):
    return (st.st_dev, st.st_ino, st.st_mode, st.st_size, st.st_mtime_ns, st.st_ctime_ns)


def absent_stat(path):
    try:
        return os.lstat(path)
    except FileNotFoundError:
        # A dangling final link is found by lstat; a missing ancestor means path absence.
        return None


def read_regular(path):
    before = os.lstat(path)
    if not stat.S_ISREG(before.st_mode):
        raise ValueError("A regular file is required (symlinks are not followed)")
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    with os.fdopen(os.open(path, flags), "rb") as source:
        if identity(os.fstat(source.fileno())) != identity(before):
            raise RuntimeError("File changed before reading")
        data = source.read()
        if identity(os.fstat(source.fileno())) != identity(before):
            raise RuntimeError("File changed while reading")
    if identity(os.lstat(path)) != identity(before):
        raise RuntimeError("File was replaced while reading")
    return data


def path_snapshot(path, permissions=False):
    if absent_stat(path) is None:
        return {"exists": False}
    records = []
    counts = {"files": 0, "directories": 0, "symlinks": 0, "bytes": 0}

    def visit(item, relative):
        before = os.lstat(item)
        mode = before.st_mode
        entry = {"relative": relative}
        if permissions:
            entry["permissions"] = stat.S_IMODE(mode)
        if stat.S_ISLNK(mode):
            entry.update(type="symlink", target=os.readlink(item))
            counts["symlinks"] += 1
        elif stat.S_ISDIR(mode):
            entry["type"] = "directory"
            counts["directories"] += 1
            records.append(entry)
            names = sorted(os.listdir(item))
            for name in names:
                visit(os.path.join(item, name), relative + "/" + name if relative else name)
            if names != sorted(os.listdir(item)):
                raise RuntimeError("Directory membership changed during capture")
        elif stat.S_ISREG(mode):
            hasher = hashlib.sha256()
            flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
            with os.fdopen(os.open(item, flags), "rb") as source:
                if identity(os.fstat(source.fileno())) != identity(before):
                    raise RuntimeError("File changed before hashing")
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    hasher.update(block)
                if identity(os.fstat(source.fileno())) != identity(before):
                    raise RuntimeError("File changed during hashing")
            entry.update(type="file", bytes=before.st_size, sha256=hasher.hexdigest())
            counts["files"] += 1
            counts["bytes"] += before.st_size
        else:
            raise ValueError("Special filesystem objects require a native checker")
        if identity(os.lstat(item)) != identity(before):
            raise RuntimeError("Filesystem object changed during capture")
        if not stat.S_ISDIR(mode):
            records.append(entry)

    visit(path, "")
    return {"exists": True, "content_sha256": digest(records), **counts}


def typed(value):
    if value is None:
        return ["null"]
    if isinstance(value, bytes):
        return ["blob", value.hex()]
    if type(value) is bool:
        return ["boolean", value]
    if type(value) is int:
        return ["integer", str(value)]
    if type(value) is float and math.isfinite(value):
        return ["real", value.hex()]
    if type(value) is str:
        return ["text", value]
    raise ValueError("Unsupported or nonfinite SQL value")


def rows_fingerprint(rows, ordered=False):
    encoded = [canonical([typed(value) for value in row]) for row in rows]
    if not ordered:
        encoded.sort()
    return {"row_count": len(rows), "rows_sha256": digest(encoded)}


def sql_authorizer(action, arg1, arg2, database, trigger):
    allowed = {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_FUNCTION}
    if hasattr(sqlite3, "SQLITE_RECURSIVE"):
        allowed.add(sqlite3.SQLITE_RECURSIVE)
    if action == sqlite3.SQLITE_FUNCTION and str(arg2).lower() == "load_extension":
        return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK if action in allowed and database in (None, "main") else sqlite3.SQLITE_DENY


def integrity_authorizer(action, arg1, arg2, database, trigger):
    if action == sqlite3.SQLITE_PRAGMA and arg1 in {"quick_check", "foreign_key_check"} and arg2 is None:
        return sqlite3.SQLITE_OK
    return sql_authorizer(action, arg1, arg2, database, trigger)


def observation_error(error):
    # Keep scope/errors, not sensitive query results or file content.
    return {"error_type": type(error).__name__, "error": str(error)}


def observe(checks, destinations=None, after=False):
    result, databases, json_cache = {}, {}, {}
    destinations = destinations or {}
    try:
        for check in checks:
            cid, kind = check["id"], check["kind"]
            try:
                if kind == "native":
                    raise NotImplementedError(check["reason"])
                path = check["path"]
                if kind == "absent":
                    result[cid] = {"exists": absent_stat(path) is not None}
                elif kind == "moved" and after:
                    destination = destinations.get(cid, check.get("destination"))
                    if destination is None:
                        raise ValueError("Actual destination is required; do not guess a Trash path")
                    absolute(destination)
                    if Path(path).resolve() == Path(destination).resolve():
                        raise ValueError("Source and destination cannot be the same")
                    result[cid] = {"source_exists": absent_stat(path) is not None,
                                   "destination": destination,
                                   "payload": path_snapshot(destination, check.get("permissions", False))}
                elif kind in {"preserved", "moved"}:
                    result[cid] = path_snapshot(path, check.get("permissions", False))
                elif kind == "json":
                    if path not in json_cache:
                        json_cache[path] = json.loads(read_regular(path).decode("utf-8"), object_pairs_hook=no_duplicates,
                                                      parse_constant=lambda x: (_ for _ in ()).throw(ValueError("Nonfinite JSON")))
                    value, exists = json_cache[path], True
                    for segment in check["selector"]:
                        if isinstance(value, dict) and type(segment) is str:
                            if segment not in value:
                                exists = False
                                break
                            value = value[segment]
                        elif isinstance(value, list) and type(segment) is int:
                            if segment >= len(value):
                                exists = False
                                break
                            value = value[segment]
                        else:
                            raise ValueError("Selector container type mismatch; this is not proof of absence")
                    result[cid] = {"exists": exists}
                    if exists:
                        result[cid]["value_sha256"] = digest(value)
                elif kind in {"sqlite", "sqlite_integrity"}:
                    if path not in databases:
                        if not stat.S_ISREG(os.lstat(path).st_mode):
                            raise ValueError("SQLite source must be an existing regular file")
                        connection = sqlite3.connect(Path(path).as_uri() + "?mode=ro", uri=True)
                        connection.execute("PRAGMA query_only=ON")
                        connection.execute("BEGIN")
                        databases[path] = connection
                    connection = databases[path]
                    if kind == "sqlite_integrity":
                        connection.set_authorizer(integrity_authorizer)
                        quick = connection.execute("PRAGMA quick_check").fetchall()
                        foreign_keys = connection.execute("PRAGMA foreign_key_check").fetchall()
                        result[cid] = {"quick_check_ok": quick == [("ok",)], "foreign_key_violation_count": len(foreign_keys)}
                    else:
                        connection.set_authorizer(sql_authorizer)
                        cursor = connection.execute(check["query"], check.get("params", []))
                        if cursor.description is None:
                            raise ValueError("A query must return a rowset")
                        result[cid] = rows_fingerprint(cursor.fetchall(), check.get("ordered", False))
            except (OSError, ValueError, RuntimeError, sqlite3.Error, NotImplementedError, RecursionError) as error:
                result[cid] = observation_error(error)
    finally:
        for connection in databases.values():
            connection.close()
    return result


def verdict(check, before, after):
    for phase, data in [("before", before), ("after", after)]:
        if not isinstance(data, dict) or "error" in data:
            return "unverifiable", phase + " observation unavailable"
    kind = check["kind"]
    if kind == "absent":
        return ("fail", "source still exists") if after["exists"] else (
            "pass", "absent after cleanup" if before["exists"] else "already absent before; no deletion proven")
    if kind == "moved":
        if not before.get("exists"):
            return "unverifiable", "source was absent before; no payload baseline"
        if after["source_exists"]:
            return "fail", "move source still exists"
        if not after["payload"].get("exists"):
            return "fail", "move destination is absent"
        return ("pass", "source absent and destination payload matches") if before == after["payload"] else (
            "fail", "destination payload differs from the original")
    if kind == "preserved":
        if not before.get("exists"):
            return "unverifiable", "protected source absent before; preservation not demonstrated"
        return ("pass", "protected payload unchanged") if before == after else ("fail", "protected payload changed")
    if kind == "json":
        rule = check["rule"]
        if rule == "absent":
            return ("fail", "JSON selection still exists") if after["exists"] else ("pass", "JSON selection absent")
        if rule == "unchanged":
            if not before["exists"]:
                return "unverifiable", "protected JSON selection absent before"
            return ("pass", "JSON selection unchanged") if before == after else ("fail", "JSON selection changed")
        return ("pass", "JSON value matches expected") if after.get("exists") and after.get("value_sha256") == digest(check["expected"]) else (
            "fail", "JSON value differs from expected")
    if kind == "sqlite":
        if check["rule"] == "unchanged":
            if not before["row_count"] and not check.get("allow_empty", False):
                return "unverifiable", "zero-row preservation baseline; explicit allow_empty required if meaningful"
            return ("pass", "SQL rowset unchanged") if before == after else ("fail", "SQL rowset changed")
        expected = rows_fingerprint(check["expected_rows"], check.get("ordered", False))
        return ("pass", "SQL rowset matches expected") if after == expected else ("fail", "SQL rowset differs from expected")
    if kind == "sqlite_integrity":
        return ("pass", "SQLite quick_check and foreign_key_check passed") if after == {
            "quick_check_ok": True, "foreign_key_violation_count": 0} else ("fail", "SQLite structural or foreign-key check failed")
    return "unverifiable", "native checker required"


def protect_output(output, manifest, destinations=None):
    absolute(str(output))
    if os.path.lexists(output):
        raise ValueError("Output exists; refuse overwrite and inspect previous execution")
    resolved = Path(output).resolve()
    protected = [c["path"] for c in manifest["checks"] if "path" in c]
    for check in manifest["checks"]:
        if check["kind"] in {"sqlite", "sqlite_integrity"}:
            protected.extend(check["path"] + suffix for suffix in ["-wal", "-shm", "-journal"])
    protected += [c["destination"] for c in manifest["checks"] if "destination" in c]
    protected += list((destinations or {}).values())
    for source in protected:
        parent = Path(source).resolve()
        if resolved == parent or parent in resolved.parents:
            raise ValueError("Output must be outside all observed source/destination paths")


def write_new(output, data):
    with open(output, "x", encoding="utf-8") as destination:
        destination.write(json.dumps(data, ensure_ascii=True, indent=2, allow_nan=False) + "\n")


def run(args):
    if args.command == "capture":
        manifest = validate_manifest(load_json(args.manifest))
        protect_output(args.output, manifest)
        observations = observe(manifest["checks"])
        unavailable = [key for key, value in observations.items() if "error" in value]
        report = {"format": "app-cleanup-baseline", "version": VERSION, "captured_at": datetime.now(timezone.utc).isoformat(),
                  "manifest": manifest, "manifest_sha256": digest(manifest), "observations": observations,
                  "status": "unverifiable" if unavailable else "captured", "unverifiable_ids": unavailable}
        write_new(args.output, report)
        return report, 2 if unavailable else 0
    baseline = load_json(args.baseline)
    if not isinstance(baseline, dict) or baseline.get("format") != "app-cleanup-baseline" or baseline.get("version") != VERSION:
        raise ValueError("Not a supported baseline")
    manifest = validate_manifest(baseline["manifest"])
    if baseline.get("manifest_sha256") != digest(manifest):
        raise ValueError("Manifest changed after capture")
    checks = manifest["checks"]
    if set(baseline.get("observations", {})) != {c["id"] for c in checks}:
        raise ValueError("Baseline check coverage mismatch")
    destinations = load_json(args.destinations) if args.destinations else {}
    if not isinstance(destinations, dict) or set(destinations) - {c["id"] for c in checks if c["kind"] == "moved"}:
        raise ValueError("Destination map may only contain declared moved-check ids")
    for path in destinations.values():
        absolute(path)
    protect_output(args.output, manifest, destinations)
    observed = observe(checks, destinations, after=True)
    results = []
    for check in checks:
        previous, current = baseline["observations"][check["id"]], observed[check["id"]]
        status, reason = verdict(check, previous, current)
        results.append({"id": check["id"], "kind": check["kind"], "status": status, "reason": reason,
                        "before": previous, "after": current})
    statuses = {result["status"] for result in results}
    status = "unverifiable" if "unverifiable" in statuses else ("fail" if "fail" in statuses else "pass")
    report = {"format": "app-cleanup-verification", "version": VERSION, "scope": manifest["scope"],
              "verified_at": datetime.now(timezone.utc).isoformat(), "manifest_sha256": digest(manifest),
              "status": status, "counts": {s: sum(r["status"] == s for r in results) for s in ["pass", "fail", "unverifiable"]},
              "checks": results,
              "boundary": "Only declared assertions at their observation times; no assertion about secure erasure, native Trash recovery, cloud state or undeclared coverage."}
    write_new(args.output, report)
    return report, {"pass": 0, "fail": 1, "unverifiable": 2}[status]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    capture = sub.add_parser("capture", help="Capture evidence before an approved category is changed")
    capture.add_argument("--manifest", required=True)
    capture.add_argument("--output", required=True)
    verify = sub.add_parser("verify", help="Verify every declared check against its baseline")
    verify.add_argument("--baseline", required=True)
    verify.add_argument("--destinations", help="JSON map of moved-check id to actual native API destination")
    verify.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        report, code = run(args)
        print(json.dumps({"status": report["status"], "output": args.output,
                          "counts": report.get("counts"), "unverifiable_ids": report.get("unverifiable_ids")}, ensure_ascii=True))
        return code
    except (OSError, ValueError, TypeError, KeyError, sqlite3.Error, RuntimeError) as error:
        print(json.dumps({"status": "error", **observation_error(error)}, ensure_ascii=True))
        return 2


if __name__ == "__main__":
    sys.exit(main())
