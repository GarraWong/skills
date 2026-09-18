# Downstream mapping — KIND → tool → fields → Freya-Docs-TA

Canonical automation stack: [test_spec/environments.md](../../../../test_spec/environments.md) (Automation stack section).

Primary test repo: **Freya-Docs-TA**. App repos (`docs-server`, `frontend`) are reference-only unless generating path hints.

## KIND → tool → artifact path

| KIND | Tool | Freya-Docs-TA artifact path pattern |
|------|------|-------------------------------------|
| MAN | Excel / ADO | `manual/<feature>/TC-{CAP}-{NNN}-MAN-{ST}.xlsx` |
| API | Pytest + requests | `tests/api/<feature>/test_{cap}_{nnn}_{st}.py` |
| UI | Pytest + Playwright | `tests/ui/<feature>/test_{cap}_{nnn}_{st}.py` |
| JMTR | JMeter | `tests/performance/<feature>/*.jmx` |
| SEC | Burp Suite | `tests/security/<feature>/TC-{CAP}-{NNN}-SEC-{ST}.md` (playbook) |

`<feature>` is typically the change kebab-name (e.g. `pdf-annotation-workflow`).

Pytest markers (convention): `@pytest.mark.api`, `@pytest.mark.ui`, `@pytest.mark.qa`, `@pytest.mark.security` (optional).

## Required TC fields by KIND

### All TCs (common)

| Field | Required |
|-------|----------|
| Parent TS | Yes |
| KIND, ST | Yes |
| Priority, Severity (MAN/SEC) | Yes |
| Traces (Spec → Requirement → Scenario; Design; BR or `none`) | Yes |
| Preconditions | Yes |
| Test data | Yes |
| Freya-Docs-TA path | Yes |
| Environment tags | Yes — one of: `DEV`, `QA`, `DSO`, `SQA`, `Pre-Prod`, `PROD` |
| Status | draft \| ready \| blocked |

### MAN

| Field | Required |
|-------|----------|
| Execution: `\| Step \| Action \| Expected result \|` | Yes — one expected per step |
| Open questions | When automation blocked elsewhere |

Template: [tc-man.md](../../../../test_spec/templates/tc-man.md)

### API

| Field | Required |
|-------|----------|
| API ref: `API-xxx` | Yes — **complete** contract only |
| Framework hint: pytest + requests | Yes |
| Fixtures | Yes |
| Markers | Yes |
| Execution: Step \| Action (requests) \| Expected result | Yes |
| Assertions (for codegen) | Yes |

Template: [tc-api.md](../../../../test_spec/templates/tc-api.md)

### UI

| Field | Required |
|-------|----------|
| Framework hint: pytest + playwright | Yes |
| Fixtures (`page`, role contexts) | Yes |
| Markers (`@pytest.mark.ui`) | Yes |
| Execution: Step \| Action \| Expected result | Yes |
| UI hints: Step \| Locator strategy \| expect() | Yes |

Template: [tc-ui.md](../../../../test_spec/templates/tc-ui.md)

### JMTR

| Field | Required |
|-------|----------|
| Load profile (Threads, Ramp-up, Duration, Target) | Yes |
| Execution: Step \| Action \| Metric \| Threshold \| Expected | Yes |
| Threshold cites design.md NFR text | Yes — never invent numbers |

Template: [tc-jmtr.md](../../../../test_spec/templates/tc-jmtr.md)

### SEC

| Field | Required |
|-------|----------|
| Scope (URL/endpoint from contract or documented route) | Yes — never invented |
| Burp hints (session, target host, payload set) | Yes |
| Execution: Step \| Burp action \| Expected result | Yes |

Template: [tc-sec.md](../../../../test_spec/templates/tc-sec.md)

## Open Questions block automation

| KIND | When OQ present |
|------|-----------------|
| MAN | OQ does **not** excuse missing Step–Expected for known steps; manual TC can still be `ready` |
| API, UI, JMTR, SEC | Set `Status: blocked` until OQ resolved; do not generate Freya-Docs-TA artifacts from blocked TCs |

Never use OQ to invent URLs, payloads, locators, thread counts, or NFR thresholds.

## Traceability for codegen

Freya-Docs-TA generators consume:

1. TC ID and KIND → selects tool and output path
2. Step–Expected (or KIND-specific execution table) → test steps
3. API ref + Assertions → pytest requests codegen (API only)
4. UI hints → Playwright locator codegen (UI only)
5. Load profile + thresholds → JMeter script (JMTR only)
6. Scope + Burp steps → security playbook (SEC only)

Index **Traceability Matrix** links Requirement → Scenario → TS → TC for coverage audits.
