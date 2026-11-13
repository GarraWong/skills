# Environments, logins, and the test environment

## Target environments

| `--env` | Freya-Docs-TA profile | Set by the script |
| --- | --- | --- |
| `dev` | `dev.env` | `FREYA_DOTENV=dev` |
| `qa` | `qa.env` | `FREYA_DOTENV=qa` |
| `dso` | `.env` (the pipeline default) | `FREYA_DOTENV` unset |

The profile files hold hosts only. Never add credentials to them.

## Logins

The suite reads its test logins (`DEV_LOGIN_NAME_1`, `QA_PASSWORD_1`, …) from environment variables, or else from AWS Secrets Manager: `dso/scrum_ta_secret`, plus `dev/scrum_ta_secret` on DEV. It uses the AWS CLI session of whoever runs it.

- The user logs in: `aws sso login --profile <profile>`, then runs with `AWS_PROFILE=<profile>` set.
- The profile's role must be allowed to read those secrets. In the Freyr AWS setup, the `Infra_Engineer` role can read the DEV secret; the `SSM_Dev_Engineer` role cannot. Ask the user which profile carries a role with access.
- Symptoms of a missing or wrong login, which the script reports as a login problem:
  - `Unable to locate credentials`: not logged in, or `AWS_PROFILE` not set.
  - `AccessDeniedException … secretsmanager:GetSecretValue`: logged in with a role that cannot read the secret.
  - `ValueError: DEV credentials missing`: neither the environment nor the secret gave a login.

Never read the secret yourself to check it. Ask the user to log in, then run the script.

## Freya-Docs-TA virtual environment

The script runs pytest with `<ta>/.venv/bin/python` when it exists, else `python3`. Create the environment once. Python 3.12 is known to work with the pinned requirements; 3.14 is not tested.

```
cd <ta>
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt
# or, without uv:
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

`pytest-xdist` (parallel workers) and `allure-pytest` (the results the reports read) come from `requirements.txt`. Some packages may come from the internal `autosphere` feed named in `pyproject.toml`; if an install fails on one of them, the user needs that feed configured.

## Markers

The script reads the `markers` list in `<ta>/pytest.ini`. Every marker whose name contains `serial` is left out of the parallel run. `--with-serial` runs those tests afterwards, alone and without workers.

Other markers, such as ones for large files or security tests, run by default. Leave them out with `-m "not <marker>"`, which the script combines with the serial exclusion.
