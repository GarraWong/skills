#!/usr/bin/env bash
# Post an Azure DevOps pull-request notification to a Teams Workflow webhook.
# Usage: send-teams-message.sh <title> <url> <reviewers> [first-reviewer-email] [author] [<title> <url> ...]
# <reviewers> is a comma-joined display list. A mention, when an email is
# given, uses only the first name in that list.
# Extra <title> <url> pairs after <author> add more pull requests to the same
# card; pass "" for email or author to skip them while still adding pairs.
set -euo pipefail

TITLE="${1:?PR title required}"
PR_URL="${2:?PR URL required}"
REVIEWERS="${3:?Reviewer names required}"
REVIEWER_EMAIL="${4:-}"
AUTHOR="${5:-}"
shift $(( $# < 5 ? $# : 5 ))
if (( $# % 2 != 0 )); then
  echo "ERROR: Extra pull requests must be <title> <url> pairs" >&2
  exit 1
fi
MENTION_NAME="$(printf '%s' "$REVIEWERS" | cut -d, -f1 | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBHOOK_URL="${TEAMS_WEBHOOK_URL:-}"

if [[ -z "$WEBHOOK_URL" && -f "$SCRIPT_DIR/webhook-url.txt" ]]; then
  WEBHOOK_URL="$(tr -d '[:space:]' < "$SCRIPT_DIR/webhook-url.txt")"
fi
if [[ -z "$WEBHOOK_URL" ]]; then
  echo "ERROR: Set TEAMS_WEBHOOK_URL or create $SCRIPT_DIR/webhook-url.txt" >&2
  exit 1
fi

PAYLOAD="$(jq -n \
  --arg title "$TITLE" \
  --arg url "$PR_URL" \
  --arg reviewers "$REVIEWERS" \
  --arg mention "@$MENTION_NAME" \
  --arg email "$REVIEWER_EMAIL" \
  --arg author "$AUTHOR" '
  ([$title, $url] + $ARGS.positional) as $flat |
  [range(0; $flat | length; 2) as $i | {title:$flat[$i], url:$flat[$i + 1]}] as $prs |
  ($mention | "<at>" + . + "</at>") as $at |
  ([if $author != "" then {title:"Author", value:$author} else empty end,
    {title:"Reviewer", value:$reviewers}]) as $facts |
  (if ($prs | length) == 1 then
     [{type:"TextBlock", text:"🔀 New Pull Request", weight:"Bolder", size:"Medium"},
      {type:"TextBlock", text:$title, wrap:true}]
   else
     [{type:"TextBlock", text:"🔀 \($prs | length) New Pull Requests",
       weight:"Bolder", size:"Medium"}] +
     [$prs[] | ((.url | capture("/_git/(?<r>[^/]+)/") | .r) // "") as $repo |
       {type:"TextBlock", wrap:true, spacing:"Small",
        text:("- " + (if $repo != "" then "**" + $repo + "**: " else "" end) +
              "[" + .title + "](" + .url + ")")}]
   end) as $header |
  {type:"message", attachments:[{
    contentType:"application/vnd.microsoft.card.adaptive",
    content: ({type:"AdaptiveCard", version:"1.5", body:(
      $header + [{type:"FactSet", facts:$facts}] +
      (if $email != "" then [{type:"TextBlock", wrap:true,
        text:($at + ", you are assigned as reviewer 👀")}] else [] end))} +
      (if ($prs | length) == 1 then
        {actions:[{type:"Action.OpenUrl", title:"View Pull Request", url:$url}]}
       else {} end) +
      (if $email != "" then {msteams:{entities:[{type:"mention", text:$at,
        mentioned:{id:$email, name:$mention}}]}} else {} end))
  }]}' --args "$@")"

curl -sS -f -X POST "$WEBHOOK_URL" -H "Content-Type: application/json" -d "$PAYLOAD"
echo "Teams message sent."
