# Task M2: VS Code adapter and notebook workflow

Read plan.md and core exports/types. Implement `packages/vscode` only (package,
src, tests, README/assets if needed), with tested behavior and report at
docs/reviews/m2-implementation.md. Root owns distribution scripts, core and root
package/lock changes. Do not spawn subagents or mutate .git. M1 core is prerequisite;
use public APIs, coordinate any missing ones. Implement this task once dispatched.

Architecture: desktop/remote Node extension with manifest engines.vscode^1.95.0,
publisher `citetrace`, name `citetrace`, version0.1.0-alpha.1, MIT, main dist/extension.cjs.
No browser host/telemetry/backend/AI. Root will bundle entry src/extension.ts to
CJS and src/worker.ts to CJS with esbuild, provide WASM beside bundles and minimal
tree-sitter-python package. Use Worker(new URL or context.asAbsolutePath dist/worker.cjs)
for parsing/project scans. VS Code imports only adapter. Worker protocol typed
and independently testable via async pure handler module if useful.

Use native notebook APIs and cell TextDocuments; do not register serializers,
controllers, or execute kernels. SourceUnit cells use notebook relative path,
zero-based index and metadata ID when real; preserve reader validations/duplicate
IDs across markdown too. To analyze unsaved notebook snapshot, reconstruct a
minimal nbformat4 object with notebook metadata, cell sources and IDs and pass
readNotebook; get true raw notebook metadata via saved file when API nests
`metadata` fields differently, without overwriting current unsaved cell order.
Unknown notebook language: explicit command/settings per notebook to treat Python
in analysis memory only; never rewrite notebook to insert IDs or language metadata.

Sidebar (Explorer view `citetrace` with title CiteTrace): Papers, Current Links,
Suggestions, Needs Attention/Broken Links, Decisions. Display useful names/status
and evidence; metadata source separate from human confirmed relation. Commands:
Initialize, Add Paper (DOI/arxiv/manual input via quickpick/input boxes), Link Paper
(choose paper, active file/cell/symbol scope, relation, optional concept/note),
Export Bibliography, Audit/Refresh, Unlink, Relink to current selection,
Sync Locations, Accept Suggestion, Ignore, Exempt(reason), Reject Candidate,
Reopen Decision. Commands work via palette/tree/context menu. Manual paper entry
requires title, optional authors/year; online lookup only explicit Add/Refresh.
Auto-export setting defaultsfalse; only after explicit confirmed link modifications,
not during scanning. Respect core safe overwrite behavior; errors not swallowed.
Show paper metadata before explicit accept. Multi-root pick/store project root
per treeitem; never silently write into wrong workspace. All writes use fresh
ledger+revision; stale UI command rechecks current content/suggestion, and when
unsaved source exists anchor uses current content with saved-state caveat visible.

Background debounce~1000ms on open/edit/save/notebook change and workspace file
rename/delete/ledger changes; discard old results by generation, terminate worker
or cancel when stale/dispose. Don't accumulate workers/listeners; tree responds
immediately then updates on completed scan. No popups during background edits;
status/errors go to tree/output channel. Report partial parsing/read errors.
Worker scans saved project plus replacement open document/notebook snapshots so
CLI/editor parity for saved content follows identical core path. No network scan.

Info diagnostics and hover for current files/cells; precise UTF16 ranges. Only
unresolved suggestions produce info; ignored/exempt/covered hidden. Broken links
show repair path. Hover escapes untrusted metadata, no trusted markdown command
URIs. Navigation verifies workspace containment and current anchor resolution.
Extension supports untrusted workspace read-only or disables writing via manifest
capabilities/command guard; don't execute repo code in either case.

Tests before implementation: adapter state/protocol snapshot conversion, stale
generation cancellation, real worker/core parity for saved Python+notebook,
manual linking+export workflow at command service boundary. Test real boundaries,
not simply that registerCommand was called. Host UI integration test hook can
export `run()` for `--extensionTestsPath`; root will attempt real installed VSCode
smoke. Use @types/vscode installed by root; request types/deps if missing.

Root bundles commonjs with import.meta.url shim; worker can use __dirname or
context.asAbsolutePath in extension. Keep package `type:module` for source tests
and tsconfig NodeNext, emitted extension runtime always .cjs by root bundler.
Root will add scripts/build-release.mjs and scripts/build-extension.mjs; package
build can be `tsc -p tsconfig.json --noEmit` until bundler is provided. Do not
include guessed GitHub repo URL. Record actual UI/runtime limitations honestly.
