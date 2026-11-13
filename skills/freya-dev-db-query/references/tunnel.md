# User-managed SSM tunnel

The agent must never start, stop, or retry `aws ssm start-session`.
The agent must never run `aws sso login`, `aws configure`, or any other login command.
Only the user can create a working tunnel. AWS credentials expire.

## What the query path needs

After the tunnel is up, `psql` needs the local listen address from the connection file (`host` and `port`). Instance ids and the RDS hostname are not used when querying.

`localPortNumber` in the SSM command must equal the `port` value in that connection's file. Each connection has its own file and its own local port; see [connections.md](connections.md).

## Showing the user their command

When the connection file holds `target`, `remote_host`, and `remote_port`, the script builds the command from the file. From the skill directory:

```
node scripts/query.mjs --tunnel-command --env dev
node scripts/query.mjs --tunnel-command --conn dso-db
```

It prints the command and exits. It runs nothing. The same command is printed when a query finds the local port closed. Give it to the user as it is.

`--profile` appears when the file has `aws_profile`. `--region` is the file's `region`, or `us-east-1`. If the file has `target_name` but no `target`, the script cannot build the command: the user looks up the instance id, or adds `target` to the file.

## User command (Dev example)

For a file without the tunnel keys, this is the shape. Jump-host id and RDS hostname can rotate. Replace `YOUR_LOCAL_PORT` with the same value as `port` in the connection file, and `YOUR_PROFILE` with the AWS CLI profile for that account. The remote Postgres port is `54321`. The local port is any free TCP port the user chooses.

The same one-liner works in bash and PowerShell:

```
aws ssm start-session --profile YOUR_PROFILE --region us-east-1 --target i-0e51e73ba181d131b --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters '{"host":["onerim-docs-dev-qa-rds-cluster.cluster-c8c7whcwxni0.us-east-1.rds.amazonaws.com"],"portNumber":["54321"],"localPortNumber":["YOUR_LOCAL_PORT"]}'
```

## AWS credentials for the profile

`aws_profile` is only a name. The skill does not read AWS credentials and does not care how the profile gets them. Both ways work, and one person can mix them across connections:

| Way | What the user does | When it expires |
| --- | --- | --- |
| Pasted keys | Copies the temporary keys from the AWS access portal into the AWS CLI `credentials` file, under the profile name. | Pastes fresh keys. |
| IAM Identity Center (SSO) | Defines the profile once in the AWS CLI `config` file, then runs `aws sso login --profile <aws_profile>`. | Runs the login again. |

If the user reports an expired-token or not-logged-in error from the tunnel command, tell them to refresh the credentials of that profile their usual way. Do not do it for them.

## If the TCP check fails

The helper probes `host` and `port` with a one-second TCP connect. Tell the user that address is not listening, and name the connection. They start or fix the tunnel themselves, or they correct `port` in the connection file. Do not invent query results. Do not run the AWS CLI for them.
