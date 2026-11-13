#!/usr/bin/env python3
"""Run a Freya feature's tests in Freya-Docs-TA, then write its run report and builder handoff report.

Python 3.9+ standard library only. pytest runs with the Freya-Docs-TA interpreter (.venv/bin/python when present).

  feature_test.py [FEATURE] [--env dev|qa|dso] [options]

FEATURE is a feature folder name, its id, or its slug. Without it, the feature comes from .specify/feature.json, then
from the branch name. Run with --help for every option.
"""
import argparse
import collections
import datetime
import glob
import json
import os
import re
import shlex
import subprocess
import sys

FULL_ID = re.compile(r"\bTC-[A-Z0-9]+-\d+-(?:MAN|API|UI|JMTR|SEC)-(?:HP|NEG|EDGE|BND|ERR)\b")
SHORT_GROUP = re.compile(r"\bTC-([A-Z0-9]+)-(\d+)((?:\s*(?:/|\.\.|–)\s*\d+)*)")
HEADING = re.compile(r"^#{2,5}\s+(TC-[A-Z0-9]+-\d+(?:-[A-Z]+-[A-Z]+)?)\b\s*(.*)$")
PRIORITY_LINE = re.compile(r"\*\*Priority:\*\*\s*(P[0-3])\b")
ENV_DOTENV = {"dev": "dev", "qa": "qa", "dso": None}
# Below this pass rate (pass ÷ cases with a result) the developer gives a reason in handoff-notes.md.
# An experience value for now; set it from real feature runs once there are some.
MIN_PASS_RATE = 80


def fail(msg, code=2):
    print(f"feature_test: {msg}", file=sys.stderr)
    sys.exit(code)


def git(repo, *args):
    try:
        return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, check=True).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


# ---------------------------------------------------------------- locate repos and the feature


def find_up(start, test):
    d = os.path.abspath(start)
    while True:
        if test(d):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def is_spec(d):
    return os.path.isdir(os.path.join(d, "test-spec")) and os.path.isdir(os.path.join(d, "functional-spec"))


def is_ta(d):
    return os.path.isfile(os.path.join(d, "pytest.ini")) and os.path.isdir(os.path.join(d, "testcase_api"))


def locate_repos(args):
    spec = args.spec_dir or os.environ.get("FREYA_SPEC_DIR")
    ta = args.ta_dir or os.environ.get("FREYA_TA_DIR")
    if not ta:
        ta = find_up(os.getcwd(), is_ta)
    if not spec:
        spec = find_up(os.getcwd(), is_spec) or (find_up(ta, is_spec) if ta else None)
    if spec and not ta:
        cand = os.path.join(spec, "projects", "Freya-Docs-TA")
        ta = cand if is_ta(cand) else None
    if not spec or not is_spec(spec):
        fail("cannot find Freya-Docs-Spec. Run from inside it, or pass --spec-dir / set FREYA_SPEC_DIR.")
    if not ta or not is_ta(ta):
        fail("cannot find Freya-Docs-TA. Clone it to <spec>/projects/Freya-Docs-TA, or pass --ta-dir / set FREYA_TA_DIR.")
    return os.path.abspath(spec), os.path.abspath(ta)


def candidates(spec):
    """Every folder that holds a test spec, as (feature name, test-spec dir)."""
    out = []
    for pattern in ("specs/*/test-spec", "test-spec/*", "openspec/changes/*/test-spec"):
        for d in sorted(glob.glob(os.path.join(spec, pattern))):
            if not os.path.isdir(d) or os.path.basename(d) == "templates":
                continue
            name = os.path.basename(os.path.dirname(d)) if d.endswith("/test-spec") else os.path.basename(d)
            out.append((name, d))
    return out


def match_feature(spec, wanted):
    wanted = wanted.strip().rstrip("/")
    if os.path.isdir(wanted):
        d = os.path.abspath(wanted)
        d = os.path.join(d, "test-spec") if os.path.isdir(os.path.join(d, "test-spec")) else d
        name = os.path.basename(os.path.dirname(d)) if d.endswith("/test-spec") else os.path.basename(d)
        return name, d
    key = os.path.basename(wanted).replace("feature/", "")
    cands = candidates(spec)
    for test in (lambda n: n == key, lambda n: n.split("-", 1)[0] == key,
                 lambda n: n.endswith("-" + key) or n.startswith(key + "-")):
        hits = [c for c in cands if test(c[0])]
        if len(hits) == 1:
            return hits[0]
        if len(hits) > 1:
            # Spec Kit features win over promoted copies of the same name.
            live = [h for h in hits if "/specs/" in h[1]]
            if len(live) == 1:
                return live[0]
            fail(f"'{wanted}' matches several test specs: " + ", ".join(os.path.relpath(h[1], spec) for h in hits))
    return None


