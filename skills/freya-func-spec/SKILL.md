---
name: freya-func-spec
description: Write, extract, normalize, and baseline business rules (BR-xxx) in functional-spec/. Use when creating or editing business rules specs, extracting rules from meetings or code behavior, writing requirement-style documentation, or when the user mentions business rules, BR-xxx, the functional-spec/ folder, or asks to baseline / merge a functional-spec change document into its topic chapter.
---

# Functional Specification

Write and maintain business rules documents in `functional-spec/`. Output is **requirement-style, testable assertions** — not user operation guides or technical specs.

The goal is a chapter a BA or QA reader can navigate: clean, concise, and complete on the business rules. Every structural device below exists to serve that; none of them is worth adding to a chapter that does not need it.

## Before writing

1. Read [functional-spec/README.md](../../../functional-spec/README.md) — it owns this project's **domain codes**, scope table, and reference chapters
2. Check [appendix/business-rules-index.md](../../../functional-spec/appendix/business-rules-index.md) for existing IDs — never duplicate or renumber
3. Cite terms from the glossary chapter rather than redefining them
4. Start new chapters from [references/chapter-template.md](references/chapter-template.md)

## Chapter structure

Document order is reading order — understand the domain, see the behavior at a glance, then look up the atom for the case in hand:

| # | Section | Normative? | Answers |
|---|---------|-----------|---------|
| 1 | `## Domain Model` | Yes (invariants) | What exists, what is always true, which axes the behavior varies along |
| 2 | `## Derived Views` | No | The whole domain in a handful of tables |
| 3 | `## Business Rules` | Yes | What is testable for a specific trigger |

- **Rules go last.** Nobody reads dozens of atoms front to back; they are looked up by ID. Reference material belongs at the back.
- **Position is not authority.** Views precede the rules for readability but stay derived: no constraint may exist only in a view, and on disagreement the cited rule or invariant governs. State this in the section's own lead paragraph.
- `## Domain Model` is the structural authority for the domain; `## Business Rules` is the testable authority for a given trigger. A rule may never contradict an invariant.
- Write the Domain Model **first**, and revise it whenever a new rule fits no existing cell — that misfit means the model is wrong or incomplete.
- Cross-chapter interactions go in the Domain Model's boundary contract. There is no `## Cross-cutting Constraints` section.

### Scale the apparatus to the chapter

Do not impose the full structure on a small domain — scaffolding that outweighs its content makes a chapter *less* readable, not more.

| Chapter size | What it needs |
|--------------|---------------|
| Under ~10 rules | Domain Model as **Overview + Key Terms + Actors**, plus invariants if any exist. Skip dimensions, capability matrix, and Derived Views unless a real matrix or state machine is called for. Rules stay flat at `###`. |
| ~10–20 rules | Add variation dimensions and whichever views earn their place. Group the rules once groups are obvious. |
| Over ~20 rules | Full apparatus: dimensions, capability matrix, boundary contract, grouped rules at `####` under `###` groups, and a group navigator table. |

The parts of a full Domain Model: Overview · Object model · Variation dimensions (3–8 orthogonal axes; every rule is a cell over them) · Invariants · Capability matrix (one row per operation) · Domain boundary contract (owns vs delegates) · Key Terms · Actors and Roles.

Naming the **dimensions** is what makes a domain describable as a whole: a reader who learns six axes can place any rule instead of memorising rules.

### Derived Views

Open with a lead paragraph telling the reader to start here and stating that views are derived. Put lookup matrices first and flows last; lead with whatever gets consulted most, usually the privilege or permission summary. Every row cites its rule or invariant.

| View | Write it when |
|------|---------------|
| Rule matrix | State × action × outcome beats prose, or several rules share one shape (one permission gate per operation) — the matrix is the readable form, the atoms stay traceable |
| State machine | The domain has a lifecycle |
| Flow `FL-{DOMAIN}-{NN}` | Ordering itself carries a rule — what commits when, what is re-checked before commit, what survives a mid-flow failure |
| Mermaid diagram | The shape is the content — object cardinality, a lifecycle graph, a flow with a failure branch, a decomposition, two mechanisms readers conflate |

Flows and diagrams are the two easiest things to over-produce, and both have a hard test for whether they belong. Format, tests, diagram types, and the renderer caveat: [references/rule-template.md](references/rule-template.md).

