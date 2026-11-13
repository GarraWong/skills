---
name: freya-func-spec-coverage
description: Reconcile a project's OpenSpec specs against its upstream functional spec (BR-xxx / FR-xxx business rules), keeping one coverage ledger per source document under openspec/coverage/. Use when the user asks whether spec.md, test-spec.md, or a test-spec package missed anything from the functional spec, asks to verify a change against the business rules, or mentions trace, traceability, rule coverage, atomization, coverage gap, 对账, 覆盖对账, 是否遗漏, or BR 覆盖.
---

# Functional Spec ↔ OpenSpec Coverage

Reconcile the OpenSpec specs against the upstream functional specification at
**atomic clause granularity**, and answer one question: **is every rule clause
covered by some spec, and does that spec say the same thing the rule says?**

## Architecture

A business rule is not the unit of work. One `**Rule**` field routinely bundles
4–6 independent SHALLs, and `**Denial behavior**` / `**Exceptions**` sit outside
that prose, so a generator that reads the Rule and starts writing Scenarios
never sees them. The unit is the **atom**: one falsifiable clause.

One file per **source document**, holding the atomization *and* its coverage:

```
openspec/coverage/<source-doc>.md

§1  Baseline        source document + pinned version; how it was last reconciled
§2  Atom Coverage   | Atom | Field | Statement | Status | Covered by | Evidence |
§3  Orphans         requirements no atom traces to
§4  Findings        every non-covered atom: finding, action, owner (a person)
```

Keyed per source document, not per domain, because **the version is a property
of the document** — so re-atomization has a blast radius of exactly one file,
and the ledger's pin can be checked against that document's Document Control.

### Two things this design deliberately does NOT have

**No per-change report.** Coverage is a property of the domain, not of a change.
One chapter is normally implemented across many concurrent changes, so "is this
clause covered" is a question about all of them at once.

**No ownership column.** `Covered by` starts with the change that covers the
atom, so attribution is read off the evidence rather than asserted in advance.
An owner field would be a *plan* ("this change will implement it"); the path is
a *fact* ("this change does, here is the line"). Plans go stale silently and
need an assignment step, an invariant, and checks to police them. Facts are
recomputed from the specs.

### The independence rule

Atoms and the OpenSpec specs are **two independent derivations of the same
source**:

```
              functional spec
                 ╱          ╲
          atoms              openspec specs
                 ╲          ╱
                reconciliation
```

The specs are **never** generated from the atoms. The reconciliation has value
only because the two were produced separately — generate one from the other and
you are verifying a generator against its own output. Atomize from the
functional spec alone, before opening any downstream file.

## Stages

The skill takes one stage argument, however the host passes arguments — as a
command argument, or stated in the request. Default to `all` when none is given.

| Stage | When it runs |
|-------|--------------|
| `spec` | stage 1. After `specs/**/spec.md`, **before** `api-contract`. |
| `test` | stage 2. After the change's test spec (`test-spec.md` or a `test-spec/` package), **before** `plan`. |
| `all` (default) | both |

An optional change name may follow the stage. It scopes only the *gate*; the
reconciliation itself is always domain-wide.

> The frontmatter `description` carries a few non-English trigger phrases so the
> skill matches how its users ask for it. Match keywords only — deliberate, not
> a leak. Everything below the frontmatter stays in English so the skill travels.

## Scope boundary

| Check | Edge it guards |
|-------|----------------|
| **This skill** | BR-xxx / FR-xxx atoms → `specs/**/spec.md` → `test-spec.md` or `test-spec/` |
| schema `verify` / `openspec-verify-change` | Scenario → TC-ID, plan tasks, delta sync |
| apply-phase code review | `plan.md` → code |

## Bindings

Defaults, not requirements — the first two are overridable with `--index` and
`--coverage`.

| Role | Default |
|------|---------|
| Upstream rules | `functional-spec/**/*.md` |
| Upstream index | `functional-spec/appendix/business-rules-index.md` |
| Coverage ledgers | `openspec/coverage/<source-doc>.md` |
| Downstream specs | `openspec/changes/<c>/specs/<capability>/spec.md` |
| Downstream tests | `openspec/changes/<c>/test-spec.md` **or** a `test-spec/` package (legacy `test_spec/` also read) |
| Anchors | one `**Source:** BR-xxx` line per covered Requirement |

What a host project must actually provide:

1. **Stable rule IDs** matching `BR-{DOMAIN}-{NNN}` or `FR-{DOMAIN}-{NNN}`, registered in one index
   that links each ID to its chapter.
2. **Field-structured rules** — `**Rule**` plus, where they apply,
   `**Exceptions**`, `**Denial behavior**`, `**Preconditions**`. The atomizer
   reads those fields by name; prose-only rules cannot be split reliably.
