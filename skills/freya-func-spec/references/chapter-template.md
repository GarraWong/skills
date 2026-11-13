# Functional Specification Chapter Template

Copy to `functional-spec/draft/{topic}.md`. Delete the `<!-- -->` comments and
every section this chapter does not need.

**Size the chapter to its content.** Under ~10 rules, keep the Domain Model to
Overview + Key Terms + Actors (plus invariants if any exist) and drop Derived
Views entirely — scaffolding that outweighs its content makes a chapter less
readable, not more. See [../SKILL.md](../SKILL.md) for the sizing table, and
[rule-template.md](rule-template.md) for every field and view rule referenced below.

Section order is reading order: `## Domain Model` → `## Derived Views` →
`## Business Rules`. Rules go last because they are looked up by ID, not read
through.

---

# <Chapter Title>

## Document Control

<!-- The project's functional-spec README owns the field list — copy it from
     there rather than from a neighbouring chapter, which may predate the
     current convention.

     Default below is a rolling topic chapter: identity and revision only.
     `Revision` is a document revision number, NOT a product version. `Status`
     is authoring completeness, not release approval. `Owner` is a role — a
     personal name goes stale the first time someone else edits the chapter.

     Where a project separates topic chapters from per-feature change
     documents, a change document carries the release-scoped fields instead
     (Version, Author, Reviewer, Baseline, work item, delivery manifest). Do
     not mix the two blocks. -->

| Field | Value |
| --- | --- |
| Domain |  |
| Status | Draft |
| Owner |  |
| Revision | 0.1 |
| Last Updated |  |

## Purpose

<!-- One paragraph: the domain this chapter covers and why these rules exist. -->

## Scope

**In scope:**

-

**Non-goals:**

-

## Audience

Business analysts, QA, implementation, support, compliance reviewers.

## Related Documents

| Document | Relationship |
| --- | --- |
| <glossary chapter> | Term definitions |

---

## Domain Model

<!-- Normative (the invariants are). Write this first; revise it whenever a new
     rule fits no existing cell. Keep only the subsections this chapter needs. -->

### Overview

<!-- What the domain does, who acts in it, what it produces. Add a table only
     where a fixed assignment exists (e.g. which host surface uses which mode). -->

### Object model

<!-- One row per object. "Owned by" names the chapter that defines it; objects
     defined elsewhere are cited, never redefined. Follow with the relations and
     their cardinality as a short list. -->

| Object | What it is | Owned by |
| --- | --- | --- |

### Variation dimensions

<!-- The 3–8 orthogonal axes behavior varies along, so a reader can place any
     rule as a cell instead of memorising rules. An axis with one value is not an
     axis — make it an invariant. Note that the cross-product is not fully
     populated. Skip this subsection in a small chapter. -->

| Axis | Values | Determined by | Governing rules |
| --- | --- | --- | --- |

### Invariants

<!-- Structural facts that hold independent of any trigger. Normative. This is
     where statements go that would otherwise be smuggled into a Key Terms cell
     or Scope prose. IDs are sequential and never renumbered; register them in
     appendix/business-rules-index.md. -->

#### INV-{DOMAIN}-01 <short title>

**Applies to**: <scope over which the invariant holds>

**Invariant**: <single structural statement in normative language>

**Related rules**: <BR-xxx / FR-xxx that specialise it>

---

### Capability matrix

<!-- One row per operation the domain offers; columns are the axes and outcomes
     that actually vary. Answers "what can I do here, and what changes between
     the options" without reading the rules. Cite the privilege gate rule rather
     than restating privilege sets — those belong in one Derived Views matrix. -->

| Operation | <axis / outcome> | <axis / outcome> | Rules |
| --- | --- | --- | --- |

### Domain boundary contract

<!-- What this chapter owns, and what it delegates — prevents both duplication
     and silent gaps at chapter seams. Also the only home for cross-chapter
     interactions: one row per concern, naming the owning chapter and rule IDs.
     There is no "Cross-cutting Constraints" section. -->

**Owned by this chapter:** <short list>

**Delegated:**

| Concern | Owner | Reference |
| --- | --- | --- |

### Key Terms

<!-- Terms not already in the project glossary chapter, and definitions only. A cell that grows
     into a paragraph of behavior is an invariant or a rule — move it. -->

| Term | Definition |
| --- | --- |

### Actors and Roles

| Actor | Role in this domain |
| --- | --- |

---

## Derived Views

<!-- Non-normative, placed before the rules because it is what a reader reads.
     Open with a lead paragraph that says to start here and that views are
     derived (position is not authority). Lookup matrices first, flows last.
     Every row cites its rule. Include only views that earn their place —
     usually none in a small chapter. -->

### <Most-consulted matrix — privileges, gates, or the equivalent>

| <Condition> | <Outcome> | Rule ref |
| --- | --- | --- |

### FL-{DOMAIN}-01 <flow name>

<!-- Only where ordering itself carries a rule. Say up front which ordering is
     normative and why. Split into Na / Nb where the outcome branches. Add a
     mermaid flowchart only when a branch is worth seeing. -->

| # | Actor | System behavior | Rules |
| --- | --- | --- | --- |

---

## Business Rules

<!-- Grouped to follow the domain model, each group carrying its ID inventory.
     Past ~20 rules, open with a group navigator (Group | Rules | Covers) at
     group granularity, reusing the group headings verbatim.

     In a grouped chapter groups are ### and atoms are ####, so the TOC nests
     rules under their group. An ungrouped small chapter may keep rules at ###.

     Fields: Applies to / Trigger / Rule always; Preconditions / Exceptions /
     Denial behavior / Related rules only when they carry information — omit the
     line, never pad with None or N/A. Example is optional and non-normative.

     Prefix: BR- below; new rules in a feature document use FR- instead. -->

| Group | Rules | Covers |
| --- | --- | --- |
| <Thematic group> | BR-{DOMAIN}-001–00N |  |

### <Thematic group>

_Rules: BR-{DOMAIN}-001–00N_

#### BR-{DOMAIN}-001 <short title>

**Applies to**: <object type or actor>

**Trigger**: <action or event that invokes this rule>

**Rule**: <single testable MUST / MUST NOT statement>

---

## Open Questions

| ID | Question | Owner | Status |
| --- | --- | --- | --- |
| OQ-{DOMAIN}-001 |  |  | Open |

## Change History

<!-- Columns match the Document Control block: a chapter tracks Revision and
     carries no Author. Semantic changes also get a row in the project's
     change-log appendix. -->

| Revision | Date | Description |
| --- | --- | --- |
| 0.1 |  | Initial draft |
