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
| Documents | pdf (view + annotate/merge/save), docx/doc, ppt/pptx, hwp/hwpx, psd, md/markdown |
| Data / source | safetensors, json, yaml/yml, toml, proto, mmd/mermaid, puml/plantuml/iuml |
| GIS | shp (Shapefile) |

## Features carried over from the vscode extension

- **Audio player** with waveform/spectrogram (WASM-accelerated analysis for large files), regions, and region export.
- **Image viewer/editor** with filters and annotation tools; filtered images can be saved into the vault.
- **PDF editor**: text, stamps, signatures, page reorder, merge with another PDF, save / save-as.
- **CSV editor**: cell editing writes back to the file.
- **Content-signature rerouting**: files whose content doesn't match their extension are opened with the right viewer automatically.
- **Share**: upload a copy of the selected file to Omni Viewer's external share service (max 10 MB, 5-minute expiry) and copy the share link; open a shared link to download it into the `omni-viewer-shared` vault folder. See the [Privacy Policy](https://omni-viewer-web.web.app/privacy/) for details.
- Refresh command to re-render the active viewer.

## How viewers are activated

Obsidian core already handles some extensions (md, pdf, images, audio, video, …). For those, this plugin cannot take over the default view; use the file context menu → **Open with … Viewer** instead. All other extensions (csv, zip, parquet, dbc, hwp, xlsx, …) open with Omni Viewer by default.

Commands (Cmd/Ctrl-P):

- `Omni Viewer: Refresh viewer`
- `Omni Viewer: Share current file`
- `Omni Viewer: Open shared link`

## Installation (manual / development)

```bash
npm install
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

- ZIP/JAR/APK, audio/image/browser-native video, CSV, PDF, Safetensors, JSON/JSONL, YAML, TOML, DBC
- Markdown, Mermaid, PlantUML, Protocol Buffer schemas
- XLS/XLSX, DOCX, HWP/HWPX, PPT/PPTX

Files created by Save As, PDF merge selection, and archive extraction stay inside the current vault. Desktop-only native helpers are intentionally unavailable on mobile: RAR/7z/DMG/system-tar extraction, ffmpeg transcoding, LibreOffice PDF fallback, and legacy DOC rendering. Browser codec support can differ between Android and iOS.

## Architecture notes

Each viewer is a `FileView` hosting a sandboxed `iframe` that renders the same self-contained HTML templates as the vscode extension. A small bridge shim emulates `acquireVsCodeApi()` inside the iframe, so template code runs unmodified; messages (`saveChanges`, `savePdf`, `loadMoreParquet`, …) are handled with Obsidian/vault APIs. vscode `--vscode-*` CSS variables are mapped to the active Obsidian theme at render time.

## License

MIT
