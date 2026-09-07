# Shared audit and suggestion lifecycle

2026-09-07. New `core/src/suggestions.ts`, `core/src/audit.ts`, focused tests.
Seven lifecycle and four audit tests failed on stubs then passed with real
Tree-sitter, ledger operations and filesystem fixtures. Commands:
`./scripts/pnpm exec vitest run packages/core/test/audit.test.ts packages/core/test/suggestions.test.ts`
passed11 tests. Scope includes concept-specific containment, human acceptance,
paper reuse, rejected candidates remaining unresolved, exemption/reopen and
fingerprint-scoped ignores across unique relocation. Audit has no writes/network,
dirty snapshots replace only scanned nonignored saved artifacts. Confirmed count
is human links, separate from missing/ambiguous/needs-review location counts.

Adapter snapshot groundwork:4 stub assertions failed, then all4 passed along
with20 existing notebook tests. Handles native metadata nesting, duplicate IDs
across markdown, explicit in-memory Python override and nonPython code cells.
Shared notebook reader now skips explicit per-cell nonPython vscode.languageId.
Snapshots create only analysis strings, never serialize back into source files.