def resolve_feature(spec, ta, wanted):
    if wanted:
        hit = match_feature(spec, wanted)
        if not hit:
            fail(f"no test spec found for '{wanted}' under specs/*/test-spec, test-spec/*, or openspec/changes/*/test-spec.")
        return hit + (f"argument '{wanted}'",)
    fj = os.path.join(spec, ".specify", "feature.json")
    if os.path.isfile(fj):
        try:
            fd = json.load(open(fj)).get("feature_directory", "")
        except ValueError:
            fd = ""
        hit = fd and match_feature(spec, os.path.basename(fd))
        if hit:
            return hit + (".specify/feature.json",)
    for repo in (spec, ta):
        branch = git(repo, "rev-parse", "--abbrev-ref", "HEAD")
        m = re.match(r"^(?:feature|bugfix|hotfix)/(.+)$", branch)
        hit = m and match_feature(spec, m.group(1))
        if hit:
            return hit + (f"branch {branch} of {os.path.basename(repo)}",)
    fail("cannot tell which feature to test. Pass the feature id or folder name.")


# ---------------------------------------------------------------- test spec and test files


def read_cases(spec_dir):
    """TC blocks of a test spec, in file order: id, title, priority, file."""
    cases, seen = [], set()
    for path in sorted(glob.glob(os.path.join(spec_dir, "**", "*.md"), recursive=True)):
        lines = open(path, encoding="utf-8").read().splitlines()
        current = None
        for line in lines:
            m = HEADING.match(line)
            if m:
                tc_id, rest = m.group(1), m.group(2).lstrip("—–:- ").strip()
                parts = [p.strip() for p in rest.split("·")]
                prio = next((m2.group(1) for p in parts[1:] for m2 in [re.match(r"(P[0-3])\b", p)] if m2), "")
                current = None
                if tc_id not in seen:
                    seen.add(tc_id)
                    current = {"id": tc_id, "title": parts[0], "priority": prio,
                               "file": os.path.relpath(path, spec_dir)}
                    cases.append(current)
                continue
            if line.startswith("#"):
                current = None
            elif current is not None and not current["priority"]:
                p = PRIORITY_LINE.search(line)
                if p:
                    current["priority"] = p.group(1)
    return cases


def base_id(tc_id):
    return "-".join(tc_id.split("-")[:3])


def ids_in(text, base_map):
    """Full TC IDs named in text. Short IDs (TC-CAP-NNN, TC-CAP-012/014, TC-CAP-108..111) map to every full ID of that base."""
    found = FULL_ID.findall(text)
    rest = FULL_ID.sub(" ", text)
    short = []
    for cap, first, tail in SHORT_GROUP.findall(rest):
        width, prev = len(first), int(first)
        nums = [prev]
        for sep, num in re.findall(r"(/|\.\.|–)\s*(\d+)", tail):
            n = int(num)
            nums += list(range(prev + 1, n + 1)) if sep in ("..", "–") else [n]
            prev = n
        short += [f"TC-{cap}-{i:0{width}d}" for i in nums]
    out = list(found)
    for s in short:
        out += base_map.get(s, [s])
    return list(dict.fromkeys(out)), len(short)


def find_test_files(ta, cases, base_map):
    bases = set(base_map)
    files = []
    for root in ("testcase_api", "testcase"):
        for path in sorted(glob.glob(os.path.join(ta, root, "**", "test_*.py"), recursive=True)):
            text = open(path, encoding="utf-8", errors="replace").read()
            ids, _ = ids_in(text, base_map)
            if any(i in base_map.get(base_id(i), []) or base_id(i) in bases for i in ids):
                files.append(os.path.relpath(path, ta))
    return files


def serial_markers(ta):
    names, inside = [], False
    for line in open(os.path.join(ta, "pytest.ini"), encoding="utf-8", errors="replace"):
        if re.match(r"^\s*markers\s*=", line):
            inside = True
            continue
        if inside:
            if line.strip() and not line[0].isspace():
                break
            m = re.match(r"^\s+([A-Za-z0-9_]+)\s*:", line)
            if m and "serial" in m.group(1):
                names.append(m.group(1))
    return names


# ---------------------------------------------------------------- run pytest


def ta_python(ta):
    venv = os.path.join(ta, ".venv", "bin", "python")
    return venv if os.path.exists(venv) else "python3"


