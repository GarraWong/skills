# Red Flags and Hard Rules

From [2026-07-13-test-spec-v2-design.md](../../../../docs/superpowers/specs/2026-07-13-test-spec-v2-design.md). **STOP and fix** on any Red Flag before declaring done or promoting.

## Red Flags — STOP and fix

| Problem | Fix |
|---------|-----|
| OpenSpec Scenario with no TS | Add TS + at least TC-*-MAN-HP |
| TS with no TC-*-MAN-HP | Add manual happy path |
| Manual TC with any step missing Expected | Add per-step expected result |
| Only HP when spec defines denial/failure | Add NEG/ERR TCs |
| API TC with incomplete `API-*` | Remove API TC or complete contract / close OQ |
| TC cannot trace to Scenario | Remove or link via Traces |
| Non-Goal from design appears in TC | Delete or mark out of scope |
| Long-chain before capability files done | Finish capability files first |
| Invented endpoint, locator, or NFR number | Replace with OQ or design quote |

## Hard rules — never violate

| Rule | Detail |
|------|--------|
| No TS/TC in spec.md | IDs live only in test_spec |
| One Scenario → one TS | TC variants use same `{CAP}-{NNN}` |
| One expected per step | MAN/UI/API execution tables |
| Never invent API bodies | incomplete + OQ |
| Never skip MAN-HP | Minimum per TS |
| Capability before long-chain | TS-X only in index after capabilities |
| BR optional | `none` + reason if no BR |
| Scope fence | One change package per authoring run |
