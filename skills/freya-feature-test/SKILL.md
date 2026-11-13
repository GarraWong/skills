---
name: freya-feature-test
description: Run one Freya Docs feature's automated tests in Freya-Docs-TA, matched to the feature's test spec by TC ID, and write its run report and builder handoff report. Use when the user asks to run the feature tests, test a feature before QA handoff, re-run a feature's tests on DEV or QA, update the test report, record manual test results, or rebuild a feature's builder handoff or handoff notes.
---

# Freya Feature Test

Run the tests that cover one feature's test spec, then write two Markdown reports in Freya-Docs-TA: a run report for the latest run on each environment and the feature's builder handoff report. The rules the reports follow are in the project's `test-spec/builder-testing-guide.md`.

Everything goes through [`scripts/feature_test.py`](scripts/feature_test.py). The user can run the same script directly; see [Running the script directly](#running-the-script-directly).

## Safety

- The tests run against a **live shared environment**. They create documents and may change settings. Running on DEV is what the user asked for when they ask to run the feature tests. Run on `qa` or `dso` only when the user names that environment, and say which one before starting.
- Tests with a `*serial*` marker (for example a test that switches a setting off for the whole tenant) are left out by default. Add `--with-serial` only when the user asks for them, and warn that the setting is off for everyone on that tenant while they run.
- Never read, print, or pass test logins or secrets. The test suite loads its own logins from the AWS secret through the user's AWS CLI session. If logins fail, tell the user to log in; see [references/environments.md](references/environments.md).
- The script writes files only. Do not commit, push, or attach the reports anywhere unless the user asks.
- Each run overwrites `run-<env>.md` for its environment; commit it with the handoff and git keeps the history. `builder-handoff.md` is rebuilt every time, so never edit it; manual results, bug links, failure classes, and QA reasons go in `handoff-notes.md`, where the script only adds rows and columns and never changes a value.

## Defaults

| Setting | Default | Override |
| --- | --- | --- |
| Feature | The folder named in `.specify/feature.json` of Freya-Docs-Spec, else the `feature/<id>-<slug>` branch of Freya-Docs-Spec or Freya-Docs-TA | Feature id, slug, or folder name as the first argument |
| Test spec | First match in `specs/<feature>/test-spec/`, `test-spec/<feature>/`, `openspec/changes/<feature>/test-spec/` | A path as the first argument |
| Freya-Docs-Spec | Found by walking up from the working directory | `--spec-dir`, or `FREYA_SPEC_DIR` |
| Freya-Docs-TA | `<spec>/projects/Freya-Docs-TA` | `--ta-dir`, or `FREYA_TA_DIR` |
| Test files | Every `test_*.py` under `testcase_api/` and `testcase/` that names a TC ID of the feature | `--tests <files or node ids>` |
| Environment | `dev` | `--env qa`, `--env dso` |
| Parallel workers | 4, one file per worker | `--workers 0` for none |
| Serial tests | Left out | `--with-serial` runs them alone after the others |
| Reports | Written for a full run; not for a partial run (`--tests` or `--pytest-args`) | `--report`, `--no-report` |

If the feature cannot be resolved, or matches several test specs, ask the user which one. Do not guess.

## Steps

Run every command from inside the Freya-Docs-Spec checkout, so the script can find both repositories. Requires Python 3.9+ to run the script, and a Freya-Docs-TA virtual environment for the tests ([references/environments.md](references/environments.md) explains how to create one).

1. **Show the scope.** Run

   ```
   python3 <skill-dir>/scripts/feature_test.py [<feature>] --list
   ```

   Tell the user the feature, where the name came from, the test spec, how many cases it has, how many have a test, and the test files. If no file names a TC ID of the feature, stop: the tests have not been generated yet, or their titles do not carry TC IDs.
2. **Check the login.** If the user has not logged in to the AWS CLI in this session, ask them to, with the profile from [references/environments.md](references/environments.md). Do not log in for them.
3. **Run.** Run

   ```
   python3 <skill-dir>/scripts/feature_test.py [<feature>] [--env <env>]
   ```

   It prints each test result as it runs. A full feature run can take several minutes; run it in the background where possible and wait for it to finish. Exit code 0 means every test passed and 1 means some failed; both write the reports. Any other code means pytest did not finish, and no report was written: show the message and the log path the script printed.
4. **Read the reports.** Open the run report and `builder-handoff.md` the script printed. Do not restate them in full. The Summary of `builder-handoff.md` says whether failures still lack a bug or OQ, and whether handed-over cases still lack a reason.
5. **Fill in the notes.** The developer records, in `handoff-notes.md`:
   - for a case tested by hand: `Result` (`pass` or `fail`) and `Tested on` (environment and date, e.g. `DEV 2026-11-06`). The case then moves to "Tested by dev"; if an automated test of the same case failed, `fail` wins.
   - for each failure: `Bug / OQ` and `Class`.
   - for each case handed to QA: `Reason` and `Setup QA needs`.
   - when the `Pass rate` line says the rate is below the threshold (80% by default): the `Low pass rate reason` line under it.

   Fill a row yourself only with values the user gave you; never invent a result, a bug number, or a reason. The script rewrites the `Pass rate` line itself; never edit it.
6. **Rebuild without running** after the notes change: add `--report-only`. It reads the Allure results of the last run, adds any missing row or column to `handoff-notes.md`, and rebuilds `builder-handoff.md`; it writes no new run report.

**"Update the test report"** means steps 5 and 6, without running the tests: write into `handoff-notes.md` whatever results, bugs, or reasons the user just gave, then run `--report-only`. Report what changed in the summary of `builder-handoff.md`. Run the tests again only when the user asks to run them.

## What the script writes

All paths are in Freya-Docs-TA. `<feature>` is the test spec's folder name, for example `331519-build-info`.

| File | Path | Committed |
| --- | --- | --- |
| Allure results, one JSON file per test | `allure-results/<feature>/`, cleared at the start of each run | No (gitignored) |
| pytest log | `logs/feature-test/<feature>-<date>-<env>.log` | No (gitignored) |
| Run report | `builder-test-report/<feature>/run-<env>.md`, overwritten by every run on that environment | Yes |
| Handoff report | `builder-test-report/<feature>/builder-handoff.md`, rebuilt every run and every `--report-only` | Yes |
| Handoff notes | `builder-test-report/<feature>/handoff-notes.md`, created on the first run; later runs only add rows and missing columns | Yes |

The sections of each file, how a case gets `pass` or `fail`, and the notes columns are in [references/report-format.md](references/report-format.md). Read it when the user asks what a report section means or why a case landed where it did.

## Running the script directly

Users can run the script without an agent. From inside the Freya-Docs-Spec checkout:

```
python3 <skill-dir>/scripts/feature_test.py 331519 --list           # what would run
python3 <skill-dir>/scripts/feature_test.py 331519                  # run on DEV, write reports
python3 <skill-dir>/scripts/feature_test.py 331519 --env qa         # run on QA
python3 <skill-dir>/scripts/feature_test.py 331519 --report-only    # update the test report: rebuild after editing handoff-notes.md
python3 <skill-dir>/scripts/feature_test.py 331519 --tests testcase_api/build_info/test_x.py::test_y   # one test, no reports
```

`python3 <skill-dir>/scripts/feature_test.py --help` lists every option.

## Completion

Report, in a few lines:

- The feature, the environment, and the pytest totals (pass / fail / skipped).
- The handoff summary: pass and fail counts, the pass rate (and its reason when below the threshold), how many cases are in "Handed to QA", and what `handoff-notes.md` still needs (failures without a bug or OQ, handed cases without a reason, a low pass rate without a reason).
- Each failing test, one line each.
- The paths of the run report and `builder-handoff.md`.
- Anything left out: serial tests, and the size of the "TC IDs in no test spec" list if it is not empty.

If the run did not finish, report the exit code, the message, and the log path instead.
