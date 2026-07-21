// Safetensors viewer — Obsidian adapter over omni-viewer-core.

import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import {
    mountSafetensorsViewer,
    type SafetensorsViewerContext
} from 'omni-viewer-core/viewers/safetensors';
import { applyMobileCoreStyles } from '../utils/mobileUi';
import { ViewerDefinition } from '../viewerCore';

function coreHostContext(): SafetensorsViewerContext {
    const ctx: SafetensorsViewerContext = {
        assets: {
            resolveAssetUrl: async (assetPath: string) => assetPath
        },
        i18n: {
            t: (key, args) => resolveCatalogMessage(key, args)
        },
        logger: {
            log: (level, message) => {
                const prefix = '[omni-viewer safetensors]';
                if (level === 'error') console.error(prefix, message);
                else if (level === 'warn') console.warn(prefix, message);
                else console.info(prefix, message);
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

export const safetensorsViewer: ViewerDefinition = {
    viewType: 'omni-viewer.safetensorsViewer',
    displayName: 'Safetensors Viewer',
    extensions: ['safetensors'],
    icon: 'blocks',
    errorContent: {
        title: 'Failed to load Safetensors file',
        message: 'Unable to inspect the Safetensors model due to an error:',
        icon: 'blocks'
    },
    async render(ctx) {
        if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
            throw new Error('Host does not support direct DOM mounting');
        }

        const buffer = await ctx.app.vault.readBinary(ctx.file);
        const container = ctx.host.provideDomContainer();
        const handle = await mountSafetensorsViewer(
            { fileName: ctx.fileName, data: new Uint8Array(buffer) },
            container,
            coreHostContext()
        );
        applyMobileCoreStyles(container);
        ctx.host.setCoreViewerHandle(handle);
    }
};
