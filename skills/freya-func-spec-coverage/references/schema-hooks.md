# Schema patches — verbatim source

The SDD integration is three edits under `openspec/schemas/super-flow-normal/`:

| # | File | Edit |
|---|------|------|
| 1 | `schema.yaml` | hook appended to the `specs` artifact `instruction:` |
| 2 | `schema.yaml` | hook appended to the `test-spec` artifact `instruction:` |
| 3 | `templates/spec.md` | the `**Source:**` anchor slot and its placement rule |

Both files are **vendored**. An upstream schema upgrade overwrites them and drops
all three. Nothing else is lost — the method lives in this skill — so recovery is
a paste of the blocks below.

Patch 3 matters as much as the hooks: without it an author writing a new spec has
no anchor slot and no warning about placement, and the one mistake available
(anchor above the requirement text) fails validation with a message that points
somewhere else entirely.

They follow the schema's own documented convention:

> DEPENDENCY MODEL — graceful fallback. No external skill is required. Every
> skill-invoking step follows one pattern: "If `<skill>` is in your available
> skills, invoke it; otherwise follow the inline instructions below." Nothing
> STOPs on a missing skill.

Indentation is **6 spaces**, matching the surrounding YAML block scalar. Preserve
it exactly or the YAML block will reflow.

## Verify all three patches are present

```bash
grep -c "UPSTREAM COVERAGE GATE" openspec/schemas/super-flow-normal/schema.yaml
grep -c "Source:" openspec/schemas/super-flow-normal/templates/spec.md
```

Expect `2` and a non-zero count. Either at `0` means re-paste from below.

---

## Hook 1 — `specs`

Append after the line:

```
      Each scenario is a potential test case — keep them testable.
```

Block to append:

```
      UPSTREAM COVERAGE GATE (graceful fallback) — run AFTER the spec files are
      written and BEFORE api-contract:
      - If `freya-func-spec-coverage` is available to you as a skill, invoke it
        with the arguments `spec <change-name>`. An install still named
        `func-spec-coverage` is the same skill; invoke that instead.
      - Otherwise skip the gate and warn the user ONCE that upstream coverage
        was not reconciled. Do NOT STOP for a missing skill.
      It maintains openspec/coverage/<source-doc>.md — one file per functional
      spec document, holding the clause-level atomization AND each atom's
      coverage. There is no per-change coverage report: coverage is a property of
      the DOMAIN, because one chapter is normally implemented across several
      concurrent changes. Each atom records `Covered by` as
      `<change> › <capability> › <Requirement> › <Scenario>` plus a verbatim
      quote, so attribution is read off the evidence rather than assigned in
      advance. The atoms are NEVER generated from these spec files, nor these
      spec files from the atoms — both derive independently from the functional
      spec, and the reconciliation is only meaningful because of that.
      It also writes one `**Source:** BR-xxx` anchor into each covered SCENARIO,
      between the `#### Scenario:` header and its WHEN/THEN bullets. Never above
      a Requirement's own text — there it becomes the requirement text and fails
      OpenSpec validation. Scenario level, because a Scenario is what a rule
      clause is actually verified by; a requirement-level anchor cannot say which
      of its Scenarios serves which rule.
      The anchor is what travels WITH the spec: the ledger is domain-wide and
      lives outside the change, so without an anchor the delta merged into
      openspec/specs/ on archive carries no link back to its rules.
      If the project has no functional-spec/ upstream, the skill reports
      N/A and the gate is a no-op.
      BLOCKING for THIS change: a `contradiction` attributed to it by a
      `Covered by` path, or an undisposed orphan requirement in its specs. Fix
      the spec, or reclassify with a written reason and a named owner. Authoring
      the wire boundary against a spec that contradicts a rule is the failure
      this gate exists to prevent.
      NOT blocking: an `uncovered` atom has no `Covered by` path, so it cannot be
      attributed to any change; blocking change A over a clause conceptually
      belonging to change B deadlocks both. Uncovered atoms are reported
      domain-level on every run and closed as a planning decision in §4.
      `partial` / `deferred` / `out-of-scope` are WARNINGs: record and proceed.
```

---

## Hook 2 — `test-spec`

Append after the line:

```
      Keep it scoped to what THIS change touches.
```

(the `test-spec` block's last line — note `api-contract` ends with the similar
but distinct "Keep the contract scoped to what THIS change touches.")

Block to append:

```
      UPSTREAM COVERAGE GATE (graceful fallback) — run AFTER the test spec is
      written (`test-spec.md` or a `test-spec/` package) and BEFORE plan:
      - If `freya-func-spec-coverage` is available to you as a skill, invoke it
        with the arguments `test <change-name>`. An install still named
        `func-spec-coverage` is the same skill; invoke that instead.
      - Otherwise skip the gate and warn the user ONCE. Do NOT STOP for a
        missing skill.
      It appends a `TC-ID(s)` column to openspec/coverage/<source-doc>.md §2:
      every atom marked `covered` or `partial` must reach >=1 TC-ID whose change
      matches that row's `Covered by` path. This is the upstream-rule counterpart
      to test-spec §2's Scenario gate — a rule clause can be covered by a
      Scenario that no case exercises.
      BLOCKING: an atom covered by THIS change with no TC-ID and no §4
      justification blocks plan. A justification must name the follow-up test
      that will cover it (integration/unit); pointing at the test spec's §4
      without naming a test is not a justification.
```

---

## Patch 3 — `templates/spec.md`

Two edits to the delta-spec template. Portable by construction: a project with
no upstream rules index simply omits the line, and the template says so.

**3a.** In the leading comment, extend the hard-format list and add the note.
After `- Scenario MUST use level-4 (####). Level-3 or a bullet fails silently.`:

```
- A **Source:** line, where used, goes inside a #### Scenario, between the
  Scenario header and its WHEN/THEN bullets. Never above a Requirement's own
  text: there it BECOMES the requirement text and validation fails with
  "must contain SHALL or MUST".
Use only the delta sections you need.

**Source:** is the durable link back to the upstream business rules a Scenario
implements. Omit it if the project keeps no upstream rules index. Where it does,
the `freya-func-spec-coverage` gate writes and verifies these lines; a Scenario that
covers upstream rules and declares no Source is a finding.

It sits on the Scenario, not the Requirement, because a Scenario is what a rule
clause is actually verified by. A requirement-level anchor cannot say which of
its Scenarios serves which rule, and it keeps claiming a rule after that rule's
only Scenario is deleted.
```

**3b.** Add the slot inside the ADDED and MODIFIED Scenario stubs, between the
`#### Scenario:` header and the WHEN/THEN bullets:

```
**Source:** <!-- upstream rule IDs, e.g. BR-DOC-014, BR-DOC-021 — base IDs only,
ascending; omit this line entirely if the project has no upstream rules index -->
```

and, in the MODIFIED comment block, after the full-text-replace warning:

```
Because it IS a full-text replace, carry each Scenario's existing **Source:**
line forward. Dropping one silently strips the living spec's only link to its
upstream rules — which is why the trace gate flags a MODIFIED Scenario whose
Source line disappeared.
```

Only `super-flow-normal` carries these patches. Do not add the slot to a schema
that has no trace hooks — an anchor nothing writes or verifies rots.