def run_pytest(ta, py, files, env, results, marker, workers, extra, clean, log):
    cmd = [py, "-m", "pytest", *files, "-p", "no:cacheprovider", f"--alluredir={results}"]
    if clean:
        cmd.append("--clean-alluredir")
    if marker:
        cmd += ["-m", marker]
    if workers > 0:
        cmd += ["-n", str(workers), "--dist=loadfile"]
    cmd += extra
    run_env = dict(os.environ)
    if ENV_DOTENV[env]:
        run_env["FREYA_DOTENV"] = ENV_DOTENV[env]
    else:
        run_env.pop("FREYA_DOTENV", None)
    shown = (f"FREYA_DOTENV={ENV_DOTENV[env]} " if ENV_DOTENV[env] else "") + " ".join(
        shlex.quote(c) for c in [os.path.relpath(py, ta) if py.startswith(ta) else py] + cmd[1:])
    print(f"$ {shown}", flush=True)
    with open(log, "a", encoding="utf-8") as fh:
        fh.write(f"$ {shown}\n")
        fh.flush()
        proc = subprocess.Popen(cmd, cwd=ta, env=run_env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        tail = collections.deque(maxlen=15)
        for line in proc.stdout:
            fh.write(line)
            tail.append(line)
            if re.search(r"(PASSED|FAILED|ERROR|SKIPPED|passed|failed|error)", line) and "INFO" not in line:
                sys.stdout.write(line)
        proc.wait()
    return proc.returncode, shown, "".join(tail)


# ---------------------------------------------------------------- reports


def outcome(status):
    return {"passed": "pass", "failed": "fail", "broken": "fail", "skipped": "skipped"}.get(status, "fail")


def first_line(msg, n=200):
    line = (msg or "").strip().splitlines()[0] if (msg or "").strip() else ""
    return (line[:n] + "…") if len(line) > n else line


def md(text):
    return (text or "").replace("|", "\\|").replace("\n", " ")


def load_results(results_dir, base_map):
    latest = {}
    for path in glob.glob(os.path.join(results_dir, "*-result.json")):
        r = json.load(open(path, encoding="utf-8"))
        key = r.get("historyId") or r.get("fullName") or path
        if key not in latest or r.get("stop", 0) > latest[key].get("stop", 0):
            latest[key] = r
    tests, short_count = [], 0
    for r in latest.values():
        full = r.get("fullName", "")
        mod, _, func = full.partition("#")
        loc = mod.replace(".", "/") + ".py" if mod else full
        loc = re.sub(r"/(Test[A-Za-z0-9_]*)\.py$", r".py::\1", loc)
        ids, n_short = ids_in(r.get("name", ""), base_map)
        short_count += 1 if n_short else 0
        tests.append({"name": r.get("name", ""), "outcome": outcome(r.get("status")), "loc": f"{loc}::{func}" if func else loc,
                      "file": loc.split("::")[0], "msg": first_line((r.get("statusDetails") or {}).get("message", "")),
                      "ids": ids, "start": r.get("start"), "stop": r.get("stop")})
    return tests, short_count


def skip_reason(msg):
    """pytest skip message without its own "Skipped:" prefix."""
    return re.sub(r"^Skipped:\s*", "", msg or "") or "no reason given"


def case_results(cases, tests):
    by_tc = collections.defaultdict(list)
    for t in tests:
        for i in t["ids"]:
            by_tc[i].append(t)
    res = {}
    for c in cases:
        runs = by_tc.get(c["id"], [])
        outs = {t["outcome"] for t in runs}
        if "fail" in outs:
            res[c["id"]] = ("fail", runs, "")
        elif outs == {"pass"}:
            res[c["id"]] = ("pass", runs, "")
        elif not runs:
            res[c["id"]] = (None, runs, "No test found for this case" if not c.get("_has_test") else "Not run (left out of this run)")
        else:
            skipped = [t for t in runs if t["outcome"] == "skipped"]
            res[c["id"]] = (None, runs, f"⚠️ Skipped: {skip_reason(skipped[0]['msg'])}")
    return res, by_tc


def stamp(ms):
    return datetime.datetime.fromtimestamp(ms / 1000).strftime("%Y-%m-%d %H:%M:%S") if ms else ""


MARK = {"pass": "✅ pass", "fail": "❌ fail"}
NOTE_COLUMNS = (("result", "Result"), ("tested_on", "Tested on"), ("bug", "Bug / OQ"), ("class", "Class"),
                ("reason", "Reason"), ("setup", "Setup QA needs"))
CLASSES = {"product", "spec", "test"}
REASONS = {"TENANT-CONFIG", "MULTI-TENANT", "NON-DETERMINISTIC", "ENV-ONLY", "SEC", "PERF", "EXPLORATORY"}
NOTES_HEADER = "| TC | " + " | ".join(label for _, label in NOTE_COLUMNS) + " |"
NOTES_RULE = "|---" * (len(NOTE_COLUMNS) + 1) + "|"
NOTES_BULLETS = [
    "- **Result**, for a case the developer tested by hand: `pass` or `fail`. It moves the case to \"Tested by dev\".",
    "- **Tested on**, with a Result: the environment and date, for example `DEV 2026-11-06`.",
    "- **Bug / OQ**: `Bug #123456` for a failure, or `OQ-…` when the failure is a spec gap.",
    "- **Class**, for a failure: `product`, `spec`, or `test`.",
    "- **Reason**, for a case handed to QA: " + ", ".join(f"`{r}`" for r in sorted(REASONS)) + ".",
    "- **Setup QA needs**, for a case handed to QA: the data, access, or help QA needs to run it.",
    "- **Low pass rate reason**, when the pass rate is below the threshold: why, for example the open bugs behind "
    "the failures.",
]
RATE_LINE = "**Pass rate**:"
REASON_LINE = "**Low pass rate reason**:"
NOTES_INTRO_OLD = ("The script adds a row for each new case that did not pass and any missing column; it never changes "
                   "a value that is here.")
NOTES_INTRO = ("The script adds a row for each new case that did not pass and any missing column, and rewrites the "
               "Pass rate line; it never changes a value that people wrote.")


def split_row(line):
    return [c.strip().replace("\\|", "|") for c in re.split(r"(?<!\\)\|", line.strip().strip("|"))]


def _notes_table(lines):
    """(header index, field keys in column order) of the notes table, or (None, None)."""
    by_label = {label.lower(): key for key, label in NOTE_COLUMNS}
    for n, line in enumerate(lines):
        if line.startswith("| TC |"):
            return n, [by_label.get(cell.lower()) for cell in split_row(line)[1:]]
    return None, None


def read_notes(path):
    """TC -> {result, tested_on, bug, class, reason, setup} from handoff-notes.md, by column name. Missing file: {}."""
    notes = {}
    if not os.path.isfile(path):
        return notes
    lines = open(path, encoding="utf-8").read().splitlines()
    head, keys = _notes_table(lines)
    if head is None:
        return notes
    for line in lines[head + 1:]:
        if line.startswith("| TC-"):
            cells = split_row(line)
            row = {key: "" for key, _ in NOTE_COLUMNS}
            row.update({k: v for k, v in zip(keys, cells[1:]) if k})
            notes[cells[0]] = row
    return notes


def _notes_row(tc, values):
    return "| " + " | ".join([tc] + [values.get(key, "").replace("|", "\\|") for key, _ in NOTE_COLUMNS]) + " |"


def update_notes(path, feature, ids):
    """Add a row for each id not yet in handoff-notes.md, and any missing column. Values that are there never change."""
    if not os.path.isfile(path):
        lines = [f"# Handoff notes — {feature}", "",
                 "Written by people, read by `freya-feature-test` every time it rebuilds `builder-handoff.md`. "
                 + NOTES_INTRO, ""] + NOTES_BULLETS + ["", "Rules: `test-spec/builder-testing-guide.md` in Freya-Docs-Spec.",
                 "", NOTES_HEADER, NOTES_RULE] + [_notes_row(i, {}) for i in ids]
        open(path, "w", encoding="utf-8").write("\n".join(lines) + "\n")
        return len(ids)
    lines = open(path, encoding="utf-8").read().splitlines()
    have = read_notes(path)
    new = [i for i in ids if i not in have]
    head, keys = _notes_table(lines)
    if head is None:
        lines += ["", NOTES_HEADER, NOTES_RULE]
        head, keys = len(lines) - 2, [key for key, _ in NOTE_COLUMNS]
    changed = bool(new)
    if keys != [key for key, _ in NOTE_COLUMNS]:
        # An older layout: rewrite the table in today's column order, every value kept by its column name
        lines[head], lines[head + 1] = NOTES_HEADER, NOTES_RULE
        for n in range(head + 2, len(lines)):
            if lines[n].startswith("| TC-"):
                lines[n] = _notes_row(split_row(lines[n])[0], have.get(split_row(lines[n])[0], {}))
        lines = [l.replace("The script adds a row for each new case that did not pass, and never changes a row "
                           "that is here.", "The script adds a row for each new case that did not pass and any "
                           "missing column; it never changes a value that is here.") for l in lines]
        for bullet in reversed(NOTES_BULLETS[:2]):
            first = next((n for n, l in enumerate(lines) if l.startswith("- **")), None)
            if first is not None and not any(l.startswith(bullet[:14]) for l in lines):
                lines.insert(first, bullet)
                head += 1
        changed = True
    if new:
        last = max(n for n, l in enumerate(lines) if l.startswith("|") and n >= head)
        lines[last + 1:last + 1] = [_notes_row(i, {}) for i in new]
    if changed:
        open(path, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    return len(new)


def set_pass_rate(path, rate_text):
    """Rewrite the Pass rate line of handoff-notes.md, adding it and an empty reason line above the table if missing.
    Returns the Low pass rate reason people wrote."""
    lines = open(path, encoding="utf-8").read().splitlines()
    before = list(lines)
    lines = [l.replace(NOTES_INTRO_OLD, NOTES_INTRO) for l in lines]
    if not any(l.startswith("- **Low pass rate reason**") for l in lines):
        last = max((n for n, l in enumerate(lines) if l.startswith("- **")), default=None)
        if last is not None:
            lines.insert(last + 1, NOTES_BULLETS[-1])
    rate = f"{RATE_LINE} {rate_text}"
    at = next((n for n, l in enumerate(lines) if l.startswith(RATE_LINE)), None)
    if at is None:
        head, _ = _notes_table(lines)
        head = len(lines) if head is None else head
        lines[head:head] = [rate, "", f"{REASON_LINE} ", ""]
    else:
        lines[at] = rate
        if not any(l.startswith(REASON_LINE) for l in lines):
            lines[at + 1:at + 1] = ["", f"{REASON_LINE} "]
    if lines != before:
        open(path, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    return next((l[len(REASON_LINE):].strip() for l in lines if l.startswith(REASON_LINE)), "")


def write_reports(meta, cases, tests, short_count, out_dir, all_bases, new_run=True):
    res, by_tc = case_results(cases, tests)
    os.makedirs(out_dir, exist_ok=True)
    notes_path = os.path.join(out_dir, "handoff-notes.md")
    added = update_notes(notes_path, meta["feature"], [c["id"] for c in cases if res[c["id"]][0] != "pass"])
    notes = read_notes(notes_path)
    note = lambda tc, field: notes.get(tc, {}).get(field, "")
    prio = {c["id"]: c["priority"] for c in cases}

    unknown = sorted({i for t in tests for i in t["ids"] if base_id(i) not in all_bases})
    fails = sorted((t for t in tests if t["outcome"] == "fail"), key=lambda t: t["loc"])
    skips = sorted((t for t in tests if t["outcome"] == "skipped"), key=lambda t: t["loc"])
    t_count = collections.Counter(t["outcome"] for t in tests)
    ran = [c for c in cases if by_tc.get(c["id"])]
    c_count = collections.Counter(res[c["id"]][0] or "skipped" for c in ran)
    starts = [t["start"] for t in tests if t["start"]]
    stops = [t["stop"] for t in tests if t["stop"]]

    # One run report per environment, overwritten by every run; git keeps the history of committed versions.
    # A rebuild (--report-only) leaves it alone unless there is none yet.
    run_name = f"run-{meta['env']}.md"
    if not os.path.exists(os.path.join(out_dir, run_name)):
        new_run = True

    def first_note(ids, field):
        return next((note(i, field) for i in ids if note(i, field)), "")

    r = [f"# Run report — {meta['feature']}, {meta['env'].upper()}, {meta['date']}", "",
         "| | |", "|---|---|",
         f"| Environment | {meta['env'].upper()} |",
         f"| Test spec | `{meta['spec_rel']}` @ `{meta['spec_commit']}` |",
         f"| Tests | `Freya-Docs-TA` `{meta['ta_branch']}` @ `{meta['ta_commit']}` |",
         f"| Started / ended | {stamp(min(starts)) if starts else ''} / {stamp(max(stops)) if stops else ''} |",
         f"| Command | `{md(meta['command'])}` |",
         f"| Left out | {md(meta['left_out']) or 'Nothing'} |", "",
         "## Totals", "",
         "| Counted by | Total | ✅ pass | ❌ fail | ⚠️ skipped |", "|---|---|---|---|---|",
         f"| pytest test | {len(tests)} | {t_count['pass']} | {t_count['fail']} | {t_count['skipped']} |",
         f"| Test case (TC ID) | {len(ran)} | {c_count['pass']} | {c_count['fail']} | {c_count['skipped']} |", ""]
    no_id = sum(1 for t in tests if not t["ids"])
    if no_id:
        r += [f"{no_id} pytest tests name no TC ID in their title.", ""]
    if short_count:
        r += [f"{short_count} pytest tests name a short TC ID (for example `TC-DTYP-012`). "
              "Rename them to the full ID from the test spec.", ""]
    r += ["## Failures", "",
          "Class and Bug / OQ come from `handoff-notes.md` as it was when this report was written. `?` = not classified yet.", ""]
    if fails:
        r += ["| Test | TC | Message | Class | Bug / OQ |", "|---|---|---|---|---|"]
        r += [f"| `{md(t['loc'])}` | {', '.join(t['ids']) or '—'} | {md(t['msg'])} | "
              f"{md(first_note(t['ids'], 'class')) or '?'} | {md(first_note(t['ids'], 'bug'))} |" for t in fails]
    else:
        r.append("None.")
    r += ["", "## Skipped", ""]
    if skips:
        r += ["| Test | TC | Reason |", "|---|---|---|"]
        r += [f"| `{md(t['loc'])}` | {', '.join(t['ids']) or '—'} | ⚠️ Skipped: {md(skip_reason(t['msg']))} |" for t in skips]
    else:
        r.append("None.")
    if unknown:
        r += ["", "## TC IDs in no test spec", "",
              "Tests name these IDs, but no test spec in Freya-Docs-Spec has such a case. "
              "Add the case to the test spec or fix the title.", "",
              ", ".join(unknown)]
    if new_run:
        open(os.path.join(out_dir, run_name), "w", encoding="utf-8").write("\n".join(r) + "\n")

    # Results a developer recorded by hand in the notes join the automated ones; a fail from either wins.
    # The run report above stays automated-only: it records this run.
    manual = {c["id"]: note(c["id"], "result").lower() for c in cases if note(c["id"], "result").lower() in MARK}
    for tc, by_hand in manual.items():
        auto, runs, hint = res[tc]
        res[tc] = ("fail" if "fail" in (auto, by_hand) else "pass", runs, hint)
    no_date = [tc for tc in manual if not note(tc, "tested_on")]

    tested = [c for c in cases if res[c["id"]][0]]
    failed = [c for c in tested if res[c["id"]][0] == "fail"]
    left = [c for c in cases if not res[c["id"]][0]]
    skipped = [c for c in left if by_tc.get(c["id"])]  # a test ran but skipped, so no pass or fail
    no_bug = [c for c in failed if not note(c["id"], "bug")]
    no_reason = [c for c in left if note(c["id"], "reason") not in REASONS]
    passed, min_rate = len(tested) - len(failed), meta["min_pass_rate"]
    rate = round(100 * passed / len(tested)) if tested else None
    low = bool(tested) and passed * 100 < min_rate * len(tested)
    if rate is None:
        rate_text = f"no case has a result yet. Threshold {min_rate}%."
    else:
        rate_text = (f"{'❌' if low else '✅'} {rate}% — {passed} of {len(tested)} cases with a result passed. Threshold {min_rate}%"
                     + (": below it, so give a Low pass rate reason." if low else "."))
    rate_reason = set_pass_rate(notes_path, rate_text)
    rate_cell = f"{rate}%" if rate is not None else "—"
    h = [f"# Builder handoff — {meta['feature']}", "",
         "<!-- Generated by freya-feature-test. Do not edit: write manual results, bug links, failure classes, and QA "
         "reasons in handoff-notes.md, then rebuild with --report-only. -->", "",
         "| | |", "|---|---|",
         f"| Work item | {meta['work_item']} |",
         f"| Test spec | `{meta['spec_rel']}` @ `{meta['spec_commit']}` |"]
    h += [f"| Code | {line} |" for line in meta["code"]] or ["| Code | <repo> `<branch>` @ <commit> |"]
    h += [f"| Tests | `Freya-Docs-TA` `{meta['ta_branch']}` @ `{meta['ta_commit']}` |",
          f"| Environment | {meta['env'].upper()} |",
          f"| Last run | `{run_name}` |", "",
          "## Summary", "",
          "| ✅ pass | ❌ fail | ⚠️ skipped | Pass rate |", "|---|---|---|---|",
          f"| {passed} | {len(failed)} | {len(skipped)} | {rate_cell} |", "",
          f"{len(cases)} test cases in the test spec. The {len(left)} without a pass or fail, the skipped ones "
          "included, are in \"Handed to QA\". Pass rate = pass ÷ (pass + fail).", ""]
    if low and rate_reason:
        h += [f"Pass rate below {min_rate}%: {md(rate_reason)}", ""]
    gaps = [f"{what}: {n}" for n, what in ((len(no_bug), "failures without a bug or OQ"),
                                            (len(no_reason), "cases handed to QA without a reason code"),
                                            (len(no_date), "manual results without Tested on")) if n]
    if low and not rate_reason:
        gaps.append(f"pass rate below {min_rate}% without a reason")
    if gaps:
        h += [f"Not ready for QA — {'; '.join(gaps)}. Fill them in `handoff-notes.md`.", ""]
    h += ["## Tested by dev", ""]
    if tested:
        h += ["| TC | Priority | Test | Result | Bug / OQ |", "|---|---|---|---|---|"]
        for c in tested:
            result, runs, _ = res[c["id"]]
            how = [f"`{f}`" for f in sorted({t["file"] for t in runs})]
            if c["id"] in manual:
                how.append(f"by hand, {md(note(c['id'], 'tested_on')) or 'no date'}")
            h.append(f"| {c['id']} | {c['priority']} | {', '.join(how)} | {MARK[result]} | "
                     f"{md(note(c['id'], 'bug'))} |")
    else:
        h.append("None.")
    h += ["", "## Handed to QA", ""]
    if left:
        h += ["| TC | Priority | Reason | Setup QA needs |", "|---|---|---|---|"]
        h += [f"| {c['id']} | {c['priority']} | {md(note(c['id'], 'reason')) or '?'} | "
              f"{md(note(c['id'], 'setup') or res[c['id']][2])} |" for c in left]
    else:
        h.append("None.")
    issues = collections.OrderedDict()
    oqs = collections.OrderedDict()
    for c in failed + left:
        bug = note(c["id"], "bug")
        if bug:
            (oqs if bug.upper().startswith("OQ") else issues).setdefault(bug, []).append(c["id"])
    h += ["", "## Known product issues", ""]
    if issues:
        h += ["| Bug | TC | First failure |", "|---|---|---|"]
        for bug, ids in issues.items():
            msg = next((t["msg"] for i in ids for t in by_tc.get(i, []) if t["outcome"] == "fail"),
                       "by hand" if any(manual.get(i) == "fail" for i in ids) else "")
            h.append(f"| {md(bug)} | {', '.join(ids)} | {md(msg)} |")
    else:
        h.append("None.")
    h += ["", "## Open questions", ""]
    if oqs:
        h += ["| OQ | TC |", "|---|---|"]
        h += [f"| {md(oq)} | {', '.join(ids)} |" for oq, ids in oqs.items()]
    else:
        h.append("None.")
    open(os.path.join(out_dir, "builder-handoff.md"), "w", encoding="utf-8").write("\n".join(h) + "\n")
    return run_name, {"tests": dict(t_count), "cases": len(cases), "pass": passed,
                      "fail": len(failed), "skipped": len(skipped), "pass_rate": rate, "min_pass_rate": min_rate,
                      "low_pass_rate_without_reason": low and not rate_reason,
                      "manual": len(manual), "handed_to_qa": len(left), "notes_rows_added": added,
                      "fail_without_bug": len(no_bug), "handed_without_reason": len(no_reason),
                      "unknown_ids": len(unknown)}


# ---------------------------------------------------------------- main


def main():
    ap = argparse.ArgumentParser(description="Run a Freya feature's tests in Freya-Docs-TA and write its reports.")
    ap.add_argument("feature", nargs="?", help="feature folder name, id, slug, or test-spec path")
    ap.add_argument("--env", default="dev", choices=sorted(ENV_DOTENV), help="target environment (default: dev)")
    ap.add_argument("--spec-dir", help="Freya-Docs-Spec checkout (default: found from the working directory; env FREYA_SPEC_DIR)")
    ap.add_argument("--ta-dir", help="Freya-Docs-TA checkout (default: <spec>/projects/Freya-Docs-TA; env FREYA_TA_DIR)")
    ap.add_argument("--tests", nargs="+", help="test files or node ids, relative to Freya-Docs-TA (default: files that name the feature's TC IDs)")
    ap.add_argument("-m", "--marker", help="extra pytest -m expression, combined with the serial exclusion")
    ap.add_argument("--workers", type=int, default=4, help="pytest-xdist workers, 0 for none (default: 4)")
    ap.add_argument("--with-serial", action="store_true", help="also run tests with a *serial* marker, alone, after the others")
    ap.add_argument("--report", action="store_true", help="write the reports even for a partial run (--tests or --pytest-args)")
    ap.add_argument("--no-report", action="store_true", help="run only; write no reports")
    ap.add_argument("--report-only", action="store_true", help="skip pytest; rebuild the reports from the last results")
    ap.add_argument("--results", help="Allure results folder (default: <ta>/allure-results/<feature>)")
    ap.add_argument("--out", help="report folder (default: <ta>/builder-test-report/<feature>)")
    ap.add_argument("--work-item", default="ADO #<id>", help="work item shown in the handoff report")
    ap.add_argument("--min-pass-rate", type=int, default=MIN_PASS_RATE,
                    help=f"pass rate in %% below which handoff-notes.md needs a reason (default: {MIN_PASS_RATE})")
    ap.add_argument("--list", action="store_true", help="print the feature, its cases and test files, then stop")
    ap.add_argument("--pytest-args", default="", help="extra pytest arguments, as one quoted string")
    args = ap.parse_args()

    spec, ta = locate_repos(args)
    feature, spec_dir, source = resolve_feature(spec, ta, args.feature)
    cases = read_cases(spec_dir)
    if not cases:
        fail(f"no TC headings found in {spec_dir}.")
    base_map = collections.defaultdict(list)
    for c in cases:
        base_map[base_id(c["id"])].append(c["id"])
    files = args.tests or find_test_files(ta, cases, base_map)
    in_files = set()
    for f in files:
        p = os.path.join(ta, f.split("::")[0])
        if os.path.isfile(p):
            in_files.update(ids_in(open(p, encoding="utf-8", errors="replace").read(), base_map)[0])
    for c in cases:
        c["_has_test"] = c["id"] in in_files

    results = os.path.abspath(args.results or os.path.join(ta, "allure-results", feature))
    out_dir = os.path.abspath(args.out or os.path.join(ta, "builder-test-report", feature))
    print(f"Feature:   {feature}  (from {source})")
    print(f"Test spec: {os.path.relpath(spec_dir, spec)}  ({len(cases)} cases)")
    print(f"Tests:     {len(files)} file(s) in {ta}")
    print(f"Env:       {args.env.upper()}")
    if args.list:
        for f in files:
            print(f"  {f}")
        print(f"Cases with a test: {sum(1 for c in cases if c['_has_test'])} of {len(cases)}")
        return 0
    if not files:
        fail("no test in Freya-Docs-TA names a TC ID of this feature. Generate the tests first, or pass --tests.")

    partial = bool(args.tests or args.pytest_args)
    want_report = not args.no_report and (args.report or not partial or args.report_only)
    date = datetime.date.today().isoformat()
    command, left_out, code = "", "", 0

    if not args.report_only:
        os.makedirs(results, exist_ok=True)
        logs = os.path.join(ta, "logs", "feature-test")
        os.makedirs(logs, exist_ok=True)
        log = os.path.join(logs, f"{feature}-{date}-{args.env}.log")
        serial = serial_markers(ta)
        not_serial = " and ".join(f"not {s}" for s in serial)
        main_marker = " and ".join(f"({x})" for x in (args.marker, not_serial) if x)
        extra = shlex.split(args.pytest_args)
        py = ta_python(ta)
        code, command, tail = run_pytest(ta, py, files, args.env, results, main_marker, args.workers, extra, True, log)
        if serial and not args.with_serial:
            left_out = ", ".join(f"`{s}` (runs alone; add --with-serial)" for s in serial)
        if args.with_serial and serial and code in (0, 1, 5):
            serial_marker = " and ".join(f"({x})" for x in (args.marker, " or ".join(serial)) if x)
            code2, cmd2, tail = run_pytest(ta, py, files, args.env, results, serial_marker, 0, extra, False, log)
            command += f" ; then {cmd2}"
            code = max(code if code != 5 else 0, code2 if code2 != 5 else 0)
        if args.marker:
            left_out = "; ".join(x for x in (left_out, f"tests outside `-m {args.marker}`") if x)
        print(f"Log:       {os.path.relpath(log, ta)}")
        if code not in (0, 1):
            print(tail, file=sys.stderr)
            if "credentials missing" in tail or "Unable to locate credentials" in tail or "AccessDenied" in tail:
                fail("the test logins could not be loaded. Log in to the AWS CLI with a profile that can read the TA "
                     "secret, set AWS_PROFILE, and run again. See references/environments.md.", code)
            if code == 5:
                fail("pytest collected no tests. Check --tests and -m.", code)
            fail(f"pytest stopped with exit code {code} before the tests finished. No report was written. See the log.", code)
    else:
        command = "(reports rebuilt from earlier results)"

    if not want_report:
        print("Reports:   not written (partial run; add --report to write them)")
        return code
    if not glob.glob(os.path.join(results, "*-result.json")):
        fail(f"no Allure results in {results}. Run the tests first.")

    tests, short_count = load_results(results, base_map)
    code_rows = []
    ta_branch = git(ta, "rev-parse", "--abbrev-ref", "HEAD")
    projects = os.path.join(spec, "projects")
    for repo in sorted(glob.glob(os.path.join(projects, "*", ".git"))):
        repo = os.path.dirname(repo)
        if os.path.samefile(repo, ta):
            continue
        if git(repo, "rev-parse", "--abbrev-ref", "HEAD") == ta_branch and ta_branch not in ("main", "master", "HEAD"):
            code_rows.append(f"`{os.path.basename(repo)}` `{ta_branch}` @ `{git(repo, 'rev-parse', '--short', 'HEAD')}`")
    meta = {"feature": feature, "env": args.env, "date": date, "command": command, "left_out": left_out,
            "spec_rel": "Freya-Docs-Spec/" + os.path.relpath(spec_dir, spec), "spec_commit": git(spec, "rev-parse", "--short", "HEAD"),
            "ta_branch": ta_branch, "ta_commit": git(ta, "rev-parse", "--short", "HEAD"),
            "work_item": args.work_item, "code": code_rows, "min_pass_rate": args.min_pass_rate}
    all_bases = {base_id(c["id"]) for _, d in candidates(spec) for c in read_cases(d)}
    run_name, summary = write_reports(meta, cases, tests, short_count, out_dir, all_bases, new_run=not args.report_only)
    print(f"Run report:     {os.path.join(out_dir, run_name)}")
    print(f"Handoff report: {os.path.join(out_dir, 'builder-handoff.md')}")
    print(f"Handoff notes:  {os.path.join(out_dir, 'handoff-notes.md')}")
    print("Summary: " + json.dumps(summary))
    return code


if __name__ == "__main__":
    sys.exit(main())
