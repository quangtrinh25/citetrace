# M1 implementation report

## Scope and outcome

Implemented the durable CiteTrace ledger, metadata lookup/cache, recursive project
reader, deterministic bibliography export, and the complete CLI provenance workflow.
The CLI retains M0 `inspect` behavior and now supports `init`, `add`, `papers`,
`paper update|refresh|remove|merge`, `link`, `unlink`, `audit`, `export`, `sync`,
`relink`, `decide`, `decisions`, and `reopen`.

The M1 core is exported through `@citetrace/core`. Detector, registry, suggestion,
and project-audit implementations were owned by the coordinator; this task only
added their agreed public exports and consumed them from the CLI.

## Implemented behavior

- Schema-version 1 runtime validation covers papers, human-confirmed links,
  decisions, normalized project-relative anchors, SHA-256 fingerprints, timestamps,
  identifier uniqueness, citation-key uniqueness, and referential integrity.
- `readLedger()` represents absence as `{ ledger: null, revision: null }` and rejects
  malformed content without replacing it. `writeLedger()` validates before writing,
  acquires an exclusive creation lock, checks the expected revision inside the lock,
  fsyncs the temporary file, atomically renames it, and cleans up only its own lock
  and temporary file. Existing locks are never stolen.
- Paper operations normalize DOI and arXiv identifiers including arXiv versions,
  never deduplicate by title, preserve IDs and citation keys across updates and
  refreshes, reject identifier conflicts, protect linked-paper removal, and make
  merge conflicts atomic.
- DOI lookup uses DOI content negotiation with CSL JSON. arXiv lookup uses the Atom
  API with exact response-identifier verification. Fetch and time boundaries are
  injectable; response headers and bodies have finite timeouts; retries are bounded;
  `429` retry delays are capped; every arXiv attempt reserves at least a three-second
  provider slot. Validated cache entries live under `.citetrace/cache`; offline cache
  misses and corrupt entries produce manual-entry guidance.
- Project reading recursively discovers saved `.py` and `.ipynb` files, uses the
  maintained `ignore` package for root and nested `.gitignore` rules, skips dependency
  and build directories, and does not follow project-walk symlinks. Individual read
  failures are diagnostics.
- BibTeX output is deterministic, escapes special characters, includes only papers
  with confirmed links, and carries a CiteTrace ownership header. Export refuses
  user-owned files unless `--force`, rejects traversal and symlink escape, and writes
  through a synced temporary file plus atomic rename.
- Audit is read-only, reports confirmed/unresolved/exempt/ignored and link-location
  states plus diagnostics, and never returns source in CLI JSON. Sync changes only
  unique relocations with unchanged fingerprints. Relink is explicit for edited or
  otherwise unresolved locations. Whole-cell linking remains available when notebook
  magic prevents symbol parsing.
- Multiple papers may link to one scope. Duplicate identity is
  `paper + concept + scope`; ID-less notebook cell scope includes its structural
  fingerprint.

