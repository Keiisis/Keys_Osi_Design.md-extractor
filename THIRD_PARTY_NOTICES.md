# Third-party notices — Keys_Osi

Keys_Osi ships or derives from the components below. Their licenses
require these notices to accompany the software.

## Extension foundation

Keys_Osi started from an MIT-licensed design-extraction extension and has
since been rewritten and extended. Its original notice:

```text
MIT License — Copyright (c) 2026 Bergside

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Fonts — `assets/fonts/`

Geist and Geist Mono (Vercel) and Instrument Serif (Instrument), SIL Open
Font License 1.1 — <https://openfontlicense.org>. Bundled locally so the
popup makes no network request for fonts.

## 3D detection and GLB → STL/3MF conversion

`lib/model-detect.mjs` and `lib/glb-convert.mjs` are derived from an
MIT-licensed browser 3D model extractor, rewritten and extended for
Keys_Osi (glTF with external buffers, strips/fans, mirrored transforms,
3MF texture relationships, Windows-safe names, false-positive fixes).

```text
MIT License — Copyright (c) 2026 3D Model Extractor

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Draco decoder — `lib/vendor/draco_wasm_wrapper.js`, `lib/vendor/draco_decoder.wasm`

Official Google Draco 1.5.7 decoder build (byte-identical to
`https://www.gstatic.com/draco/versioned/decoders/1.5.7/`).
Licensed under the Apache License, Version 2.0 —
<https://www.apache.org/licenses/LICENSE-2.0>. Copyright Google LLC.

## meshoptimizer decoder — `lib/vendor/meshopt_decoder.js`

Official meshoptimizer v0.20 JavaScript decoder (identical to the
upstream `js/meshopt_decoder.js`). MIT License, Copyright (C) 2016-2023
Arseny Kapoulkine.

## Test fixtures — `tests/fixtures/3d/`

`Box.glb`, `BoxDraco.gltf`, `Box.bin`, `BoxTextured.glb` from the Khronos
glTF Sample Assets (model "Box" / "BoxTextured" by Cesium), licensed
CC-BY 4.0 — <https://creativecommons.org/licenses/by/4.0/>. Used only by
the test suite; not loaded by the extension.

## Figma import, page → Figma capture, plugin — `lib/figma-import.mjs`, `figma-capture.js`, `figma-plugin/`

Written for Keys_Osi; logic adapted (not copied verbatim) from these
MIT-licensed projects, whose permission notice is the MIT text quoted above:

- Figma-Context-MCP — gradient angle and blur conversion, rate-limit headers.
- figitdesign/web-to-figma — MIT, Copyright (c) 2026 Figit — auto-layout
  inference from flexbox, linear gradient transforms, blur radius mapping.
- kevicebryan/open-htmltofigma — MIT, Copyright (c) 2026 Kevin Bryan —
  font index and closest-weight matching, image import fallback.
- figma/rest-api-spec and figma/variables-github-action-example — MIT,
  Copyright (c) Figma, Inc. — API types and variables-to-tokens walk.

## Page signals, region heuristics, platform exports — `deep-probe.js`, `lib/deep-signals.mjs`, `lib/platform-exports.mjs`

Ported and extended from an MIT-licensed design-extraction CLI:

```text
MIT License — Copyright (c) 2024 Manavarya Singh
```

(Same MIT permission notice as above.)

## Fonts downloaded at run time

The Brand Kit fetches font files from the Fontsource catalogue / CDN and,
as a fallback, Google Fonts, when the user asks for them. Those fonts are
not bundled; each keeps its own license (mostly SIL OFL 1.1), listed in the
generated BRAND.md.

## Figma file decoding without the API — `lib/figma-offline.mjs`, `lib/vendor/zstd-decode.mjs`

- `lib/vendor/zstd-decode.mjs`: pure-JS zstd decompressor, unmodified apart
  from its header comment (moved here). MIT License, Copyright (c) 2020
  Arjun Barrett. Source: npm `fzstd`.
- Binary schema decoding in `lib/figma-offline.mjs` is reimplemented after
  the kiwi format reference. MIT License, Copyright (c) 2016-2023 Evan Wallace.
- Test fixtures `tests/fixtures/figma-offline/*.fig` and the clipboard
  payload: MIT License, Copyright (c) 2026 OpenFig Contributors (test data,
  not shipped in the extension package).

(Same MIT permission notice as above.)

## Advanced reverse engineering — `native-host/`

The Keys_Osi native host runs the REA engine (`rea-agents`, MIT License)
through `npx` on the user's machine. REA is not bundled with the extension.
