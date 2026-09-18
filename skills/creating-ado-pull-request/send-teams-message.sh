#!/usr/bin/env bash
#
# Post a message to a Microsoft Teams channel via an Incoming Webhook (Workflow)
# using an Adaptive Card. Called after an Azure DevOps PR is created.
#
# Webhook URL resolution (first match wins):
#   1. $TEAMS_WEBHOOK_URL environment variable
#   2. webhook-url.txt next to this script (gitignored; put the real URL there)
#
# Usage:
#   ./send-teams-message.sh "<pr-title>" "<pr-url>" "<reviewer>" \
#                           ["<reviewer-email>"] ["<author>"]
#
# If <reviewer-email> (the reviewer's UPN/email or AAD object id) is given, the
# reviewer is @-mentioned in the card via the msteams.entities mechanism.
# Omit it (or pass "") to skip the mention and just list the reviewer.
#
set -euo pipefail

TITLE="${1:?PR title required}"
PR_URL="${2:?PR URL required}"
REVIEWER="${3:?Reviewer name required}"
REVIEWER_EMAIL="${4:-}"
AUTHOR="${5:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Resolve the webhook URL.
WEBHOOK_URL="${TEAMS_WEBHOOK_URL:-}"
if [[ -z "$WEBHOOK_URL" && -f "$SCRIPT_DIR/webhook-url.txt" ]]; then
  WEBHOOK_URL="$(tr -d '[:space:]' < "$SCRIPT_DIR/webhook-url.txt")"
fi
if [[ -z "$WEBHOOK_URL" ]]; then
  echo "ERROR: No webhook URL. Set \$TEAMS_WEBHOOK_URL or create $SCRIPT_DIR/webhook-url.txt" >&2
  exit 1
fi

# jq handles JSON escaping of all user-supplied text. The reviewer mention is
# built only when an email/id is supplied: the <at>…</at> token in the body
# text MUST match the entity's `text` character-for-character, or Teams renders
# it as plain text instead of a mention.
PAYLOAD="$(jq -n \
  --arg title "$TITLE" \
  --arg url "$PR_URL" \
  --arg reviewer "$REVIEWER" \
  --arg email "$REVIEWER_EMAIL" \
  --arg author "$AUTHOR" \
  '
  ($reviewer | "<at>" + . + "</at>")                     as $at |
  ([ if $author != "" then {title:"Author", value:$author} else empty end,
     {title:"Reviewer", value:$reviewer} ])              as $facts |
  {
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      content: ({
        type: "AdaptiveCard",
        version: "1.5",
        body: ([
          { type: "TextBlock", text: "🔀 New Pull Request", weight: "Bolder", size: "Medium" },
          { type: "TextBlock", text: $title, wrap: true },
          { type: "FactSet", facts: $facts }
        ] + (if $email != ""
             then [ { type: "TextBlock", wrap: true,
                      text: ($at + ", you are assigned as reviewer 👀") } ]
             else [] end)),
        actions: [
          { type: "Action.OpenUrl", title: "View Pull Request", url: $url }
        ]
      } + (if $email != ""
           then { msteams: { entities: [
                    { type: "mention", text: $at,
                      mentioned: { id: $email, name: $reviewer } } ] } }
           else {} end))
    }]
  }')"

curl -sS -f -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD"

echo "Teams message sent."
