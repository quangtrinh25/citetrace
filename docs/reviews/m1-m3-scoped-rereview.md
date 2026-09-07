# M1 and M3 scoped re-review

Re-reviewed 2026-09-07. Scope was limited to the three Important findings in
`docs/reviews/m1-review.md` and the I7 class-body binding finding in
`docs/reviews/m3-detector-final-rereview.md`. The latest appendices in
`docs/reviews/m1-implementation.md` and `docs/reviews/m3-detector-fixes.md`, the
corresponding core implementation, and focused tests were inspected. The M1
Moderate CLI finding, other detector behavior, M2, independent detector quality
evaluation, and release/pilot gates were excluded. No production source was
changed.

## Finding dispositions

### M1 I1 — Addressed: persisted schemas reject unknown fields

`exactKeys` in `packages/core/src/ledger.ts:73-77` rejects fields outside an
explicit allow-list. It is applied to the top-level ledger, papers, links,
decisions, anchors, and nested anchor symbols at lines 92-105 and 112-157.
`readLedger` validates parsed bytes before returning them, and `writeLedger`
validates before acquiring a lock or serializing anything. Therefore the
original `anchor.source = "SECRET = 1"` payload is rejected on both read/write
boundaries rather than persisted or silently stripped.

The regression at `packages/core/test/ledger.test.ts:32-56` exercises all six
object boundaries and verifies that failed writes leave the ledger absent. This
closes I1.

### M1 I2 — Addressed: arXiv reservations survive process boundaries

`reserveProvider` in `packages/core/src/metadata.ts:152-177` stores
`nextRequestAt` in the canonical project's validated `.citetrace/cache`
directory, serializes updates with an exclusive `wx` lock, never removes a lock
it did not acquire, and bounds lock acquisition. It advances the reservation
while holding the lock and sleeps only after releasing it, allowing other
processes to reserve later slots without collapsing request start times.
`fetchText` reserves a three-second slot before every arXiv attempt, including
retries (`packages/core/src/metadata.ts:179-196`).

The regression at `packages/core/test/metadata.test.ts:14-28` launches two
separate Node processes against the same project and observes at least 2.9
seconds between their actual fetch markers. Existing retry coverage verifies
the same three-second rule within one lookup. This closes the original one-shot
CLI/extension process gap. As documented by the implementation report, the
coordination scope is one canonical project cache rather than a machine-wide
provider service; that is a declared design boundary and was not a new issue in
this scoped re-review.

### M1 I3 — Addressed with a documented portability limit: bibliography races

`exportBibliography` in `packages/core/src/bibliography.ts:52-94` now holds an
exclusive cooperative lock across ownership inspection and commit. For an
existing target it compares the current bytes exactly with the inspected bytes
immediately before atomic rename and fails on any observed change. For a target
that was absent at inspection it uses a hard link as an atomic no-clobber commit,
so a concurrent creator wins and is preserved. `force` bypasses only the
ownership-header decision; it does not bypass locking or concurrency checks.

The focused tests at `packages/core/test/project-bibliography.test.ts:65-93`
verify that another exporter's lock is preserved and that concurrent content is
not overwritten for both initially absent and generated targets. This addresses
the original broad check/write interval and closes I3 for the requested
cooperative/revision-checked design.

There remains an unavoidable narrow interval between the final comparison and
`rename` in portable Node filesystem APIs. A non-cooperating writer that lands
in precisely that interval is not atomically compare-and-swapped. The
implementation report states this limit accurately and does not overclaim the
guarantee. It should remain visible in release documentation; eliminating it
would require a different replacement/backup policy or platform-specific
filesystem primitives.

### M3 I7 — Addressed: class execution and method lexical parents are separated

The detector now constructs both phases explicitly at
`packages/core/src/detector.ts:166-176`. Definition-time expressions use
`declarationEnv`. A class body is scanned with that pre-rebinding environment,
so an imported alias matching the class name remains visible while the body is
executed. A distinct `postBindingParent` is passed as the lexical parent for
nested function/method bodies, so later method execution does not incorrectly
reuse the import after the class name has been rebound. Function bodies retain
the post-rebinding behavior, and whole-class assignment collection remains
conservative.

The five assertions at `packages/core/test/detector.test.ts:131-148` cover the
exact class-body reproduction, class-base evaluation, recursive function
behavior, explicit class-body shadowing, and method execution. The reproduction
now yields one LoRA suggestion anchored to `Train`; all controls retain their
expected empty result. This closes I7.

## Fresh verification

- `./scripts/pnpm exec vitest run packages/core/test/ledger.test.ts packages/core/test/metadata.test.ts packages/core/test/project-bibliography.test.ts packages/core/test/detector.test.ts`
  passed **272/272 tests in 4 files**.
- `./scripts/pnpm --filter @citetrace/core typecheck` exited successfully.

## Verdict

**All four scoped Important findings are addressed.** The fixes match the
original failure modes, include focused regression coverage, and introduce no
new actionable issue within this bounded review. The bibliography's final
portable-filesystem race and the per-project scope of provider reservations are
documented limits rather than hidden guarantees. This verdict does not establish
the independent repository/family-disjoint detector evaluation or any M2,
distribution, hosted-CI, or pilot acceptance gate.