### Business Rules

Group rules under thematic headings that follow the domain model, each with its `_Rules: BR-xxx–yyy_` inventory so the index can be cross-checked. In a grouped chapter, groups are `###` and atoms are `####` so the TOC nests rules under their group; the same applies to `### Invariants` with `#### INV-xxx` beneath.

Past ~20 rules, open the section with a group navigator (`Group | Rules | Covers`) at **group** granularity, reusing the group headings verbatim. A row per rule duplicates every summary and drifts.

## Atoms

Two normative atom types. Pick by asking whether an action invokes the statement. Full field guidance: [references/rule-template.md](references/rule-template.md).

```markdown
#### BR-{DOMAIN}-{NNN} <short title>

**Applies to**: <object type or actor>
**Trigger**: <action or event that invokes this rule>
**Rule**: <single testable MUST/SHALL statement>
```

`Applies to`, `Trigger`, `Rule` are **required**. `Preconditions`, `Exceptions`, `Denial behavior`, `Related rules` are **conditional — omit the whole line unless it carries information**; never pad with `None` / `N/A` / `—`. `Example` (illustrative) is optional and non-normative.

```markdown
#### INV-{DOMAIN}-{NN} <short title>

**Applies to**: <scope over which the invariant holds>
**Invariant**: <single structural statement in normative language>
**Related rules**: <BR-xxx that specialise it>
```

Invariants have no Trigger, Preconditions, or Denial behavior, and live under `## Domain Model` — never inside `## Business Rules`.

### IDs

- `BR-{DOMAIN}-{NNN}` · `INV-{DOMAIN}-{NN}` · `FL-{DOMAIN}-{NN}` for flows · `OQ-{DOMAIN}-{NNN}` for open questions
- **`{DOMAIN}`** is a short uppercase code for the subject area, defined per project. Establish the list in `functional-spec/README.md` before authoring, and reserve one code (conventionally `X`) for cross-cutting rules. Never use `INV` as a domain code — it collides with the invariant prefix.
- Next sequence number in the domain; never renumber
- Register `BR-xxx` and `INV-xxx` in `appendix/business-rules-index.md`. `FL-xxx` is not indexed — the index carries normative atoms only.

## Writing rules

**Do**

- Write one testable conclusion per rule, in MUST / SHALL / MUST NOT language
- State denial behavior when the rule blocks something
- Split compound conditions into separate rules
- Replace repetition with a matrix — and keep the atoms for traceability
- Mark unknowns as Open Questions (`OQ-xxx`) — do not guess

**Do not**

- Write UI steps ("click", "navigate to", "select from dropdown")
- Include class names, API endpoints, database tables, or file paths
- Pad conditional fields, or bundle independent constraints into one rule
- Put behavior into a Key Terms definition, or a normative claim into Scope prose
- Let a constraint exist only in a matrix, flow, or diagram
- Use vague words without exceptions: "usually", "may", "might", "often"
- Duplicate a rule already in the index under a new ID

## Workflow

**Extract from input** (meeting notes, informal requirements, observed behavior)

1. Identify objects, actors, and the axes behavior varies along → draft the domain model
2. Lift the timeless statements into invariants
3. Convert each triggered constraint to a rule atom
4. Check the index — update in place if behavior changed, new ID if new
5. Flag ambiguities as Open Questions

**New chapter**

1. Copy `references/chapter-template.md` to `functional-spec/draft/{topic}.md`
2. Fill Document Control, Purpose, Scope
3. Write the Domain Model, sized per the table above
4. Write the rules, grouped to follow the domain model
5. Add only the views that earn their place
6. List Open Questions

**Normalise an existing chapter**

1. Reconstruct the domain model from the rules already there
2. Move smuggled structural statements out of Key Terms / Scope / repeated `Rule` clauses into invariants
3. Delete empty conditional fields
4. Collapse same-shaped rule families into a matrix, keeping the IDs
5. Reconcile: every rule should be locatable as a cell over the dimensions

**Baseline a change document** — triggered by "baseline", "merge this change into its topic chapter", or a named change document

Some projects separate **topic chapters** (current released behavior) from **change documents** (one per feature in flight), and merge the latter into the former once the behavior ships. Where that is the case, `functional-spec/README.md` defines the operation — its trigger, its unit, and exactly which sections it must rewrite. **Read that section and follow it; do not improvise a merge.** If the README defines no such split, this workflow does not apply.

