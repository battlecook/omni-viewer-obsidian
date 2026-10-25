// NumPy viewer — Obsidian adapter over omni-viewer-core.
//
// Covers a standalone `.npy` array (the `\x93NUMPY` header followed by the raw
// buffer) and an `.npz` collection, which is a ZIP of `.npy` members as written
// by `np.savez` / `np.savez_compressed`. The core parser tells the two apart by
// their leading bytes and never unpickles object arrays. It reads from a byte
// array, so the vault file is handed over whole and mounted straight into the
// Obsidian view container, like Safetensors and ONNX.

import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import {
    mountNumpyViewer,
    NUMPY_VIEWER_META,
    type NumpyViewerContext
} from 'omni-viewer-core/viewers/numpy';
import { ViewerDefinition } from '../viewerCore';

/** Core takes the whole file, so cap what a single array may pull into memory.
 *  Keep in step with FileUtils.MAX_IN_MEMORY_SIZE, which gates the reroutes
 *  towards this viewer. */
const MAX_IN_MEMORY_BYTES = 512 * 1024 * 1024;

function coreHostContext(): NumpyViewerContext {
    const ctx: NumpyViewerContext = {
        assets: {
            resolveAssetUrl: async (assetPath: string) => assetPath
        },
        i18n: {
            t: (key, args) => resolveCatalogMessage(key, args)
        },
        logger: {
            log: (level, message) => {
                const prefix = '[omni-viewer numpy]';
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

export const numpyViewer: ViewerDefinition = {
    viewType: 'omni-viewer.numpyViewer',
    displayName: 'NumPy Viewer',
    extensions: [...NUMPY_VIEWER_META.extensions],
    icon: 'grid-3x3',
    errorContent: {
        title: 'Failed to load NumPy file',
        message: 'Unable to inspect the NumPy array due to an error:',
        icon: 'grid-3x3'
    },
    async render(ctx) {
        if (ctx.signal?.aborted) return;

        if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
            throw new Error('Host does not support direct DOM mounting');
        }

        if (ctx.file.stat.size > MAX_IN_MEMORY_BYTES) {
            throw new Error(
                `NumPy files above ${MAX_IN_MEMORY_BYTES / (1024 * 1024)} MB cannot be inspected: `
                + 'the file has to be read into memory in full.'
            );
        }

        const buffer = await ctx.app.vault.readBinary(ctx.file);
        // A slow vault read may finish after a file switch or tab close.
        if (ctx.signal?.aborted) return;
        const container = ctx.host.provideDomContainer();
        const handle = await mountNumpyViewer(
            { fileName: ctx.fileName, data: new Uint8Array(buffer) },
            container,
            coreHostContext(),
            { signal: ctx.signal }
        );
        if (ctx.signal?.aborted) {
            handle.dispose();
            return;
        }
        ctx.host.setCoreViewerHandle(handle);
    }
};
