# Contributing to CiteTrace

Read [plan.md](plan.md) and [the progress log](docs/progress.md) before choosing a
task. The current local alpha includes the ledger, CLI, VS Code adapter and ten
limited detectors. Held-out evaluation, public release and the human pilot remain
separate gates; development fixture counts must not be presented as field accuracy.

Use Node.js 24 LTS and pnpm 10.34.5, run `pnpm install --frozen-lockfile`, then
`pnpm check`. Local workspace users can substitute `./scripts/pnpm` for `pnpm`.

Write behavioral regression tests for parsing and anchor changes. Include
ambiguous and malformed cases; an anchor must never choose arbitrarily between
equally plausible targets. Tests use real Tree-sitter WASM and compiled CLI
processes. Keep the core independent from VS Code and never execute input code.

Preserve notebook bytes and keep all citation metadata external. Do not introduce
network calls into background analysis. Detector contributions must include paper
identifiers, explainable signals and hard-negative examples. Follow the
[detector guide](docs/detector-contributing.md). Confirming a link records a human
declaration; it does not prove the code's scientific origin.

Persistence changes need corruption, competing-write and restart coverage. Editor
changes must preserve native notebooks, respect workspace trust and discard stale
analysis. Test saved-file parity with the CLI and unsaved-buffer behavior separately.
Run `pnpm exec node scripts/package-release.mjs --smoke` after distribution changes;
it builds the VSIX and installs the actual CLI tarball offline into a fresh prefix.
Build staging directories are generated and replaced on each bundle build.

CI defines checks on Linux, macOS and Windows with Node 22/24, plus Linux artifact
packaging. A configured workflow is not evidence that hosted CI has passed. Record
the OS, Node/VS Code versions, commands and limitations with verification results.

For bug reports, include a minimal synthetic `.py` or `.ipynb`, the command,
expected behavior and observed output. Do not include private research code or
credentials. Use small PRs with a clear purpose and the checks you ran.
