---
name: creating-ado-pull-request
description: Use when the user asks to create a PR or pull request in this repo. Creates an Azure DevOps pull request via the ado MCP, adds reviewers from the baked-in team roster (no identity lookup needed), then posts a notification to a Teams channel webhook.
---

# Creating an ADO Pull Request

Four tool calls, start to finish: **prep → create → reviewers → notify.**
Everything else is already baked into this file — do not look anything up.

**Repo constants.** `repositoryId` is **derived from the `origin` remote**, never
assumed — copies of this skill exist in several repos under the same ADO project,
plus a user-level copy at `~/.claude/skills/creating-ado-pull-request/` that may
shadow this one. Deriving makes it not matter which copy loads.

| Field         | Value                |
|---------------|----------------------|
| org           | `FreyrDevOps` |
| project       | `Freyr-Unified-RIMS` |
| repositoryId  | **last path segment of `origin`** — step 1 prints it as `$REPO` (here: `Freya-Docs-Spec`) |
| target branch | `main` unless the user says otherwise |
| PR URL        | `https://dev.azure.com/FreyrDevOps/Freyr-Unified-RIMS/_git/$REPO/pullrequest/<id>` |

Every `$REPO` below means that derived value. Opening a PR against the wrong
repository is the one mistake here that isn't cheap to undo.

## Team roster — identity IDs are pre-resolved

**Never call `mcp__ado__core_get_identity_ids` for anyone in this table.** The
`id` column is what `reviewerIds` needs; the `email` column is what the Teams
script needs for the @-mention.

### QA

| Name | id | email |
|------|----|-------|
| Xin (Yolanda) Gu | `6033a48d-b261-6bb5-b01c-e06552f9f982` | Yolanda.Gu@freyrsolutions.com |
| Bolun Zhang | `38d3ca6c-a7dc-6262-acc9-541cae944775` | Bolun.Zhang@FreyrSolutions.com |
| Yanfang Wu | `5fed4ea9-1c56-65a5-a2a3-a52e9b1aff44` | Yanfang.Wu@FreyrSolutions.com |
| Yanmin (Mina) Zhang | `a79db57b-c5e6-67e6-b97f-36ad72bf17e8` | Mina.Zhang@FreyrSolutions.com |

### Backend devs

| Name | id | email |
|------|----|-------|
| Fernando Wang | `53a67182-b912-6687-b952-c9a9f222d151` | Fernando.Wang@FreyrSolutions.com |
| Kai Hu | `894cf7ca-03b0-63c9-85d7-ce3f232f84d2` | Kai.Hu@FreyrSolutions.com |
| Susan SU | `c1d3890f-c81a-6ec3-911e-4ebbf74f8b5c` | Susan.Su@FreyrSolutions.com |
| Jay Song | `d509a71a-a880-6c89-aecd-9457c782363d` | Jay.Song@FreyrSolutions.com |

### Frontend devs

| Name | id | email |
|------|----|-------|
| Wenjian Cedric Zhang | `5a134abe-bbd7-6e39-868a-81f01bb10916` | Cedric.Zhang@FreyrSolutions.com |
| Yiqin Du | `f414c614-7801-6ec7-b02b-5bafb91184d3` | Yiqin.Du@FreyrSolutions.com |

### BA

| Name | id | email |
|------|----|-------|
| Amber Zhao | `a2a6d065-f7a0-6db5-8f7a-2f3d60c6c487` | Amber.Zhao@FreyrSolutions.com |
| Zhang Jin | `8a824c3f-9d2a-6993-82d3-7c40f0db6642` | Zhang.Jin@FreyrSolutions.com |

Their ADO display names differ from the names above for three people — Jay Song
is `Jian (Jay) JaySong`, Wenjian Cedric Zhang is `Cedric Zhang`, Zhang Jin is
`Joy (Jin) Zhang`. Use the roster names when talking to the user.

**This repo's docs are BA/QA-owned** — `functional-spec/` chapters carry named
authors and reviewers. For a spec or test-spec change, the QA and BA groups are
the natural reviewers; check the document's own Author/Reviewer fields before
defaulting to the dev groups.

## Workflow

### 1. Prep — one bash call

```bash
REPO=$(basename -s .git "$(git remote get-url origin)"); echo "REPO=$REPO"
git branch --show-current && git log -1 --format=%s && git status --short
```

- **`$REPO` is the `repositoryId` for every later call.** Read it from this
  output; do not carry over a repo name from another repo's copy of this skill.
- Refuse if the branch is `main` — branch first. This repo commits to `main`
  directly often enough that you will land on it; `git checkout -b <name>` then
  commit, rather than pushing `main`.
- Commit any pending work the PR is meant to carry, then
  `git push -u origin HEAD` and confirm it succeeded — ADO cannot create a PR
  from a ref it doesn't have.
