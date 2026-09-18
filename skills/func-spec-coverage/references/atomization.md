# Atomization

Splitting an upstream `BR-{DOMAIN}-{NNN}` rule into atoms is the step that
catches real omissions. Get the granularity wrong and the whole trace is
theatre: a rule marked `covered` because two of its six clauses landed.

Examples below use a synthetic `DOC` domain. Substitute your own domain codes,
rule text, and change names.

## Sub-ID grammar

```
BR-DOC-014.2     Rule clause 2
BR-DOC-014.D1    Denial behavior clause 1
BR-DOC-014.E1    Exceptions clause 1
BR-DOC-014.P1    Preconditions clause 1 (only when itself testable)
```

Sub-IDs never enter the functional spec — they live in
`openspec/coverage/<source-doc>.md`. But they are **not** scratch: every verdict
and `Covered by` path in that ledger references them, so they are append-only
contract, under the same rule the rule IDs have — *never renumber*.

Numbering runs in source order within each field. If you find a missed clause
after the ledger exists, **append** it with the next free sub-ID rather than
inserting it in sequence.

## Splitting rules

**One atom = one independently falsifiable statement.** The test is mechanical:
can you write a single test that fails if and only if this clause is violated?
If a statement needs two unrelated tests, it is two atoms.

### Split on

- Each separate MUST / SHALL / MUST NOT / SHALL NOT in the prose
- Each branch of a conditional pair — "exactly one file → X" and "more than one
  file → Y" are two atoms, because a system can get one right and the other wrong
- Each concrete pinned value: a filename pattern, a numeric bound, an ordering
  constraint, a privilege code, a default
- Each distinct actor or object the clause applies to

### Do not split on

- Sentence boundaries as such — one sentence can be one atom, or four
- Restatements of the same obligation in different words
- `**Example**` content, ever — it is explicitly non-normative and introduces
  no constraint beyond the Rule
- `**Related rules**` — a navigation hint, not an obligation

### Highest-risk fields

`**Denial behavior**` and `**Exceptions**` are the top two omission sources,
and for the same reason: they sit outside the `**Rule**` prose, so a generator
that reads the Rule and starts writing Scenarios never sees them. Atomize them
**first**, before the Rule field, to break that habit.

## Worked example

A rule of the shape this skill expects:

> ### BR-DOC-014 Export a record bundle
>
> **Applies to**: an active record bundle
> **Trigger**: the user selects Export
> **Preconditions**: the user can see the record and holds `Record_Export`
> **Rule**: Export SHALL NOT require re-authentication. When the bundle holds
> exactly one file, the system SHALL NOT offer a format choice and SHALL
> download that file under its original name. When the bundle holds more than
> one file, the system SHALL offer two options: a single archive, or each file
> separately. An archive download SHALL open in a new tab, and the archive SHALL
> be named `<Bundle Name>.zip`. Read-only access SHALL NOT be treated as export
> authorization.
> **Exceptions**: None
> **Denial behavior**: A retired bundle SHALL NOT be exported. Without
> `Record_Export` the Export action SHALL NOT appear.
> **Related rules**: BR-DOC-009, BR-DOC-021

Atomized — 11 atoms from what a careless pass reads as "the export rule":

| Atom | Field | Statement |
|------|-------|-----------|
| BR-DOC-014.D1 | Denial behavior | a retired bundle cannot be exported |
| BR-DOC-014.D2 | Denial behavior | without `Record_Export` the Export action does not appear |
| BR-DOC-014.P1 | Preconditions | export requires visibility of the record and `Record_Export` |
| BR-DOC-014.1 | Rule | export does not require re-authentication |
| BR-DOC-014.2 | Rule | a single-file bundle offers no format choice |
| BR-DOC-014.3 | Rule | a single-file bundle downloads that file under its original name |
| BR-DOC-014.4 | Rule | a multi-file bundle offers two options: single archive, or each file separately |
| BR-DOC-014.5 | Rule | an archive download opens in a new tab |
| BR-DOC-014.6 | Rule | the archive is named `<Bundle Name>.zip` |
| BR-DOC-014.7 | Rule | read-only access is not export authorization |

Note what the split exposes:

- `.2` and `.3` are separate. A build that downloads the right file but still
  shows the format dialog violates `.2` and satisfies `.3`.
- `.6` pins a concrete value. Compare it downstream character by character — a
  spec that says `<Bundle Name>-export.zip` is a `contradiction`, not a
  `partial`.
- `.7` overlaps whichever rule owns privileges (here BR-DOC-021). Keep it as an
  atom anyway — overlap is not duplication, and dropping it because "021 covers
  it" is how privilege clauses disappear.
- `.D1` and `.D2` came out first and are the two most likely to be missing
  downstream.

## Bad splits

| Bad atom | Why |
|----------|-----|
| `BR-DOC-014.1` — "bundle export rules" | Not falsifiable. No single test fails on exactly this. |
| `BR-DOC-014.1` — "single file downloads directly, multiple files offer two options, archive opens in a new tab" | Three obligations. Two can pass while one fails, and the atom still reads `covered`. |
| `BR-DOC-014.1` — "a three-file bundle offers archive or separate downloads" | Lifted from an `**Example**`. Non-normative, and it smuggles "three" in as if the count mattered. |
| Omitting `.7` because BR-DOC-021 also states it | Overlap ≠ duplication. Each rule's atoms stand alone. |

## Extending the ledger after a version bump

Atomization happens **once per source document**, not once per change. If
`openspec/coverage/<source-doc>.md` exists and its recorded **Version** matches
the document's, there is nothing to do — do not re-split. A re-split churns
sub-IDs and silently invalidates every verdict and `Covered by` path.

`C15` catches the reverse: a ledger still pinning an old version after the
document moved on.

When the upstream **Version** does change:

| Upstream change | Ledger action |
|---|---|
| clause text unchanged | keep the existing ID untouched |
| clause reworded, same obligation | keep the ID, update the Statement |
| clause obligation changed | keep the ID, update the Statement, and re-verdict it in every owning change |
| new clause | append the next free sub-ID |
| clause removed | keep the row, set Status to `🚫 retired` |

Bump the Version recorded in §1 in the same edit, and never renumber.

## Writing atoms in the spec's own language

Keep each Statement in the language of the upstream rule. Translating introduces
a second reading of the obligation, and the trace's whole premise is that a
verdict rests on quotable text rather than on paraphrase.
