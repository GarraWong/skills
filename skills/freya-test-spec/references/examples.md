# TC examples — good and bad

Concrete patterns for v2 authoring. Templates: [test_spec/templates/tc-*.md](../../../../test_spec/templates/).

---

## Good — MAN with Step–Expected table

`TC-AUDIT-001-MAN-HP` under `TS-AUDIT-001` (Create event captured):

```markdown
### TC-AUDIT-001-MAN-HP Create annotation produces audit event

**Parent TS:** TS-AUDIT-001  
**KIND:** MAN | **ST:** HP  
**Priority:** P0 | **Severity:** Critical  
**Status:** draft  

**Traces:**
- Spec: `specs/annotation-audit-trail/spec.md` → Requirement: `Audit Event Capture for Annotation Lifecycle` → Scenario: `Create event captured`
- Design: `design.md` → D5: Audit delivery — transactional outbox
- BR: `none` — no functional-spec BR published for PDF annotation audit lifecycle.

**Preconditions:**
- Word document version has PDF rendition; overlay annotation enabled.
- Task participant has permission to create annotations.

**Execution (one expected result per step — mandatory):**

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Authenticate as permitted task participant on active workflow task | Session established; document version visible |
| 2 | Create one highlight annotation on page 1 of the rendered document | Annotation saved; ID returned in UI or API response |
| 3 | Inspect annotation audit outbox / Platform Audit for this document version | One row: action=CREATE; user, timestamp, document ID, version, annotation ID, action type match step 2 |

**Test data:**
- Document: Word with PDF rendition; annotation type: supported overlay highlight.

**Freya-Docs-TA path:** `manual/pdf-annotation-workflow/TC-AUDIT-001-MAN-HP.xlsx` (to be generated)  
**Environment tags:** `[QA]`
```

**Why good:** Every step has its own expected result; traces to Scenario; MAN-HP minimum met.

---

## Bad — v1 multi-step list + block expected (anti-pattern)

From the `pdf-annotation-workflow` dry-run (`annotation-audit-trail.md` v1 style):

```markdown
**Steps:**
1. Authenticate as the permitted task participant.
2. Create one annotation on the rendered document version.
3. Capture the created annotation identifier and document version under test.
4. Inspect the annotation audit outbox and/or Platform Audit event stream for the create action.
5. Correlate the audit record to the user, timestamp, document ID, version, annotation ID, and action type.

**Expected result:**
- A create audit event is recorded for the annotation lifecycle action.
- The event includes user, timestamp, document ID, version, annotation ID, and action type.
- The event correlation matches the annotation created in the test.
```

**Why bad:**

- Five steps but only a **trailing bullet block** of expectations — QA cannot verify step-by-step.
- No TC ID, KIND, or ST — not executable or traceable to downstream tools.
- v2 requires a `### TC-{CAP}-{NNN}-MAN-{ST}` block with `| Step | Action | Expected result |` table.

**Fix:** Replace with `TC-AUDIT-001-MAN-HP` using the good example above.

---

## Good — SEC-NEG with Burp steps

`TC-AUDIT-002-SEC-NEG` under `TS-AUDIT-002` (Access denial captured):

```markdown
### TC-AUDIT-002-SEC-NEG Unauthorized annotation attempt denied and audited

**Parent TS:** TS-AUDIT-002  
**KIND:** SEC | **ST:** NEG  
**Priority:** P0 | **Severity:** Critical  
**Status:** blocked  

**Traces:**
- Spec: `specs/annotation-audit-trail/spec.md` → Requirement: `Audit Event Capture for Annotation Lifecycle` → Scenario: `Access denial captured`
- Design: `design.md` → D12: Centralized permission evaluator
- BR: `none` — no functional-spec BR published for PDF annotation audit lifecycle.

**Preconditions:**
- Document version exists; user without annotation permission has valid session.
- Burp Suite configured for QA environment.

**Scope:**
- **Target:** Annotation create endpoint or UI route (from complete API contract or documented route)
- **Out of scope:** endpoints not in `api-contracts.md` or `api-contract.yaml`

**Burp hints:**
- Session handling: Bearer token from unauthorized role login
- Target host: QA host per `test_spec/environments.md`

**Execution (one expected result per step — mandatory):**

| Step | Burp action | Expected result |
|------|-------------|-----------------|
| 1 | Repeater: authorized user creates annotation (baseline) | `201` or UI success; annotation ID returned |
| 2 | Repeater: replay create request with unauthorized user token | `403` or `401`; no annotation created |
| 3 | Inspect audit outbox / Platform Audit for denial attempt | Denial audit event recorded with user, timestamp, document ID, denied action |

**Freya-Docs-TA path:** `tests/security/pdf-annotation-workflow/TC-AUDIT-002-SEC-NEG.md` (playbook; to be generated)  
**Environment tags:** `[QA]`

**Open questions:**
- OQ-AUDIT-001: Scoped annotation API URL not in api-contracts; SEC TC blocked until contract complete.
```

**Why good:** Per-step Burp actions and expectations; NEG matches denial Scenario; OQ instead of invented URL.

---

## Bad — API TC when contract is incomplete

```markdown
### TC-AUDIT-001-API-HP Create annotation via REST

**Parent TS:** TS-AUDIT-001  
**KIND:** API | **ST:** HP  

**API ref:** `API-001` — annotation create endpoint

**Execution:**

| Step | Action (requests) | Expected result |
|------|-------------------|-----------------|
| 1 | `POST /api/v1/documents/{id}/annotations` with highlight payload | `201`; annotation ID in body |
```

When `api-contracts.md` marks `API-001` as:

```markdown
### API-001 Create annotation
**Status:** incomplete — request body and response schema not defined in api-contract.yaml
```

**Why bad:**

- API KIND TC cites an **incomplete** contract — codegen would hallucinate payloads.
- Violates hard rule: never invent API bodies.

**Fix:** Remove the API TC, or complete `api-contracts.md` from `api-contract.yaml`, or set `Status: blocked` with `OQ-AUDIT-002` until the contract is complete. Use MAN-HP only until then.