- Title: the user's wording; else the commit subject; else the branch name.

### 2. Pick reviewers — usually no question needed

- **If the user named anyone** ("PR to Kai", "review by QA"), use them and
  **skip AskUserQuestion entirely.** A role word maps to that whole roster
  group; a name maps to that row (match loosely — "Cedric", "Mina", "Yolanda",
  "Jay" are unambiguous).
- **Only if no reviewer is implied**, ask once with **AskUserQuestion**,
  `multiSelect: true`, offering the four group defaults: Fernando Wang,
  Kai Hu, Susan SU, Jay Song. Do not ask a second follow-up question.
- Someone not in the roster: that's the one case where you call
  `mcp__ado__core_get_identity_ids`. Its `searchFilter` is finicky — it matches
  the full display name *or* the email local part, and neither reliably
  (`Zhang Jin` resolves but the real display name `Joy (Jin) Zhang` does not;
  `Yanmin (Mina) Zhang` resolves but `Mina Zhang` does not). Bare surnames and
  guessed email addresses always fail. Try the user's wording first, then the
  `First.Last` form; if two attempts miss, ask the user rather than guessing
  further. Add anyone who comes up often to the roster above.

### 3. Create the PR

`mcp__ado__repo_pull_request_write` with:

- `action: "create"`
- `project: "Freyr-Unified-RIMS"`, `repositoryId: "$REPO"` (from step 1)
- `sourceRefName: "refs/heads/<branch>"`, `targetRefName: "refs/heads/main"`
- `title`, `description` (summary of the change)

`description` is capped at **4000 characters** — the call fails validation if you
exceed it, so keep the body tight rather than pasting the whole commit message.

Keep the returned `pullRequestId`.

### 4. Add reviewers — one call for all of them

`mcp__ado__repo_pull_request_write` with:

- `action: "update_reviewers"`, `reviewerAction: "add"`
- `pullRequestId`, `project`, `repositoryId`
- `reviewerIds`: **array of every reviewer's id at once** — do not loop.

> The MCP tool has no `isRequired` flag, so it cannot mark a reviewer
> *required*; that's ADO branch policy. Mention this only if the user asked for
> a required reviewer.

### 5. Notify Teams

```bash
.claude/skills/creating-ado-pull-request/send-teams-message.sh \
  "<pr title>" \
  "https://dev.azure.com/FreyrDevOps/Freyr-Unified-RIMS/_git/$REPO/pullrequest/<id>" \
  "<reviewer name(s)>" \
  "<reviewer email>" \
  "Dave"
```

Args: title, url, reviewer name, reviewer email, author. For multiple reviewers
pass a comma-joined name string and the **first** reviewer's email (the card
mentions one person). Pass `""` for the email to skip the mention.

The identical script also sits at
`~/.claude/skills/creating-ado-pull-request/send-teams-message.sh` — use that
path if running from outside the repo root.

A webhook failure does **not** mean the PR failed — report it separately.

### 6. Report

PR id, URL, reviewers added, Teams sent yes/no. One short block, no recap of
the steps.

## Webhook configuration

The URL is secret and not committed. `send-teams-message.sh` resolves it from
`$TEAMS_WEBHOOK_URL`, else `webhook-url.txt` next to the script. That file is
gitignored in this repo (`.gitignore` line: `.claude/skills/creating-ado-pull-request/webhook-url.txt`)
— keep it that way, and never move the URL into `SKILL.md`. If step 5 fails with
"No webhook URL":

```bash
export TEAMS_WEBHOOK_URL="https://..."
# or
echo "https://..." > .claude/skills/creating-ado-pull-request/webhook-url.txt
```

The card is a `message` attachment with
`application/vnd.microsoft.card.adaptive` content, plus a "View Pull Request"
button. When an email is passed the script adds a `content.msteams.entities`
mention and a matching `<at>Name</at>` token — Teams renders a real mention
only when those match exactly, and only on Workflows/Power Automate webhooks
(legacy Office 365 connectors ignore them).

## Common mistakes — these are what make a PR slow

- **Assuming `repositoryId` instead of deriving it.** Copies of this skill exist
  in several repos, and a user-level copy may shadow this one. Step 1 prints
  `$REPO` — use it.
- **Looking up an identity ID that's already in the roster.** It's the single
  biggest time sink. The table above is the source of truth.
- **Using old tool names.** There is no `repo_create_pull_request` or
  `repo_update_pull_request_reviewers`; both are `repo_pull_request_write`
  with an `action`.
- **A `description` over 4000 characters.** The create call rejects it.
- **Asking who should review when the user already said.** Read the request
  first; AskUserQuestion is the fallback, not the default.
- **One `update_reviewers` call per reviewer.** Send the whole array.
- **Skipping the push**, or **dropping the `refs/heads/` prefix**.
- **Letting a webhook failure abort the flow.** The PR already exists.
