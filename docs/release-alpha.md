# CiteTrace 0.1.0-alpha.1 — GitHub alpha

This alpha records papers beside Python and notebook code, keeps links through
unambiguous moves, offers ten limited concept detectors and exports linked papers
as BibTeX. It includes the CLI and native-notebook VS Code adapter. The code is
MIT licensed; bundled dependencies retain their licenses and notices.

## Build and installation evidence

```bash
./scripts/pnpm check
./scripts/pnpm exec node scripts/package-release.mjs --smoke
./scripts/pnpm exec node scripts/smoke-vscode.mjs /usr/share/code/code
./scripts/pnpm exec node scripts/benchmark.mjs
```

The VS Code command uses an existing desktop executable, installs the actual VSIX
into a fresh temporary profile and loads the installed extension in a test host.
It does not download VS Code or change the user's extension profile. Linux uses
Electron headless mode; other platforms need a desktop session. Test evidence and
logs are retained in the temporary directory printed by the script.

Artifacts under `dist/release/`:

- `citetrace-0.1.0-alpha.1.tgz`: CLI with parser JavaScript/WASM bundled.
- `citetrace-0.1.0-alpha.1.vsix`: desktop extension and isolated analysis worker.
- `SHA256SUMS`: checksums of both archives.
- `cli-install-smoke.json`: actual offline tarball installation and workflow result.
- `vscode-install-smoke.json`: actual installed VSIX host result, when run.

Each bundle build replaces only its generated staging directory. The CLI smoke
uses a fresh npm prefix/cache with lifecycle scripts enabled and performs
init/add/link/audit/export. The host smoke exercises activation, the shared service
API, native notebooks and commands; it does not simulate every interactive picker
or replace a timed human usability test.

## Release gates still open

The controlled regression corpus is not independent held-out evidence. Build a
repository/implementation-family-disjoint labeled evaluation, report concept
precision and scoped recall, and score candidate-paper relevance separately.
The accepted plan requires at least 200 labeled examples and concept precision
of at least 90% on the held-out split.

Run [the human pilot](pilot.md) with 5–10 people over 2–4 weeks before stable.
No participant or retention metrics have been collected. Hosted cross-platform CI
status is reported in [GitHub Actions](https://github.com/quangtrinh25/citetrace/actions).
The source and alpha artifacts are distributed through
[GitHub](https://github.com/quangtrinh25/citetrace/releases/tag/v0.1.0-alpha.1);
Marketplace and npm registry publication remain deferred.

See [README](../README.md) for supported syntax, notebook language handling,
conservative anchors, concurrency limits and offline behavior.

## Verified locally on 2026-09-07

Build, strict typecheck and 364 tests passed (17 files, Node 24.20.0, Linux x64).
The offline CLI installation and installed VSIX host on VS Code 1.111.0 passed.
Host checks include two Python/notebook links, unchanged notebook bytes, explicit
unknown-language authorization, stale diagnostic/hover clearing and removed-root
rejection. The final scoped review accepted the workspace-event timing fix.

Benchmark: 901 lines, 180 symbols, 30 samples on Intel i5-14600K; median 37.32 ms,
p95 48.08 ms for parser plus detectors. See [raw result](benchmarks/local.json)
for cold timing and exclusions. No human pilot or held-out accuracy is inferred.
