/**
 * @file Sync the version from `package.json` into the native build files
 * (`src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`) so a release's crate
 * and desktop installers carry the released version. Run in CI by `bun run
 * version` after `changeset version`, or by hand with `bun scripts/syncVersion.ts`
 */

const pkg = await Bun.file("package.json").json();
const version = pkg.version;

const cargo = await Bun.file("src-tauri/Cargo.toml").text();
await Bun.write(
  "src-tauri/Cargo.toml",
  cargo.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`),
);

// tauri.conf.json's top-level `version` is what drives the bundle/installer
// version and the app's reported version; without syncing it the installers
// keep the previous number even though the release is tagged at the new one
const conf = await Bun.file("src-tauri/tauri.conf.json").text();
await Bun.write(
  "src-tauri/tauri.conf.json",
  conf.replace(/"version"\s*:\s*"[^"]*"/, `"version": "${version}"`),
);

console.info(
  `Synced version ${version} to src-tauri/Cargo.toml and src-tauri/tauri.conf.json`,
);

export {};
