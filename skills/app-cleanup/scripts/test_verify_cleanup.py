#!/usr/bin/env python3
"""Behavioral tests using only disposable local fixtures, never real app data."""

import argparse
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

import verify_cleanup as verifier


class CleanupVerifierTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="app-cleanup-verifier-")
        self.root = Path(self.temp.name).resolve()
        self.addCleanup(self.temp.cleanup)
        self.serial = 0

    def file(self, name, data=b"original\x00content"):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def json_file(self, name, value):
        return self.file(name, json.dumps(value, ensure_ascii=False).encode())

    def baseline(self, checks):
        self.serial += 1
        manifest = self.json_file("manifest-%s.json" % self.serial, {
            "version": 1, "scope": "isolated, user-approved test category", "checks": checks})
        output = self.root / ("before-%s.json" % self.serial)
        report, code = verifier.run(argparse.Namespace(command="capture", manifest=str(manifest), output=str(output)))
        return output, report, code

    def verify(self, baseline, destinations=None):
        self.serial += 1
        mapping = self.json_file("destinations-%s.json" % self.serial, destinations) if destinations is not None else None
        return verifier.run(argparse.Namespace(command="verify", baseline=str(baseline),
                                              destinations=str(mapping) if mapping else None,
                                              output=str(self.root / ("after-%s.json" % self.serial))))

    def database(self):
        path = self.root / "mixed.db"
        with sqlite3.connect(path) as db:
            db.executescript("CREATE TABLE provider(id INTEGER PRIMARY KEY, app TEXT, value BLOB);"
                             "INSERT INTO provider VALUES(1,'target',X'0001');"
                             "INSERT INTO provider VALUES(2,'keep',X'0203');"
                             "INSERT INTO provider VALUES(3,'keep',NULL);")
        return path

    def test_end_to_end_cleanup_and_preservation(self):
        deleted = self.file("remove")
        payload = self.root / "payload"
        self.file("payload/子目录/文件.txt", b"payload")
        self.file("payload/.hidden", b"hidden")
        (payload / "empty").mkdir()
        kept = self.file("bookmarks.json", b'{"bookmark":"keep"}')
        config = self.json_file("settings.json", {"target": None, "keep": {"enabled": True}})
        database = self.database()
        checks = [
            {"id": "gone", "kind": "absent", "path": str(deleted)},
            {"id": "move", "kind": "moved", "path": str(payload)},
            {"id": "keep", "kind": "preserved", "path": str(kept)},
            {"id": "origin", "kind": "json", "path": str(config), "selector": ["target"], "rule": "absent"},
            {"id": "other", "kind": "json", "path": str(config), "selector": ["keep"], "rule": "unchanged"},
            {"id": "rows", "kind": "sqlite", "path": str(database), "query": "SELECT COUNT(*) FROM provider WHERE app=?", "params": ["target"], "rule": "equals", "expected_rows": [[0]]},
            {"id": "other-rows", "kind": "sqlite", "path": str(database), "query": "SELECT * FROM provider WHERE app=?", "params": ["keep"], "rule": "unchanged"},
            {"id": "integrity", "kind": "sqlite_integrity", "path": str(database)},
        ]
        baseline, _, code = self.baseline(checks)
        self.assertEqual(code, 0)
        deleted.unlink()
        destination = self.root / "trash" / "renamed"
        destination.parent.mkdir()
        payload.rename(destination)
        config.write_text('{"keep":{"enabled":true}}', encoding="utf-8")
        with sqlite3.connect(database) as db:
            db.execute("DELETE FROM provider WHERE app=?", ("target",))
        report, code = self.verify(baseline, {"move": str(destination)})
        self.assertEqual(code, 0, report)
        self.assertEqual(report["counts"], {"pass": 8, "fail": 0, "unverifiable": 0})
        self.assertTrue(destination.is_dir())
        self.assertEqual(kept.read_bytes(), b'{"bookmark":"keep"}')

    def test_file_content_change_fails_even_same_length(self):
        path = self.file("protected", b"AB")
        baseline, _, _ = self.baseline([{"id": "keep", "kind": "preserved", "path": str(path)}])
        path.write_bytes(b"CD")
        self.assertEqual(self.verify(baseline)[1], 1)

    def test_directory_membership_including_empty_directory_is_verified(self):
        self.file("protected/nested/keep")
        directory = self.root / "protected"
        baseline, _, _ = self.baseline([{"id": "keep", "kind": "preserved", "path": str(directory)}])
        (directory / "new-empty-dir").mkdir()
        self.assertEqual(self.verify(baseline)[1], 1)

    def test_move_requires_matching_payload_and_source_absence(self):
        for scenario in ["source-remains", "wrong-payload", "missing-destination"]:
            with self.subTest(scenario=scenario):
                source = self.file(scenario, b"original")
                target = self.root / (scenario + "-destination")
                baseline, _, _ = self.baseline([{"id": "move", "kind": "moved", "path": str(source)}])
                target.write_bytes(b"original" if scenario == "source-remains" else b"different")
                if scenario != "source-remains":
                    source.unlink()
                if scenario == "missing-destination":
                    target.unlink()
                self.assertEqual(self.verify(baseline, {"move": str(target)})[1], 1)

    def test_missing_move_destination_is_unverifiable(self):
        path = self.file("move")
        baseline, _, _ = self.baseline([{"id": "m", "kind": "moved", "path": str(path)}])
        self.assertEqual(self.verify(baseline)[1], 2)

    def test_absent_baseline_is_not_claimed_as_a_new_deletion(self):
        baseline, _, _ = self.baseline([{"id": "gone", "kind": "absent", "path": str(self.root / "missing")}])
        report, code = self.verify(baseline)
        self.assertEqual(code, 0)
        self.assertIn("no deletion proven", report["checks"][0]["reason"])

    def test_missing_protected_baseline_does_not_pass(self):
        baseline, _, _ = self.baseline([{"id": "keep", "kind": "preserved", "path": str(self.root / "missing")}])
        self.assertEqual(self.verify(baseline)[1], 2)

    def test_permission_error_is_not_treated_as_absence(self):
        check = {"id": "no-access", "kind": "absent", "path": str(self.root / "restricted")}
        with mock.patch.object(verifier.os, "lstat", side_effect=PermissionError("denied")):
            observation = verifier.observe([check])["no-access"]
        self.assertEqual(observation["error_type"], "PermissionError")
        self.assertEqual(verifier.verdict(check, {"exists": True}, observation)[0], "unverifiable")

    def test_dangling_symlink_is_present_and_symlink_targets_are_not_followed(self):
        link = self.root / "link"
        try:
            link.symlink_to(self.root / "missing")
        except (OSError, NotImplementedError):
            self.skipTest("Native symlink creation unavailable")
        baseline, _, _ = self.baseline([{"id": "link", "kind": "absent", "path": str(link)}])
        self.assertEqual(self.verify(baseline)[1], 1)
        baseline, _, _ = self.baseline([{"id": "link", "kind": "preserved", "path": str(link)}])
        (self.root / "missing").write_bytes(b"not part of the declared link payload")
        self.assertEqual(self.verify(baseline)[1], 0)

    def test_json_null_not_absence_and_literal_dot_keys(self):
        path = self.json_file("config.json", {"site.example": None, "unrelated": [1, 2]})
        baseline, _, _ = self.baseline([{"id": "origin", "kind": "json", "path": str(path),
                                         "selector": ["site.example"], "rule": "absent"}])
        self.assertEqual(self.verify(baseline)[1], 1)
        path.write_text('{"unrelated":[1,2]}', encoding="utf-8")
        self.assertEqual(self.verify(baseline)[1], 0)

    def test_json_container_type_change_is_not_proof_of_absence(self):
        path = self.json_file("config.json", {"site": {"target": True}})
        baseline, _, _ = self.baseline([{"id": "origin", "kind": "json", "path": str(path),
                                         "selector": ["site", "target"], "rule": "absent"}])
        path.write_text('{"site":null}', encoding="utf-8")
        self.assertEqual(self.verify(baseline)[1], 2)

    def test_json_duplicate_keys_and_nonfinite_numbers_are_rejected(self):
        for raw in [b'{"x":1,"x":2}', b'{"x":NaN}']:
            with self.subTest(raw=raw):
                path = self.file("invalid.json", raw)
                _, report, code = self.baseline([{"id": "j", "kind": "json", "path": str(path), "selector": ["x"], "rule": "unchanged"}])
                self.assertEqual(code, 2)
                self.assertEqual(report["unverifiable_ids"], ["j"])

    def test_json_equals_is_type_sensitive(self):
        path = self.json_file("typed.json", {"x": True})
        baseline, _, _ = self.baseline([{"id": "j", "kind": "json", "path": str(path), "selector": ["x"], "rule": "equals", "expected": 1}])
        self.assertEqual(self.verify(baseline)[1], 1)

    def test_sql_missing_database_is_not_created(self):
        path = self.root / "missing.db"
        _, _, code = self.baseline([{"id": "sql", "kind": "sqlite", "path": str(path), "query": "SELECT 1", "rule": "equals", "expected_rows": [[1]]}])
        self.assertEqual(code, 2)
        self.assertFalse(path.exists())

    def test_sql_row_preservation_detects_value_change_not_just_count(self):
        path = self.database()
        baseline, _, _ = self.baseline([{"id": "keep", "kind": "sqlite", "path": str(path), "query": "SELECT * FROM provider WHERE app=?", "params": ["keep"], "rule": "unchanged"}])
        with sqlite3.connect(path) as db:
            db.execute("UPDATE provider SET value=X'0405' WHERE id=2")
        self.assertEqual(self.verify(baseline)[1], 1)

    def test_sql_unordered_duplicates_and_types_remain_distinguishable(self):
        fingerprint = verifier.rows_fingerprint
        self.assertEqual(fingerprint([(1, b"x"), (2, None)]), fingerprint([(2, None), (1, b"x")]))
        self.assertNotEqual(fingerprint([(1,), (1,)]), fingerprint([(1,)]))
        self.assertNotEqual(fingerprint([(1,)]), fingerprint([(1.0,)]))
        self.assertNotEqual(fingerprint([(b"1",)]), fingerprint([("1",)]))
        self.assertNotEqual(fingerprint([(1,), (2,)], True), fingerprint([(2,), (1,)], True))

    def test_sql_empty_preservation_requires_explicit_intent(self):
        path = self.database()
        check = {"id": "empty", "kind": "sqlite", "path": str(path), "query": "SELECT * FROM provider WHERE 0", "rule": "unchanged"}
        baseline, _, _ = self.baseline([check])
        self.assertEqual(self.verify(baseline)[1], 2)
        check["allow_empty"] = True
        baseline, _, _ = self.baseline([check])
        self.assertEqual(self.verify(baseline)[1], 0)

    def test_sql_parameter_binding_does_not_execute_sql(self):
        path = self.database()
        check = {"id": "count", "kind": "sqlite", "path": str(path), "query": "SELECT count(*) FROM provider WHERE app=?", "params": ["x'; DELETE FROM provider; --"], "rule": "equals", "expected_rows": [[0]]}
        baseline, _, _ = self.baseline([check])
        self.assertEqual(self.verify(baseline)[1], 0)
        with sqlite3.connect(path) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM provider").fetchone(), (3,))

    def test_sql_authorizer_rejects_writes_attachment_and_extension_loading(self):
        path = self.database()
        with sqlite3.connect(path) as db:
            db.set_authorizer(verifier.sql_authorizer)
            for statement in ["DELETE FROM provider", "ATTACH DATABASE ':memory:' AS other", "SELECT load_extension('nonexistent')", "PRAGMA user_version=5"]:
                with self.subTest(statement=statement), self.assertRaises(sqlite3.DatabaseError):
                    db.execute(statement)
            self.assertEqual(db.execute("WITH x AS (SELECT 1) SELECT * FROM x").fetchall(), [(1,)])
        with sqlite3.connect(path) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM provider").fetchone(), (3,))

    def test_sql_integrity_detects_foreign_key_violation(self):
        path = self.root / "broken.db"
        with sqlite3.connect(path) as db:
            db.executescript("CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(parent_id INTEGER REFERENCES parent(id)); INSERT INTO child VALUES(99);")
        baseline, _, code = self.baseline([{"id": "db", "kind": "sqlite_integrity", "path": str(path)}])
        self.assertEqual(code, 0)
        report, code = self.verify(baseline)
        self.assertEqual(code, 1)
        self.assertEqual(report["checks"][0]["after"]["foreign_key_violation_count"], 1)

    def test_native_unverifiable_takes_precedence_without_hiding_failure(self):
        path = self.file("still-present")
        checks = [{"id": "gone", "kind": "absent", "path": str(path)},
                  {"id": "native", "kind": "native", "reason": "Native credential store query unavailable"}]
        baseline, _, code = self.baseline(checks)
        self.assertEqual(code, 2)
        report, code = self.verify(baseline)
        self.assertEqual(code, 2)
        self.assertEqual(report["counts"], {"pass": 0, "fail": 1, "unverifiable": 1})

    def test_no_raw_sql_rows_or_file_content_in_reports(self):
        secret = "PRIVATE_TEST_SENTINEL"
        path = self.database()
        with sqlite3.connect(path) as db:
            db.execute("UPDATE provider SET app=? WHERE id=2", (secret,))
        baseline, report, _ = self.baseline([{"id": "db", "kind": "sqlite", "path": str(path), "query": "SELECT * FROM provider", "rule": "unchanged"}])
        self.assertNotIn(secret, json.dumps(report))
        self.assertNotIn(secret, json.dumps(self.verify(baseline)[0]))

    def test_invalid_manifest_cases_are_rejected(self):
        good = {"id": "one", "kind": "absent", "path": str(self.root / "path")}
        cases = [[], [good, good], [{**good, "path": "relative"}], [{**good, "kind": "unsupported"}], [{**good, "optional": True}], [{**good, "kind": "json", "selector": [-1], "rule": "absent"}]]
        for checks in cases:
            with self.subTest(checks=checks), self.assertRaises(ValueError):
                verifier.validate_manifest({"version": 1, "scope": "test", "checks": checks})

    def test_output_cannot_overwrite_or_live_inside_observed_directory(self):
        source = self.root / "observed"
        source.mkdir()
        manifest = {"version": 1, "scope": "test", "checks": [{"id": "keep", "kind": "preserved", "path": str(source)}]}
        with self.assertRaises(ValueError):
            verifier.protect_output(source / "report.json", manifest)
        occupied = self.file("occupied.json", b"unchanged")
        with self.assertRaises(ValueError):
            verifier.protect_output(occupied, manifest)
        self.assertEqual(occupied.read_bytes(), b"unchanged")

    def test_manifest_or_coverage_change_is_rejected(self):
        baseline, data, _ = self.baseline([{"id": "one", "kind": "absent", "path": str(self.root / "missing")}])
        data["manifest"]["scope"] = "changed"
        baseline.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaises(ValueError):
            self.verify(baseline)
        data["manifest_sha256"] = verifier.digest(data["manifest"])
        data["observations"] = {}
        baseline.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaises(ValueError):
            self.verify(baseline)

    def test_output_cannot_be_a_sqlite_sidecar(self):
        database = self.database()
        manifest = {"version": 1, "scope": "test", "checks": [{"id": "sql", "kind": "sqlite_integrity", "path": str(database)}]}
        for suffix in ["-wal", "-shm", "-journal"]:
            with self.subTest(suffix=suffix), self.assertRaises(ValueError):
                verifier.protect_output(Path(str(database) + suffix), manifest)
    def test_cli_returns_structured_failure_and_no_cleanup(self):
        source = self.file("still-exists")
        baseline, _, _ = self.baseline([{"id": "gone", "kind": "absent", "path": str(source)}])
        result = subprocess.run([sys.executable, "-I", str(Path(verifier.__file__).resolve()), "verify", "--baseline", str(baseline), "--output", str(self.root / "cli-after.json")], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(json.loads(result.stdout)["status"], "fail")
        self.assertTrue(source.exists())

    def test_cli_rejects_nonobject_baseline_with_structured_error(self):
        baseline = self.json_file("malformed-baseline.json", [])
        result = subprocess.run([sys.executable, "-I", str(Path(verifier.__file__).resolve()), "verify", "--baseline", str(baseline), "--output", str(self.root / "invalid-after.json")], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(json.loads(result.stdout)["status"], "error")
        self.assertFalse((self.root / "invalid-after.json").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
