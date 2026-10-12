# Offline Figma import fixtures

Origin URLs and copyright notices for these files are in `THIRD_PARTY_NOTICES.md` at the repository root.

| File | What it is | License | SHA-256 |
|---|---|---|---|
| `basic-shapes.fig` | Real `.fig` saved from Figma: ZIP with stored `canvas.fig` (`fig-kiwi` v101, zstd data chunk), deflated `meta.json`, `thumbnail.png`. One frame, a rotated group, rectangle, line, arrow, ellipse, polygon, star, drop shadow. | MIT | `c7cd6d3a8b338b28ea41c9a101f5eb0eecf731c562111025f9aec5d4ad87b028` |
| `medium-complex.fig` | Real `.fig` saved from Figma (`fig-kiwi` v106): 3 pages ordered by position, text in two families, component instances, gradient fill, layout grids. | MIT | `5126634984cb7a441c8c12583f0cef916cf01dee8084c107a2d6abf75b54928e` |
| `clipboard-clip-test.html` | Clipboard `text/html` envelope (`(figmeta)` + `(figma)` spans) built by Keys_Osi around a real `canvas.fig` (SHA-256 `53fdad58062521430003f4e33e907fde2d9c6773c3c10a14696b209c46532bd3`) taken from a real `.fig` whose content was pasted from the Figma clipboard (its message carries `pasteFileKey` / `pasteID`). The envelope markup is synthetic; the binary payload is real. | MIT (payload) | — |

The auto-layout, component set, instance override, style and image-fill sample is not a file: `tests/figma-offline-tests.mjs` encodes it at run time with the real schema embedded in the clipboard payload, so only real format fields can be used.
