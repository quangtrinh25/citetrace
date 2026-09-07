# M1 durable core and CLI review

Reviewed 2026-09-07 against `docs/m1-task.md`, `plan.md`, and
`docs/reviews/m1-implementation.md`. Scope was limited to the M1 ledger,
metadata, project reader, bibliography, CLI, and their tests. The previously
reviewed M0 parser/anchor baseline, the concurrent detector fix, and M2 work were
excluded. No production files were changed.

## Findings

### I1 — Important: runtime validation accepts and persists source text hidden in schema objects

`validateAnchor` at `packages/core/src/ledger.ts:86-102` validates required
fields but does not reject unknown properties. The paper, link, decision, and
top-level validators follow the same permissive pattern. Because `readLedger`
returns the parsed objects and `writeLedger` serializes them directly, an extra
property is retained indefinitely rather than rejected as corrupt provenance.

A targeted probe created an otherwise valid link with
`anchor.source = "SECRET = 1"`, passed it to `writeLedger`, and then read the
ledger bytes. The operation succeeded and printed `SOURCE_PERSISTED`. This
breaks the plan's explicit invariant that serialized anchor snapshots contain
no source, and it weakens the promised runtime validation boundary for manually
edited, migrated, or plugin-produced JSON.

Reject unknown keys for every persisted schema object, especially `CodeAnchor`
and its nested symbol, on both read and write. Silently stripping fields would
also be unsafe on read because the corrupt input should remain visible for the
user to repair.

### I2 — Important: the arXiv three-second throttle resets on every CLI invocation

`packages/core/src/metadata.ts:31` stores provider state in a module-level
`Map`, and `reserveProvider` at lines 122-125 consults only that in-memory map.
This spaces retries and concurrent lookups inside one Node process, which is all
the test at `packages/core/test/metadata.test.ts:52-64` demonstrates. The shipped
CLI is a one-command process, so two consecutive `citetrace add <arXiv>` or
`paper refresh` invocations each start with an empty map and may contact arXiv
without any spacing. Separate CLI and extension processes have the same gap.

The M1 requirement is provider throttling of at least three seconds, not merely
retry spacing. Coordinate the reservation across processes, for example with a
small timestamp plus exclusive lock in the validated cache directory, and add a
two-process boundary test. The state update must remain bounded and recoverable
without treating a stale lock as permission to delete it.

### I3 — Important: bibliography ownership can change after the check and still be overwritten

`exportBibliography` reads the target and checks the ownership header at
`packages/core/src/bibliography.ts:54-57`, then builds and writes a temporary
file before replacing the target with `rename` at line 61. There is no lock or
revision comparison around that interval. If another process or editor replaces
the previously generated target with a user-owned bibliography after the read,
the rename silently destroys the new user content even when `force` is false.
The temporary-file rename prevents partial output, but it does not prevent this
lost-update race.

Protect the check-and-replace operation with an exclusive output lock and verify
the exact checked revision immediately before replacement. A changed target
should fail and leave both versions recoverable; `--force` may explicitly bypass
only the ownership decision, not accidentally broaden the output path.

### M1 — Moderate: default CLI audit omits ignored decisions and help understates network commands

The audit object contains `counts.ignored`, but the default text output at
`packages/cli/src/main.ts:218-220` prints confirmed, unresolved, exempt,
needs-review, ambiguous, missing, and diagnostics without ignored. A user who
does not request JSON therefore cannot see one of the four specified suggestion
states. The help text at line 36 also says only `add` performs metadata lookup,
although `paper refresh` at lines 188-190 performs an explicit lookup too.

Print the ignored count in text audit output and describe both explicit network
entry points. Add CLI assertions for the human-readable path, since the existing
decision test checks only JSON counts.

## Passing evidence

- Ledger writes validate before acquiring the lock, acquire with exclusive
  creation, compare the expected revision while locked, fsync the temporary
  file, atomically rename it, fsync the directory on non-Windows systems, and
  remove only their own temporary/lock files. Corrupt ledger reads remain
  failures and competing revisions cannot overwrite committed data.
- Paper update and merge use cloned state before committing arrays; identifier
  conflicts and duplicate post-merge scopes fail without partial mutation.
  Paper removal refuses to orphan links unless the caller explicitly requests
  link removal.
- DOI/arXiv normalization, bounded response timeouts/retries, exact arXiv result
  checks, cache validation/symlink rejection, and offline fallback behavior have
  focused tests. No scan/audit path invokes a metadata provider.
- Project discovery is deterministic, uses root and nested `.gitignore` rules,
  excludes standard dependency/build directories, skips traversal symlinks, and
  reports per-artifact failures.
- BibTeX generation is deterministic, escapes special characters, includes only
  papers with human links, blocks traversal and symlink parents, and refuses a
  sequential user-owned overwrite unless `force` is explicit.
- The compiled CLI tests cover copy/restart, corruption preservation, notebook
  cell linking, ambiguous symbols, move/sync/relink, CRUD/merge, bibliography
  protection, and the suggestion-decision workflow.

The implementation report records a final `./scripts/pnpm check` result of
**338/338** tests in 13 files. Per the review brief, that known-passing suite was
not rerun. The only new execution was the isolated schema probe for I1; it used
a temporary directory, removed it afterward, and made no repository source
changes.

## Spec and quality verdict

**Changes requested.** The main M1 persistence design is careful and most of the
specified workflow is covered by meaningful filesystem and compiled-CLI tests.
However, I1 violates the no-source persisted-schema invariant, I2 leaves the
real one-shot CLI outside the advertised provider throttle, and I3 retains a
concurrent user-file data-loss window. These boundaries need focused regression
tests and fixes before M1 is implementation-complete. M1 also does not establish
the later detector quality, distribution, or pilot gates.
