# Measured font selection and Office identity are distinct

The invariant from #15 remains: the selected face used for measurement must be the face addressed by the PPTX. [#32](https://github.com/devosurf/deckflip/issues/32), under [#30](https://github.com/devosurf/deckflip/issues/30), supersedes the original decision to serialize one preferred family name with CSS-derived bold/italic.

A Resolved font separates CSS font aliases, the selected asset and member face, and Office font identity. The legacy family/subfamily (name IDs 1/2), checked against consistent style metadata, determine Office family/RIBBI. Preferred names remain matching aliases. Numeric CSS weights remain authored browser inputs, never Office style-linking rules. Missing, contradictory or unsupported identity fails explicitly; do not strip font tables or remap weights.

Generic families remain rejected when reached before a concrete match: Chromium resolves them to different faces across operating systems, so accepting them would make measurement and conversion machine-dependent. An unresolved concrete stack also fails validation; the base Arial default keeps unstyled text deterministic.

Host font discovery and the injected `body { font-family: Arial }` remain transitional behavior, not the final portability model. #30 calls for pinned Deck assets and permits a bundled default that respects authored inheritance; #32 does not implement embedding or override that dependency order.

[#34](https://github.com/devosurf/deckflip/issues/34) makes `@font-face` the pinned-asset path. deckflip answers every stylesheet and font request Chromium makes, drops `local()` sources and serves each `url()` as the decoded sfnt that identifies the asset, so the face Chromium measures is the selected face on any machine. A declared family matches only its rules. Downloads are frozen once in the Asset directory and never refreshed, trading freshness for repeatable measurement and offline conversion. Chromium's per-node platform-font record audits fallback; it names fonts, not files, so it is evidence, not identity. Installed-font discovery now serves only families no `@font-face` declares, pending the redistributable default (#35) and embedding (#36).

Structural Verification does not establish font fidelity or identical per-glyph fallback. Package inspection and supported-PowerPoint edit/save/reopen evidence are separate requirements; affected Oracle records require actual PowerPoint runs ([ADR 0007](0007-verification-and-powerpoint-oracle.md)).
