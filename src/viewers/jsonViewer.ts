// JSON viewer — Obsidian adapter over omni-viewer-core.
//
// Mounts the core DOM viewer directly into the view content (same pattern as
// the CSV viewer). Style isolation comes from the core's shadow-root mount;
// theme mapping (--omni-* <- Obsidian variables) lives in styles.css.

import * as fs from 'fs';
import * as path from 'path';
import { mountJsonViewer } from 'omni-viewer-core/viewers/json';
import type { JsonViewerContext } from 'omni-viewer-core/viewers/json';
import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import { Platform } from 'obsidian';
import { showSaveDialog } from '../platform';
import { saveBinaryBesideFile } from '../utils/vaultFiles';
import { RenderContext, ViewerDefinition } from '../viewerCore';

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

function coreHostContext(renderCtx: RenderContext): JsonViewerContext {
    const { app, file, filePath, host } = renderCtx;
    const ctx: JsonViewerContext = {
        assets: {
            resolveAssetUrl: async (assetPath: string) => assetPath
        },
        i18n: {
            t: (key, args) => resolveCatalogMessage(key, args)
        },
        logger: {
            log: (level, message) => {
                const prefix = '[omni-viewer json]';
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
    ctx.save = {
        saveFile: async (name, data) => {
            if (Platform.isMobileApp) {
                await saveBinaryBesideFile(app, file, name, data);
                return;
            }
            const targetPath = await showSaveDialog(
                path.join(path.dirname(filePath), name),
                [{ name: 'JSON', extensions: ['json'] }]
            );
            if (!targetPath) return;
            await fs.promises.writeFile(targetPath, data);
        }
    };
    ctx.writeback = {
        write: async (data) => {
            host.markInternalWrite?.();
            await app.vault.modifyBinary(file, toArrayBuffer(data));
        }
    };
    return ctx;
}

export const jsonViewer: ViewerDefinition = {
    viewType: 'omni-viewer.jsonViewer',
    displayName: 'JSON Viewer',
    extensions: ['json'],
    icon: 'braces',
    errorContent: {
        title: 'Failed to load JSON file',
        message: 'Unable to load the JSON file due to an error:',
        icon: '🧾'
    },
    async render(ctx) {
        if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
            throw new Error('Host does not support direct DOM mounting');
        }
        const buffer = await ctx.app.vault.readBinary(ctx.file);
        const container = ctx.host.provideDomContainer();
        const handle = await mountJsonViewer(
            { fileName: ctx.fileName, data: new Uint8Array(buffer) },
            container,
            coreHostContext(ctx)
        );
        ctx.host.setCoreViewerHandle(handle);
    }
};
