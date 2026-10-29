// HTML preview/source viewer — shared by the desktop and mobile vault hosts.
import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import { HTML_VIEWER_META, mountHtmlViewer } from 'omni-viewer-core/viewers/html';
import { ViewerDefinition } from '../viewerCore';

// Core falls back to a bounded source preview above 8 MB. Limit the vault
// read as well, since readBinary materializes the entire file on both hosts.
const MAX_INPUT_BYTES = 64 * 1024 * 1024;

export const htmlViewer: ViewerDefinition = {
    viewType: 'omni-viewer.htmlViewer',
    displayName: 'HTML Viewer',
    extensions: [...HTML_VIEWER_META.extensions],
    icon: 'file-code',
    errorContent: {
        title: 'Failed to load HTML document',
        message: 'Unable to open this HTML document due to an error:',
        icon: 'file-code'
    },
    async render(ctx) {
        if (ctx.signal?.aborted) return;
        if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
            throw new Error('Host does not support direct DOM mounting');
        }
        if (ctx.file.stat.size > MAX_INPUT_BYTES) {
            throw new Error('HTML documents above 64 MB cannot be opened: the document has to be read into memory in full.');
        }

        const data = new Uint8Array(await ctx.app.vault.readBinary(ctx.file));
        if (ctx.signal?.aborted) return;
        const container = ctx.host.provideDomContainer();
        const handle = await mountHtmlViewer(
            { fileName: ctx.fileName, data, lastModified: ctx.file.stat.mtime },
            container,
            {
                assets: { resolveAssetUrl: async (assetPath) => assetPath },
                i18n: { t: (key, args) => resolveCatalogMessage(key, args) },
                logger: {
                    log: (level, message) => {
                        if (level === 'error') console.error('[omni-viewer html]', message);
                        else if (level === 'warn') console.warn('[omni-viewer html]', message);
                    }
                }
            },
            // Core bundles styles into the shadow root and isolates the
            // document in its own sandboxed preview iframe.
            { signal: ctx.signal }
        );
        if (ctx.signal?.aborted) {
            handle.dispose();
            return;
        }
        ctx.host.setCoreViewerHandle(handle);
    }
};
