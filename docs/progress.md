# CiteTrace implementation progress

The accepted product specification is `plan.md`; the original concept is retained
in `docs/original-plan.md`. The workspace now contains a local alpha with durable
provenance, CLI, ten detectors, decisions and a VS Code desktop adapter. The M0
entries below are historical. Current work is tracked in
[the M1–M5 implementation record](implementation-m1-m5.md).

## Current status — 2026-09-07

- M1 is implemented: validated atomic ledger, paper CRUD, explicit metadata lookup,
  conservative relocation and protected BibTeX export; CLI uses the shared core.
- M2 is implemented and the desktop host workflow has run. Review identified
  notebook language authorization, stale failure state and link-input gaps; fixes
  are fixed and independently reviewed. The rebuilt installed-VSIX host passed.
- M3 has ten limited detector rules and fingerprint-scoped decisions, with 245
  controlled detector regression cases. These are development fixtures, not an
  independently held-out repository dataset or a measured 90% precision claim.
- M4 CLI tarball and VSIX are built locally. The CLI installs offline into a fresh
  prefix/cache. Release scripts, issue templates and artifact CI are provided;
  publication target is [quangtrinh25/citetrace](https://github.com/quangtrinh25/citetrace).
  Hosted CI status is available on GitHub Actions.
- M5 local stabilization checks pass. [The pilot protocol](pilot.md) is ready;
  no participant results, week-two retention or stable-release acceptance exist.

Benchmark output is recorded in [local.json](benchmarks/local.json), including
hardware, sample count and exclusions. Build/install evidence is summarized
in [the alpha release notes](release-alpha.md).

## Decisions

- Work in the provided workspace: `.git` is an externally managed read-only
  directory and is not currently a valid repository. No Git initialization,
  branch changes, commits, or publishing are attempted.
- Python `.venv` is for development helpers. The shipped analysis core uses
  TypeScript and bundled WebAssembly, with no Python runtime dependency.
- Keep M0 runnable independently of M1 ledger and M2 VS Code integration.
- Compare source units and anchors without ever executing repository code.

## Execution checklist

- [x] Create Python 3.11 virtual environment.
- [x] Download and verify local Node.js 24.20.0 against official SHA-256 manifest.
- [x] Install local pnpm and lock project dependencies.
- [x] Implement and test notebook reading without modifying source notebooks.
- [x] Implement and test Python symbol extraction and structural fingerprints.
- [x] Implement and test conservative code-anchor resolution.
- [x] Add read-only CLI, examples, setup documentation and CI.
- [x] Independent code review and final verification.

## Interface review

| Producer / consumer | Contract | Check |
| --- | --- | --- |
| Notebook reader / parser | `SourceUnit` and `SourceDiagnostic` in core types | Cell index is display-only; source is exact concatenated text |
| Parser / anchor resolver | Serializable symbol and unit snapshots | Fingerprints ignore formatting, preserve meaningful tokens |
| Core / CLI | Core contains no VS Code imports | CLI reads files; analysis never executes them |
| Notebook task / own tests | nbformat 4 input, Python code cells only | Malformed input is reported, not silently accepted |
| Parser task / own tests | Tree-sitter WASM parses real Python | Syntax errors and magics remain explicit |
| Anchor task / own tests | Exact identity or unique conservative match | Duplicates must be ambiguous; deleted sources remain missing |

## Verification record

- Python: eight behavioral tests failed against the empty implementation, then
  all eight passed with real Tree-sitter WASM.
- Anchors: ten tests failed against the missing-only implementation, then all
  twelve passed, including missing, ambiguous and review-needed cases.
- Notebook: 19 focused tests passed; independent task review approved both spec
  compliance and quality with no actionable findings.
- CLI: six tests failed against the unimplemented entrypoint, then all seven
  passed against compiled CLI subprocesses.
- `./scripts/pnpm check`: build and typecheck passed; 46/46 tests passed on
  2026-09-06 with Node.js 24.20.0 on Linux x64.
- Restricted sandbox stdout capture for synchronous Node child processes returns
  EPERM. The full integration suite was rerun successfully with approved execution
  outside that sandbox; tests were not weakened or skipped.
- An initial TypeScript 7 typecheck failure was traced to missing explicit Node
  ambient types. `--types node` proved the fix, now recorded in the shared config.
- `inspect` ran on both shipped examples and the relocation example resolved a
  renamed function in a moved Python file without executing Python.
- Warm local benchmark: 901 lines / 300 symbols, 30 samples on Intel Core
  i5-14600K, Linux x64, Node 24.20.0: median 7.87 ms, p95 12.81 ms. This is a
  synthetic parser benchmark, excluding cold WASM initialization and file I/O.

## Remaining product milestones at the M0 checkpoint (historical)

M1 ledger/metadata/BibTeX, M2 VS Code, M3 citation detectors and the M4/M5 public
release/pilot gates are not implemented or claimed complete by this M0 delivery.
The CI workflow is provided for GitHub but has not run on hosted runners yet.

## Final M0 disposition — 2026-09-06

**Environment and M0 are complete for this execution slice.** Node 24.20.0,
pnpm 10.34.5 and Python 3.11.9 `.venv` are available locally. Both example inputs
and the anchor relocation demo run successfully.

Independent final review identified three actionable issues: silently ignored
malformed notebook entries, symbols under invalid Python wrappers, and descendants
under duplicate enclosing Python scopes. Each was reproduced and fixed with
behavioral regression tests. The scoped re-review accepted the notebook and scope
fixes and found one remaining decorator/comment variant; the parent reproduced
that variant (1 failing test / 12), fixed comment-aware recovery, then verified
12/12 parser tests and the original compiled-core reproduction (anchor now missing).

Final `./scripts/pnpm check` passed build, strict typechecking and **56/56 tests**:
20 notebook, 12 Python, 16 anchors, 8 compiled CLI. Synchronous CLI subprocess tests
ran with the approved sandbox escalation. Hosted cross-platform CI has not run.

Review history: [initial review](reviews/m0-initial.md),
[fix report](reviews/m0-fixes.md), [scoped re-review](reviews/m0-rereview.md).
The historical re-review predates the final comment-aware decorator fix; the
fresh regression and compiled-core verification above record its disposition.

At that checkpoint, the next milestone was M1 persistence and paper-linking CLI, metadata resolution and
BibTeX generation, as specified in `plan.md`.

## Final alpha verification — 2026-09-07

- Whole workspace: build, strict types and **364/364 tests in 17 files** passed.
- Offline installed CLI tarball: init/add/link/audit/export passed.
- Installed VSIX, VS Code 1.111.0 on Linux: two persisted Python/notebook links,
  notebook bytes unchanged, explicit unknown-language authorization, stale-state
  clearing, and invalid/removed workspace rejection passed.
- The real host caught a workspace-event timing race; API entry now synchronizes
  current folders before validation. The reproduced host case passed after fixing.
- Final independent review and its scoped follow-up found no open Critical or
  Important issues. See [review](reviews/final-alpha-review.md).
- Parser plus detector, 901 lines/30 samples: median 37.32 ms, p95 48.08 ms on
  i5-14600K/Node 24.20.0/Linux; excludes I/O, network, worker startup and debounce.
- Publishing uses an isolated Git staging repository because the original
  workspace .git directory is managed and read-only. No venv/cache is published.

## GitHub publication and first hosted CI

Public source: https://github.com/quangtrinh25/citetrace

Alpha release: https://github.com/quangtrinh25/citetrace/releases/tag/v0.1.0-alpha.1

All five release assets were uploaded and server SHA-256 digests match the local
archives. The first hosted run passed Linux Node 22/24, Windows Node 22, macOS
Node 22 and artifact packaging/install. The Node 24 Windows/macOS jobs exposed
a timing-dependent filesystem watcher in the bibliography concurrency test.
The test now inserts a real competing write at a controlled filesystem boundary;
production code and published binaries are unchanged. The focused six tests and
strict typecheck pass locally; the updated full matrix is being run on GitHub.
