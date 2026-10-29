import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import { ARROW_VIEWER_META, mountSelfLoadingArrowViewer, type ArrowViewerContext } from 'omni-viewer-core/viewers/arrow/self-loading';
import { ViewerDefinition } from '../viewerCore';
import { saveBinaryBesideFile } from '../utils/vaultFiles';

const MAX_INPUT_BYTES = 256 * 1024 * 1024;

export const arrowViewer: ViewerDefinition = {
    viewType: 'omni-viewer.arrowViewer',
    displayName: 'Arrow / Feather Viewer',
    extensions: [...ARROW_VIEWER_META.extensions],
    icon: 'table',
    errorContent: {
        title: 'Failed to load Arrow / Feather file',
        message: 'Unable to inspect this Arrow IPC or Feather V2 file due to an error:',
        icon: 'table'
    },
    async render(ctx) {
        if (ctx.signal?.aborted) return;
        if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
            throw new Error('Host does not support direct DOM mounting');
        }
        if (ctx.file.stat.size > MAX_INPUT_BYTES) {
            throw new Error('Arrow / Feather files above 256 MB cannot be opened: the file has to be read into memory in full.');
        }
        const data = new Uint8Array(await ctx.app.vault.readBinary(ctx.file));
        if (ctx.signal?.aborted) return;
        const coreContext: ArrowViewerContext = {
            assets: { resolveAssetUrl: async (assetPath) => assetPath },
            i18n: { t: (key, args) => resolveCatalogMessage(key, args) },
            logger: { log: (level, message) => {
                if (level === 'error') console.error('[omni-viewer arrow]', message);
                else if (level === 'warn') console.warn('[omni-viewer arrow]', message);
            } },
            save: { saveFile: async (name, bytes) => {
                if (ctx.signal?.aborted) return { status: 'cancelled' };
                const saved = await saveBinaryBesideFile(ctx.app, ctx.file, name, bytes);
                return saved ? { status: 'saved', fileName: saved.name } : { status: 'cancelled' };
            } }
        };
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
            coreContext.clipboard = { writeText: (text) => navigator.clipboard.writeText(text) };
        }
        // esbuild bundles Arrow and the optional LZ4/ZSTD decoders for offline use.
        const handle = await mountSelfLoadingArrowViewer(
            { fileName: ctx.fileName, data, lastModified: ctx.file.stat.mtime },
            ctx.host.provideDomContainer(),
            coreContext,
            { signal: ctx.signal }
        );
        if (ctx.signal?.aborted) {
            handle.dispose();
            return;
        }
        ctx.host.setCoreViewerHandle(handle);
    }
};
