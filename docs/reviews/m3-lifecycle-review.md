# M3 suggestion lifecycle and audit review

Reviewed 2026-09-07. Scope was limited to
`packages/core/src/suggestions.ts`, `packages/core/src/audit.ts`, their focused
tests, and the anchor/ledger/project contracts those two modules call. The
review used `plan.md` and `docs/reviews/m3-lifecycle-implementation.md` as the
requirements and implementation record. Concurrent M1 and M2 work was excluded.
No production files were changed.

## Findings

No actionable lifecycle or audit defects were found in the reviewed scope.

## Evidence

- Classification is read-only. `auditSuggestions` validates but does not mutate
  the ledger, while `auditProject` reads the ledger and source snapshots without
  calling a writer or metadata provider.
- A stored paper alone does not suppress a suggestion. Coverage requires a
  human link for the same concept whose anchor resolves uniquely and without a
  meaningful fingerprint change.
- File/cell scopes and class descendants are contained conservatively. Cell
  identity remains separate across notebook cells, and class coverage requires
  a qualified-name descendant plus the same concept.
- Ignore and exemption decisions are tied to their structural fingerprint.
  Formatting/comment moves and unique relocation retain the decision, while a
  meaningful edit reopens the suggestion. Exemptions require a nonblank reason
  and can be explicitly removed.
- Rejecting a paper filters only that candidate and leaves the concept
  unresolved; accepting a registry candidate creates an `actor: human` link,
  reuses an exact existing arXiv paper, and performs mutations on a validated
  copy before replacing the ledger arrays.
- Project audit preserves corrupt-ledger failures, reports parse/read
  diagnostics, applies dirty snapshots only to saved nonignored artifacts, and
  keeps confirmed human-link counts separate from missing, ambiguous and
  needs-review location counts.

## Verification

`./scripts/pnpm exec vitest run packages/core/test/audit.test.ts packages/core/test/suggestions.test.ts packages/core/test/detector.test.ts`
passed all **245/245** tests (11 lifecycle/audit and 234 detector tests).

A workspace-wide TypeScript check was also attempted. It currently fails because
concurrent M1 tests import `removePaper`, `mergePapers`, `updatePaper`, and
`refreshPaper` before those unfinished exports exist. Those errors do not touch
the reviewed lifecycle/audit modules and are not treated as findings here.

## Verdict

**Approved for the bounded M3 lifecycle/audit scope.** This verdict does not
approve unfinished M1/M2 integration or establish the detector's held-out
precision/recall quality gate.
