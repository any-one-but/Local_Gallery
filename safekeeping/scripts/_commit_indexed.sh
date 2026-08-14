#!/usr/bin/env bash
# Usage: _commit_indexed.sh <DisplayWord>
# Stages everything, commits as "<DisplayWord> NNNN", and pushes.
# Only counts prior commits whose subject is exactly "<word> <digits>" (case-insensitive).

set -euo pipefail

WORD="$1"
WORD_LOWER="$(printf "%s" "$WORD" | tr '[:upper:]' '[:lower:]')"

LAST="$(git log --format="%s" \
  | grep -iE "^${WORD_LOWER} [0-9]+$" \
  | grep -oE "[0-9]+$" \
  | sort -n \
  | tail -1)"

if [[ -z "$LAST" ]]; then
  NEXT=1
else
  NEXT=$(( 10#$LAST + 1 ))
fi

PADDED="$(printf "%04d" "$NEXT")"
MSG="${WORD} ${PADDED}"

printf "Committing: %s\n" "$MSG"
git add .
git commit -m "$MSG"
git push
