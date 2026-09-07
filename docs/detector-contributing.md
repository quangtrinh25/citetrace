# Contributing detector evidence

The initial registry supports RMSNorm, LayerNorm, BatchNorm, GroupNorm, Focal Loss,
Adam, AdamW, GELU, RoPE and LoRA. A suggestion offers a paper candidate for a human
to review. It does not prove origin or impose a requirement to cite.

Use parsed definitions or calls with a resolved import. Include the original
import, enclosing scopes and assignments in each test. Comments, strings, unused
imports, unrelated modules, shadowed identifiers and ambiguous names need negative
fixtures. Keep lexical uncertainties conservative. Do not add network lookup to
parsing or trigger network access while editing.

For a rule change, supply:

- A concept ID, rule version, explicit supported names/API paths and limitations.
- Primary paper metadata and source URL; preserve versions and explain relevance.
- Positive examples and confusion cases with independently assigned labels.
- Repository revision, source location and compatible license for public fixtures.
- Development fixtures separated from held-out repositories/implementation families.
- Precision, recall within supported evidence, and paper relevance as separate
  measurements; include counts and false positives, not an uncalibrated score.

Run `pnpm check`. Cover grouping, changed fingerprints and decision persistence
when a rule affects suggestion identity. Do not change a held-out label to make a
new rule pass without recording why the original label was incorrect and removing
that example from the untouched evaluation set.

Current controlled fixtures are development/regression tests. Passing them is
not evidence of90% precision on independently sampled research repositories.
