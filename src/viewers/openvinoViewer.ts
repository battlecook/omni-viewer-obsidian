// OpenVINO IR viewer — Obsidian adapter over omni-viewer-core.
//
// An IR is two files: the `.xml` topology (`<net>` with `<layers>` and
// `<edges>`) and a same-named `.bin` holding the raw constant payloads that
// `Const` layers address by offset and size. The core viewer takes the `.xml` as
// its input and the `.bin` as an optional sidecar — the graph renders without
// it, only constant previews and range checks need the weights.
//
// `.xml` belongs to the generic XML viewer, so this viewer claims no extension:
// FileUtils.detectViewerType reroutes an IR here by content on desktop, and the
// XML viewer hands one over to this renderer on mobile, which has no rerouting.

import { normalizePath, TFile } from 'obsidian';
import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import {
    mountOpenVinoViewer,
    type OpenVinoViewerContext
} from 'omni-viewer-core/viewers/openvino';
import { RenderContext, ViewerDefinition } from '../viewerCore';

/** Core takes the whole `.xml`, and the `.bin` whole when it is supplied. Keep
 *  in step with FileUtils.MAX_IN_MEMORY_SIZE. */
const MAX_IN_MEMORY_BYTES = 512 * 1024 * 1024;

// Core 0.19's colored graph nodes use dark backgrounds even when the inherited
// foreground follows a light Obsidian theme. Keep their colored borders while
// using the host's panel palette inside the isolated shadow root.
const OBSIDIAN_THEME_CSS = `
.omni-openvino__node--input,
.omni-openvino__node--output,
.omni-openvino__node--const {
    background: var(--omni-panel-bg, #20242b) !important;
}
.omni-openvino__attribute b {
    color: var(--omni-fg, #d8dee9);
}
`;

function coreHostContext(): OpenVinoViewerContext {
    const ctx: OpenVinoViewerContext = {
        assets: {
            resolveAssetUrl: async (assetPath: string) => assetPath
        },
        i18n: {
            t: (key, args) => resolveCatalogMessage(key, args)
        },
        logger: {
            log: (level, message) => {
                const prefix = '[omni-viewer openvino]';
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

/** Reads the `.bin` beside the `.xml`, or returns undefined when there is none
 *  or it is too large to hold — the topology still renders either way. */
async function readWeightsSidecar(ctx: RenderContext): Promise<Uint8Array | undefined> {
    const binPath = normalizePath(`${ctx.file.parent?.path ?? ''}/${ctx.file.basename}.bin`);
    const bin = ctx.app.vault.getAbstractFileByPath(binPath);
    if (!(bin instanceof TFile)) return undefined;

    if (bin.stat.size > MAX_IN_MEMORY_BYTES) {
        console.warn(
            '[omni-viewer openvino]',
            `Skipped ${bin.path}: weights above ${MAX_IN_MEMORY_BYTES / (1024 * 1024)} MB are not read, `
            + 'so constant previews are unavailable.'
        );
        return undefined;
    }

    return new Uint8Array(await ctx.app.vault.readBinary(bin));
}

/** Renders an IR into the view. `xml` is the topology when the caller has
 *  already read it — the XML viewer on mobile — so it is not read twice. */
export async function renderOpenVinoIr(ctx: RenderContext, xml?: ArrayBuffer): Promise<void> {
    if (ctx.signal?.aborted) return;

    if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
        throw new Error('Host does not support direct DOM mounting');
    }

    if (ctx.file.stat.size > MAX_IN_MEMORY_BYTES) {
        throw new Error(
            `OpenVINO topologies above ${MAX_IN_MEMORY_BYTES / (1024 * 1024)} MB cannot be inspected: `
            + 'the XML has to be read into memory in full.'
        );
    }

    const [topology, bin] = await Promise.all([
        xml ?? ctx.app.vault.readBinary(ctx.file),
        readWeightsSidecar(ctx)
    ]);
    // A slow vault read may finish after a file switch or tab close.
    if (ctx.signal?.aborted) return;
    const container = ctx.host.provideDomContainer();
    const handle = await mountOpenVinoViewer(
        { fileName: ctx.fileName, data: new Uint8Array(topology) },
        container,
        coreHostContext(),
        { signal: ctx.signal, sidecars: { bin } }
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

export const openvinoViewer: ViewerDefinition = {
    viewType: 'omni-viewer.openvinoViewer',
    displayName: 'OpenVINO Viewer',
    extensions: [],
    icon: 'cpu',
    errorContent: {
        title: 'Failed to load OpenVINO model',
        message: 'Unable to inspect the OpenVINO IR due to an error:',
        icon: 'cpu'
    },
    render: (ctx) => renderOpenVinoIr(ctx)
};