3. **OpenSpec `### Requirement:` / `#### Scenario:`** downstream.

A project meeting those three works unchanged. Different rule-ID naming needs
one regex adjusted — `ATOM` / `RULE` at the top of `scripts/coverage-check.mjs`.

Two things vary by project and are handled without editing the script:

- **Test-spec layout** — a single `test-spec.md` at the change root and a
  `test-spec/` directory package (legacy name `test_spec/`) are both accepted, and a package's child files
  are searched too, because its TC-IDs often live there rather than in the index.
- **TC-ID vocabulary** — the default grammar asserts only the shape
  `TC-{CAP}-{NNN}-{KIND}-{ST}`, since `KIND` / `ST` belong to the host project's
  test-spec convention. Pass `--tc <regex>` to enforce a specific vocabulary.

**N/A path:** no upstream rules tree → write nothing, report `N/A`, exit. The
gate is a no-op, never a blocker.

## Anti-self-confirmation

A context that just authored a spec will confirm its own coverage, and inside
the SDD flow this skill runs immediately after that authoring.

1. **Dispatch a fresh agent or a clean context** for the matching, handing it
   only file paths and these instructions — never the session history that
   produced the artifacts. If the host cannot spawn one, say so in §1 and run
   inline.
2. **Quote, never confirm.** Never ask "is BR-xxx covered?". Demand the covering
   text verbatim. Absence of a quote *is* the finding — and the checker verifies
   every quote still appears in the cited spec, so a paraphrase does not survive.

## Seeding or extending a ledger

Once per source document, and again only on a version bump. Rules and a worked
example: [references/atomization.md](references/atomization.md). The ledger's
own four-section layout, with a filled example to copy:
[references/templates.md](references/templates.md) — the checker parses the
section numbers and the `§2` header row, so keep both exactly as shown.

**Seed:** atomize every rule the index maps to the document, `**Denial
behavior**` and `**Exceptions**` **first** — the top two omission sources,
precisely because they sit outside the Rule prose. Status starts `⬜ pending`.

**Extend after a version bump:** keep the ID wherever the clause text is
unchanged, append new IDs for new clauses, set a removed clause to `🚫 retired`.
Bump §1's version in the same edit. **Never renumber** — every `Covered by` path
and verdict references these IDs.

`C15` enforces this: the ledger's pinned version is compared against the source
document's actual Document Control version, so an upstream bump cannot leave the
whole file quietly describing superseded text.

## When a ledger gets created

A ledger is per **source document**, so a new *change* never creates one — it
reconciles against the ledger of whichever document holds its rules.

A ledger is created when the functional spec gains a **document**. `C16` catches
that: any document the rules index links to that no ledger declares is reported
with the rules it holds and the filename to seed. Without it a new chapter is
invisible — `C09` only reaches rules whose document some ledger already declares,
so nothing would ever ask about the new one.

Sequence for a new change, then:

1. Its rules already live in an existing ledger → nothing to create.
2. Stage 1 reconciles the domain; the change's requirements either get traced by
   existing atoms (whose `Covered by` now names it) or surface in `§3`.
3. If the change implements rules from a document with no ledger, `C16` says so
   and that ledger is seeded first.

### When the upstream splits released from in-flight rules

Some projects hold current released behavior in **topic documents** and each
feature in flight in its own **change document**, merging the latter into the
former once the behavior ships. Nothing about per-document keying changes: a
change document is a document, so it gets its own ledger, and that ledger is the
one a developer actually works against while building the feature.

Both kinds coexist, one ledger each, discovered exactly as before — `C16` reads
the index links, so it follows a rule into a change document with no special
case:

| Ledger | Source | Answers |
|--------|--------|---------|
| `<change-slug>.md` | the change document | is this feature's spec and test coverage complete |
| `<topic-doc>.md` | the topic document | is all released behavior in this domain still covered |

**On merge upstream**, move the atoms, do not re-atomize:

1. Append the change ledger's `§2` rows into the topic ledger — unchanged. Atom
   IDs derive from the rule IDs, which an upstream merge does not renumber, so
   the rows carry over verbatim and stay append-only. Seed the topic ledger
   first if the topic document is new.
2. Carry unresolved `§3` / `§4` entries across; drop the ones the merge closed.
3. Re-pin `§1` to the topic document and its version.
4. Move the change ledger to `<coverage>/archive/YYYY-MM-DD-<slug>.md`, dated
   by the merge. Keep it — it is the record of what was reconciled at
   implementation time, and its `Evidence` quotes are only meaningful alongside
   the change document they were taken from.

Because change ledgers are transient, the live directory stays bounded by the
number of domains plus the number of features in flight — all the accumulation
lands in `archive/`. A change ledger that is never merged is the one way that
stops being true, which is what `C17` fails on.

Two things to know about that archive directory:

