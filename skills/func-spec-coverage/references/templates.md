# Template — `openspec/coverage/<source-doc>.md`

One file per source document, holding the atomization and its coverage. There is
no per-change report.

`scripts/coverage-check.mjs` parses this file, so **keep the section numbers and the
`§2` header row exactly as shown**. `§2` is parsed by column *name*, so an
optional `TC-ID(s)` column can be appended for stage 2 without shifting
anything. Prose outside the tables is free-form.

Examples use a synthetic `DOC` domain with placeholder change and capability
names. Substitute your own; nothing here is specific to one project.

---

````markdown
# Coverage — export-and-retention

Atomization of one functional-spec chapter, and the coverage of each atom by the
OpenSpec specs that implement it. One file per **source document**: the upstream
version is a property of the document, so re-atomization has a blast radius of
exactly one file.

Atoms and the OpenSpec specs are **independent derivations** of the same source.
The specs are never generated from the atoms — the reconciliation has value only
because the two were produced separately, so a spec generated from these atoms
would be verifying a generator against its own output.

## Atom IDs are append-only contract

**Never renumber.** On an upstream version bump: keep the ID wherever the clause
text is unchanged, append new IDs for new clauses, and set a removed clause's
Status to `🚫 retired`.

Sub-ID grammar: `.1 .2` = `**Rule**` clauses in source order · `.D1` =
`**Denial behavior**` · `.E1` = `**Exceptions**` · `.P1` = a testable
`**Preconditions**`. `**Example**` is non-normative and never atomized;
`**Related rules**` is navigation only.

## §1 Baseline

| Document | Version | Last Updated |
|----------|---------|--------------|
| functional-spec/export-and-retention.md | 1.4.0 | 2026-01-31 |

Rules atomized: 18 (BR-DOC-001 … BR-DOC-018). Atoms: 147.

Reconciled by: fresh subagent | inline (state which; inline weakens the result).

Only two facts belong here. The **version** records which upstream text these
verdicts were reached against — `C15` compares it to the document's actual
Document Control version. **Reconciled by** records how the matching was done.
Do not restate atom counts, requirement counts, capability lists, or anchor
state: all are computed, so a copy could only agree redundantly or drift.

## §2 Atom Coverage

**Covered by** is `<change> › <capability> › <Requirement> › <Scenario>`. The
leading change segment makes attribution direct — no scanning the tree, and no
dependence on Requirement names happening to be unique.

**Evidence** is a verbatim quote of the WHEN/THEN line carrying the obligation.
An atom is `✅ covered` only if the quote can be pasted, and `S22` verifies the
quote still appears in the cited spec — which catches both a spec edited under a
verdict and a fabricated quote.

| Status | Means |
|--------|-------|
| ✅ covered | a downstream WHEN/THEN line carries the full obligation |
| ⚠️ partial | covers part of the clause; drops a condition, bound, or value |
| ❌ uncovered | no spec in any active change carries it |
| ⛔ contradiction | a spec states something **incompatible** with the rule |
| ⏸️ deferred | deliberately later; §4 names the phase or change |
| ➖ out-of-scope | outside this product's remit; §4 says why |
| 🚫 retired | clause superseded by a version bump; row kept for traceability |
| ⬜ pending | not yet reconciled |

⛔ does not share ❌ deliberately: an omission usually ships *no* behaviour, a
divergent value ships *wrong* behaviour.

| Atom | Field | Statement | Status | Covered by | Evidence |
|------|-------|-----------|--------|-----------|----------|
| BR-DOC-014.D1 | Denial behavior | a retired bundle cannot be exported | ✅ covered | export-record-bundle › record-export › Bundle export behavior › Export a retired bundle | "**THEN** the export SHALL be refused" |
| BR-DOC-014.5 | Rule | an archive download opens in a new tab | ⛔ contradiction | export-record-bundle › record-export › Bundle export behavior › Export a multi-file bundle | "**THEN** the archive downloads in the current tab" |
| BR-DOC-014.6 | Rule | the archive is named `<Bundle Name>.zip` | ❌ uncovered | — | — |
| BR-DOC-003.1 | Rule | superseded clause, row kept for traceability | 🚫 retired | — | — |
| BR-DOC-011.2 | Rule | retention labels are fixed at ingest | ⬜ pending | — | — |

`Field` is one of `Rule` / `Exceptions` / `Denial behavior` / `Preconditions`.
Keep each Statement in the language of the upstream rule — do not translate.

## §3 Orphan Requirements

Requirements declared by an active change that **no atom** traces to. Global by
design: "no atom anywhere covers this" is a better question than "no atom in my
slice covers this".

Detection defers while any atom is `⬜ pending` — an untraced requirement cannot
be told apart from an unreconciled one.

| Requirement | Change › Capability | Disposition | Owner |
|-------------|---------------------|-------------|-------|
| Bulk export queue | export-record-bundle › record-export | write new BR upstream | <name> |

`Disposition` is `write new BR upstream` or `delete from spec` — nothing else.
An undisposed orphan blocks its change.

## §4 Findings & Actions

One row per atom whose Status is not `✅ covered`, `🚫 retired`, or `⬜ pending`.
**Owner** is the person who closes the gap — a name, not a change directory,
because a person can act and a directory cannot.

| Atom | Status | Finding | Action | Owner |
|------|--------|---------|--------|-------|
| BR-DOC-014.5 | contradiction | spec says current tab, rule requires a new tab | fix the spec, or amend BR-DOC-014 upstream if the rule is stale | <name> |
| BR-DOC-014.6 | uncovered | no Scenario names the archive filename | add a Scenario to `record-export` | <name> |
````

---

## Stage 2 — test coverage

When acceptance cases exist, append a `TC-ID(s)` column to `§2` rather than
creating a second file. `§2` is parsed by column name, so nothing else shifts.
Each cited TC-ID must match `TC-{CAP}-{NNN}-{KIND}-{ST}` and appear in the test
spec of the change named in that row's `Covered by` path — either its
`test-spec.md` or any file of its `test_spec/` package.
