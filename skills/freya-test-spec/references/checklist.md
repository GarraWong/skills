# freya-test-spec verification checklist

Run before declaring a change's `test_spec/` complete or promoting on archive. Merges v1 completeness checks with v2 TS+TC gates from [2026-07-13-test-spec-v2-design.md](../../../../docs/superpowers/specs/2026-07-13-test-spec-v2-design.md).

Also run [red-flags.md](red-flags.md) — **STOP** on any Red Flag.

## Phase gates

- [ ] **Inventory** covers all Scenarios (+ NFRs for performance) before any TC bodies were written
- [ ] Child file exists for every `specs/<capability>/`
- [ ] `api-contracts.md` exists (or explicit "No API changes")
- [ ] Index `test_spec.md` authored only after all in-scope capability files complete

## TS + TC completeness

- [ ] Each OpenSpec Scenario → exactly one TS (`TS-{CAP}-{NNN}`)
- [ ] Each TS → at least one TC
- [ ] Each TS → **`TC-*-MAN-HP`** (minimum manual happy path)
- [ ] NEG / ERR / BND TCs present when Scenario describes denial, failure, or boundary
- [ ] Child matrix / Traceability Matrix: every row → `yes` / fully populated
- [ ] No orphan TC (every TC traces to a TS and Scenario via Traces)

## Execution format (v2)

- [ ] All MAN TCs use `| Step | Action | Expected result |` — one expected per step
- [ ] All API TCs use Step–Expected execution + Assertions table
- [ ] All UI TCs use Step–Expected + UI hints table
- [ ] JMTR TCs cite design NFR thresholds (not invented)
- [ ] SEC TCs use Step \| Burp action \| Expected; scope from contract or documented route only
- [ ] No v1-style numbered Steps list with separate Expected result bullet block

## Traceability Matrix (index)

- [ ] Master matrix columns: Requirement \| Scenario \| TS-ID \| TC-IDs \| KINDs \| ST \| File \| Covered
- [ ] Long-chain rows: `Source: cross-domain` → TS-X → TC-X-*
- [ ] NFR rows: `Source: design.md NFR` → TS-PERF → TC-*-JMTR-*
- [ ] **TS-X / TC-X** authored in index only after all capability files complete
- [ ] Index does not duplicate full single-domain Steps from child files

## API contracts

- [ ] `api-contracts.md` frontmatter `source:` is `api-contract.yaml` (or explicit N/A)
- [ ] Every ADDED/MODIFIED entry in `api-contract.yaml` `x-api-change` / `paths` has an `API-*` row
- [ ] Extraction is a **full OpenAPI mirror**: every used `components/schemas` entry (incl. each `*Params`) has a `Field | Type | Required | Notes` table — not a thin summary / "unchanged catalog" collapse
- [ ] No invented request/response fields (`incomplete` + OQ if missing from yaml)
- [ ] API KIND TCs cite `API-*` only when contract is **complete** (not `incomplete`)
- [ ] API generation ready only when contracts have no unresolved `incomplete`

## Field rules

- [ ] Every TC has Parent TS, KIND, ST, Priority, Traces (Spec + Design + BR or `none` + reason)
- [ ] Preconditions, Test data, Freya-Docs-TA path, Environment tags on every TC
- [ ] Environment tags ⊆ {DEV, QA, DSO, SQA, Pre-Prod, PROD}
- [ ] Primary repo path under Freya-Docs-TA (or `to be generated`)
- [ ] `cap_code` declared in capability file frontmatter

## Scope and anti-hallucination

- [ ] Non-Goals copied from `design.md` and marked out of scope; no in-scope violation in TCs
- [ ] Did not read other `openspec/changes/<other>/` content for this generation
- [ ] Did not use `openspec/specs/` as SDD authority
- [ ] No TS/TC IDs in OpenSpec `spec.md` files
- [ ] Open Questions listed where automation is blocked; OQ does not invent URLs, payloads, locators, or NFR numbers

## Promote readiness (unchanged from v1)

- [ ] All checklist items above pass
- [ ] No open Red Flags
- [ ] Full package ready to copy `openspec/changes/<change>/test_spec/` → `test_spec/<change>/`
