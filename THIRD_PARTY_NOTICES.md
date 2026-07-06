# Third-party notices

This plugin redistributes the following third-party components. Each component
remains under its own license; license texts are kept alongside the vendored
files where noted.

## Vendored runtime assets (`templates/`)

| Component | License | Location |
| --- | --- | --- |
| pdf.js (pdfjs-dist) | Apache-2.0 | `templates/vendor/pdfjs/` (LICENSE included) |
| ag-psd | MIT | `templates/psd/vendor/` (LICENSE included) |
| rhwp (@rhwp/core) | see bundled LICENSE | `templates/hwp/vendor/rhwp/` |
| docx-preview | Apache-2.0 | `templates/word/vendor/` (LICENSE included) |
| JSZip | MIT / GPLv3 dual (used under MIT) | `templates/word/vendor/` (LICENSE included) |
| wavesurfer.js and other bundled libraries | see notice files | `templates/*/js/*.LICENSE.txt` |

## WASM audio engine sources (`wasm/lib/`)

| Component | License | Notes |
| --- | --- | --- |
| KISS FFT | BSD-3-Clause | Copyright (c) 2003-2010 Mark Borgerding; notices retained in source headers |
| dr_mp3, dr_wav, dr_flac (dr_libs) | Public domain / MIT-0 (dual) | License statements at the end of each header |
| stb_vorbis | Public domain / MIT (dual) | License statement in the source file |

## npm dependencies

Runtime npm dependencies (bundled into `main.js`) are listed in `package.json`
and retain their respective licenses (all MIT/Apache-2.0/BSD-compatible).
