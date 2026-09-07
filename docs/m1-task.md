# Task: M1 durable core and CLI

Read plan.md, docs/implementation-m1-m5.md and existing core/CLI. Implement M1
completely, with TDD and recorded red/green commands in docs/reviews/m1-implementation.md.
Own new ledger.ts, metadata.ts, bibliography.ts, project.ts and their tests;
CLI files/tests; exports in core/index.ts. Do not edit detector.ts/registry.ts
or their tests (coordinator owns those). No commits: .git is environment-managed
and not a repository. Do not spawn reviewers. Use installed ./scripts/pnpm.

Requirements:
- Ledger schemaVersion=1, papers/links/decisions arrays. Paper stable id,
  citationKey, title, authors (string[]), year?, doi?, arxiv?, url?, metadataSource
  ('manual'|'doi'|'arxiv'|'registry'). Link id,paperId,anchor,relation,conceptId?,
  actor,createdAt,note?,referenceUrl?. Four plan relations; human confirmed only.
  Decision id,kind ('ignore'|'exempt'|'reject-paper'),conceptId,anchor,
  fingerprint,createdAt,reason?,paperId? (candidate identifier for rejection).
- Expose types plus ergonomic readLedger(root): {ledger,revision:string|null},
  writeLedger(root,ledger,expectedRevision): Promise<string>, emptyLedger(),
  addPaper(ledger,input): Paper, addLink(ledger,input): ResearchLink, removeLink.
  Operations may mutate an in-memory ledger but writes explicit. Runtime validate
  every read/write incl anchor/path shape and referential integrity; never erase
  corrupt data. Missing is explicit to callers; init only creates when missing.
  Exclusive file creation lock + revision check inside lock + temp/fsync/rename.
  Never automatically steal stale locks. Clean up own lock/temp on failure.
- Normalize DOI/arxiv exact IDs incl versions; dedup by exact identifier, never
  title. Stable unique BibTeX keys. Manual incomplete metadata allowed title
  required. Existing identifier conflicts fail instead of losing user data.
- Explicit metadata lookup only, DOI content negotiation CSL JSON at doi.org;
  arxiv API Atom. Finite timeout/retries incl 429 + bounded Retry-After,
  provider throttle (arxiv at least3sec), cache under .citetrace/cache,
  offline can use cache else actionable manual fallback. Inject fetch/time for
  deterministic external-boundary tests. Verify docs: Crossref content
  negotiation and info.arxiv.org/help/api/user-manual.html. No source sent.
  Dependencies allowed via pnpm if justified (XML parser and gitignore library).
- readProject(root,{...}?) saved .py/.ipynb recursive, ignores .gitignore incl
  nested patterns and standard dependency/build dirs; no following symlinks
  outside workspace; per-artifact read errors reported. Expose readArtifact.
- BibTeX generated deterministically only papers with confirmed links; escape
  special characters; stable keys. Export tracked generated header and default
  references.citetrace.bib; refuse user-owned overwrite unless explicit --force.
  Prevent traversal or symlink escape. Atomic output.
- CLI retain inspect behavior. Add init, add (<DOI/arxiv> or --title --author
  repeat --year --doi/--arxiv optional, --offline), papers, link paperId path
  [--symbol qualifiedName] [--cell ID or one-based index] --relation ...
  [--concept conceptId] [--note ...], unlink linkId, audit [--json], export
  [--output ...] [--force], sync (only unambiguous unchanged locations), relink.
  Every command structured --json if sensible. Audit counts per link status and
  diagnostics, no aggregate citation coverage and no ledger writes. Missing
  init emits clear error; no network except add/refresh explicit operations.
  Support explicit refresh and manual paper update/remove/merge if feasible;
  required paper CRUD must not orphan links; fail/remove explicitly.
- Cell-level manual link works even parser reports magic; duplicate scope rejects
  clean symbol link. Tests copy project, reorder cells, moved symbol, corrupted
  ledger, simultaneous writers, key collision, offline lookup/cache, escaping,
  user export protection and real compiled CLI workflow. Preserve M0 tests.

Communicate API changes to coordinator early, then continue. Full CLI tests need
./scripts/pnpm check escalated (known subprocess stdout/EPERM sandbox restriction).
Finish with report, modified files, commands/results, limitations. Do not assert
M2–M5 completion, publish, or contact other people.
