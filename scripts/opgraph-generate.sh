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
#
# ODK emits variants and fields in schema declaration order and is byte-stable
# across runs, so regenerating with an unchanged schema produces no diff.
set -euo pipefail

# Run from the repo root regardless of the caller's cwd (direct ./ invocation
# as well as `bun run`)
cd "$(dirname "$0")/.."

ODK="${ODK:-odk}"
SCHEMA="schema/opgraph.odk.yaml"
TS_DIR="src/facet"
RUST_DIR="crates/facet-kernel/src"

# --out-file names the output stem directly, so no rename step is needed
"$ODK" generate "$SCHEMA" -t typescript --out-file opgraph.gen -o "$TS_DIR"
"$ODK" generate "$SCHEMA" -t rust --out-file opgraph_gen -o "$RUST_DIR"

echo "Regenerated opgraph.gen.ts and opgraph_gen.rs from $SCHEMA"
