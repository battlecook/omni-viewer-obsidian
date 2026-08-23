// Keras viewer — Obsidian adapter over omni-viewer-core.
//
// Covers both saved formats: `.keras` (a Keras 3 ZIP holding config.json,
// metadata.json and model.weights.h5) and the legacy Keras HDF5 model. The core
// parser reads layer configuration and weight *shapes* only — no weight payload
// is decoded — so the vault file is handed over as an in-memory byte array and
// mounted straight into the Obsidian view container, like ONNX and TFLite.
//
// Legacy `.h5` models keep the HDF5 viewer as their registered extension owner;
// FileUtils.detectViewerType reroutes the ones that carry Keras metadata here.

import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import {
    mountKerasViewer,
    type KerasViewerContext
} from 'omni-viewer-core/viewers/keras';
import { ViewerDefinition } from '../viewerCore';

/** Core takes the whole file, so cap what a single model may pull into memory.
 *  Desktop keeps oversized Keras HDF5 stores with the HDF5 viewer instead
 *  (FileUtils.detectViewerType applies the same limit before rerouting), which
 *  reads its metadata through the filesystem rather than a full load. */
const MAX_IN_MEMORY_BYTES = 512 * 1024 * 1024;

function coreHostContext(): KerasViewerContext {
    const ctx: KerasViewerContext = {
        assets: {
            resolveAssetUrl: async (assetPath: string) => assetPath
        },
        i18n: {
            t: (key, args) => resolveCatalogMessage(key, args)
        },
        logger: {
            log: (level, message) => {
                const prefix = '[omni-viewer keras]';
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

export const kerasViewer: ViewerDefinition = {
    viewType: 'omni-viewer.kerasViewer',
    displayName: 'Keras Viewer',
    extensions: ['keras'],
    icon: 'network',
    errorContent: {
        title: 'Failed to load Keras model',
        message: 'Unable to inspect the Keras model due to an error:',
        icon: 'network'
    },
    async render(ctx) {
        if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
            throw new Error('Host does not support direct DOM mounting');
        }

        if (ctx.file.stat.size > MAX_IN_MEMORY_BYTES) {
            throw new Error(
                `Keras models above ${MAX_IN_MEMORY_BYTES / (1024 * 1024)} MB cannot be inspected: `
                + 'the model has to be read into memory in full.'
            );
        }

        const buffer = await ctx.app.vault.readBinary(ctx.file);
        const container = ctx.host.provideDomContainer();
        const handle = await mountKerasViewer(
            { fileName: ctx.fileName, data: new Uint8Array(buffer) },
            container,
            coreHostContext()
        );
        ctx.host.setCoreViewerHandle(handle);
    }
};
