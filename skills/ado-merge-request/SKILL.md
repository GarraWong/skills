---
name: ado-merge-request
description: Create an Azure DevOps pull request, assign reviewers, and notify Microsoft Teams. Use when the user asks to open or create an ADO pull request or merge request.
---

# Azure DevOps merge request

Azure DevOps calls merge requests **pull requests**. Create the pull request in
the repository checked out by the user, add the requested reviewers, and report
the resulting URL and notification status.

## Safety and repository context

- Before pushing, creating or modifying a pull request, assigning reviewers, or
  posting the required Teams notification, state the planned changes and obtain
  explicit confirmation. Treat a Teams-webhook failure separately: it must not
  undo, block, or imply failure of an already-created pull request.
- Derive the repository from the `origin` remote immediately before creating
  each pull request. Do not reuse a repository name from another checkout. For
  example: `basename -s .git "$(git remote get-url origin)"`.
- Inspect the current branch, latest commit subject, and working-tree status.
  Do not open a pull request from `main`; create or switch to a topic branch.
  Push the source branch and confirm it exists remotely before creating the
  pull request.
- Use the user-provided title and target branch. Otherwise use the latest
  commit subject for the title and `main` for the target branch. Keep the
  description a concise change summary and under 4,000 characters.

## Several pull requests in one run

In a multi-repo workspace or a mono-repo, one request can need several pull
requests — for example the same change in several repositories, or several
branches in one repository. Treat them as one batch:

- Confirm the whole batch once: list each repository, source branch, target
  branch, and title.
- Create every pull request and assign its reviewers before notifying Teams.
- Send one Teams message for the batch, not one per pull request.
- If some pull requests fail, notify Teams about the ones that succeeded and
  report the failures to the user.

## Azure DevOps defaults

Unless the user supplies different values, use:

| Setting | Value |
| --- | --- |
| Organization | `FreyrDevOps` |
| Project | `Freyr-Unified-RIMS` |
| Repository | Last path segment of the `origin` remote |
| Target branch | `main` |
| Pull request URL | `https://dev.azure.com/FreyrDevOps/Freyr-Unified-RIMS/_git/<repository>/pullrequest/<id>` |

First check whether an Azure DevOps MCP server is configured and exposes
pull-request creation and reviewer-assignment operations. Use it when
available; otherwise use an Azure DevOps client or API. Create the pull request
with `refs/heads/<source-branch>` and `refs/heads/<target-branch>`, then add
all reviewers in one request. Preserve the returned pull-request ID.

### Required or optional reviewers

Add reviewers as **required** when both hold:

- `ADO_MCP_AUTH_TOKEN` is set in the shell environment.
- `az` is installed with the `azure-devops` extension
  (`az extension show --name azure-devops`).

Then add every reviewer in one call, passing the token as the CLI's PAT. Never
print, log, or echo the token:

```sh
AZURE_DEVOPS_EXT_PAT="$ADO_MCP_AUTH_TOKEN" az repos pr reviewer add \
  --org https://dev.azure.com/FreyrDevOps --id <pr-id> \
  --reviewers <email-1> <email-2> --required true --output json
```

Confirm `isRequired` is `true` for each reviewer in the output. If the call
fails, add the reviewers as optional instead and tell the user why.

Otherwise, add reviewers as optional, as the MCP server or API does by default.
Report which mode was used.

## Reviewers

Read [the reviewer roster](references/reviewers.md) before selecting or adding
reviewers. If the request names a person or role, use that selection without
asking again. If none is implied, ask once and offer the default backend
reviewers listed in that reference.

## Teams notification

After the pull request and reviewer assignment succeed, always notify Teams.
Run [`scripts/send-teams-message.sh`](scripts/send-teams-message.sh) with the
title, pull-request URL, comma-joined reviewer names, first reviewer's email
(or an empty string to omit a mention), and author name. The card lists every
name; the mention is only the first. Do not ask for a separate notification
request.

For a batch, make one call: pass the first pull request as above, then append
a title and URL pair for each other pull request. Use the combined, deduplicated
reviewer names across the batch. Pass `""` for an empty email or author so the
pairs stay in position:

```sh
scripts/send-teams-message.sh "<title 1>" "<url 1>" "<reviewers>" "<email>" "<author>" \
  "<title 2>" "<url 2>" "<title 3>" "<url 3>"
```

The batch card lists each pull request as a link with its repository name.

The script reads the webhook URL from `TEAMS_WEBHOOK_URL` or a local,
gitignored `scripts/webhook-url.txt`. Never commit or place the webhook URL in
skill instructions. It requires `curl` and `jq`. Teams mentions render only on
Workflow/Power Automate webhooks when the mention token and entity match.

If no webhook is configured, report the pull request as successful and suggest
setting `TEAMS_WEBHOOK_URL` or adding the URL to `scripts/webhook-url.txt`.

## Completion

Report each pull-request ID and URL, reviewers added (required or optional),
and whether the Teams
notification was sent. Keep this report short.
