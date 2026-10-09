// HAR viewer — Obsidian adapter over omni-viewer-core.
//
// HAR files are JSON, but the core viewer turns them into a network-triage
// surface: request filters, status/size summaries, a timing waterfall, and
// request/response detail panes. The parser and renderer both live in core;
// this adapter only supplies the vault bytes and Obsidian host services.

import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import {
    mountHarViewer,
    type HarViewerContext
} from 'omni-viewer-core/viewers/har';
import { ViewerDefinition } from '../viewerCore';

/** Keep the adapter's preflight aligned with omni-viewer-core's default input
 * limit. Checking before readBinary avoids materializing an archive that core
 * will reject immediately. */
const MAX_INPUT_BYTES = 256 * 1024 * 1024;

function coreHostContext(): HarViewerContext {
    const ctx: HarViewerContext = {
        assets: {
            resolveAssetUrl: async (assetPath: string) => assetPath
        },
        i18n: {
            t: (key, args) => resolveCatalogMessage(key, args)
        },
        logger: {
            log: (level, message) => {
                const prefix = '[omni-viewer har]';
                if (level === 'error') console.error(prefix, message);
                else if (level === 'warn') console.warn(prefix, message);
            }
        }
    };

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
        ctx.clipboard = {
            writeText: (text: string) => navigator.clipboard.writeText(text)
        };
    }

    return ctx;
}

export const harViewer: ViewerDefinition = {
    viewType: 'omni-viewer.harViewer',
    displayName: 'HAR Viewer',
    extensions: ['har'],
    icon: 'network',
    errorContent: {
        title: 'Failed to load HAR file',
        message: 'Unable to inspect the HTTP Archive due to an error:',
        icon: '🌐'
    },
    async render(ctx) {
        if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
            throw new Error('Host does not support direct DOM mounting');
        }

        if (ctx.file.stat.size > MAX_INPUT_BYTES) {
            throw new Error(
                `HAR files above ${MAX_INPUT_BYTES / (1024 * 1024)} MB cannot be inspected: `
                + 'the archive has to be read into memory in full.'
            );
        }

        const buffer = await ctx.app.vault.readBinary(ctx.file);
        const container = ctx.host.provideDomContainer();
        const handle = await mountHarViewer(
            { fileName: ctx.fileName, data: new Uint8Array(buffer) },
            container,
            coreHostContext()
        );
        ctx.host.setCoreViewerHandle(handle);
    }
};
