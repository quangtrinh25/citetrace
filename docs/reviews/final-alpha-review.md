# Final local alpha review

Reviewed 2026-09-07 against `plan.md`, `docs/implementation-m1-m5.md`, the
M1/M3 scoped re-review, and the M2 review and fix report. This review inspected
the current files because the shared workspace does not have a usable Git
history. No production source was changed or artifacts rebuilt by the reviewer.

## Verdict

**No new Critical or Important findings in this bounded review.** The five
Important M2 findings are addressed in the current implementation. The inspected
CLI and VSIX archives are suitable for the local alpha verification and GitHub
prerelease workflow. This is not stable-release acceptance or a claim that
publication, hosted CI, or the installed extension-host test has completed.

## M2 finding dispositions

- **I1, notebook language authorization — addressed.** `snapshots()` reads the
  saved notebook envelope separately and passes it to `notebookText()`. Native
  cells supply current order/source and cell metadata, while saved metadata
  determines notebook language. A saved `{}` envelope remains unauthorized
  despite native Python synthesis. Missing/invalid saved metadata also cannot
  authorize Python. The explicit session command changes only analysis input.
- **I2, stale failed-scan state — addressed.** Current failures from both direct
  and scheduled `LatestScan.run()` calls reach the failure callback. `failScan()`
  deletes the published audit, and the callback rebuilds diagnostics. Hover reads
  that same publication state, so the failed audit cannot retain earlier links.
  Aborted or superseded runs do not publish their failures or results.
- **I3, provenance detail and dirty content — addressed.** The manual link
  command requests optional note and HTTP(S) repository-reference inputs and
  passes them through `ProjectService.link()` into the ledger. Dirty file and
  notebook scope choices show the saved-state caveat. Before saving, the service
  rescans and rejects a changed/ambiguous selection rather than persisting it.
  These fields have service-level regression coverage; the interactive picker
  sequence was inspected rather than driven by this reviewer.
- **I4, extension identity — addressed.** Source and packaged manifests use
  `publisher: citetrace` and `name: citetrace`; the installed-host lookup uses
  `citetrace.citetrace`. The VSIX manifest JSON matches the current source bytes.
- **I5, public root containment — addressed.** Both public API entry points use
  `knownWorkspaceRoot()` with the current workspace state keys. Harmless lexical
  path normalization is accepted; sibling, parent, unregistered symlink alias,
  and removed roots are rejected. The service entry point retains its trust
  check. This guard deliberately recognizes the registered lexical workspace
  path; it does not admit every filesystem alias of that path.

## Integration and distribution evidence

Fresh reviewer execution:

```text
./scripts/pnpm exec vitest run \
  packages/vscode/test/coordinator.test.ts \
  packages/vscode/test/scan-state.test.ts \
  packages/vscode/test/snapshot.test.ts \
  packages/vscode/test/service.test.ts \
  packages/vscode/test/workspace.test.ts \
  packages/vscode/test/manifest.test.ts \
  packages/vscode/test/worker.test.ts \
  packages/core/test/ledger.test.ts

8 files passed; 31 tests passed.
```

This includes the numeric-artifact schema regression, failed publication
invalidation, stale link selection, optional provenance fields, native snapshot
language handling, worker isolation/cancellation, and workspace root rejection.
The previously recorded M1/M3 scoped review closes the persisted-schema,
cross-process arXiv reservation, cooperative bibliography concurrency, and
class-body binding findings. Those wider suites were not redundantly rerun here.

The reviewer independently opened the rebuilt `0.1.0-alpha.1` tarball and VSIX
and verified both SHA-256 digests against `dist/release/SHA256SUMS`. The VSIX
contains the extension and worker bundles, both parser WASM assets, runtime
JavaScript, dependency manifests/licenses, and third-party notices. The CLI
archive contains its entry point and parser dependencies; the vendored grammar
manifest has no native installation scripts. `buildCli()` and `buildExtension()`
now remove only their generated staging directories before assembling output,
closing the previously noted stale-file packaging issue.

The coordinator reported a passing full 364-test check and an actual fresh,
offline CLI tarball installation/workflow before this review. The installed-VSIX
host run was being executed independently by the coordinator during review; its
final result belongs in the release evidence. The expanded host test covers
unknown-language dirty notebooks, explicit session authorization, preserved
notebook bytes, cell-link note/reference persistence, failed-scan hover/diagnostic
clearing, and rejected public roots. Reading that test is not execution evidence.

## Known limits and remaining evidence

- The 245 controlled detector cases are development regressions, not the
  independent repository/implementation-family-disjoint held-out dataset.
  Concept precision, scoped recall, and paper relevance remain unestablished on
  that independent dataset.
- The 5–10-person, 2–4-week pilot has not run. No usability completion, timing,
  or retention metric can be inferred from automated tests.
- Local evidence is Node 24 on Linux. Hosted cross-platform CI is pending;
  configured jobs alone do not establish support on every matrix platform.
- arXiv reservations coordinate processes sharing a canonical project cache,
  not all projects on the machine. Portable bibliography replacement retains the
  documented narrow final comparison/rename interval for non-cooperating
  writers. The review does not strengthen those documented guarantees.
- Dirty-buffer links record current editor content, and discarded edits may
  require relinking. Notebook language authorization lasts only for the session.
  The host/API smoke does not exercise every interactive picker, restricted-mode
  interaction, or multi-root UI choice.

These limits should remain explicit in the alpha release documentation. They
do not require substituting stable-release gates for the authorized prerelease.

## Scoped follow-up: workspace-removal event timing

The coordinator's subsequent installed-host run exposed an integration gap in
the original I5 fix: `workspace.workspaceFolders` could already reflect removal
while the extension's queued folder-change callback had not yet removed the root
from `states`. Checking only the stored state keys therefore admitted the removed
root during that interval. The original static/unit-test disposition above did
not establish this event-order boundary.

Re-reviewed the two public API entry-point changes in `extension.ts` on
2026-09-07. Both `audit()` and `service()` now call `ensureStates()` immediately
before `knownWorkspaceRoot()`. `ensureStates()` reads the current workspace list,
disposes removed scanners, and deletes removed state synchronously. There is no
`await` between that synchronization and validation. Consequently an invocation
after the workspace list reflects removal rejects the root even if the queued
folder-change callback has not run. The service trust check remains in place.

**Scoped verdict: the change addresses the reproduced race; no additional
Critical or Important finding.** The adjusted host test uses a saved multi-root
workspace and removes its secondary root, avoiding the first-root removal that
can restart the test host. Its bounded waits observe current workspace state and
scan publication rather than assuming that a cancelled refresh has completed an
audit. The coordinator reports the preceding notebook-language, preserved-byte
linking, and failure-state host assertions passed; the final rebuilt-artifact
host run and full check were still being executed when this appendix was written.
No additional build or host instance was started by this reviewer.
