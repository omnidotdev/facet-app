#!/usr/bin/env bash
# Regenerate the op-graph contract (TS + Rust) from schema/opgraph.odk.yaml.
#
# This is the ONLY step that needs the ODK CLI; the Facet build itself consumes
# the committed generated files (src/facet/opgraph.gen.ts,
# crates/facet-kernel/src/opgraph_gen.rs) and never runs ODK.
#
# ODK is published, so install the pinned CLI from crates.io. The `odk` binary
# is the Rust `odk-cli` crate; the npm `@omnidotdev/odk` package is a different
# TypeSpec tool and does not provide `generate`:
#   cargo install odk-cli@0.1.2   # requires rustc >= 1.96 (wasmtime deps)
# Then run with `odk` on PATH, or point ODK at the binary:
#   bun opgraph:generate
#   ODK=/path/to/odk bun opgraph:generate
#
# ODK emits variants and fields in schema declaration order and is byte-stable
# across runs, so regenerating an unchanged schema produces no diff (verified
# byte-identical against odk-cli 0.1.2 on 2026-11-09)
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
