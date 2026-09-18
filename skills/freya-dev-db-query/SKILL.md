---
name: freya-dev-db-query
description: >-
  Read-only query of Freya Docs/Rendition PostgreSQL tenant databases through
  the user's local AWS SSM port-forward. Use when inspecting Dev (or
  explicitly configured) tenant rows, pdf_rendition_task, document_version,
  ECS PROCESSING tasks, or large-file concurrency from the database side.
---

# Freya Dev DB Query

Read-only inspection via a **user-managed** local tunnel. Do not start or stop SSM. Do not guess `host`/`port`. Do not ask for passwords in chat.

## Agent checklist (do this, in order)

1. Do not start SSM. Do not read entity source for column names.
2. Run the helper once with SQL from [queries.md](queries.md). Default: Dev tenant `0`, rendition DB.
3. Report the printed rows. Timestamp columns are already formatted as epoch-ms plus `+08:00`. Status: 0 PENDING, 1 PROCESSING, 2 SUCCESS, 3 FAILED.
4. If the script says the tunnel is not reachable, stop and tell the user to start it. Do not invent rows.

```powershell
.\.cursor\skills\freya-dev-db-query\scripts\query.ps1 `
  -TenantId 0 `
  -DbKind rendition `
  -Environment dev `
  -Sql "SELECT id, status, resource_tier, source_file_size, priority, relate_id, relate_version_id, rendition_id, create_time, start_at, end_at, execution_deadline, duration, error_code, error_msg, ecs_task_arn FROM pdf_rendition_task ORDER BY id DESC LIMIT 1"
```

- Shell needs network-capable permissions for localhost JDBC.
- Read-only by default. Refuse writes unless the user names the database and confirms.
- Do not call Secrets Manager unless the user explicitly asks.
- Clear `FREYA_DEV_DB_*` from the shell if you set them yourself.
- Do not use `Test-NetConnection` (slow ICMP). The script uses a 1s TCP connect.

## Hard rules

1. Never run `aws ssm start-session` (or any AWS CLI that opens the tunnel). Credentials expire; only the user can create a working session. See [tunnel.md](tunnel.md).
2. Never print, log, or commit passwords. Never ask the user to paste credentials into chat.
3. Never default a local port. Read `host`/`port`/`username`/`password` from env or the personal file.
4. Resolve the target database as prefix + tenant id (separate databases, not schemas). See [databases.md](databases.md).
5. If preflight fails, stop. Do not invent rows.

## Personal config

Path: `%USERPROFILE%\.freya\dev-db.credentials`

Resolution per field (env wins):

| Field | Env | File key |
|---|---|---|
| host | `FREYA_DEV_DB_HOST` | `host` |
| port | `FREYA_DEV_DB_PORT` | `port` |
| username | `FREYA_DEV_DB_USER` | `username` |
| password | `FREYA_DEV_DB_PASSWORD` | `password` |

Template: [credentials.example](credentials.example). Placeholders such as `REPLACE_ME` are not valid values.

If the file is missing or incomplete:

1. Run `scripts/init-config.ps1` (creates the file from the example only when missing; never overwrites).
2. Tell the user to fill `port`, `username`, and `password` locally.
3. Stop. Do not query.

## Preflight

The helper script:

1. Resolves config (all four fields real).
2. Opens TCP to that `host`:`port` with a 1s timeout (not `Test-NetConnection`).
3. Reuses a compiled `QueryMain` cache under `%USERPROFILE%\.freya\db-query-classes` (compiles only when `QueryMain.java` is newer).
4. Builds the database name from `-TenantId` + `-DbKind` + `-Environment`, or uses `-Database`.

Port not listening → user must start the tunnel or fix `port=` in their file. See [tunnel.md](tunnel.md).

## Response style

- Report id, status meaning, tier, times from the script output.
- For concurrency, prefer ECS in-flight / overlapping `start_at`, not a single latest SUCCESS row.
- Do not dump whole tables or source object keys unless asked.
- Real column names: `error_msg` (not `error_message`), `relate_id` / `relate_version_id` (not `document_version_id`).
