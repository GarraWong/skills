# Atom and View Field Guide

Deep reference for the formats named in `SKILL.md`. Field-level detail lives here
and nowhere else.

Examples below use placeholder domain codes (`ORD` orders, `ACCT` accounts,
`PERM` permissions). Replace them with this project's own codes.

| Atom | ID | Use when |
|------|----|----------|
| Business rule | `BR-{DOMAIN}-{NNN}` (`FR-` in a feature document) | An action or event invokes the statement |
| Invariant | `INV-{DOMAIN}-{NN}` | The statement is true before, during, and after every action in the domain |

---

## Business rule fields

**Required:** `Applies to`, `Trigger`, `Rule`. A rule missing any of these is not
testable.

**Conditional:** `Preconditions`, `Exceptions`, `Denial behavior`,
`Related rules`. Include one **only when it carries information**; otherwise
delete the whole line.

```markdown
**Exceptions**: None                                 <- delete the line
**Denial behavior**: N/A                             <- delete the line
**Denial behavior**: N/A (display rule)              <- delete the line
**Denial behavior**: N/A (mode is fixed per tenant)  <- delete the line
**Related rules**: None                              <- delete the line

**Denial behavior**: N/A for defaults; row filtering per BR-ORD-021  <- keep, it says something
**Exceptions**: None (a missing avatar uses the placeholder)         <- delete; that belongs in the Rule
```

Why: a chapter with 57 rules and 50 `Exceptions: None` lines trains readers and
agents to skip the field set, so the exceptions that *do* exist get skipped too.
Absence of an exception is already the default reading of a MUST statement.

### Applies to

The business object or actor the rule governs.

`Order` · `Account` · `User with ORDER_CANCEL permission` · `Order in Submitted state`

### Trigger

The user action or system event that causes the rule to be evaluated.

`User submits an order for approval` · `User cancels an order` · `System closes a billing period`

If no action invokes it, you are writing an invariant.

### Preconditions

What must be true before the rule applies — distinct from the rule itself. Omit
when the rule applies unconditionally.

`Order carries the On Hold marker` · `Account has unpaid invoices` · `Order is the latest revision`

### Rule

A single testable statement in normative language.

Good:
- `Orders on hold MUST NOT have any state transition performed by users.`
- `Accounts with unpaid invoices MUST NOT be closed.`

Bad:
- `Holds prevent changes.` — too vague: what changes, who is blocked?
- `Accounts can't be closed with unpaid invoices unless the user is an admin.` — two rules bundled

### Exceptions

Explicit carve-outs, including system paths that bypass the rule.

`Scheduled settlement jobs` · `Administrator with ACCOUNT_FORCE_CLOSE permission`

### Denial behavior

What the system does when the rule blocks the action. Describe a user-visible or
test-observable outcome, not implementation. Omit when the rule blocks nothing —
display, classification, and side-effect rules.

`Operation rejected with a business error` · `Transition not offered in the allowed-transitions list` · `Silent block — action not available in the UI`

### Related rules

Rules that interact with this one, and the invariant it specialises.

`BR-ACCT-001` · `INV-ORD-02`

### Example (optional)

A concrete scenario that helps a reader understand the rule. **Non-normative:**
it may only illustrate the Rule, never add a condition or outcome. If an example
seems to introduce a constraint, that constraint belongs in its own rule.

Business terms only — no UI steps, class names, endpoints, or file paths. Reuse
the permission codes and states the rule already names. Omit when the rule is
self-explanatory.

`A user holds ORDER_VIEW but is not on the order's account team and is not its owner — the view is denied.`

---

## Invariants

```markdown
#### INV-{DOMAIN}-01 <short title>

**Applies to**: <scope over which the invariant holds>

**Invariant**: <single structural statement in normative language>

**Rationale**: <optional — why the product works this way>

**Related rules**: <BR-xxx / FR-xxx that specialise it>
```

An invariant is not a rule with the Trigger deleted. Test: if you can name an
action that invokes it, it is a rule (`BR`/`FR`). If it holds before, during, and after every
action in the domain, it is an invariant.

### What belongs here

- Identity and classification — `A quote is an order and follows the same approval model.`
- Keying and ownership — `A line item belongs to the order revision, not to the product.`
- Scope isolation — `Each order revision's line items are isolated from every other revision's.`
- Domain-wide model laws — `Exactly two denial presentations exist in this domain.`

### Where these statements hide

When normalising an existing chapter, invariants are already present but
un-IDed. Look in:

1. **Key Terms cells that grew into paragraphs.** A definition that explains
   keying, copying, or isolation is an invariant wearing a term's clothes. Move
   the behavior, leave the definition.
