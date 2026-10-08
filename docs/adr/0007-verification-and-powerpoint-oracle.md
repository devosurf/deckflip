# Conversions verify themselves; PowerPoint fidelity rests on a byte-bound oracle, not on LibreOffice

Every conversion compares what its source shows with what its output contains (Verification: Visible text, speaker notes, element geometry, stacking) and reports a mismatch as a `VERIFY_*` error with exit 5, the output kept. The HTML side is Chromium's census of the rendered Slides, read by a walk of its own, so a measurement defect cannot hide what it lost; the PPTX side is the package read back by the parser. What converts faithfully but rarely reads as intended (overflowing, overlapping or illegible text, a line PowerPoint may break elsewhere) is a Layout flag measured in the same Chromium session. Together they replace looking at renders as the evidence an agent delivers on.

PowerPoint itself is checked per release instead of per Deck: `corpus:oracle` renders every corpus fixture in PowerPoint and records the digest of the package it rendered; CI compares Chromium with those renders and fails when a fixture emits another package. LibreOffice stays available as a renderer and as an opt-in local comparison, but is not a gate: it disagreed with PowerPoint more often than deckflip did (false alarms on letter-spaced translucent text and exact-spaced baselines in field use), at 805 MB.

## Consequences

- Any emitter change that alters a fixture's package needs a PowerPoint run on a Mac with PowerPoint before CI passes; the oracle machine's PowerPoint version is recorded with the renders.
- The digest leaves out media bytes and `docProps`: rasters are Chromium's own paint, already the other side of the image gate.
- A Verification error is never something an author should work around; the hint says to report it.
