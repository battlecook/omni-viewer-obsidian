// PyTorch Export viewer — Obsidian adapter over omni-viewer-core.
//
// A `.pt2` is the ZIP `torch.export.save()` writes: an `archive_format` marker,
// the serialized ExportedProgram JSON (graph, signature, range constraints) and
// the weight / constant payloads it references. Packages from older writers
// carry `serialized_exported_program.json` at the root instead. The core parser
// only previews a few values per tensor, but it reads the archive from a byte
// array, so the vault file is handed over whole and mounted straight into the
// Obsidian view container, like ExecuTorch and Core ML.

import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import {
    mountPt2Viewer,
    PT2_VIEWER_META,
    type Pt2ViewerContext
} from 'omni-viewer-core/viewers/pt2';
import { ViewerDefinition } from '../viewerCore';

/** Core takes the whole file, so cap what a single package may pull into memory.
 *  The weights make up nearly all of a `.pt2`, so it can reach several GB even
 *  though only a short preview of each tensor is decoded. Keep in step with
 *  FileUtils.MAX_IN_MEMORY_SIZE, which gates the reroutes towards this viewer. */
const MAX_IN_MEMORY_BYTES = 512 * 1024 * 1024;

// Core 0.19's colored graph nodes use dark backgrounds even when the inherited
// foreground follows a light Obsidian theme. Keep their colored borders while
// using the host's panel palette inside the isolated shadow root.
const OBSIDIAN_THEME_CSS = `
.omni-pt2__node--input,
.omni-pt2__node--output,
.omni-pt2__node--param,
.omni-pt2__node--buffer,
.omni-pt2__node--constant,
.omni-pt2__node--hop {
    background: var(--omni-panel-bg, #20242b) !important;
}
.omni-pt2__attribute b {
    color: var(--omni-fg, #d8dee9);
}
`;

function coreHostContext(): Pt2ViewerContext {
    const ctx: Pt2ViewerContext = {
        assets: {
            resolveAssetUrl: async (assetPath: string) => assetPath
        },
        i18n: {
            t: (key, args) => resolveCatalogMessage(key, args)
        },
        logger: {
            log: (level, message) => {
                const prefix = '[omni-viewer pt2]';
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

export const pt2Viewer: ViewerDefinition = {
    viewType: 'omni-viewer.pt2Viewer',
    displayName: 'PyTorch Export Viewer',
    extensions: [...PT2_VIEWER_META.extensions],
    icon: 'flame',
    errorContent: {
        title: 'Failed to load PyTorch Export package',
        message: 'Unable to inspect the exported program due to an error:',
        icon: 'flame'
    },
    async render(ctx) {
        if (ctx.signal?.aborted) return;

        if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
            throw new Error('Host does not support direct DOM mounting');
        }

        if (ctx.file.stat.size > MAX_IN_MEMORY_BYTES) {
            throw new Error(
                `PyTorch Export packages above ${MAX_IN_MEMORY_BYTES / (1024 * 1024)} MB cannot be inspected: `
                + 'the package has to be read into memory in full.'
            );
        }

        const buffer = await ctx.app.vault.readBinary(ctx.file);
        // A slow vault read may finish after a file switch or tab close.
        if (ctx.signal?.aborted) return;
        const container = ctx.host.provideDomContainer();
        const handle = await mountPt2Viewer(
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
