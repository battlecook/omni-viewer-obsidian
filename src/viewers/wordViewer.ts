// Word viewer — Obsidian adapter over omni-viewer-core.
//
// Like the CSV/PDF/PPT viewers, this mounts the core DOM viewer directly into
// the view content instead of rendering a template into a sandboxed iframe.
// The core owns parsing (docx-preview for .docx, its own DocBinaryParser for
// legacy .doc) and rendering; this adapter only supplies host services and
// dependencies.

import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import * as docxPreview from 'docx-preview';
import { Platform } from 'obsidian';
import type { PrintService } from 'omni-viewer-core/host';
import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import {
    mountWordViewer,
    type WordViewerContext,
    type WordViewerDeps
} from 'omni-viewer-core/viewers/word';
import { RenderContext, ViewerDefinition } from '../viewerCore';

// Passed explicitly rather than via the core's `loadWordViewerDeps()`: that
// helper uses non-literal dynamic imports (`import('jszip' as string)`), which
// esbuild cannot follow into the bundle. It would be left as a runtime
// require() that fails inside the single-file plugin bundle.
const wordDeps: WordViewerDeps = {
    loadDocxPreview: async () => docxPreview,
    loadZip: async () => JSZip,
    // Required for embedded-workbook previews in legacy .doc and for OLE
    // objects in .docx. Omitting it silently degrades to a warning log.
    loadSheet: async () => XLSX
};

/**
 * The core viewer only exposes a `print` button when the host provides a
 * PrintService. `window.print()` is not usable here: unlike the Chrome and
 * VSCode adapters (whose viewer owns the whole page), the viewer is embedded
 * in the Obsidian window, so printing would capture the entire app UI.
 *
 * Move the mounted viewer into a temporary, top-level print root. Word viewer
 * CSS is bundled into styles.css, so the print document needs no runtime style
 * element (which Obsidian's plugin-review rules prohibit).
 */
function createPrintService(container: HTMLElement): PrintService {
    return {
        print: async () => {
            const parent = container.parentNode;
            if (!parent) return;

            const nextSibling = container.nextSibling;
            const printRoot = document.body.createDiv({
                cls: ['omni-viewer-content', 'omni-word-print-root']
            });
            document.body.addClass('omni-word-printing');
            printRoot.append(container);
            try {
                await waitForImages(container);
                window.print();
            } finally {
                document.body.removeClass('omni-word-printing');
                const insertionPoint = nextSibling?.parentNode === parent ? nextSibling : null;
                parent.insertBefore(container, insertionPoint);
                printRoot.remove();
            }
        }
    };
}

/** Best-effort: let embedded images decode so they are not dropped from the print. */
async function waitForImages(root: ParentNode): Promise<void> {
    const images = Array.from(root.querySelectorAll<HTMLImageElement>('img')).filter(
        (image) => !image.complete
    );
    if (!images.length) return;
    await Promise.race([
        Promise.all(
            images.map(
                (image) =>
                    new Promise<void>((resolve) => {
                        image.addEventListener('load', () => resolve(), { once: true });
                        image.addEventListener('error', () => resolve(), { once: true });
                    })
            )
        ),
        new Promise<void>((resolve) => window.setTimeout(resolve, 3000))
    ]);
}

function coreHostContext(container: HTMLElement): WordViewerContext {
    const ctx: WordViewerContext = {
        assets: {
            // The word viewer bundles no external assets.
            resolveAssetUrl: async (assetPath: string) => assetPath
        },
        i18n: {
            t: (key, args) => resolveCatalogMessage(key, args)
        },
        logger: {
            log: (level, message) => {
                const prefix = '[omni-viewer word]';
                if (level === 'error') console.error(prefix, message);
                else if (level === 'warn') console.warn(prefix, message);
            }
        }
    };
    // Obsidian mobile has no print pipeline; leaving the service off makes the
    // core disable the button with an explanatory tooltip.
    if (!Platform.isMobileApp) ctx.print = createPrintService(container);
    return ctx;
}

async function renderWord(ctx: RenderContext): Promise<void> {
    if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
        throw new Error('Host does not support direct DOM mounting');
    }
    const buffer = await ctx.app.vault.readBinary(ctx.file);
    const container = ctx.host.provideDomContainer();
    const handle = await mountWordViewer(
        { fileName: ctx.fileName, data: new Uint8Array(buffer) },
        container,
        coreHostContext(container),
        wordDeps,
        { styleIsolation: 'scoped' }
    );
    ctx.host.setCoreViewerHandle(handle);
}

export const wordViewer: ViewerDefinition = {
    viewType: 'omni-viewer.wordViewer',
    displayName: 'Word Viewer',
    extensions: ['docx', 'doc'],
    icon: 'file-type',
    errorContent: {
        title: 'Failed to load Word file',
        message: 'Unable to load the file:',
        icon: '📄'
    },
    render: renderWord
};

/**
 * Mobile keeps the previous .docx-only registration. The core parses legacy
 * .doc from bytes (no filesystem or LibreOffice dependency), so lifting this
 * is possible, but it would widen mobile support beyond the migration.
 */
export const mobileWordViewer: ViewerDefinition = {
    ...wordViewer,
    extensions: ['docx'],
    errorContent: {
        title: 'Failed to load DOCX file',
        message: 'Unable to render this document on mobile:',
        icon: 'file-type'
    }
};
