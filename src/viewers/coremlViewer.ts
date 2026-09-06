// Core ML viewer — Obsidian adapter over omni-viewer-core.
//
// Covers both Core ML encodings: a bare `.mlmodel`, which is a serialized
// `CoreML.Specification.Model` protobuf, and an `.mlpackage`, whose bytes are a
// ZIP holding a `Manifest.json`, that same spec, and the weight blobs an ML
// Program references. The core parser recognizes the two by their leading bytes,
// so nothing here has to say which one it holds.
//
// Weight payloads are never decoded — the parser resolves blob references to a
// file, an offset and a byte count — but it still reads the container from a
// byte array, so the vault file is handed over whole and mounted straight into
// the Obsidian view container, like ONNX, TFLite and Keras.

import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import {
    mountCoremlViewer,
    type CoremlViewerContext
} from 'omni-viewer-core/viewers/coreml';
import { ViewerDefinition } from '../viewerCore';

/** Core takes the whole file, so cap what a single model may pull into memory.
 *  A neural network holds its parameters inline in the spec and an `.mlpackage`
 *  carries its weight blobs alongside it, so either encoding can reach several
 *  GB even though none of those bytes are decoded. Keep in step with
 *  FileUtils.MAX_IN_MEMORY_SIZE, which gates the reroutes towards this viewer. */
const MAX_IN_MEMORY_BYTES = 512 * 1024 * 1024;

function coreHostContext(): CoremlViewerContext {
    const ctx: CoremlViewerContext = {
        assets: {
            resolveAssetUrl: async (assetPath: string) => assetPath
        },
        i18n: {
            t: (key, args) => resolveCatalogMessage(key, args)
        },
        logger: {
            log: (level, message) => {
                const prefix = '[omni-viewer coreml]';
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

export const coremlViewer: ViewerDefinition = {
    viewType: 'omni-viewer.coremlViewer',
    displayName: 'Core ML Viewer',
    // `.mlpackage` is a directory bundle on macOS, so Obsidian only ever hands
    // one over when it has been archived into a single file; the extension is
    // registered for that case, and the parser reads the ZIP either way.
    extensions: ['mlmodel', 'mlpackage'],
    icon: 'network',
    errorContent: {
        title: 'Failed to load Core ML model',
        message: 'Unable to inspect the Core ML model due to an error:',
        icon: 'network'
    },
    async render(ctx) {
        if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
            throw new Error('Host does not support direct DOM mounting');
        }

        if (ctx.file.stat.size > MAX_IN_MEMORY_BYTES) {
            throw new Error(
                `Core ML models above ${MAX_IN_MEMORY_BYTES / (1024 * 1024)} MB cannot be inspected: `
                + 'the model has to be read into memory in full.'
            );
        }

        const buffer = await ctx.app.vault.readBinary(ctx.file);
        const container = ctx.host.provideDomContainer();
        const handle = await mountCoremlViewer(
            { fileName: ctx.fileName, data: new Uint8Array(buffer) },
            container,
            coreHostContext()
        );
        ctx.host.setCoreViewerHandle(handle);
    }
};
