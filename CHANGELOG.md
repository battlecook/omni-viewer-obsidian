# Changelog

## [0.1.0] - 2026-07-09

### Added
- Initial Obsidian Community plugin release.
- Desktop-only viewer plugin for opening many non-markdown file formats directly inside Obsidian.
- Viewer support for archives, audio, video, images, CSV/TSV, Excel, Word, PowerPoint, PDF, HWP/HWPX, PSD, Parquet, Shapefile, HDF5, MAT, JSONL, YAML, TOML, Mermaid, PlantUML, and automotive/measurement formats.
- File context menu actions for opening supported files with Omni Viewer when Obsidian has a built-in default viewer.
- Commands for refreshing the active viewer, sharing the current file, and opening shared links.
- Embedded viewer templates and bundled assets so the release only needs `main.js`, `manifest.json`, and `styles.css`.
- MIT license and Obsidian plugin metadata.

### Notes
- This plugin is desktop-only because several viewers rely on desktop Obsidian and bundled browser/runtime capabilities.
