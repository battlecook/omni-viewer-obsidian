// Parquet viewer — Obsidian adapter over omni-viewer-core.
//
// Mounts the core DOM viewer directly into the view content (same pattern as
// the JSON/TOML viewers). Style isolation comes from the core's shadow-root
// mount; theme mapping (--omni-* <- Obsidian variables) lives in styles.css.
//
// Large-file lazy load: on desktop we hand the core a random-access
// `ParquetViewerSource` (core 0.8.0) backed by fs range reads, so only the
// footer + requested row-group pages are ever read into memory. On mobile
// (no filesystem access) we fall back to the whole-buffer `{ data }` path.

import * as fs from 'fs';
import * as path from 'path';
import { mountParquetViewer } from 'omni-viewer-core/viewers/parquet';
import type { ParquetViewerContext, ParquetViewerSource } from 'omni-viewer-core/viewers/parquet';
import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import { Notice, Platform } from 'obsidian';
import { showSaveDialog } from '../platform';
import { saveBinaryBesideFile } from '../utils/vaultFiles';
import { RenderContext, ViewerDefinition } from '../viewerCore';

/**
 * Writes text to the clipboard with a legacy `execCommand` fallback for
 * webviews where `navigator.clipboard` is unavailable. Core 0.11 owns success
 * and payload-limit toasts; this adapter only surfaces a fallback failure.
 * Always resolves so the core's fire-and-forget copy calls never raise an
 * unhandled rejection.
 */
async function copyToClipboard(text: string): Promise<void> {
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }
    } catch {
        // fall through to the execCommand path below
    }
    if (fallbackCopyText(text)) {
        return;
    }
    new Notice('Failed to copy to clipboard');
}

function fallbackCopyText(text: string): boolean {
    if (typeof document === 'undefined') return false;
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.setCssStyles({
        position: 'fixed',
        left: '-9999px'
    });
    document.body.appendChild(textArea);
    textArea.select();
    try {
        return document.execCommand('copy');
    } catch {
        return false;
    } finally {
        textArea.remove();
    }
}

function coreHostContext(renderCtx: RenderContext): ParquetViewerContext {
    const { app, file, filePath } = renderCtx;
    const ctx: ParquetViewerContext = {
        assets: {
            resolveAssetUrl: async (assetPath: string) => assetPath
        },
        i18n: {
            t: (key, args) => resolveCatalogMessage(key, args)
        },
        logger: {
            log: (level, message) => {
                const prefix = '[omni-viewer parquet]';
                if (level === 'error') console.error(prefix, message);
                else if (level === 'warn') console.warn(prefix, message);
                else console.info(prefix, message);
            }
        }
    };
    // Always provide clipboard (fallback covers webviews without navigator.clipboard)
    // so the core keeps its copy buttons enabled.
    ctx.clipboard = {
        writeText: (text: string) => copyToClipboard(text)
    };
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
    return ctx;
}

/**
 * Builds a lazy, fs-backed random-access source so the core reads only the
 * footer + requested row-group pages instead of the whole file. Returns null on
 * mobile or when the vault has no real filesystem path, in which case the caller
 * reads the entire file into memory instead.
 */
async function createFsParquetSource(ctx: RenderContext): Promise<ParquetViewerSource | null> {
    if (Platform.isMobileApp) return null;
    let byteLength: number;
    let lastModified: number | undefined;
    try {
        const stats = await fs.promises.stat(ctx.filePath);
        byteLength = stats.size;
        lastModified = stats.mtimeMs;
    } catch {
        return null;
    }
    return {
        fileName: ctx.fileName,
        byteLength,
        lastModified,
        async slice(start: number, end: number = byteLength): Promise<ArrayBuffer> {
            const handle = await fs.promises.open(ctx.filePath, 'r');
            try {
                const length = Math.max(0, end - start);
                const bytes = Buffer.alloc(length);
                const { bytesRead } = await handle.read(bytes, 0, length, start);
                return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytesRead) as ArrayBuffer;
            } finally {
                await handle.close();
            }
        }
    };
}

export const parquetViewer: ViewerDefinition = {
    viewType: 'omni-viewer.parquetViewer',
    displayName: 'Parquet Viewer',
    extensions: ['parquet'],
    icon: 'table-2',
    errorContent: {
        title: 'Failed to load Parquet file',
        message: 'Unable to load the Parquet file due to an error:',
        icon: '📊'
    },
    async render(ctx) {
        if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
            throw new Error('Host does not support direct DOM mounting');
        }
        const container = ctx.host.provideDomContainer();
        const source = await createFsParquetSource(ctx);
        const handle = source
            ? await mountParquetViewer(source, container, coreHostContext(ctx))
            : await mountParquetViewer(
                  {
                      fileName: ctx.fileName,
                      data: new Uint8Array(await ctx.app.vault.readBinary(ctx.file))
                  },
                  container,
                  coreHostContext(ctx)
              );
        ctx.host.setCoreViewerHandle(handle);
    }
};
