---
name: freya-test-spec
description: >
  Author and maintain Freya Docs test_spec documents (v2 TS + TC model) for QA agents
  under openspec/changes/<change>/test_spec/ and promoted test_spec/<change>/.
  Use when creating test specs, Traceability Matrix, TC blocks with KIND (MAN/API/UI/JMTR/SEC)
  and step-level Expected results, api-contracts from api-contract.yaml, inventory, promoting test_spec
  on archive, or when the user mentions test_spec, TS-*, TC-*, or API-*.
---

# Freya Test Spec (v2)

Write **agent-consumable** test specifications using the **TS + TC** model. Authority for SDD authoring:

1. `openspec/changes/<change>/specs/**/*.md` (required) — Requirements and Scenarios only; **no TS/TC in spec.md**
2. `openspec/changes/<change>/design.md` (required) — NFR, Non-Goals, decisions
3. `openspec/changes/<change>/api-contract.yaml` (required when HTTP surface exists) — OpenAPI paths + schemas for `test_spec/api-contracts.md`
4. `BR-xxx` — optional trace only (`none` + reason if none)

## Read first

| Document | Purpose |
|----------|---------|
| [2026-07-13-test-spec-v2-design.md](../../../docs/superpowers/specs/2026-07-13-test-spec-v2-design.md) | **Authoritative** v2 TS+TC model |
| [2026-07-11-test-spec-layer-design.md](../../../docs/superpowers/specs/2026-07-11-test-spec-layer-design.md) | v1 layout, authority, promote (still valid) |
| [test_spec/README.md](../../../test_spec/README.md) | Directory layout, generate order, promote |
| [test_spec/templates/](../../../test_spec/templates/) | capability, index, tc-*.md templates |
| [test_spec/environments.md](../../../test_spec/environments.md) | Environment tags, automation stack |

## Reference docs (use during authoring)

| Reference | Use when |
|-----------|----------|
| [references/inventory.md](references/inventory.md) | Phase 1 — plan TS/TC IDs; no TC bodies until done |
| [references/id-kind-st.md](references/id-kind-st.md) | Assigning TC-{CAP}-{NNN}-{KIND}-{ST} IDs |
| [references/examples.md](references/examples.md) | Good Step–Expected vs bad v1 patterns |
| [references/red-flags.md](references/red-flags.md) | **STOP** on any Red Flag |
| [references/downstream.md](references/downstream.md) | KIND → Freya-Docs-TA paths and required fields |
| [references/checklist.md](references/checklist.md) | Final verification before done / promote |

## Hard gates (never skip)

1. **Inventory first** — see [inventory.md](references/inventory.md). List every Requirement + Scenario (+ design NFR rows). **No TC execution bodies until inventory exists.**
2. **One capability at a time** — finish child matrix / all TC blocks before the next capability.
3. **Minimum MAN-HP** — every TS must have at least `TC-*-MAN-HP`.
4. **API contracts** — extract `test_spec/api-contracts.md` from `api-contract.yaml` (primary); never invent bodies. If yaml is `# api-contract: N/A`, write explicit "No API changes". API KIND TCs cite `API-*` **only when contract is complete** (not `incomplete`).
5. **Index last** — `test_spec.md` Traceability Matrix + TS-X + TS-PERF only after all in-scope capability files + api-contracts.
6. **TS-X after capabilities** — long-chain flows in index only when every capability file is done.
7. **Scope fence** — do not read other changes' folders or `openspec/specs/` during SDD generation.
8. **Red flags** — run [red-flags.md](references/red-flags.md); stop on any hit.

## Workflow — create test_spec for a change

### Phase 1 — Inventory only

1. Confirm `openspec/changes/<name>/` has `design.md`, `specs/*/spec.md`, and (when HTTP surface is expected) `api-contract.yaml`.
2. Create `openspec/changes/<name>/test_spec/` if missing.
3. Build inventory table per [inventory.md](references/inventory.md):
   - Every `#### Scenario:` → planned `TS-{CAP}-{NNN}` and `TC-IDs (planned)`
   - Add NFR rows from design for JMTR planning
   - **Do not write TC Step–Expected tables yet**

### Phase 2 — Per capability (TS + TC)

