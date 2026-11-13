# Report format

The three files [`scripts/feature_test.py`](../scripts/feature_test.py) keeps in `Freya-Docs-TA/builder-test-report/<feature>/`. This page describes what the script writes; when the two disagree, change the script and this page in the same commit.

| File | Written by | When |
| --- | --- | --- |
| `run-<env>.md` | Script | Overwritten by every run on that environment (`run-dev.md`, `run-qa.md`). Commit it with the handoff; git keeps the history |
| `builder-handoff.md` | Script | Rebuilt on every run and every `--report-only`. Never edit it by hand |
| `handoff-notes.md` | People | Created by the script on the first run. The script adds rows and missing columns and rewrites the `Pass rate` line |

## Run report — `run-<env>.md`

| Section | Content |
| --- | --- |
| Header table | Environment; test spec path and commit; Freya-Docs-TA branch and commit; start and end time from the Allure results; the pytest command; what was left out (serial markers, `-m`) |
| Totals | Two rows: counted by pytest test, and counted by TC ID of this feature. Columns: total, pass, fail, skipped |
| Notes under Totals | How many tests name no TC ID, and how many use short IDs that should be renamed |
| Failures | One row per failing test: test node id, TC IDs, first line of the failure, class and bug from `handoff-notes.md` at the time of the run (`?` when empty) |
| Skipped | One row per skipped test, with `⚠️ Skipped:` and its skip reason |
| TC IDs in no test spec | Only when present: IDs that tests name but no test spec in Freya-Docs-Spec contains |

## Handoff report — `builder-handoff.md`

| Section | Content |
| --- | --- |
| Header table | Work item (`--work-item`); test spec path and commit; one Code row per component clone on the same branch as Freya-Docs-TA; Freya-Docs-TA branch and commit; environment; the run report it was built from |
| Summary | One table: `✅ pass`, `❌ fail` and `⚠️ skipped` case counts (skipped: a test ran but was skipped, so the case has no result), and the pass rate. Then the number of cases in "Handed to QA", skipped ones included. Then the Low pass rate reason, when the rate is below the threshold and one is given. Then, when not ready, how many failures lack a bug or OQ, how many handed cases lack a reason code, how many manual results lack `Tested on`, and whether a low pass rate lacks a reason |
| Tested by dev | Every case with a result: TC, priority, how it was tested (test files, and `by hand, <Tested on>` for a manual result), `✅ pass` or `❌ fail`, Bug / OQ from the notes |
| Handed to QA | Every case without a result: TC, priority, reason from the notes (`?` when empty), setup from the notes, or the script's hint (no test found, left out of the run, skipped and why) |
| Known product issues | Grouped by bug from the notes: bug, TC IDs, first failure message (`by hand` for a manual failure) |
| Open questions | Grouped by OQ from the notes (a Bug / OQ value starting with `OQ`): OQ, TC IDs |

How a case gets its result:

- A test names its cases in its Allure title. Full IDs (`TC-DTYP-012-API-HP`) match directly. A short ID (`TC-DTYP-012`, `TC-DTYP-012/014`, `TC-SAVE-108..111`) matches every full ID with that `TC-<CAP>-<NNN>` base.
- `pass`: every test naming the case passed. `fail`: any of them failed or broke. Anything else (skipped, not run, no test) has no result and goes to "Handed to QA".
- A `Result` in the notes (a manual test) joins the automated result: `fail` from either wins, otherwise `pass`. A case with only a manual result moves to "Tested by dev". The run report ignores manual results: it records one run.
- With pytest retries, the latest attempt of each test counts.

Pass rate = pass ÷ (pass + fail), over the cases with a result, manual results included, rounded to a whole percent. Skipped and handed-to-QA cases are not counted. Below the threshold (`MIN_PASS_RATE` in the script, 80 by default, `--min-pass-rate` for one run) the developer gives a reason. 80 is an experience value; change `MIN_PASS_RATE` once real feature runs show a better one.

## Handoff notes — `handoff-notes.md`

Two lines and one Markdown table, above the table:

| Line | Written by | Content |
| --- | --- | --- |
| `**Pass rate**:` | Script, rewritten on every run and `--report-only` | `✅` when the rate meets the threshold, `❌` when below it; then the rate, the counts behind it, the threshold, and whether a reason is needed |
| `**Low pass rate reason**:` | People | Why the rate is below the threshold, for example the open bugs behind the failures. Read when the rate is below the threshold; ignored otherwise |

The script adds both lines to an older file that lacks them. The table is read by column name, so the column order does not matter. On every run and every `--report-only` the script adds a row for every case that did not pass and is not yet in the table, and adds any missing column (an older file gains `Result` and `Tested on`, every value kept). It never edits or removes a value, so a row stays after its case passes; delete it by hand if it is no longer needed.

| Column | Filled for | Values |
| --- | --- | --- |
| TC | Every row | Full TC ID from the test spec |
| Result | A case tested by hand | `pass` or `fail` (any case). Anything else is ignored |
| Tested on | A case with a Result | Environment and date, e.g. `DEV 2026-11-06` |
| Bug / OQ | A failure | `Bug #<ADO id>`, or `OQ-…` for a spec gap |
| Class | A failure | `product`, `spec`, or `test` |
| Reason | A case handed to QA | `TENANT-CONFIG`, `MULTI-TENANT`, `NON-DETERMINISTIC`, `ENV-ONLY`, `SEC`, `PERF`, `EXPLORATORY` |
| Setup QA needs | A case handed to QA | Free text: data, access, or help from dev |

A reason outside that list counts as missing in the Summary. The reason codes and what they mean are defined in `test-spec/builder-testing-guide.md` of Freya-Docs-Spec.
