# Tenant database names

Each tenant is a separate PostgreSQL **database**, not a schema inside one shared database.
Name = prefix + tenant id (no extra separator). Tenant id is the numeric suffix, commonly `0`.

## Prefixes (from runtime YAML)

| Environment | Kind | Prefix | Example tenant `0` |
|---|---|---|---|
| `dev` | rendition | `docs_rendition_dev_tenant_` | `docs_rendition_dev_tenant_0` |
| `dev` | docs | `docs_dev_tenant_` | `docs_dev_tenant_0` |
| `qa` | rendition | `docs_rendition_qa_tenant_` | `docs_rendition_qa_tenant_0` |
| `qa` | docs | `docs_qa_tenant_` | `docs_qa_tenant_0` |

Rendition tables (e.g. `pdf_rendition_task`, `pdf_rendition`, `sync_cursor`) live in the **rendition** database.
Docs tables (e.g. `document_version`) live in the **docs** database.

Default when the user does not specify: environment `dev`, tenant `0`, kind `rendition`.

This skill defaults to Dev. Do not reuse Dev credentials or the Dev local port against QA unless the user explicitly configured that.

## How to pass it to the script

Prefer `-TenantId`, `-DbKind`, and `-Environment` so the script builds the name:

```powershell
.\.cursor\skills\freya-dev-db-query\scripts\query.ps1 `
  -TenantId 0 `
  -DbKind rendition `
  -Environment dev `
  -Sql "SELECT current_database()"
```

`-Database` overrides the constructed name when the user already gave a full database name.

## Listing tenants

`SELECT datname FROM pg_database WHERE datistemplate = false` on a permitted database (often `postgres`), then keep names that start with the rendition or docs prefix. If permission is denied, ask the user for a tenant id instead of retrying with Secrets Manager.
