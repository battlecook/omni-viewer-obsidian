# Changelog

## [0.2.0] - 2026-07-19

### Added
- Archive: inline preview for audio, video, and image entries. Previously only plain-text entries could be previewed and every other entry was reported as unsupported.
- Archive: save an individual entry to disk from the viewer.

### Changed
- Migrated the PowerPoint and archive viewers to the shared `omni-viewer-core` rendering engine, mounting the core viewer directly into the view instead of the iframe/template path (continuing the CSV/PDF migration from 0.1.2).
- Archive: listing, entry preview, and save all stream through a path-based decoder, so multi-GB archives are inspected and extracted without loading the archive into memory.
- PowerPoint: parsing and rendering now come from the core; the LibreOffice (`soffice`) PDF fallback for decks with no renderable slides is preserved, and its export is save-only so it can no longer overwrite the source `.ppt`/`.pptx` with PDF bytes.
- Loaded PDF.js through a static import shimmed at build time instead of a dynamic `import()` of a blob URL.
- Updated `omni-viewer-core` to 0.4.

### Removed
- Deleted the viewer code the core migrations replaced: the archive/CSV/PDF/PowerPoint templates, the vendored PPTX and legacy-PPT binary parsers, the eager archive reader, and the unused HWP document parser (HWP rendering goes through the bundled `rhwp` WebAssembly module). About 17k lines in total, shrinking `main.js`.

### Fixed
- Archive: `rar`/`7z`/`dmg`/`tar` archives no longer fail to open when Obsidian is launched outside a login shell (for example from the macOS Dock), where the inherited `PATH` omits Homebrew/MacPorts and the `7z`/`tar` binaries could not be found.
- Themed the toolbars of the office-family and archive viewers, which previously kept the core's hardcoded dark fallback colors instead of the Obsidian theme.

## [0.1.2] - 2026-07-18

### Changed
- Migrated the CSV and PDF viewers to the shared `omni-viewer-core` rendering engine, mounting the core viewer directly into the view instead of the iframe/template path.
- CSV: editing now preserves scroll position, sort order, and selection when you save; export uses the system save dialog, matching the PDF viewer and the rest of the plugin.
- PDF: adding annotations and saving no longer resets the current page, zoom, or scroll.
- Moved Share and Open shared link from in-view buttons to the viewer toolbar actions.
- Updated `xlsx` to the official SheetJS distribution (npm publishing stopped at 0.18.5).

## [0.1.1] - 2026-07-10

### Changed
- Removed `eval`/`new Function` usage to comply with Obsidian plugin guidelines: replaced the `setimmediate`/`lie` dependencies with safe shims and switched the HWP viewer to a readable `hwpViewerMain.js`, deleting the minified webpack bundle.
- Replaced `any` with explicit types/`unknown` plus runtime type guards across platform, audio engine, GIS, tabular, and message handling code.
- Used Obsidian's `setCssStyles()` instead of direct `el.style` assignment.
- Removed `!important` and dead VSCode-only CSS variables from viewer templates.
- Used Node's `module.builtinModules` instead of the `builtin-modules` package.
- Gzip-compressed bundled assets to reduce `main.js` size.
- Removed debug `console.log` statements while keeping error/warning handlers.
- Cleaned up the command name and manifest/package description.

### Docs
- Added a privacy policy link for the share feature.

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
