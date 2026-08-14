// TFLite / LiteRT viewer — Obsidian adapter over omni-viewer-core.
//
// The core parser inspects the FlatBuffer metadata without decoding model
// weights. Like ONNX, it receives the vault file as an in-memory byte array and
// mounts directly into the Obsidian view container.

import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import {
    mountTfliteViewer,
    type TfliteViewerContext
} from 'omni-viewer-core/viewers/tflite';
import { ViewerDefinition } from '../viewerCore';

function coreHostContext(): TfliteViewerContext {
    const ctx: TfliteViewerContext = {
        assets: {
            resolveAssetUrl: async (assetPath: string) => assetPath
        },
        i18n: {
            t: (key, args) => resolveCatalogMessage(key, args)
        },
        logger: {
            log: (level, message) => {
                const prefix = '[omni-viewer tflite]';
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

export const tfliteViewer: ViewerDefinition = {
    viewType: 'omni-viewer.tfliteViewer',
    displayName: 'TFLite Viewer',
    extensions: ['tflite', 'lite'],
    icon: 'network',
    errorContent: {
        title: 'Failed to load TFLite file',
        message: 'Unable to inspect the TFLite model due to an error:',
        icon: 'network'
    },
    async render(ctx) {
        if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
            throw new Error('Host does not support direct DOM mounting');
        }

        const buffer = await ctx.app.vault.readBinary(ctx.file);
        const container = ctx.host.provideDomContainer();
        const handle = await mountTfliteViewer(
            { fileName: ctx.fileName, data: new Uint8Array(buffer) },
            container,
            coreHostContext()
        );
        ctx.host.setCoreViewerHandle(handle);
    }
};