Two things hold wherever the operation exists:

- It is a **semantic rewrite, not a copy**. A rule that amends an earlier one replaces it, so the chapter states one current behavior — never both, and never a "delta vs" section.
- The unit of rewriting is the rule atom, but **the unit of consistency is the chapter**: after baselining, the Domain Model and Derived Views must describe exactly the rules the chapter now holds. Regenerate views from the current rule set rather than patching rows.

**The rewrite is only half the operation.** A baselining that stops at the chapter leaves the change document sitting in `changes/`, the index pointing at it, and every pointer elsewhere in the repo naming a document that no longer holds the behavior — which is what makes a "finished" baselining fail review. Before starting, read the project README's procedure and confirm it covers each of these; where it does not, they are still the minimum:

1. **Release evidence** — the increment is actually live. Do not infer it, and do not mark it released yourself.
2. **Destination** — resolved from the project's domain → chapter map, not guessed from the change document's filename.
3. Chapter rewrite (above), including **stripping what only the change document may carry**: delta framing, `Amendment:` notes, and any implementation detail the change document inherited from its technical spec.
4. **Withdrawn IDs** — a replaced rule's ID is never reused and never silently vanishes; record its fate where the project registers IDs, and drop it from the `Related rules` of atoms that cited it.
5. **Index** rows repointed to the chapter; **change-log** row added.
6. **Change document** manifest updated, then archived per the project's rule.
7. **Pointer sweep** — `grep` the slug across the repo; README tables, overview documents, agent instruction files, and downstream ledgers all name it.

Surface what you rewrote and what you judged, and never do this unattended — a first baselining into a new chapter means authoring a Domain Model from scratch, and the invariants for it are never already IDed: they are sitting in the change document's overview prose, its Key Terms cells, and clauses repeated across several of its rules.

**Finalize**

1. Move from `draft/` to `functional-spec/` root when approved
2. Register new `BR-xxx` / `INV-xxx` in `appendix/business-rules-index.md`
3. Record semantic changes in `appendix/change-log.md`

## Quality checklist

- [ ] Structure matches the chapter's size — no apparatus a small chapter does not need
- [ ] Every rule is locatable as a cell over the stated dimensions
- [ ] No rule contradicts an invariant; no invariant merely restates one rule
- [ ] Every rule has Applies to / Trigger / Rule, is independently testable, and pads no conditional field
- [ ] Key Terms cells are definitions, not behavior
- [ ] Every view row cites a rule; each flow and diagram passes its test in the field guide
- [ ] No implementation detail (classes, APIs, schemas) and no UI operation steps
- [ ] Glossary terms linked, not redefined; new IDs registered; Open Questions listed
- [ ] After a baselining: no superseded wording left in the chapter, and no view row cites a rule the chapter no longer holds
- [ ] After a baselining: change document archived, index repointed, change-log row added, and `grep <slug>` returns only the archive and the change-log

## Reference

| File | Why |
|------|-----|
| [references/rule-template.md](references/rule-template.md) | Field-by-field guidance; matrix, flow, and diagram rules |
| [references/examples.md](references/examples.md) | Before/after contrasts for common defects |

Once this project has authored chapters, add its own best ones here — a real chapter is a better reference than any template.

## Relationship to other artifacts

| Artifact | Location | Purpose |
|----------|----------|---------|
| Requirements | `requirements/` | WHAT we want built — raw prescriptive input, distilled into BR-xxx before it belongs here |
| Business rules spec | `functional-spec/` | WHAT the system does (this skill) |
| Technical specs | `openspec/specs/` | HOW the implementation satisfies behavior — developers only; cites real classes and files |
| Test specs | per project — a top-level directory, or per-change alongside the technical spec | HOW QA and agents test it |
| Development docs | per project | Integration and API guides for developers |

The last two locations vary by project; `functional-spec/README.md` names them. Do not guess a path — citing a directory the repository does not have sends every later reader looking for it.

Do not port conventions between layers. In particular, the no-implementation-detail rule above holds **because** a separate technical-spec layer owns class names, endpoints, and schemas. If this project has no such layer, decide deliberately where that detail lives before dropping the rule.
