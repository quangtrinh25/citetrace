# M1–M5 implementation record

Binding product requirements: [plan.md](../plan.md). Execution authorized by the
user on 2026-09-06 through M5 when quality permits. Work in the shared directory:
the environment-managed `.git` is not a usable repository, so reviews inspect
files and recorded task reports; no fictitious commits or clean-checkout claims.

## Work sequence and contracts

1. **M1, durable provenance.** Versioned runtime-validated ledger, atomic writes
   with revision checks and an exclusive lock; explicit corruption/conflict errors.
   Manual and DOI/arXiv paper inputs, stable keys and identifier deduplication,
   confirmed links, relocation audit, sync/relink, safe BibTeX export. CLI and
   core use the same operations. Test real filesystem and compiled CLI including
   copy/restart, malformed data, competing writes, offline/provider failures.
2. **M2, editor adapter.** VS Code commands/tree/hover/info diagnostics; Python
   files and native notebook cells; unsaved source analysis, debounce and discard
   stale work, background worker; add/link/export and repair without JSON edits.
   Core stays independent of VS Code. Test adapter boundary behavior and attempt
   a real extension-host smoke test with recorded environment limitations.
3. **M3, limited suggestions.** Ten registry concepts and paper candidates;
   Tree-sitter definitions and resolved imported calls only. Conservative import
   shadowing, grouping by concept+anchor, explicit evidence. Decisions distinguish
   confirm/reject-paper/exempt/ignore and use fingerprints. Scope coverage only
   for the same concept. Test >=200 labeled controlled cases with disjoint
   implementation families; report synthetic evaluation separately from real
   held-out repository evaluation. Never call these calibrated probabilities.
4. **M4, reviewable alpha distribution.** Bundle WASM and dependencies into CLI
   tarball and VSIX; run artifacts in a fresh directory, CI artifact workflow,
   English README, Vietnamese quickstart, changelog, contribution/issue templates,
   demo project and release notes. Inspect available GitHub target only after
   artifacts are reviewable. Public release requires a real target and successful
   publication; a locally built artifact is not a public release.
5. **M5, stabilization and pilot readiness.** Independent review, regressions,
   measured performance, installation checks and a reproducible pilot protocol.
   A stable tag requires real 5–10 participant / 2–4 week evidence from plan.md;
   human results cannot be manufactured or replaced with unit tests.

## Parallel work boundaries

The M1 implementer owns ledger/metadata/bibliography/project reader/CLI and tests.
The coordinator owns detector.ts, registry.ts and their tests while M1 runs.
No overlapping source edits. Detector exports initially live in their own module;
coordinator integrates exports and audit coverage after M1 contract is available.
One implementation subagent at a time; separate review runs at task boundaries.

## Status

| Work | Implementation | Verification / release gate |
| --- | --- | --- |
| M0 | complete | baseline passed 56 tests on 2026-09-06 |
| M1 | implemented | persistence/CLI regressions and scoped re-review pass |
| M2 | implemented | review fixes accepted; rebuilt installed-VSIX host passed |
| M3 | ten detectors and decision lifecycle implemented | 245 controlled detector tests; real held-out quality gate pending |
| M4 | local CLI/VSIX, documentation and artifact CI implemented | fresh CLI/VSIX installs passed; public GitHub source and v0.1.0-alpha.1 published |
| M5 | local stabilization verified; pilot protocol ready | real human pilot and stable acceptance pending |

Resume2026-09-07: prior agents were interrupted by account usage limit. Existing
files retained; resumed M1 implementer and detector reviewer. Fresh whole-workspace
build/typecheck/test passed295 tests before additional suggestion lifecycle work.
Suggestion lifecycle:7 new tests observed failing on stubs, then7 passing with
real core (accept/reject/exempt/ignore/reopen, concept scope, copy/move, edits).

Resume06:50: agents interrupted again by usage quota; partial M1 retained. Fresh
check found five compiled CLI failures (init dispatcher missing), handed to the
resumed M1 implementer. Coordinator fixed all five detector review findings with
seven observed failing cases ->234 passing detector tests. Definition-name Adam
coverage narrowed to exact class `Adam` or explicit `adam_optimizer`; bare methods
named `adam` no longer count. Added required per-rule confusion fixtures. Scoped
independent re-review dispatched. Coordinator owns M2 implementation in this phase.