Provider behavior was checked against the official
[Crossref content-negotiation documentation](https://support.crossref.org/hc/en-us/articles/213673586-Content-negotiation)
and [arXiv API user manual](https://info.arxiv.org/help/api/user-manual.html), including
the CSL media type, `id_list` query, Atom response, and arXiv's three-second request
spacing guidance.

## TDD evidence

Tests were added before each production slice and observed failing at the intended
boundary.

- RED: `./scripts/pnpm exec vitest run packages/core/test/ledger.test.ts packages/core/test/metadata.test.ts packages/core/test/project-bibliography.test.ts`
  initially reported 10/10 failures because the new public functions did not exist.
- RED: `./scripts/pnpm exec vitest run packages/core/test/ledger.test.ts` reported
  the multi-paper and ID-less-cell scope regressions, then the concept-identity
  regression, against the initial duplicate check.
- RED: `./scripts/pnpm exec vitest run packages/core/test/project-bibliography.test.ts`
  reported two failures for anchored/`**/` ignore semantics and creation through a
  symlinked output parent.
- RED: `./scripts/pnpm exec vitest run packages/core/test/metadata.test.ts` reported
  failures for unthrottled arXiv retries, an unbounded body read, and a cache-entry
  symlink. Later malformed-cache and provider JSON cases failed with non-actionable
  parser messages before their error handling was added.
- RED: `./scripts/pnpm exec vitest run packages/core/test/ledger.test.ts packages/core/test/metadata.test.ts`
  reported 4 failures for absent update/remove/merge/refresh APIs.
- RED: `./scripts/pnpm run build && ./scripts/pnpm exec vitest run packages/cli/test/cli.test.ts -t "updates, merges|audits suggestions"`
  reported 2/2 failures because paper subcommands and suggestion-aware audit/decision
  commands were not dispatched.
- Mutation check: removing the `init` dispatch branch and running
  `./scripts/pnpm run build && ./scripts/pnpm exec vitest run packages/cli/test/cli.test.ts -t "runs the durable init"`
  produced the expected 1/1 workflow failure. Restoring the branch returned the
  workflow to green.
- GREEN: focused core paper/metadata tests passed 19/19, and focused compiled CLI
  paper/decision tests passed 2/2.
- FINAL GREEN: `./scripts/pnpm check` completed build and strict typecheck, then
  passed **338/338 tests in 13 files**. This command ran outside the filesystem
  sandbox because compiled CLI subprocess creation is otherwise denied with EPERM.

## Files changed in this task

- `packages/core/src/ledger.ts`
- `packages/core/src/metadata.ts`
- `packages/core/src/project.ts`
- `packages/core/src/bibliography.ts`
- `packages/core/src/index.ts`
- `packages/core/test/ledger.test.ts`
- `packages/core/test/metadata.test.ts`
- `packages/core/test/project-bibliography.test.ts`
- `packages/cli/src/main.ts`
- `packages/cli/test/cli.test.ts`
- `packages/core/package.json` and `pnpm-lock.yaml` (runtime `ignore` and
  `fast-xml-parser` dependencies, installed by the coordinator while pnpm was idle)
- `docs/reviews/m1-implementation.md`

## Self-review and limits

The final review checked the M1 task requirement by requirement, searched changed
source/tests for TODO or stale M0-only messaging, and ran the full verification gate.
No detector or registry source was edited by this implementer.

Optional paper fields can be replaced through the CLI but are not cleared through a
dedicated flag. Stale locks require explicit human investigation by design; CiteTrace
never guesses that a lock is abandoned. Provider tests exercise real `Response`
parsing with injected network/time boundaries rather than making live external calls,
so they are deterministic and do not depend on provider availability.

## M1 review fix wave — 2026-09-07

The three important findings and the moderate CLI finding in
`docs/reviews/m1-review.md` were addressed in one bounded follow-up.

- Persisted schema validation now rejects unknown keys at the ledger, paper,
  link, decision, anchor, and nested anchor-symbol boundaries. The same strict
  checks run before writes, so an unexpected `source` field is reported as
  corrupt input instead of being retained or silently stripped.
- arXiv reservations are stored in the validated `.citetrace/cache` directory
  and updated under an exclusive cooperative lock. Separate Node processes
  sharing that project cache therefore reserve request starts at least three
  seconds apart, including retries. Lock acquisition is bounded; CiteTrace
  never deletes a pre-existing lock and names it for manual recovery after the
  user verifies that no lookup is active.
- Bibliography export now holds an exclusive cooperative output lock across the
  ownership check and commit. Existing output is compared byte-for-byte with
  the checked content immediately before replacement. An output that was absent
  at the check is committed with an atomic no-clobber hard link, so a concurrent
  creator wins without being overwritten. `--force` bypasses only the ownership
  decision and retains the concurrency checks.
- Human-readable audit output includes ignored decisions. Help now identifies
  both `add` and `paper refresh` as explicit metadata-network entry points.

### Review-fix TDD evidence

- RED: the focused core command reported **5 failures and 22 passes**: one
  strict-schema case, one two-process arXiv reservation case, and three
  bibliography lock/race cases. The two race tests observed another writer
  replace an initially absent and a generated target after the export check.
- RED: the compiled CLI decision workflow omitted `Ignored: 1`, and the isolated
  help assertion still described metadata lookup as add-only.
- GREEN: `./scripts/pnpm exec vitest run packages/core/test/ledger.test.ts packages/core/test/metadata.test.ts packages/core/test/project-bibliography.test.ts`
  passed **27/27** tests.
- GREEN: `./scripts/pnpm exec vitest run packages/cli/test/cli.test.ts` passed
  **15/15** tests after rebuilding the CLI.
- GREEN: `./scripts/pnpm --filter @citetrace/core typecheck` passed.

The cross-process throttle guarantee is scoped to processes using the same
canonical project cache; different projects do not share a machine-wide
reservation service. The cooperative output lock serializes CiteTrace exporters.
For an existing file, portable Node filesystem APIs do not provide a true
compare-and-swap replacement: a noncooperating arbitrary writer can still change
the file between the final byte comparison and `rename`. The implementation
reduces that interval and detects changes before it, but does not claim to prove
the absence of that final TOCTOU window. The initially absent-target commit does
have atomic no-clobber behavior through `link`.
