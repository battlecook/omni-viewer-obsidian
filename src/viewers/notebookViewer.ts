// Jupyter Notebook viewer — Obsidian adapter over omni-viewer-core.
// Static renderer dependencies are bundled into main.js for offline/mobile use.

import createDOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import katex from 'katex';
import { Marked } from 'marked';
import { normalizePath, TFile } from 'obsidian';
import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import {
    mountNotebookViewer,
    type NotebookViewerContext,
    type NotebookViewerDeps
} from 'omni-viewer-core/viewers/notebook';
import { openExternal } from '../platform';
import { RenderContext, ViewerDefinition } from '../viewerCore';

// Match core's input limit and reject oversized notebooks before reading them.
const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const markdown = new Marked({ async: false, gfm: true });
const purifierFactory = createDOMPurify as unknown as NotebookViewerDeps['createDOMPurify'];

const notebookDeps: NotebookViewerDeps = {
    render: { parse: (source) => markdown.parse(source, { async: false }) },
    createDOMPurify: (window) => purifierFactory(window),
    highlighter: hljs,
    math: {
        renderToHtml: (source, displayMode) => katex.renderToString(source, {
            displayMode,
            throwOnError: false,
            output: 'htmlAndMathml',
            trust: false
        })
    }
};

function coreHostContext(ctx: RenderContext): NotebookViewerContext {
    const root = ctx.file.parent?.path ?? '';
    const rootPrefix = root ? `${root}/` : '';
    return {
        assets: { resolveAssetUrl: async (assetPath) => assetPath },
        i18n: { t: (key, args) => resolveCatalogMessage(key, args) },
        logger: {
            log: (level, message) => {
                const prefix = '[omni-viewer notebook]';
                if (level === 'error') console.error(prefix, message);
                else if (level === 'warn') console.warn(prefix, message);
            }
        },
        navigation: {
            openExternalUrl: async (url) => { openExternal(url); }
        },
        documentAssets: {
            resolve: async (assetPath) => {
                let relativePath: string;
                try { relativePath = decodeURIComponent(assetPath); }
                catch { return null; }
                // Core validates relative references; keep the vault boundary
                // here as well before asking the adapter for a resource URL.
                if (!relativePath || relativePath !== relativePath.trim()
                    || /[\u0000-\u001f\u007f\\]/.test(relativePath)
                    || /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(relativePath)
                    || relativePath.split('/').includes('..')) return null;
                relativePath = relativePath.split('/').filter((part) => part && part !== '.').join('/');
                const targetPath = normalizePath(`${rootPrefix}${relativePath}`);
                if (rootPrefix && !targetPath.startsWith(rootPrefix)) return null;
                const target = ctx.app.vault.getAbstractFileByPath(targetPath);
                if (!(target instanceof TFile)
                    || !/^(?:png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i.test(target.extension)) return null;
                return {
                    url: ctx.app.vault.adapter.getResourcePath(target.path),
                    // Vault resource URLs are persistent, not transient blobs.
                    dispose() {}
                };
            }
        }
    };
}

export const notebookViewer: ViewerDefinition = {
    viewType: 'omni-viewer.notebookViewer',
    displayName: 'Jupyter Notebook Viewer',
    extensions: ['ipynb'],
    icon: 'notebook',
    errorContent: {
        title: 'Failed to load Jupyter Notebook',
        message: 'Unable to parse or render this notebook:',
        icon: '📓'
    },
    async render(ctx) {
        if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
            throw new Error('Host does not support direct DOM mounting');
        }
        if (ctx.signal?.aborted) return;
        if (ctx.file.stat.size > MAX_INPUT_BYTES) {
            throw new Error(
                `Jupyter Notebooks above ${MAX_INPUT_BYTES / (1024 * 1024)} MB cannot be opened: `
                + 'the notebook has to be read into memory in full.'
            );
        }

        const data = new Uint8Array(await ctx.app.vault.readBinary(ctx.file));
        if (ctx.signal?.aborted) return;
        const container = ctx.host.provideDomContainer();
        const handle = await mountNotebookViewer(
            { fileName: ctx.fileName, data, lastModified: ctx.file.stat.mtime },
            container,
            coreHostContext(ctx),
            notebookDeps,
            {
                signal: ctx.signal,
                limits: { maxInputBytes: MAX_INPUT_BYTES },
                // Obsidian loads viewer and KaTeX rules from styles.css.
                styleIsolation: 'scoped'
            }
        );
        if (ctx.signal?.aborted) {
            handle.dispose();
            return;
        }
        ctx.host.setCoreViewerHandle(handle);
    }
};
