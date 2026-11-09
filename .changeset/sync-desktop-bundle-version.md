---
"@omnidotdev/facet": patch
---

Version the desktop installers from the single source of truth. The release version sync wrote `src-tauri/Cargo.toml` but not `src-tauri/tauri.conf.json`, whose `version` drives the bundle and the app's reported version, so a tagged release could ship installers still carrying the previous number. The sync now updates both, keeping the tag, the installers, and the in-app version in lockstep.
