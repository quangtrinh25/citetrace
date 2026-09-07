# M2 and distribution review

Reviewed 2026-09-07 against `docs/m2-task.md`, `plan.md`, the current
`packages/vscode` source/manifest/tests, `scripts/build-bundles.mjs`,
`scripts/package-release.mjs`, the generated VSIX/npm archives, and the installed
VS Code host result under `/tmp/citetrace-host-uDE7jL`. This was a bounded review;
no implementation source was changed.

## Verdict

**Specification verdict: needs changes before M2 acceptance.** The packaged
extension proves the basic file workflow (activate, initialize, add, link, reopen,
export) and opens a native notebook without registering a kernel, controller, or
serializer. The worker is a real `worker_threads` bundle, cancellation terminates
it, the installed artifact contains the worker, WASM runtime, grammar, licenses,
and notices, and persisted writes use core revision-checked atomic ledger APIs.
Workspace-folder ownership is carried on tree entries, command-palette operations
pick a root when needed, write commands are guarded by workspace trust, and hover
text uses `MarkdownString.appendText` rather than trusted Markdown or command URIs.

The native notebook language boundary, failed-scan state invalidation, required
link inputs, public API containment, and manifest identity still have important
gaps. The current VSIX also predates a manifest edit and must be regenerated after
review fixes.

**Quality verdict: good lower-level coverage, insufficient boundary coverage.** A
fresh `./scripts/pnpm --filter citetrace-vscode typecheck` exited 0. A fresh scoped
Vitest run passed 4 files and 10 tests. The existing installed-host result records
VS Code 1.111.0, three notebook cells, and one reopened link. That host test uses
the returned `ProjectService` for initialize/add/link and only invokes refresh and
export as actual commands; it does not test unsaved notebook reconstruction,
missing language metadata, tree/hover invalidation, restricted mode, multi-root
selection, or the interactive link fields.

## Important findings

### I1. A notebook with no saved language declaration is silently analyzed as Python

`packages/vscode/src/snapshot.ts:12-13` trusts
`NotebookDocument.metadata.metadata` as the raw notebook metadata. The native
VS Code ipynb deserializer does not preserve the distinction required here: when
the saved file has neither `kernelspec` nor `language_info`, it chooses a default
language (Python in the normal desktop host) and inserts
`metadata.language_info.name` before exposing `NotebookDocument.metadata`.
Consequently `snapshots()` in `packages/vscode/src/extension.ts:43-46` constructs
an apparently explicit Python notebook and core accepts it without the user ever
running **Treat Notebook as Python for This Session**.

This is the exact case behind the task requirement to obtain true raw notebook
metadata from the saved file while preserving current unsaved cell order. The
snapshot unit tests model hand-built metadata and therefore cannot catch the
native serializer's synthesized value. Read the saved ipynb metadata separately,
use the native cell documents only for current order/source/ID, and apply the
Python override only after the explicit session command. Add a real-host case for
a saved notebook whose metadata is `{}` and assert that it remains unsupported
until that command is run.

### I2. A failed background audit leaves old diagnostics and hovers active

The scan error callback at `packages/vscode/src/extension.ts:91` sets
`state.error`, writes the output channel, and refreshes the tree, but retains
`state.audit` and does not clear or recompute diagnostics. The hover provider at
`packages/vscode/src/extension.ts:277-286` continues consuming that old audit.
The diagnostic collection likewise retains the last successful suggestions and
link diagnostics. For example, corrupting or conflict-marking the ledger after a
successful scan makes the tree say **Audit failed** while editor hovers still
present the previous human-confirmed relations.

Invalidate the published audit (or mark it unusable) and clear that root's
diagnostics on failure. A regression test should publish a successful audit,
make the next scan fail, and verify that neither hover nor diagnostic state can
read the earlier result.

### I3. The required link workflow cannot record its optional provenance detail

The command flow at `packages/vscode/src/extension.ts:182-190` asks for scope,
paper, relation, and concept only. `ProjectService.link` at
`packages/vscode/src/service.ts:22-30` has no note or reference URL parameters and
passes neither to `addLink`, although the ledger supports both. This misses the M2
requirement for an optional note and the plan's repository-reference URL. It also
persists an anchor made from dirty editor content without a visible saved-state
caveat in that command flow; the picker merely says “current editor content.” If
the user later discards the buffer, the newly created link immediately becomes a
review/missing link, and CLI parity never existed for the chosen content.

Add optional note and repository URL inputs to the command/service boundary and
show a specific warning or description when the selected scope comes from an
unsaved document/notebook. Cover the stored fields and dirty-source caveat at the
command boundary.

### I4. The extension identity does not match the specified manifest identity

`packages/vscode/package.json:2` names the extension `citetrace-vscode`, while the
M2 architecture requires name `citetrace` with publisher `citetrace`. The built
archive therefore identifies itself as `citetrace.citetrace-vscode`, and
`packages/vscode/test/host-smoke.cjs:7` asserts that same non-spec ID. Extension
IDs are persistent user-facing identifiers, so changing this after distribution
creates a different extension rather than an upgrade.

Set the manifest name to `citetrace`, update the host lookup to
`citetrace.citetrace`, rebuild the VSIX, and verify the identity in
`extension.vsixmanifest`.

### I5. The exported read-only API can scan arbitrary filesystem roots

The returned `audit(root)` API at `packages/vscode/src/extension.ts:300` sends any
caller-provided path to a worker without checking `states.has(root)` or resolving
it to an open local workspace folder. The sibling `service(root)` API does perform
that check. A consumer can therefore trigger recursive parsing outside every
workspace represented by this extension, which breaks the multi-root/project
containment contract and makes the public test hook materially broader than the
UI.

Apply the same known-workspace validation to `audit`, preferably after canonical
path normalization, and test rejection of sibling, parent, symlink-alias, and
removed workspace roots. Read-only operation in an untrusted workspace can remain
supported for roots already in `states`.

## Distribution state

The inspected VSIX contains `extension.cjs`, `worker.cjs`, both Tree-sitter WASM
files, the minimal `tree-sitter-python` package, licenses, and third-party notices.
The npm tarball likewise contains the CLI entry point and both bundled parser
dependencies. The isolated-directory worker parity and cancellation tests pass.

The checked-in `packages/vscode/package.json` was modified after the current VSIX
was produced: the source settings now have resource scope, while
`dist/release/citetrace-0.1.0-alpha.1.vsix` does not. Its checksums therefore
describe an older manifest. Regenerate both artifacts and `SHA256SUMS` only after
the findings above are resolved, then inspect the archive rather than relying on
the build exit status alone.

The build functions only create their destination directories; they do not clean
them. Because `.vscodeignore` includes all of `dist/**`, a future build can package
stale files left by an earlier build. Use a fresh staging directory (preferred)
or narrowly remove/recreate the generated destination before copying runtime
files, and keep the archive-content inspection in the release check.
