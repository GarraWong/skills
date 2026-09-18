# Phase 1 — Inventory

Complete this table **before** writing any TC execution bodies. Inventory is the gate for Phase 2.

## Output table

| Capability | Requirement | Scenario | TS-ID (planned) | TC-IDs (planned) | Status |
|------------|-------------|----------|-----------------|------------------|--------|
| annotation-audit-trail | Audit Event Capture for Annotation Lifecycle | Create event captured | TS-AUDIT-001 | TC-AUDIT-001-MAN-HP | pending |
| annotation-audit-trail | Audit Event Capture for Annotation Lifecycle | Access denial captured | TS-AUDIT-002 | TC-AUDIT-002-MAN-NEG, TC-AUDIT-002-SEC-NEG | pending |
| annotation-audit-trail | Transactional Outbox Delivery Guarantee | Platform Audit temporarily unavailable | TS-AUDIT-003 | TC-AUDIT-003-MAN-ERR | pending |
| … | … | … | … | … | pending |

Add rows for **every** `#### Scenario:` under each `### Requirement:` in `specs/<capability>/spec.md`.

## Rules

1. **Enumerate all Scenarios** — one inventory row minimum per OpenSpec Scenario; never skip a Scenario because it "looks similar" to another.
2. **Plan TS-ID** — assign `TS-{CAP}-{NNN}` in scenario order within the capability; `cap_code` comes from capability file frontmatter (see [id-kind-st.md](id-kind-st.md)).
3. **Plan TC-IDs** — list planned `{KIND}-{ST}` variants per TS:
   - **Required:** at least `MAN-HP` per TS.
   - **NEG / ERR / BND:** when Scenario title or WHEN/THEN describes denial, failure, or boundary.
   - **SEC:** when authZ, IDOR, or sensitive-data exposure is in scope.
   - **API / UI:** only when `api-contracts.md` is complete or UI flow is documented.
   - **JMTR:** when design NFR defines measurable latency/load (often index-level `TS-PERF` instead).
4. **NFR rows** — add inventory rows sourced from `design.md` NFRs for performance planning (`TS-PERF-*`, `TC-PERF-*-JMTR-*`); these typically land in index `test_spec.md`, not capability files.
5. **Status column** — use `pending` until Phase 2 completes the capability file; then `done`.
6. **No TC bodies until inventory done** — do not write Step–Expected tables, Preconditions detail, or Freya-Docs-TA paths until every in-scope Scenario (and planned NFR) has a row with planned TS-ID and TC-IDs.
7. **No invented endpoints** — if API/UI/SEC scope is unknown, plan `OQ-{CAP}-NNN` in Phase 2 and list TC as `blocked` in Status notes; do not fabricate URLs or payloads in the inventory.
8. **Scope fence** — inventory only the current change package (`openspec/changes/<change>/`); do not pull Scenarios from other changes or `openspec/specs/`.

## Where to put the inventory

- **Scratch section** at the top of `test_spec/test_spec.md` (remove or collapse after Traceability Matrix is populated), or
- **Child matrix** in each `<capability>.md` with `Covered: no` until Phase 2 completes.

After Phase 2, the master **Traceability Matrix** in `test_spec.md` supersedes the scratch inventory as the authoritative coverage view.

## Gate check (before Phase 2)

- [ ] Every `specs/<capability>/spec.md` Requirement + Scenario has a row
- [ ] Every row has a planned TS-ID
- [ ] Every row lists at least one planned TC-ID including `*-MAN-HP`
- [ ] NFR / performance test points from design are listed (if any)
- [ ] No TC execution bodies written yet
