# ID conventions — TS, TC, KIND, ST

From [2026-07-13-test-spec-v2-design.md](../../../../docs/superpowers/specs/2026-07-13-test-spec-v2-design.md).

## TS (trace anchor)

| Pattern | When | Example |
|---------|------|---------|
| `TS-{CAP}-{NNN}` | One per OpenSpec `#### Scenario` in a capability | `TS-AUDIT-001` |
| `TS-PERF-{NNN}` | One per design NFR test point (index or capability) | `TS-PERF-001` |
| `TS-X-{NNN}` | One per cross-capability long-chain flow (index only) | `TS-X-001` |

- **CAP**: short code declared in capability file frontmatter (e.g. `AUDIT`, `REND`, `OVERLAY`).
- **NNN**: three-digit sequence within capability; never reuse after publish.
- TS IDs **never appear** in `spec.md`.

## TC (executable test case)

**Pattern:** `TC-{CAP}-{NNN}-{KIND}-{ST}`

Cross-domain and performance use the same KIND/ST suffix on `TC-X-*` / `TC-PERF-*` prefixes:

- `TC-X-001-MAN-HP`
- `TC-PERF-001-JMTR-HP`

### `{CAP}-{NNN}` — links to parent TS

Same capability code and sequence number as the parent TS for that OpenSpec Scenario.

| Example | Parent TS | OpenSpec Scenario |
|---------|-----------|-------------------|
| `TC-AUDIT-002-SEC-NEG` | `TS-AUDIT-002` | Access denial captured |
| `TC-REND-003-JMTR-HP` | `TS-REND-003` or `TS-PERF-00x` | Generation within target time |

## `{KIND}` — execution layer / downstream tool

| KIND | Meaning | Downstream | When to author |
|------|---------|------------|----------------|
| **MAN** | Manual test | Excel / ADO | **Required:** at least `MAN-HP` per TS |
| **API** | HTTP API automation | Pytest + requests | When `api-contracts.md` has **complete** `API-*` for the exercised endpoint |
| **UI** | UI automation | Pytest + Playwright | When the Scenario has a user-visible flow |
| **JMTR** | Performance | JMeter | When design NFR or spec defines measurable latency/load targets |
| **SEC** | Security | Burp Suite | AuthZ, IDOR, injection, sensitive-data exposure for the Scenario scope |

Not every TS needs all KINDs. Minimum: **`TC-*-MAN-HP`**.

## `{ST}` — scenario type (test design)

| ST | Meaning | Typical source |
|----|---------|----------------|
| **HP** | Happy Path | Primary WHEN/THEN in spec |
| **NEG** | Negative | Denial, invalid input, unauthorized (often matches Scenario title) |
| **EDGE** | Edge case | Empty data, special chars, unusual but valid states |
| **BND** | Boundary | Explicit limits (size, count, depth) |
| **ERR** | Error / fault | Dependency down, timeout, generation failure |

### Coverage rules

- Every TS: at least **`TC-*-MAN-HP`**.
- If the OpenSpec Scenario describes denial/failure/boundary, author matching **NEG / ERR / BND** TCs (Manual and/or SEC/API as appropriate).
- If the Scenario is HP-only but denial is implied by domain (permissions, validation), extend with **`TC-*-MAN-NEG`** (and SEC/API if applicable) unless `design.md` Non-Goals exclude it.

## `cap_code` — pdf-annotation-workflow

Declare `cap_code` in each capability file frontmatter. Use these codes for `pdf-annotation-workflow`:

| Capability folder | cap_code |
|-------------------|----------|
| annotation-audit-trail | AUDIT |
| pdf-annotation-overlay | OVERLAY |
| annotated-pdf-rendering | REND |
| annotation-workflow-submission | WFSUB |
| annotation-permissions | PERM |
| annotation-export | EXPORT |
| native-pdf-annotation | NATPDF |

## Open Questions (`OQ-xxx`)

| Rule | Detail |
|------|--------|
| Format | `OQ-{CAP}-{NNN}` or `OQ-X-{NNN}` for cross-domain |
| Manual TC | OQ does **not** excuse missing Step–Expected rows for known steps |
| API/UI/JMTR/SEC | May set `Status: blocked` until OQ resolved |
| Never | Use OQ to invent URLs, payloads, locators, or NFR numbers |

## API contracts

- **API-{NNN}** — HTTP contract rows in `api-contracts.md`; never reuse IDs.
- API KIND TCs cite `API-*` only when the contract row is **complete** (not `incomplete`).
