// ExecuTorch viewer — Obsidian adapter over omni-viewer-core.
//
// A `.pte` is the FlatBuffer `to_executorch().save()` writes (identifier `ET12`),
// optionally followed by data segments — constant tensors, delegate blobs,
// mutable initial state, named blobs — that an extended header locates. The core
// parser never decodes those payloads, only where each one lives, but it reads
// the program from a byte array, so the vault file is handed over whole and
// mounted straight into the Obsidian view container, like TFLite and Core ML.

import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import {
    mountPteViewer,
    PTE_VIEWER_META,
    type PteViewerContext
} from 'omni-viewer-core/viewers/pte';
import { ViewerDefinition } from '../viewerCore';

/** Core takes the whole file, so cap what a single program may pull into memory.
 *  Constant and delegate segments make up nearly all of a `.pte`, so even though
 *  none of those bytes are decoded the file can reach several GB. Keep in step
 *  with FileUtils.MAX_IN_MEMORY_SIZE, which gates the reroute towards this viewer. */
const MAX_IN_MEMORY_BYTES = 512 * 1024 * 1024;

// Core 0.19's colored cards use dark backgrounds even when the inherited
// foreground follows a light Obsidian theme. Keep its colored borders while
// using the host's panel palette inside the isolated shadow root.
const OBSIDIAN_THEME_CSS = `
.omni-pte__node--input,
.omni-pte__node--constant,
.omni-pte__node--output,
.omni-pte__node--delegate,
.omni-pte__node--move {
    background: var(--omni-panel-bg, #20242b) !important;
}
.omni-pte__attribute b {
    color: var(--omni-fg, #d8dee9);
}
`;

function coreHostContext(): PteViewerContext {
    const ctx: PteViewerContext = {
        assets: {
            resolveAssetUrl: async (assetPath: string) => assetPath
        },
        i18n: {
            t: (key, args) => resolveCatalogMessage(key, args)
        },
        logger: {
            log: (level, message) => {
                const prefix = '[omni-viewer pte]';
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

export const pteViewer: ViewerDefinition = {
    viewType: 'omni-viewer.pteViewer',
    displayName: 'ExecuTorch Viewer',
    // `.ptd` data files (`FT01`) hold only tensors, not a program, and core does
    // not claim them.
    extensions: [...PTE_VIEWER_META.extensions],
    icon: 'network',
    errorContent: {
        title: 'Failed to load ExecuTorch program',
        message: 'Unable to inspect the ExecuTorch program due to an error:',
        icon: 'network'
    },
    async render(ctx) {
        if (ctx.signal?.aborted) return;

        if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
            throw new Error('Host does not support direct DOM mounting');
        }

        if (ctx.file.stat.size > MAX_IN_MEMORY_BYTES) {
            throw new Error(
                `ExecuTorch programs above ${MAX_IN_MEMORY_BYTES / (1024 * 1024)} MB cannot be inspected: `
                + 'the program has to be read into memory in full.'
            );
        }

        const buffer = await ctx.app.vault.readBinary(ctx.file);
        // A slow vault read may finish after a file switch or tab close.
        if (ctx.signal?.aborted) return;
        const container = ctx.host.provideDomContainer();
        const handle = await mountPteViewer(
            { fileName: ctx.fileName, data: new Uint8Array(buffer) },
            container,
            coreHostContext(),
            { signal: ctx.signal }
        );
        if (ctx.signal?.aborted) {
            handle.dispose();
            return;
        }
        const themeStyle = container.ownerDocument.createElement('style');
        themeStyle.textContent = OBSIDIAN_THEME_CSS;
        (container.shadowRoot ?? container).append(themeStyle);
        ctx.host.setCoreViewerHandle({
            dispose() {
                try {
                    handle.dispose();
                } finally {
                    themeStyle.remove();
                }
            }
        });
    }
};
