import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import { FONT_VIEWER_META, mountFontViewer } from 'omni-viewer-core/viewers/font';
import { ViewerDefinition } from '../viewerCore';

const MAX_INPUT_BYTES = 64 * 1024 * 1024;

export const fontViewer: ViewerDefinition = {
    viewType: 'omni-viewer.fontViewer',
    displayName: 'Font Viewer',
    extensions: [...FONT_VIEWER_META.extensions],
    icon: 'type',
    errorContent: {
        title: 'Failed to load font',
        message: 'Unable to inspect this font due to an error:',
        icon: 'type'
    },
    async render(ctx) {
        if (ctx.signal?.aborted) return;
        if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
            throw new Error('Host does not support direct DOM mounting');
        }
        if (ctx.file.stat.size > MAX_INPUT_BYTES) {
            throw new Error('Fonts above 64 MB cannot be opened: the font has to be read into memory in full.');
        }
        const data = new Uint8Array(await ctx.app.vault.readBinary(ctx.file));
        if (ctx.signal?.aborted) return;
        const handle = await mountFontViewer(
            { fileName: ctx.fileName, data, lastModified: ctx.file.stat.mtime },
            ctx.host.provideDomContainer(),
            {
                assets: { resolveAssetUrl: async (assetPath) => assetPath },
                i18n: { t: (key, args) => resolveCatalogMessage(key, args) },
                logger: { log: (level, message) => {
                    if (level === 'error') console.error('[omni-viewer font]', message);
                    else if (level === 'warn') console.warn('[omni-viewer font]', message);
                } }
            },
            { signal: ctx.signal }
        );
        if (ctx.signal?.aborted) {
            handle.dispose();
            return;
        }
        ctx.host.setCoreViewerHandle(handle);
    }
};
