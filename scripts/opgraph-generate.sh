#!/usr/bin/env bash
# Regenerate the op-graph contract (TS + Rust) from schema/opgraph.odk.yaml.
#
# This is the ONLY step that needs the ODK CLI; the Facet build itself consumes
# the committed generated files (src/facet/opgraph.gen.ts,
# crates/facet-kernel/src/opgraph_gen.rs) and never runs ODK.
#
# ODK is not published, so build the CLI from master and point this at it:
#   git clone https://github.com/omnidotdev/odk && cd odk
#   cargo build --release -p odk-cli   # or: cargo install --path odk-cli
# Then run with ODK set to the binary (or put `odk` on PATH):
#   ODK=/path/to/odk bun opgraph:generate
set -euo pipefail

# Run from the repo root regardless of the caller's cwd (direct ./ invocation
# as well as `bun run`)
cd "$(dirname "$0")/.."

ODK="${ODK:-odk}"
SCHEMA="schema/opgraph.odk.yaml"
TS_DIR="src/facet"
RUST_DIR="crates/facet-kernel/src"

# ODK writes `models.<ext>`; rename to the stable, home-specific filenames
# (this overwrites any existing opgraph.gen.* / opgraph_gen.* in place)
"$ODK" generate "$SCHEMA" -t typescript -o "$TS_DIR"
mv "$TS_DIR/models.ts" "$TS_DIR/opgraph.gen.ts"

"$ODK" generate "$SCHEMA" -t rust -o "$RUST_DIR"
mv "$RUST_DIR/models.rs" "$RUST_DIR/opgraph_gen.rs"

echo "Regenerated opgraph.gen.ts and opgraph_gen.rs from $SCHEMA"
