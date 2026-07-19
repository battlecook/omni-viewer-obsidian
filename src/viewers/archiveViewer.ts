// Archive viewer — Obsidian adapter over omni-viewer-core (streaming path).
//
// Mounts the core archive viewer directly into the view and feeds it a lazy,
// path-based decoder (ArchiveStreamingSource) so the archive is never loaded
// into renderer memory whole. Listing, per-entry preview, and save-to-disk all
// stream through the adapter (JSZip / zlib / system `7z` / `tar`).

import * as fs from 'fs';
import * as path from 'path';
import { mountArchiveViewer } from 'omni-viewer-core/viewers/archive';
import type { ArchiveStreamingSource, ArchiveViewerContext } from 'omni-viewer-core/viewers/archive';
import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import { showSaveDialog } from '../platform';
import { openArchiveStreamHandle, saveArchiveEntry } from '../utils/fileUtils/archiveStream';
import { ViewerDefinition } from '../viewerCore';

function coreHostContext(filePath: string): ArchiveViewerContext {
    return {
        assets: {
            resolveAssetUrl: async (assetPath: string) => assetPath
        },
        i18n: {
            t: (key, args) => resolveCatalogMessage(key, args)
        },
        logger: {
            log: (level, message) => {
                const prefix = '[omni-viewer archive]';
                if (level === 'error') console.error(prefix, message);
                else if (level === 'warn') console.warn(prefix, message);
                else console.info(prefix, message);
            }
        },
        // Streaming save: the adapter pipes the entry to the chosen file, so a
        // multi-GB entry is never materialized in memory.
        saveEntry: {
            saveEntry: async (entry, options) => {
                const suggested = entry.path.split('/').filter(Boolean).pop() ?? 'archive-entry';
                const dest = await showSaveDialog(
                    path.join(path.dirname(filePath), suggested),
                    [{ name: 'All files', extensions: ['*'] }]
                );
                if (!dest) return null;
                await saveArchiveEntry(filePath, entry, dest, options.signal);
                return path.basename(dest);
            }
        }
    };
}

export const archiveViewer: ViewerDefinition = {
    viewType: 'omni-viewer.archiveViewer',
    displayName: 'Archive Viewer',
    extensions: ['zip', 'rar', '7z', 'dmg', 'jar', 'apk', 'tar', 'tgz', 'gz', 'tbz2', 'bz2', 'txz', 'xz'],
    icon: 'folder-archive',
    errorContent: {
        title: 'Failed to load archive file',
        message: 'Unable to inspect the archive contents due to an error:',
        icon: '🗜️'
    },
    async render(ctx) {
        if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
            throw new Error('Host does not support direct DOM mounting');
        }
        const stats = await fs.promises.stat(ctx.filePath);
        const container = ctx.host.provideDomContainer();
        const source: ArchiveStreamingSource = {
            fileName: ctx.fileName,
            totalSize: stats.size,
            openArchive: (options) => openArchiveStreamHandle(ctx.filePath, options?.signal)
        };
        const handle = await mountArchiveViewer(source, container, coreHostContext(ctx.filePath));
        ctx.host.setCoreViewerHandle(handle);
    }
};
