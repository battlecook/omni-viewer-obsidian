// Generic XML viewer — Obsidian adapter over omni-viewer-core.
//
// Covers core's generic XML extensions (`XML_VIEWER_META`: `.xml`, `.xsd`,
// `.xslt`, `.wsdl`, `.rss`, `.kml`, `.gpx`, `.csproj`, …) with an element tree,
// the source pane, XPath and search. Core keeps the decoded source whole — the
// tree's nodes point back into it by offset — so the vault file is read in full.
// `.arxml` and `.reqif` are XML too but keep the automotive viewers.
//
// `.xml` is shared with OpenVINO IR. On desktop FileUtils.detectViewerType
// moves an IR to the OpenVINO viewer before this one renders; mobile has no
// content rerouting, so an IR that still arrives here is handed to that
// viewer's renderer instead of being shown as a generic tree.

import { Platform } from 'obsidian';
import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import { looksLikeOpenVinoIr } from 'omni-viewer-core/registry';
import {
    mountXmlViewer,
    XML_DEFAULT_MAX_INPUT_BYTES,
    XML_VIEWER_META,
    type XmlViewerContext
} from 'omni-viewer-core/viewers/xml';
import { ViewerDefinition } from '../viewerCore';
import { renderOpenVinoIr } from './openvinoViewer';

/** Core refuses a document past its 64 MB input cap. */
const MAX_INPUT_BYTES = XML_DEFAULT_MAX_INPUT_BYTES;
/** Bytes decoded to look for an OpenVINO IR root, matching the desktop
 *  signature window. */
const IR_SNIFF_BYTES = 64 * 1024;
/** On mobile an `.xml` may be an IR, which the OpenVINO viewer takes up to its
 *  own in-memory limit; keep in step with openvinoViewer's MAX_IN_MEMORY_BYTES. */
const IR_MAX_BYTES = 512 * 1024 * 1024;

function tooLarge(irChecked: boolean): Error {
    const limit = `${MAX_INPUT_BYTES / (1024 * 1024)} MB`;
    return new Error(irChecked
        ? `XML documents above ${limit} and OpenVINO topologies above ${IR_MAX_BYTES / (1024 * 1024)} MB cannot be opened: `
            + 'the document has to be read into memory in full.'
        : `XML documents above ${limit} cannot be opened: the document has to be read into memory in full.`);
}

// Clipboard backs the XPath / value / subtree copy buttons; without it core
// disables them.
function coreHostContext(): XmlViewerContext {
    const ctx: XmlViewerContext = {
        assets: {
            resolveAssetUrl: async (assetPath: string) => assetPath
        },
        i18n: {
            t: (key, args) => resolveCatalogMessage(key, args)
        },
        logger: {
            log: (level, message) => {
                const prefix = '[omni-viewer xml]';
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

export const xmlViewer: ViewerDefinition = {
    viewType: 'omni-viewer.xmlViewer',
    displayName: 'XML Viewer',
    extensions: [...XML_VIEWER_META.extensions],
    icon: 'file-code',
    errorContent: {
        title: 'Failed to load XML document',
        message: 'Unable to open this XML document due to an error:',
        icon: 'file-code'
    },
    async render(ctx) {
        if (ctx.signal?.aborted) return;

        if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
            throw new Error('Host does not support direct DOM mounting');
        }

        // Desktop has already rerouted an IR, so only a mobile `.xml` may be
        // one; an IR topology may exceed the XML cap, so such a file is held to
        // the OpenVINO limit until its root has been looked at.
        const mayBeIr = Platform.isMobileApp && ctx.file.extension.toLowerCase() === 'xml';
        const size = ctx.file.stat.size;
        if (size > (mayBeIr ? IR_MAX_BYTES : MAX_INPUT_BYTES)) throw tooLarge(mayBeIr);

        const buffer = await ctx.app.vault.readBinary(ctx.file);
        // A slow vault read may finish after a file switch or tab close.
        if (ctx.signal?.aborted) return;

        if (mayBeIr && looksLikeOpenVinoIr(new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, IR_SNIFF_BYTES))))) {
            // Handed over, not re-read: a large topology is held in memory once.
            await renderOpenVinoIr(ctx, buffer);
            return;
        }
        if (size > MAX_INPUT_BYTES) throw tooLarge(true);
        const data = new Uint8Array(buffer);

        const container = ctx.host.provideDomContainer();
        // A document that does not parse is not thrown: core mounts its own
        // failure view with the localized reason and diagnostics.
        const handle = await mountXmlViewer(
            { fileName: ctx.fileName, data, lastModified: ctx.file.stat.mtime },
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
