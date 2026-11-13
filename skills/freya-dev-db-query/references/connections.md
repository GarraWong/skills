# Connection files

One file per connection, in `.freya` under the user home directory. A connection is one tunnel: one local port forwarded to one remote host. The file name without `.credentials` is the connection name, so `dev-db.credentials` is the connection `dev-db`.

A person with access to several AWS accounts keeps one file per tunnel, for example `dev-db`, `sqa-db`, and `dso-db`. One tunnel can reach more than one environment: the Dev cluster holds both `dev` and `qa`.

The files are personal. They hold a database password, so they are never committed and never pasted into chat.

## Format

Plain `key=value` lines. Lines starting with `#` are comments. Keys are case-insensitive. Keys the script does not know are ignored, so other tools may keep their own settings in the same file.

## Keys

| Key | Needed for a query | Meaning |
| --- | --- | --- |
| `envs` | To select by `--env` | Environments this tunnel reaches, comma-separated: `dev,qa`. |
| `type` | No | `postgres` (default), `redis`, or `tcp`. The query script refuses anything but `postgres`. |
| `host` | No | Local listen address. Default `127.0.0.1`. |
| `port` | Yes | Local listen port. Must equal `localPortNumber` of the tunnel. |
| `username` | Yes | Database user. |
| `password` | Yes | Database password. Never printed. |
| `aws_profile` | No | AWS CLI profile the user opens the tunnel with. |
| `region` | No | AWS region. Default `us-east-1`. |
| `target` | No | Jump-host instance id, `i-…`. |
| `target_name` | No | Jump-host `Name` tag, for tools that look the id up. The script does not resolve it. |
| `remote_host` | No | Host the tunnel forwards to, such as the RDS cluster endpoint. |
| `remote_port` | No | Port on the remote host. |
| `db_prefix.<env>.<kind>` | No | Database name prefix for an environment the script does not know, or to replace a built-in one. See [databases.md](databases.md). |

The tunnel keys (`aws_profile` to `remote_port`) are only printed back in the command the user runs. The script never calls the AWS CLI.

Placeholder values such as `REPLACE_ME` count as missing.

## How a connection is chosen

| Flags | Result |
| --- | --- |
| `--env <env>` | The one file whose `envs` lists `<env>`. Two files listing it is an error: pass `--conn`. |
| `--conn <name>` | That file. Its first `envs` entry is the environment unless `--env` is also passed. |
| `--conn <name> --env <env>` | That file, and `<env>` must be in its `envs` when the key is present. |
| neither | `--env dev`. |

A `dev-db` file with no `envs` key counts as `dev,qa`. Files written before the key existed keep working. Any other file without `envs` is reachable with `--conn` only.

## Environment variables

`FREYA_DEV_DB_HOST`, `FREYA_DEV_DB_PORT`, `FREYA_DEV_DB_USER`, and `FREYA_DEV_DB_PASSWORD` override the `dev-db` connection only. No other connection reads them.

## Creating a file

From the skill directory:

```
node scripts/init-config.mjs
node scripts/init-config.mjs --conn sqa-db --envs sqa
```

The first form creates `dev-db.credentials` with `envs=dev,qa`. An existing file is never overwritten. The template is [credentials.example](credentials.example).

## Seeing what is configured

```
node scripts/query.mjs --list
```

Prints one row per connection: environments, type, local address, whether that address is listening, AWS profile, region, target, remote address, and whether a login is set. It prints no username and no password.

## Checking the files

```
node scripts/check-config.mjs
```

Run it after the skill is updated, after a file is edited, or when a query fails before it reaches the database. It checks Node and `psql`, then every connection file, and prints one line per finding:

```
LEVEL  CONNECTION  message
```

| Level | Meaning |
| --- | --- |
| `ERROR` | A query through this connection will fail. The exit code is 1. |
| `WARN` | Probably a mistake: a mistyped key, a duplicate key, an environment no file or two files claim, two connections on one local port. |
| `NOTE` | Worth knowing, nothing to fix. |
| `OK` | Checked and fine. |

A closed tunnel is not an error. It is reported on the `OK` line of the local address.

## What is never printed

Only a real query reads the login. `--list`, `--tunnel-command`, and `check-config.mjs` read the files redacted:

- A `username` or `password` value is replaced, as its line is read, by a marker that says only whether it is filled in.
- A key the script does not know is dropped together with its value. It may be a mistyped `password`, or a secret pasted on its own line. The check reports it by line number, and names the known key it resembles.
- A value that fails its format check is reported as invalid, not echoed.

So the output names files, line numbers, known keys, and well-formed values of the non-secret keys. It is safe to show the user and to paste into a report. To see the actual content of a line, the user opens the file.
