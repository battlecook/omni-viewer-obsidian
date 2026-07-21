// CSV viewer — Obsidian adapter over omni-viewer-core (Phase 1 pilot).
//
// Unlike the legacy template viewers (which render an HTML document into a
// sandboxed iframe via host.setHtml), this mounts the core DOM viewer
// directly into the view content. Style isolation comes from the core's
// shadow-root mount; theme mapping (--omni-* <- Obsidian variables) lives in
// styles.css and pierces the shadow boundary as custom properties.

import * as fs from 'fs';
import * as path from 'path';
import { mountCsvViewer } from 'omni-viewer-core/viewers/csv';
import type { CsvViewerContext } from 'omni-viewer-core/viewers/csv';
import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import { Platform } from 'obsidian';
import { showSaveDialog } from '../platform';
import { saveBinaryBesideFile } from '../utils/vaultFiles';
import { applyMobileCoreStyles } from '../utils/mobileUi';
import { RenderContext, ViewerDefinition } from '../viewerCore';

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

function coreHostContext(renderCtx: RenderContext): CsvViewerContext {
    const { app, file, filePath, host } = renderCtx;
    const ctx: CsvViewerContext = {
        assets: {
            // CSV needs no bundled assets; wasm/worker viewers will route
            // through getBundledBinaryAsset -> blob URLs here.
            resolveAssetUrl: async (assetPath: string) => assetPath
        },
        i18n: {
            // Obsidian has no platform i18n mechanism for plugins; the core
            // catalog is the single source of message text.
            t: (key, args) => resolveCatalogMessage(key, args)
        },
        logger: {
            log: (level, message) => {
                const prefix = '[omni-viewer csv]';
                if (level === 'error') console.error(prefix, message);
                else if (level === 'warn') console.warn(prefix, message);
                else console.info(prefix, message);
            }
        }
    };
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
        ctx.clipboard = {
            writeText: (text: string) => navigator.clipboard.writeText(text)
        };
    }
    // Export a new file via the platform save dialog, matching the PDF viewer
    // and the rest of the plugin (mediaMessageHandlers / legacy pdfMessageHandlers).
    ctx.save = {
        saveFile: async (name, data) => {
            if (Platform.isMobileApp) {
                await saveBinaryBesideFile(app, file, name, data);
                return;
            }
            const targetPath = await showSaveDialog(
                path.join(path.dirname(filePath), name),
                [{ name: 'Delimited text', extensions: ['csv', 'tsv', 'txt'] }]
            );
            if (!targetPath) return;
            await fs.promises.writeFile(targetPath, data);
        }
    };
    // Edit-mode writeback: bound to the open file only (no path parameter).
    ctx.writeback = {
        write: async (data) => {
            host.markInternalWrite?.();
            await app.vault.modifyBinary(file, toArrayBuffer(data));
        }
    };
    return ctx;
}

export const csvViewer: ViewerDefinition = {
    viewType: 'omni-viewer.csvViewer',
    displayName: 'CSV Viewer',
    extensions: ['csv', 'tsv'],
    icon: 'table',
    errorContent: {
        title: 'Failed to load CSV file',
        message: 'Unable to load the CSV file due to an error:',
        icon: '📊'
    },
    async render(ctx) {
        if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
            throw new Error('Host does not support direct DOM mounting');
        }
        const buffer = await ctx.app.vault.readBinary(ctx.file);
        const container = ctx.host.provideDomContainer();
        const handle = await mountCsvViewer(
            { fileName: ctx.fileName, data: new Uint8Array(buffer) },
            container,
            coreHostContext(ctx)
        );
        applyMobileCoreStyles(container);
        ctx.host.setCoreViewerHandle(handle);
    }
};
