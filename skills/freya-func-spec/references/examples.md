# Annotated Rule Examples

Before-and-after contrasts for the defects that reference prose describes but
cannot show. Field-by-field guidance lives in `rule-template.md`; this file only
carries cases where seeing the wrong version next to the right one is the point.

Examples use placeholder domain codes (`ORD` orders, `ACCT` accounts). **Replace
these with real defects from this project's own chapters as soon as it has
some** — a defect a reviewer recognises teaches far better than a generic one.

## Good — single assertion, testable, complete

```markdown
#### BR-ORD-005 Orders on hold block all state transitions

**Applies to**: Order

**Trigger**: User attempts a state transition

**Preconditions**: Order carries the On Hold marker

**Rule**: The system MUST NOT apply any state transition requested by a user.

**Exceptions**: Scheduled settlement jobs

**Denial behavior**: Transition rejected with a business error; order state unchanged
```

Why it works: one object, one unambiguous constraint, an explicit carve-out, and
a test-observable outcome. Note what is **absent** — no `Related rules` line,
because this rule stands alone, and padding it with `None` would say nothing.

---

## Bad — UI operation guide (wrong document type)

```markdown
## How to cancel an order

1. Navigate to the order in the orders list
2. Click the three-dot menu
3. Select "Cancel order"
4. Confirm the cancellation dialog
```

Fix — extract the constraint the procedure implies:

```markdown
#### BR-ORD-012 Shipped orders cannot be cancelled

**Applies to**: Order
**Trigger**: User attempts to cancel an order
**Preconditions**: Order has at least one shipped line item
**Rule**: The system MUST reject the cancellation.
**Denial behavior**: Cancellation rejected with a business error; order unchanged
```

The procedure is not wrong, it is the wrong artifact — it belongs in user
documentation. What the spec owes a reader is the constraint the dialog enforces.

---

## Bad — implementation detail (belongs in the technical spec layer)

```markdown
#### BR-ORD-010 Status change validation

**Rule**: `OrderController.changeStatus` SHALL call `orderStateService.applyTransition` and return `Result.failure` when status codes mismatch.
```

Fix — state the business behavior, which is what QA can test and what survives a
refactor:

```markdown
#### BR-ORD-010 Stale status rejected on state change

**Applies to**: Order
**Trigger**: User submits a state change carrying an outdated current status
**Preconditions**: Submitted current status does not match the live order status
**Rule**: The system MUST NOT apply the transition and MUST inform the user the page is stale.
**Denial behavior**: Transition blocked; user prompted to refresh
```

---

## Bad — Example that smuggles in a new constraint

The `Example` line is non-normative, which makes it the easiest place to hide a
claim no rule makes.

```markdown
#### BR-ACCT-002 Owner permission exemption

**Rule**: The record owner MUST pass record-level permission checks on that record without a matching permission entry.
...
**Example** (illustrative): An owner can always delete their own order, even one on hold.
```

Why it's wrong: the example asserts an On Hold override the Rule never states —
and one that contradicts the hold rules elsewhere. If that behavior were real it
would need its own `BR-xxx`.

Fix — let the example replay only what the Rule says:

```markdown
**Example** (illustrative): An owner with no explicit permission entry on their own order still passes the record-level check — provided they also hold the required functional permission and no marker or state block applies.
```

A good `Example` adds no condition, only specificity — it names the permission
codes and states the Rule already uses:

```markdown
**Example** (illustrative): A service account whose configured list includes ORDER_VIEW but not ORDER_CREATE can view an order it has no explicit entry on, but a create request is rejected because ORDER_CREATE is not in its list.
```

---

## Bad — invariant forced into a rule

```markdown
#### BR-ORD-0xx Line item ownership

**Applies to**: Line items on an order
**Trigger**: System classifies line item values
**Rule**: Line items MUST belong to the order revision, not to the product catalog entry.
```

Why it's wrong: "System classifies …" is not a trigger — nothing invokes it. The
statement holds before, during, and after every action in the domain, so forcing
it into a rule atom requires inventing a fake trigger, and the fact then competes
with the real rules for authority.

Fix — state it once as an invariant and let the rules cite it:

```markdown
#### INV-ORD-03 Line items belong to the order revision

**Applies to**: Line items on any order revision
**Invariant**: A line item MUST belong to the order revision that carries it, not to the product catalog entry it references. The same product MAY therefore appear with different prices and quantities on different revisions of the same order.
**Related rules**: BR-ORD-004, BR-ORD-015
```

---

## Bad — structural fact smuggled into a Key Terms cell

```markdown
| Term | Definition |
| --- | --- |
| Order revision | A numbered revision `x.y` of an order (not the product catalog version). The page for a revision lists only line items keyed to that revision. When a new revision is created, line items from the prior revision are **copied** onto it; thereafter each revision's line items are independent (including add / remove / reprice) |
```

Why it's wrong: that cell is three normative claims with no ID, no test hook, and
no place in the index — it became a paragraph precisely because the chapter had
no invariant layer to put it in.

Fix — keep the definition, move the behavior to invariants and cite them:

```markdown
| Order revision | A numbered revision `x.y` of an order. Keying and per-revision isolation: INV-ORD-02, INV-ORD-03 |
```
