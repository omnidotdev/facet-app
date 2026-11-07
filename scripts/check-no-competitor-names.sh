#!/usr/bin/env bash
set -euo pipefail

# Fail if a competing product's name appears in tracked source, comments, docs,
# or UI. The house rule is to never name a competitor; this guard keeps the name
# from creeping back in once it has been reworded out.
#
# The blacklist is intentionally conservative: start with a single, unambiguous
# product name and extend it only with terms that cannot collide with legitimate
# geometry or CAD vocabulary (so NOT generic words like "fuse" or "fusion").
BLACKLIST=(
  "openscad"
)

# A line that must keep a competitor name on purpose (a truthful interop claim, a
# deliberate comparison) can opt out by appending this marker as a comment.
OPT_OUT_MARKER="competitor-name-ok"

# Paths that are allowed to contain the names: this guard itself, binaries, the
# lockfile, dependencies, and generated output.
EXCLUDES=(
  ":!scripts/check-no-competitor-names.sh"
  ":!*.wasm"
  ":!bun.lock"
  ":!**/node_modules/**"
  ":!*.gen.ts"
  ":!*_gen.rs"
)

found=0
for term in "${BLACKLIST[@]}"; do
  # git grep -n is case-insensitive via -i; drop any line that opted out
  if matches=$(git grep -in "$term" -- . "${EXCLUDES[@]}" | grep -v "$OPT_OUT_MARKER"); then
    echo "Competitor name \"$term\" found:" >&2
    echo "$matches" >&2
    found=1
  fi
done

if [ "$found" -ne 0 ]; then
  echo >&2
  echo "Reword to drop the competitor name, or append \"$OPT_OUT_MARKER\" to a line that must keep it." >&2
  exit 1
fi

echo "No competitor names found."
