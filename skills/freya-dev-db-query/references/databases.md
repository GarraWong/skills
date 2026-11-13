# Tenant database names

Each tenant is a separate PostgreSQL database, not a schema inside one shared database.
The name is the prefix plus the tenant id, with no extra separator. The tenant id is a numeric suffix, commonly `0`.

## Prefixes

| Environment | Kind | Prefix | Example tenant `0` |
| --- | --- | --- | --- |
| `dev` | rendition | `docs_rendition_dev_tenant_` | `docs_rendition_dev_tenant_0` |
| `dev` | docs | `docs_dev_tenant_` | `docs_dev_tenant_0` |
| `qa` | rendition | `docs_rendition_qa_tenant_` | `docs_rendition_qa_tenant_0` |
| `qa` | docs | `docs_qa_tenant_` | `docs_qa_tenant_0` |
| `sqa` | rendition | `ff-docs-docs-rendition-sqa-rds` | `ff-docs-docs-rendition-sqa-rds0` |
| `sqa` | docs | `ff-docs-docs-sqa-rds` | `ff-docs-docs-sqa-rds0` |
| `dso-bridge` | rendition | `ff-docs-docs-rendition-devsecops-rds` | `ff-docs-docs-rendition-devsecops-rds0` |
| `dso-bridge` | docs | `ff-docs-docs-devsecops-rds` | `ff-docs-docs-devsecops-rds0` |
| `dso-sws` | docs | `ff-silo-sws-dso-db-cluster` | `ff-silo-sws-dso-db-cluster0` |

Rendition tables (`pdf_rendition_task`, `pdf_rendition`, `sync_cursor`) live in the rendition database.
Docs tables (`document_version`) live in the docs database.

No rendition prefix is recorded for `dso-sws`. Asking for `--kind rendition` there stops with an error. Ask the user for the full database name and pass `--database`, or have them add the prefix to the connection file (below). Do not guess a name.

Default when the user does not specify: environment `dev`, tenant `0`. Without `--kind`, the script uses `rendition` where the environment has it, and the environment's only kind otherwise.

## Which connection reaches which environment

The connection file says so in its `envs` key; see [connections.md](connections.md). `dev` and `qa` share one tunnel and one login. Do not pass an environment the user did not name.

## How to pass it to the script

From this skill directory, prefer `--tenant`, `--kind`, and `--env` so the script builds the name:

```
node scripts/query.mjs --tenant 0 --kind rendition --env dev --sql "SELECT current_database()"
```

`--database` overrides the constructed name when the user already gave a full database name. The override must be letters, digits, underscores, and hyphens only.

## Adding or replacing a prefix

A connection file can carry prefixes for its own environments. The key is `db_prefix.<env>.<kind>`:

```
envs=uat
db_prefix.uat.docs=docs_uat_tenant_
db_prefix.uat.rendition=docs_rendition_uat_tenant_
```

A prefix in the file wins over the table above. The user edits the file; do not write a prefix the user did not give.

## Listing tenants

`SELECT datname FROM pg_database WHERE datistemplate = false` on a permitted database (often `postgres`, passed with `--database postgres`), then keep names that start with the rendition or docs prefix. If permission is denied, ask the user for a tenant id. Do not retry through a secrets store.
