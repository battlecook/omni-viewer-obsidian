# Omni Viewer for Obsidian

Obsidian port of the [vscode-omni-viewer](https://github.com/battlecook/vscode-omni-viewer) extension. View (and in some cases edit) a wide range of file formats directly inside Obsidian.

## Supported formats

| Category | Extensions |
| --- | --- |
| Archive | zip, rar, 7z, dmg, jar, apk, tar, tgz, gz, tbz2, bz2, txz, xz |
| Audio | mp3, wav, pcm, aiff, aif, aifc, amr, awb, ogg, flac, ac3, aac, m4a |
| Video | mp4, mts, m2ts, avi, mov, wmv, flv, webm, mkv |
| Image | jpg, jpeg, png, gif, bmp, webp, svg |
| Tabular | csv, tsv, xlsx, xls, parquet, jsonl/ndjson/jsonlines |
| Automotive / measurement | dbc, arxml, a2l, asc, blf, mf4, avro, bag (ROS), db3 (SQLite), reqif, pcap, pcapng, stp/step, h5/hdf5/he5, mat |
| Web / network | har (HTTP Archive) |
| Jupyter Notebook | ipynb (nbformat v4) |
| Documents | pdf (view + annotate/merge/save), docx/doc, ppt/pptx, hwp/hwpx, psd, md/markdown, tex/latex/ltx |
| Data / source | safetensors, gguf, onnx, tflite/lite, keras (and Keras HDF5 models saved as h5/hdf5), mlmodel/mlpackage (Core ML), pte (ExecuTorch), json, yaml/yml, toml, proto, mmd/mermaid, puml/plantuml/iuml |
| GIS | shp (Shapefile) |

## Features carried over from the vscode extension

- **Audio player** with waveform/spectrogram (WASM-accelerated analysis for large files), regions, and region export.
- **Image viewer/editor** with filters and annotation tools; filtered images can be saved into the vault.
- **PDF editor**: text, stamps, signatures, page reorder, merge with another PDF, save / save-as.
- **CSV editor**: cell editing writes back to the file.
- **HAR failure analysis**: filter and sort requests by method, status, resource type, domain, URL, headers, and optional body content; inspect request/response details and page metadata alongside summary metrics and a timing waterfall.
- **Jupyter Notebook preview**: Markdown and KaTeX math, highlighted code cells, execution counts, saved text/HTML/image/JSON outputs and error tracebacks, attachments and relative vault images, cell search, and source/output visibility controls. Read-only: code and interactive widgets are never executed.
- **LaTeX structure and math preview**: outline, source editing, tables, theorem blocks, KaTeX formulas, and vault-backed `\\input`/`\\include` resolution. It is a partial preview, not a TeX compiler or typeset PDF.
- **ML model inspection**: ONNX, TFLite/LiteRT, and Core ML graph topology with searchable operator/tensor/IO tables and node inspection; ExecuTorch program instruction graphs with delegate, value, and segment inspection; Keras layer tables, per-layer configuration, and parameter counts; GGUF metadata, tensor index, and quantization summary read without touching the tensor payload.
- **Content-signature rerouting**: files whose content doesn't match their extension are opened with the right viewer automatically.
- **Share**: upload a copy of the selected file to Omni Viewer's external share service (max 10 MB, 5-minute expiry) and copy the share link; open a shared link to download it into the `omni-viewer-shared` vault folder. See the [Privacy Policy](https://omni-viewer-web.web.app/privacy/) for details.
- Refresh command to re-render the active viewer.

## How viewers are activated

Obsidian core already handles some extensions (md, pdf, images, audio, video, …). For those, this plugin cannot take over the default view; use the file context menu → **Open with … Viewer** instead. All other extensions (csv, ipynb, zip, parquet, dbc, hwp, xlsx, …) open with Omni Viewer by default.

Commands (Cmd/Ctrl-P):

- `Omni Viewer: Refresh viewer`
- `Omni Viewer: Share current file`
- `Omni Viewer: Open shared link`

## Installation (manual / development)

```bash
npm install
npm test
npm run build
```

Then copy the following into `<vault>/.obsidian/plugins/omni-viewer/`:

- `main.js`
- `manifest.json`
- `styles.css`

The viewer templates, bundled JavaScript, and WASM assets are embedded into `main.js` during `npm run build`, so no extra asset folders are required.

Enable **Omni Viewer** in Settings → Community plugins. The same bundle runs on desktop, Android, and iOS.

### Mobile support

On Obsidian mobile, Omni Viewer uses vault APIs instead of local filesystem paths. Mobile currently supports:

- ZIP/JAR/APK, audio/image/browser-native video, CSV, PDF, HAR, Safetensors, ONNX, TFLite/LiteRT, Keras, Core ML, ExecuTorch, JSON/JSONL, YAML, TOML, DBC
- Jupyter Notebook, Markdown, LaTeX, Mermaid, PlantUML, Protocol Buffer schemas
- XLS/XLSX, DOCX, HWP/HWPX, PPT/PPTX

Keras models open as `.keras` archives on mobile. Legacy Keras HDF5 models (`.h5`) rely on content-signature rerouting, which is a desktop-only path. Keras models are read into memory in full, so the 512 MB limit applies on both platforms; a legacy Keras HDF5 model above it stays with the HDF5 viewer, which reads metadata through the filesystem and opens at any size.

A `.mlpackage` is a directory bundle, so Obsidian only opens one that has been archived into a single file; a bare `.mlmodel` opens directly. Core ML models are read into memory in full on both platforms, so the 512 MB limit applies to each encoding.

ExecuTorch programs (`.pte`) are read into memory in full on both platforms, so the 512 MB limit applies; segment payloads (constants, delegate blobs) are located but never decoded. Separate `.ptd` data files are not opened.

HAR files are read into memory in full on both platforms and are limited to 256 MB. For large captures, the viewer retains up to 20,000 requests and bounded request/response body previews; the core viewer reports when content was truncated.

Jupyter Notebooks (`.ipynb`) use nbformat v4 and are limited to 64 MB on both platforms. The core bounds previews to 2,000 cells, 10,000 saved outputs, 4 MB per preview, and 16 MB total preview content, with warnings when content is truncated. HTML/SVG outputs are sanitized, remote images are blocked, and relative images resolve inside the notebook's vault folder. On desktop, a v4 notebook saved as JSON also opens in the Notebook viewer when its `nbformat` and `cells` keys are present in the 64 KB detection window.

GGUF is desktop-first: models are inspected through filesystem range reads, so on mobile only files below 512 MB open (they have to be read into memory in full).

Files created by Save As, PDF merge selection, and archive extraction stay inside the current vault. Desktop-only native helpers are intentionally unavailable on mobile: RAR/7z/DMG/system-tar extraction, ffmpeg transcoding, LibreOffice PDF fallback, and legacy DOC rendering. Browser codec support can differ between Android and iOS.

## Architecture notes

Each viewer is an Obsidian `FileView`. Core-backed viewers, including Jupyter Notebook, mount `omni-viewer-core` directly into the view and receive vault, navigation, and other host services from a small adapter. Notebook and KaTeX styles are scoped and bundled into `styles.css`. Legacy viewers host the vscode extension's self-contained HTML templates in an `iframe`; a bridge emulates `acquireVsCodeApi()` and handles messages with Obsidian/vault APIs. Both paths map theme variables to the active Obsidian theme.

## License

MIT