4. For each capability folder under `specs/`:
   - Copy [test_spec/templates/capability.md](../../../test_spec/templates/capability.md) → `test_spec/<capability>.md`
   - Set `cap_code` in frontmatter (see [id-kind-st.md](references/id-kind-st.md))
   - One `## TS-{CAP}-{NNN}` per Scenario (trace anchor)
   - Under each TS, nest `### TC-{CAP}-{NNN}-{KIND}-{ST}` blocks using [tc-*.md](../../../test_spec/templates/) templates:
     - **Required:** `TC-*-MAN-HP` with Step–Expected table (one expected per step)
     - **Add:** NEG/ERR/BND when Scenario implies denial or failure
     - **Add:** SEC when authZ/IDOR in scope; API when `api-contracts` complete; UI when user-visible flow; JMTR when NFR defines targets
   - Update child matrix: Requirement \| Scenario \| TS-ID \| TC-IDs \| Covered

### Phase 3 — api-contracts.md

5. Copy [test_spec/templates/api-contracts.md](../../../test_spec/templates/api-contracts.md) → `test_spec/api-contracts.md`
   - **Primary source:** `openspec/changes/<name>/api-contract.yaml`
     - Use `x-api-change` (added / modified / removed) for the catalog and Change column
     - Map each `paths` operation to an `API-{NNN}` row
     - If the file is only the N/A marker (`# api-contract: N/A`), write explicit "No API changes" and stop
   - **Rich extraction required — full OpenAPI mirror, not a thin summary:**
     - OpenAPI header meta + full `x-api-change` (added/modified/removed verbatim meaning)
     - Per-operation request/response tables + example JSON when helpful
     - Tool catalog table (if MCP/multi-tool facade)
     - **One `Field \| Type \| Required \| Notes` table per schema** under `components/schemas` that the endpoint uses — including every `*Params`, shared fragments (`PaginationFields`, `Identifier`, …), envelopes, and nested item schemas (`LinkedRecordEntry`, …)
     - Expand `allOf` into listed fields; keep enums, patterns, defaults, and empty/error message literals from yaml
   - **Anti-patterns (reject / rewrite):** collapsing dedicated Params into a one-line "unchanged catalog" blurb; listing schema names without field rows; omitting optional properties that exist in yaml
   - QA must be able to assert any yaml property from `api-contracts.md` without reopening the yaml for routine cases
   - **Cross-check:** `design.md` — do not add endpoints absent from yaml; record OQ if design and yaml disagree
   - Mark `incomplete` when request/response missing in yaml; add OQ — never invent schemas
   - Frontmatter `source:` must be `api-contract.yaml` (or N/A rationale)

### Phase 4 — Index test_spec.md

6. Copy [test_spec/templates/index.md](../../../test_spec/templates/index.md) → `test_spec/test_spec.md`
   - **Traceability Matrix** (Req → Scenario → TS → TC) — all rows populated
   - **TS-X / TC-X** — full E2E Step–Expected; only after all capability files complete
   - **TS-PERF / TC-JMTR** — from design NFRs with quoted thresholds
   - Non-Goals from design

7. Run [references/checklist.md](references/checklist.md) and [references/red-flags.md](references/red-flags.md). Stop if any item fails.

## Workflow — promote on archive

1. Copy `openspec/changes/<name>/test_spec/` → `test_spec/<name>/` (full package).
2. Add `PROMOTE.md` (or note in archived `test_spec/test_spec.md` frontmatter):
   - `origin: openspec/changes/archive/.../test_spec/`
   - `promoted_to: test_spec/<name>/`
3. Do not delete the archived copy.

## ID rules (summary)

| ID | Pattern | Notes |
|----|---------|-------|
| TS | `TS-{CAP}-{NNN}` | One per Scenario; trace anchor |
| TS-X | `TS-X-{NNN}` | Index only; cross-capability |
| TS-PERF | `TS-PERF-{NNN}` | Index; from design NFR |
| TC | `TC-{CAP}-{NNN}-{KIND}-{ST}` | Executable; KIND = MAN/API/UI/JMTR/SEC; ST = HP/NEG/EDGE/BND/ERR |
| API | `API-{NNN}` | In api-contracts.md; never reuse |

Full tables: [id-kind-st.md](references/id-kind-st.md).

## DO / DO NOT

**DO:** Use Step–Expected tables for all MAN/API/UI TCs; environment tags from `environments.md`; Freya-Docs-TA paths on every TC; cite `API-*` on API KIND TC only when contract is complete; record OQ when automation is blocked.

**DO NOT:** Put TS/TC in `spec.md`; use v1 Steps list + trailing Expected block; invent API schemas, locators, URLs, or NFR numbers; author API TC against `incomplete` contracts; write TS-X before capability files; duplicate child TC steps into the index; read other changes during generation.
