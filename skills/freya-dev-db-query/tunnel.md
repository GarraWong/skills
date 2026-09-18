# User-managed SSM tunnel

The agent must never start, stop, or retry `aws ssm start-session`.
AWS credentials expire; only the user can create a working tunnel.

## What the query path needs

After the tunnel is up, JDBC/psql only needs the **local** listen address from the personal credentials file (`host` + `port`). Instance IDs and RDS DNS are irrelevant to querying.

`localPortNumber` in the SSM command **must match** `port=` in `%USERPROFILE%\.freya\dev-db.credentials`.

## User command (Dev example)

Jump-host id and RDS DNS can rotate. Replace `<your-local-port>` with the same value as `port=` in the credentials file.

```powershell
aws ssm start-session `
  --target i-0e51e73ba181d131b `
  --document-name AWS-StartPortForwardingSessionToRemoteHost `
  --parameters '{"host":["onerim-docs-dev-qa-rds-cluster.cluster-c8c7whcwxni0.us-east-1.rds.amazonaws.com"],"portNumber":["54321"],"localPortNumber":["<your-local-port>"]}'
```

Remote Postgres port is `54321`. Local port is chosen by the user (any free TCP port).

## If preflight fails

The helper probes `host:port` with a 1s TCP connect (not `Test-NetConnection`). Tell the user: that address is not listening. They must start (or fix) the tunnel themselves, or update `port=` in the credentials file. Do not invent query results. Do not run AWS CLI for them.
