#!/usr/bin/env bash
# Checks that every skills/<skill>/reference/ snapshot (and its .claude/skills/
# copy) still matches the real file it was taken from, per
# scripts/skill-references.txt. Also fails on reference files missing from the
# manifest, so a new snapshot cannot be added without saying where it comes from.
#
#   bash scripts/check-skill-references.sh         # check (CI: skills-sync job)
#   bash scripts/check-skill-references.sh --fix   # copy sources into both trees
set -euo pipefail
cd "$(dirname "$0")/.."

manifest=scripts/skill-references.txt
fix=false
[ "${1:-}" = "--fix" ] && fix=true
failed=0
listed=$(mktemp)
trap 'rm -f "$listed"' EXIT

while read -r ref src; do
  src=${src%$'\r'} # Windows checkouts (core.autocrlf) give the manifest CRLF endings
  case "$ref" in '' | '#'*) continue ;; esac
  echo "$ref" >>"$listed"
  if [ ! -f "$src" ]; then
    echo "MISSING SOURCE: $src (for $ref)"
    failed=1
    continue
  fi
  for tree in skills .claude/skills; do
    if ! cmp -s "$src" "$tree/$ref"; then
      if $fix; then
        mkdir -p "$(dirname "$tree/$ref")"
        cp "$src" "$tree/$ref"
        echo "refreshed: $tree/$ref <- $src"
      else
        echo "OUT OF DATE: $tree/$ref differs from $src"
        failed=1
      fi
    fi
  done
done <"$manifest"

while read -r f; do
  if ! grep -qxF "${f#skills/}" "$listed"; then
    echo "NOT IN MANIFEST: $f (add it to $manifest)"
    failed=1
  fi
done < <(find skills -path '*/reference/*' -type f | sort)

if [ "$failed" -ne 0 ]; then
  echo "Skill references are out of date - run: bash scripts/check-skill-references.sh --fix"
  exit 1
fi
echo "All skill references match their sources."