- Ledger discovery is **non-recursive**, so `<coverage>/archive/` is invisible
  to the checker by construction — archived ledgers never produce findings and
  their duplicated atom IDs never collide with the live ones. Preserve that
  property if discovery is ever rewritten.
- An archived ledger is **never edited**. It pins a version that will keep
  drifting from the topic document, and that is correct: it describes what was
  true then.

The failure this creates is a **stranded ledger** — the upstream merge happened
but the atoms were left behind, so the index points a rule at the topic document
while its coverage still sits in a change ledger. `C17` reports it. Untreated,
`C16` would tell you to seed a fresh ledger for the topic document, which
duplicates every atom instead of moving it.

## Reconciling

For each atom that is not `🚫 retired`, search **every active change's** specs
for a covering Scenario. Record:

- **Covered by** — `<change> › <capability> › <Requirement> › <Scenario>`
- **Evidence** — a verbatim quote of the WHEN/THEN line carrying the obligation

An atom is `✅ covered` only if you can paste the words.

Then invert: for every `### Requirement:` in every active change that no atom
traces to, add a `§3` row with a disposition — `write new BR upstream` (a real
rule nobody wrote down) or `delete from spec` (invented behaviour).

And hunt divergence: for every atom pinning a concrete value — a filename
pattern, a numeric bound, a privilege code, an ordering, a default — compare the
downstream value **character by character**, not by meaning.

| Status | Meaning | Needs a §4 row |
|--------|---------|----------------|
| `✅ covered` | quotable text carries the full obligation | no |
| `⚠️ partial` | covers part; drops a condition, bound, or value | yes |
| `❌ uncovered` | no spec in any change carries it | yes |
| `⛔ contradiction` | a spec states something **incompatible** | yes — top priority |
| `⏸️ deferred` | deliberately later; §4 names the phase | yes |
| `➖ out-of-scope` | outside the product's remit; §4 says why | yes |
| `🚫 retired` | superseded by a version bump | no |
| `⬜ pending` | not yet reconciled | no |

`⛔` does not share `❌`: an omission usually ships *no* behaviour, a divergent
value ships *wrong* behaviour. Never soften one to `⚠️` because the intent looks
close.

## Writing the `Source:` anchors

The ledger is domain-wide and lives outside the change. The anchor is what
travels *with* the spec into `openspec/specs/` on archive, so the living spec
keeps a link back to its rules.

For every Scenario named in a `covered` or `partial` atom's `Covered by` path:

```markdown
### Requirement: Bundle export behavior

The system SHALL ... (requirement text, containing SHALL or MUST)

#### Scenario: Export a one-file bundle

**Source:** BR-DOC-014, BR-DOC-021

- **WHEN** ...
- **THEN** ...
```

1. **Placement: inside the Scenario**, between its header and the WHEN/THEN
   bullets. Never above a Requirement's own text — there OpenSpec reads it *as*
   the requirement text and validation fails with `must contain SHALL or MUST`.
2. **Scenario level, not requirement level.** A Scenario is what a rule clause
   is verified by. A requirement-level anchor cannot say which of its Scenarios
   serves which rule, and it keeps claiming a rule after that rule's only
   Scenario is deleted.
3. **Base rule IDs only** — `BR-DOC-014`, not `BR-DOC-014.6`.
4. Comma-separated, ascending, deduplicated, idempotent.
5. **No anchor on an orphan Requirement** — it has no upstream rule.
6. Do not touch `REMOVED` / `RENAMED` blocks.

Then run `openspec validate <change> --json`.

The delta-spec template carries this slot and the placement rule — see
[references/schema-hooks.md](references/schema-hooks.md) patch 3. `S17`–`S20`
enforce the anchors: missing rule, dropped on `MODIFIED` full-text replace,
unknown rule ID, and an unfilled template placeholder.

`S18` compares **rule sets**, not scenario names. `MODIFIED` replaces a
requirement wholesale, so its scenarios get renamed, split and merged — matching
by name finds nothing in exactly the case the check exists for. It asks instead
whether the rewrite still references every rule the living spec anchors.

## Known limit: one `Covered by` slot per atom

An atom has a single `Covered by` cell, so the ledger cannot express "covered
correctly by change A **and** contradicted by change B". If that happens, record
the `⛔ contradiction` — it is the finding that matters — and note the other
change in `§4`. Do not silently pick the covering one.

This is a real gap, not a rule: two changes touching one clause and disagreeing
is exactly what the gate should surface.

## Comparing names — normalize both sides

Requirement and Scenario headings carry markdown (`` Date `is` covers a whole
day ``). Table cells have it stripped; headings do not. Every comparison must
run both sides through `nameKey`, and every quote match through `norm`.

