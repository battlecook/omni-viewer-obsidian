// EPUB viewer — Obsidian adapter over omni-viewer-core.
//
// An EPUB is a ZIP (OCF) of XHTML chapters, stylesheets and images. Core opens
// the central directory once and inflates single chapters and images on demand
// while the book is open, out of the bytes handed over here, so the vault file
// is read whole and kept. Chapters are sanitized with DOMPurify — the viewer's
// only peer — before they are inserted; scripts in a book never run.

import createDOMPurify from 'dompurify';
import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import {
    mountEpubViewer,
    EPUB_VIEWER_META,
    type EpubViewerContext,
    type EpubViewerDeps
} from 'omni-viewer-core/viewers/epub';
import { openExternal } from '../platform';
import { ViewerDefinition } from '../viewerCore';

/** Core refuses a container past its default 256 MB input cap; reject it
 *  before the vault read instead of after. */
const MAX_INPUT_BYTES = 256 * 1024 * 1024;
const purifierFactory = createDOMPurify as unknown as EpubViewerDeps['createDOMPurify'];

const epubDeps: EpubViewerDeps = {
    createDOMPurify: (window) => purifierFactory(window)
};

// Navigation is what lets external links in a chapter open; without it core
// marks them aria-disabled. In-book links never leave the viewer.
function coreHostContext(): EpubViewerContext {
    return {
        assets: {
            resolveAssetUrl: async (assetPath: string) => assetPath
        },
        i18n: {
            t: (key, args) => resolveCatalogMessage(key, args)
        },
        logger: {
            log: (level, message) => {
                const prefix = '[omni-viewer epub]';
                if (level === 'error') console.error(prefix, message);
                else if (level === 'warn') console.warn(prefix, message);
            }
        },
        navigation: {
            openExternalUrl: async (url) => { openExternal(url); }
        }
    };
}

export const epubViewer: ViewerDefinition = {
    viewType: 'omni-viewer.epubViewer',
    displayName: 'EPUB Viewer',
    extensions: [...EPUB_VIEWER_META.extensions],
    icon: 'book-open',
    errorContent: {
        title: 'Failed to load EPUB book',
        message: 'Unable to open this EPUB book due to an error:',
        icon: '📚'
    },
    async render(ctx) {
        if (ctx.signal?.aborted) return;

        if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
            throw new Error('Host does not support direct DOM mounting');
        }

        if (ctx.file.stat.size > MAX_INPUT_BYTES) {
            throw new Error(
                `EPUB books above ${MAX_INPUT_BYTES / (1024 * 1024)} MB cannot be opened: `
                + 'the book has to be held in memory in full.'
            );
        }

        const buffer = await ctx.app.vault.readBinary(ctx.file);
        // A slow vault read may finish after a file switch or tab close.
        if (ctx.signal?.aborted) return;
        const container = ctx.host.provideDomContainer();
        // A book that does not parse is not thrown: core mounts its own
        // failure view with the localized reason.
        const handle = await mountEpubViewer(
            { fileName: ctx.fileName, data: new Uint8Array(buffer), lastModified: ctx.file.stat.mtime },
            container,
            coreHostContext(),
            epubDeps,
            { signal: ctx.signal, limits: { maxInputBytes: MAX_INPUT_BYTES } }
        );
        if (ctx.signal?.aborted) {
            handle.dispose();
            return;
        }
        ctx.host.setCoreViewerHandle(handle);
    }
};