2. **`Rule` clauses that restate a shared premise.** When five rules each open
   by re-establishing the same fact, that fact is an invariant they should cite.
3. **Scope prose.** "Submitted orders remain editable by their owner" is a
   normative claim with no ID.

Do not create an invariant that only restates one rule — that is duplication,
not a layer.

---

## Views

Non-normative. Every row cites the rule that governs it, and no constraint may
exist only in a view.

### Matrix instead of repetition

When many rules share one shape — state × blocked actions, one permission gate
per operation — the matrix is the readable form and the atoms stay the traceable
one. Keep both:

| State / Marker | Blocked actions | Allowed targets | Rule ref |
|----------------|-----------------|-----------------|----------|
| On Hold | All state transitions | None (user-initiated) | BR-ORD-005 |

Each row representing a distinct testable constraint still needs its own
`BR-xxx` / `FR-xxx` in the index.

### Flows

Write one **only where ordering itself carries a rule** — what commits when,
what is re-checked immediately before commit, what survives a mid-flow failure.
Cite rules per step; split into `Na` / `Nb` where the outcome branches.

```markdown
### FL-ORD-01 Create, then submit for approval

**The step order is itself normative**: the order is created before submission
is attempted, which is why it survives a failed submission (INV-ORD-04).

| # | Actor | System behavior | Rules |
| --- | --- | --- | --- |
| 3 | System | **Creates the order** in Draft. Audit: Creation | BR-ORD-030, BR-ORD-047, INV-ORD-04 |
| 4 | System | Re-evaluates permissions **immediately before the submission commit** | BR-ORD-051, INV-ORD-05 |
| 5a | System | Checks pass → order submitted. Audit: Submission | BR-ORD-047 |
| 5b | System | Checks fail → the Draft from step 3 **remains**; no Submission audit | BR-ORD-051, INV-ORD-04 |
```

That earns its place because no rule atom can state "step 3 happens before step
4", yet both BR-ORD-051 and BR-ORD-047 depend on it.

**Test:** shuffle the rows. If nothing is lost it was a list of rules — cut it.
A flow narrating clicks is a user guide and belongs nowhere in this repository,
and a flow is never the authority for a constraint: if a step states something no
cited rule states, that belongs in a rule.

### Diagrams

Fenced ``mermaid`` code blocks. **Never a binary format** (`.xmind`, `.vsdx`,
`.drawio`): it cannot be diffed, cannot be reviewed in a pull request, and pulls
the truth out of the Markdown.

A diagram is a view of something already stated in text, never a carrier. Place
it immediately after what it visualises and say in one line that the text
governs.

| Draw | Type | For |
|------|------|-----|
| Object model | `erDiagram` | Objects, cardinality, what keys what |
| State machine | `stateDiagram-v2` | A lifecycle a reader can trace, where a from/to table cannot be |
| Flow with a branch | `flowchart` | A flow whose point is a commit point and a failure branch |
| Contrast | `flowchart` | Two mechanisms readers conflate (copy vs inheritance) |
| Decomposition | `mindmap` | A taxonomy or scope breakdown — the shape is pure hierarchy, with no per-node attributes |

**Do not draw:** permission sets, column catalogs, action catalogs, denial
presentation, or the variation-dimensions table — those get grepped and diffed
row by row, and a picture of a matrix is strictly worse. Nor a flow that is a
straight chain with one terminal pass/fail fork: the fork is not a shape.

The line for `mindmap` is whether the content is *pure hierarchy*. A taxonomy of
object families or a scope breakdown is; the dimensions table is not — it carries
values, an owner, and rule refs per axis, and a mind map can only show the axis
names, so it duplicates the table while losing three of its four columns.

**Never draw for symmetry.** If one flow has a diagram its siblings do not
automatically need one; a picture that only retraces its own table is noise and
implies it is load-bearing when it is not. Add one sentence saying why a sibling
has none, so a reviewer does not read the asymmetry as an oversight.

Constraints:

- **~12 nodes maximum.** A diagram that needs scrolling has stopped clarifying — split it or drop it.
- **No styling** — no colours, `classDef`, or emoji. Structure only.
- **Spec terms verbatim** in labels, citing `BR-xxx` / `INV-xxx` where they fit. A node saying something no rule says is the same defect as a flow step doing it.
- Quote every label (`A["text"]`, `-->|"text"|`) and keep `(`, `)`, `#`, `;` out of label text — unquoted punctuation breaks older renderers.
- **Verify your renderer before relying on diagrams.** Mermaid support varies by host: some platforms render it in wiki pages but not in repo file preview, and `mindmap` is a newer diagram type that older mermaid versions reject outright. Render one of each type you plan to use in the actual target before committing to it — and because support is uneven, no fact may live only in a diagram.