This has caused three separate bugs — emphasis markers in evidence, backticks in
a Scenario name, and the same in the `S18` living-spec lookup. When adding a
comparison, normalize both sides or it will fail silently on the first heading
that contains markup.

## Archived changes

A change keeps its name after archiving but its directory gains a `YYYY-MM-DD-`
prefix. `Covered by` paths are **not** rewritten. The checker strips the date and
looks under `openspec/changes/archive/` as well, so a path stays valid for the
life of the ledger.

Archived changes take part in resolution only. They are excluded from orphan
detection and from the duplicate-name check (`S23`), because their requirements
are history and a `MODIFIED` requirement legitimately reuses the living name.

## Stage 2 — test coverage

Append a `TC-ID(s)` column to `§2`. Each atom that is `covered` or `partial`
must reach >=1 TC-ID from the test spec of the change in its `Covered by`
path. The join is mechanical: a test-spec's `§2` (or its Traceability Matrix)
already maps Requirement + Scenario to TC-IDs, and `Covered by` carries both.

`T02` reports an atom whose covering Scenario no case exercises, and blocks the
change that covers it. Two deferrals keep it honest:

- **No `TC-ID(s)` column** — stage 2 has not started; nothing is demanded.
- **The owning change has no test spec** — reported as `STAGE 2 NOT DUE`
  with a per-change count, never as a finding. Otherwise every atom of every
  change without a test-spec would read as untested.

A `§4` row excuses a missing test only if it **names** the test that will cover
it — a TC-ID, or an identifier ending `Test` / `IT` / `Spec`. A row that merely
exists is about coverage and says nothing about whether anything runs.

`T05` checks TC-ID grammar; `T06` checks the ID actually appears in that
change's test spec.

## Gate policy

The gate is per change, and attributes via the `Covered by` change segment.

| Present | Effect on `<change>` |
|---------|----------------------|
| `⛔ contradiction` attributed to this change | **BLOCK** |
| undisposed orphan requirement in this change | **BLOCK** |
| `⚠️ partial` attributed to this change | WARNING |
| `❌ uncovered` anywhere | reported domain-level, **never blocks** |
| `⏸️ deferred` / `➖ out-of-scope` | WARNING |

An uncovered clause has no `Covered by` path, so it cannot be attributed to
anyone. Blocking a change for a clause conceptually belonging to another change
deadlocks both — so uncovered atoms are reported prominently on every run and
block nothing. Closing them is a planning decision recorded in `§4`.

Contradictions and partials *can* be attributed, and this is stricter than
ownership was: the change whose spec actually contradicts the rule is the one
blocked, not whichever change was nominally assigned the rule.

## Check

Needs `node` (ES modules, no dependencies). The script path is relative to this
skill's directory; the repo it checks is `--root`, which defaults to the current
directory — so run it from the project root, or pass `--root`.

```bash
node scripts/coverage-check.mjs [<change>] [--root <repo>] [--json]
```

Options: `--root`, `--index`, `--coverage`, `--tc`, `--json`. Omit the change
name for domain-level checks with no gate. It only reads; every fix is an edit
you make to the ledger or a spec.

| exit | meaning | fix where |
|------|---------|-----------|
| `0` | clean | — |
| `1` | bookkeeping broken | the ledger, a `Source:` anchor, or a spec |
| `2` | gate blocked for `<change>` | that change's specs |

Orphan detection **defers** while any atom is `⬜ pending` (`S09d`): an untraced
requirement cannot be told apart from an unreconciled one, and computing it on
partial data would flag every requirement of every unreconciled change.

## Reporting

Report the rollup, and **every** `⛔` and `❌` atom in full. Never compress gaps
into "a few minor items". State the concrete next action per finding: fix the
spec, write a new upstream rule, or record the deferral with a named owner.

Report uncovered atoms as domain-level, so nobody reads them as a defect of the
change just checked.

## Re-patching the schema after an upgrade

Three edits under `openspec/schemas/super-flow-normal/` — two instruction hooks
and the spec template's anchor slot. Both files are vendored, so an upgrade drops
all three. Verbatim recovery text:
[references/schema-hooks.md](references/schema-hooks.md).

```bash
grep -c "UPSTREAM COVERAGE GATE" openspec/schemas/super-flow-normal/schema.yaml
grep -c "Source:" openspec/schemas/super-flow-normal/templates/spec.md
```

Expect `2` and non-zero.

## Completion

Report:

- The stage run (`spec` / `test`), the change gated if any, and the checker's
  exit code.
- The rollup per ledger, then **every** `⛔ contradiction` and `❌ uncovered`
  atom in full — uncovered ones labelled domain-level.
- Ledgers created or extended, and the version each is pinned to.
- `Source:` anchors written, and the result of `openspec validate <change>`.
- Whether the matching ran in a fresh context or inline — inline weakens the
  result and belongs in §1 of the ledger too.
