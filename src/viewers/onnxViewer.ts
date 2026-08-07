// ONNX viewer — Obsidian adapter over omni-viewer-core.
//
// The core parser reads the whole `ModelProto` but skips weight payload
// decoding, so it needs the file bytes in memory: there is no random-access
// source overload the way parquet/gguf have one. Mounting is the same
// DOM-container pattern as the safetensors adapter.

import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import { mountOnnxViewer, type OnnxViewerContext } from 'omni-viewer-core/viewers/onnx';
import { ViewerDefinition } from '../viewerCore';

function coreHostContext(): OnnxViewerContext {
    const ctx: OnnxViewerContext = {
        assets: {
            resolveAssetUrl: async (assetPath: string) => assetPath
        },
        i18n: {
            t: (key, args) => resolveCatalogMessage(key, args)
        },
        logger: {
            log: (level, message) => {
                const prefix = '[omni-viewer onnx]';
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

export const onnxViewer: ViewerDefinition = {
    viewType: 'omni-viewer.onnxViewer',
    displayName: 'ONNX Viewer',
    extensions: ['onnx'],
    icon: 'network',
    errorContent: {
        title: 'Failed to load ONNX file',
        message: 'Unable to inspect the ONNX model due to an error:',
        icon: 'network'
    },
    async render(ctx) {
        if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
            throw new Error('Host does not support direct DOM mounting');
        }

        const buffer = await ctx.app.vault.readBinary(ctx.file);
        const container = ctx.host.provideDomContainer();
        const handle = await mountOnnxViewer(
            { fileName: ctx.fileName, data: new Uint8Array(buffer) },
            container,
            coreHostContext()
        );
        ctx.host.setCoreViewerHandle(handle);
    }
};
