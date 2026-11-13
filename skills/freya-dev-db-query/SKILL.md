---
name: freya-dev-db-query
description: Read-only query of Freya Docs and Rendition PostgreSQL tenant databases (Dev, QA, SQA, DSO) through the user's local AWS SSM port-forward. Use when the user asks to inspect tenant rows, pdf_rendition_task, document_version, ECS PROCESSING tasks, or large-file concurrency from the database, or asks which database connections and tunnels are configured.
---

# Freya Dev DB Query

Read tenant rows through the local port-forward the user already started. Do not start, stop, or retry the tunnel. Do not guess the host or port. Do not ask for a password, and do not print one.

## Safety

- Never run `aws ssm start-session` or any other command that opens the tunnel. The script prints the user's own command; see [references/tunnel.md](references/tunnel.md).
- Never run `aws sso login`, `aws configure`, or any other login command. Never read the AWS CLI credentials file.
- Never call a secrets store. Never put credentials in the chat or the repository. Do not open a connection file to read it; use `--list` or the configuration check, which read it redacted.
- [`scripts/query.mjs`](scripts/query.mjs) opens a read-only session and rejects mutating SQL, `SET`, and psql meta-commands. Do not work around a rejection. This skill does not run writes.
- If credentials are missing or the host and port are not listening, stop. Do not invent rows.
- Report a failed connection and a failed query separately. Both end the task.

## Connections

One file per connection (one tunnel) in `.freya` under the user home directory: `<connection>.credentials`. A user with several AWS accounts has several files, each with its own local port and login. The `envs` key of a file lists the environments its tunnel reaches, and `--env` finds the file that way. Keys and selection rules are in [references/connections.md](references/connections.md).

| Environment | Usual connection | Note |
| --- | --- | --- |
| `dev`, `qa` | `dev-db` | One tunnel and one login reach both. |
| `sqa` | the file whose `envs` lists `sqa` | |
| `dso-bridge`, `dso-sws` | the file whose `envs` lists them | One tunnel reaches both. |

To see what the user has, from this skill directory:

```
node scripts/query.mjs --list
```

It prints each connection's environments, local address, and whether that address is listening. It prints no username and no password.

## Checking the configuration

Run the check when a query fails before it reaches the database, when the user says the skill stopped working after an update, or when the user asks whether their configuration is right:

```
node scripts/check-config.mjs
```

[`scripts/check-config.mjs`](scripts/check-config.mjs) checks Node, `psql`, and every connection file. It prints one line per finding, as level, connection, and message, and exits 1 when any line is an `ERROR`. A closed tunnel is not an error.

The output is redacted and safe to show: no username, no password, no content of a line the script does not recognise, and no value that failed a check. What is hidden and why is in [references/connections.md](references/connections.md).

Report the `ERROR` and `WARN` lines to the user with the file name and line number. The user opens the file and fixes it. Do not open or edit the file for them, and do not ask them to paste a line into the chat.

## Defaults

| Setting | Value |
| --- | --- |
| Environment | `dev`. Pass another `--env` only when the user names that environment. |
| Connection | Chosen from `--env`. Pass `--conn <name>` only when the user names a connection, or the script says two files claim the environment. |
| Tenant | `0` |
| Database kind | `rendition` where the environment has one, else its only kind. Use `docs` for document tables such as `document_version`. |
| Local address | `host` and `port` from the connection file. `--host` and `--port` override them. There is no flag for the password. |
| Time zone | Epoch-millisecond columns print as millis plus `+08:00`. Do not convert them again. |

`pdf_rendition_task.status`: 0 PENDING, 1 PROCESSING, 2 SUCCESS, 3 FAILED.

## Missing or placeholder credentials

The file template is [references/credentials.example](references/credentials.example). Placeholder values such as `REPLACE_ME` are not usable.

If the script says a file is missing or still a placeholder:

1. From this skill directory, run the command the message names, for example `node scripts/init-config.mjs --conn sqa-db --envs sqa`. Without flags it creates `dev-db.credentials`. [`scripts/init-config.mjs`](scripts/init-config.mjs) creates the file only when missing and never overwrites it.
2. Tell the user to fill `port`, `username`, and `password` in that file.
3. Stop.

If the script says no connection declares the environment, tell the user which connections `--list` shows and ask which one reaches it. They add the environment to that file's `envs` key. Do not edit the file for them.

`FREYA_DEV_DB_HOST`, `FREYA_DEV_DB_PORT`, `FREYA_DEV_DB_USER`, and `FREYA_DEV_DB_PASSWORD` override the `dev-db` connection only. If this run exported any of them, unset them before finishing.

## Steps

1. Take SQL from [references/queries.md](references/queries.md), or use the statement the user wrote. Read [references/databases.md](references/databases.md) before naming a database. Real column names are `error_msg`, `relate_id`, and `relate_version_id`.
2. From this skill directory, run:

```
node scripts/query.mjs --env dev --tenant 0 --kind rendition --sql "<SQL>"
```

   Use `--sql-file` when the statement is easier to pass as a file. Use `--database` only when the user already gave a full database name. Requires Node 18 or newer and `psql` 12 or newer on `PATH`.
3. The script checks that the connection's host and port accept TCP within one second, then runs the query. If the check fails, tell the user which connection is not listening and give them the command the script printed. Do not run it for them.
4. If the environment blocks TCP to the local machine, run the same command where local connections are allowed. Still do not invent rows.

## Completion

Report the connection and database the script printed, then the rows: id, status meaning, resource tier, and the formatted times. For concurrency, use in-flight ECS rows (`status = 1` and `resource_tier` set) or overlapping `start_at` values, not the single latest SUCCESS row. Do not dump a whole table or source object keys unless the user asked. Keep the report short.
