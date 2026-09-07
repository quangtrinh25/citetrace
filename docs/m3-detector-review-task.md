# Review M3 isolated detector

Review `packages/core/src/detector.ts`, `registry.ts`, the one-line export of
pythonLanguage in python.ts, and test/detector.test.ts against plan.md detector
requirements. Existing M0 parsing/anchors assumed baseline reviewed. M1 agent is
simultaneously adding unrelated core/CLI files; ignore unfinished M1.

Check lexical scoping/shadowing/conditional imports/AST evidence/grouping/anchors,
paper candidate metadata and no false precision claims. Run targeted tests or
small adversarial repros as useful; no edits to production. Record findings with
severity, concrete source/line and runnable repro in docs/reviews/m3-detector-review.md.
No git repository available; inspect listed files directly. No agents spawned.
Send concise findings and verdict. Current228 synthetic tests pass; do not treat
this as independent held-out research repository evaluation.
