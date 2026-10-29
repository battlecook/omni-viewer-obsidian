import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import { GEOJSON_VIEWER_META, mountGeoJsonViewer } from 'omni-viewer-core/viewers/geojson';
import { ViewerDefinition } from '../viewerCore';

const MAX_INPUT_BYTES = 64 * 1024 * 1024;

export const geojsonViewer: ViewerDefinition = {
    viewType: 'omni-viewer.geojsonViewer',
    displayName: 'GeoJSON Viewer',
    extensions: [...GEOJSON_VIEWER_META.extensions],
    icon: 'map',
    errorContent: {
        title: 'Failed to load GeoJSON',
        message: 'Unable to inspect this GeoJSON document due to an error:',
        icon: 'map'
    },
    async render(ctx) {
        if (ctx.signal?.aborted) return;
        if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
            throw new Error('Host does not support direct DOM mounting');
        }
        if (ctx.file.stat.size > MAX_INPUT_BYTES) {
            throw new Error('GeoJSON documents above 64 MB cannot be opened: the document has to be read into memory in full.');
        }
        const data = new Uint8Array(await ctx.app.vault.readBinary(ctx.file));
        if (ctx.signal?.aborted) return;
        const handle = await mountGeoJsonViewer(
            { fileName: ctx.fileName, data, lastModified: ctx.file.stat.mtime },
            ctx.host.provideDomContainer(),
            {
                assets: { resolveAssetUrl: async (assetPath) => assetPath },
                i18n: { t: (key, args) => resolveCatalogMessage(key, args) },
                logger: { log: (level, message) => {
                    if (level === 'error') console.error('[omni-viewer geojson]', message);
                    else if (level === 'warn') console.warn('[omni-viewer geojson]', message);
                } }
            },
            { signal: ctx.signal, limits: { maxInputBytes: MAX_INPUT_BYTES } }
        );
        if (ctx.signal?.aborted) {
            handle.dispose();
            return;
        }
        ctx.host.setCoreViewerHandle(handle);
    }
};
