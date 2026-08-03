import * as fs from '../shims/desktopFs';
import * as path from '../shims/desktopPath';
import mermaid from 'mermaid';
import { render as renderPlantUmlSvg } from 'puml-canvas-js';
import { Platform } from 'obsidian';
import { mountMermaidViewer, type MermaidViewerContext } from 'omni-viewer-core/viewers/mermaid';
import { mountPlantUmlViewer } from 'omni-viewer-core/viewers/plantuml';
import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import { FileUtils } from '../utils/fileUtils';
import { MessageHandler } from '../utils/messageHandler';
import { WebviewMessage } from '../utils/messageHandlers/types';
import { TemplateUtils } from '../utils/templateUtils';
import { showSaveDialog } from '../platform';
import { saveBinaryBesideFile } from '../utils/vaultFiles';
import { RenderContext, ViewerDefinition } from '../viewerCore';

/**
 * Shared wiring for the markdown viewer: the template can push edited source
 * back with a `saveSource` message and expects a `saveSourceResult` reply;
 * everything else goes to the shared MessageHandler.
 */
function setupSaveSourceMessages(ctx: RenderContext): void {
    ctx.host.onMessage(async (message: WebviewMessage) => {
        if (!message) {
            return;
        }

        if (message?.type !== 'saveSource' || typeof message.source !== 'string') {
            await MessageHandler.handleWebviewMessage(message, {
                app: ctx.app,
                file: ctx.file,
                absPath: ctx.filePath,
                postMessage: (m) => ctx.host.postMessage(m),
                reopen: async () => { /* not applicable */ }
            });
            return;
        }

        try {
            await ctx.app.vault.modify(ctx.file, message.source);
            ctx.host.postMessage({ type: 'saveSourceResult', ok: true });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            ctx.host.postMessage({
                type: 'saveSourceResult',
                ok: false,
                message: errorMessage
            });
        }
    });
}

export const markdownViewer: ViewerDefinition = {
    viewType: 'omni-viewer.markdownViewer',
    displayName: 'Markdown Viewer',
    extensions: ['md', 'markdown'],
    icon: 'file-text',
    errorContent: {
        title: 'Failed to load Markdown file',
        message: 'Unable to render the Markdown file due to an error:',
        icon: 'MD'
    },
    async render(ctx) {
        setupSaveSourceMessages(ctx);

        const [source, fileSize] = await Promise.all([
            fs.promises.readFile(ctx.filePath, 'utf8'),
            FileUtils.getFileSize(ctx.filePath)
        ]);
        const html = await TemplateUtils.loadTemplate(ctx.templatesDir, 'markdown/markdownViewer.html', {
            fileName: ctx.fileName,
            fileSize,
            markdownSource: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(source))
        }, ctx.host);

        ctx.host.setHtml(html);
    }
};

// ---------------------------------------------------------------------------
// Mermaid / PlantUML — Obsidian adapters over omni-viewer-core.
//
// Both mount the core DOM diagram viewer (source editor + live preview + theme/
// zoom/copy/save) directly into the view content, replacing the previous
// webview-template bundles. Style isolation comes from the core's shadow-root
// mount; theme mapping (--omni-* <- Obsidian variables) lives in styles.css.
//
// The renderers are passed explicitly rather than via the core's
// `loadMermaidRenderer()` / `loadPlantUmlRenderer()` helpers: those use
// non-literal dynamic imports (`import('mermaid' as string)`) that esbuild
// cannot follow into the single-file plugin bundle (same reason as the Word
// viewer's explicit deps).
// ---------------------------------------------------------------------------

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

function isDarkTheme(): boolean {
    return document.body.classList.contains('theme-dark');
}

// Mermaid honors four named themes; re-initialize only when the theme changes,
// matching the core self-loader. Lazy so the plugin does not pay mermaid's init
// cost until a diagram is actually opened.
const MERMAID_BASE = { startOnLoad: false, securityLevel: 'strict', maxTextSize: 200_000, htmlLabels: false } as const;
let mermaidBaseReady = false;
let mermaidTheme: string | undefined;

async function renderMermaid(id: string, source: string, theme?: string): Promise<string> {
    if (!mermaidBaseReady) {
        mermaid.initialize(MERMAID_BASE);
        mermaidBaseReady = true;
    }
    if (theme && theme !== mermaidTheme) {
        mermaidTheme = theme;
        mermaid.initialize({ ...MERMAID_BASE, theme: theme as 'default' | 'dark' | 'forest' | 'neutral' });
    }
    return (await mermaid.render(id, source)).svg;
}

// PlantUML supports only 'light'/'dark'; the core only ever hands those through
// for this kind, so the cast is safe.
function renderPlantUml(source: string, doc: Document, theme?: string): SVGElement {
    return renderPlantUmlSvg(source, theme ? { document: doc, theme: theme as 'light' | 'dark' } : { document: doc });
}

/** Host services shared by both diagram viewers: clipboard, in-place writeback
 *  (edited source -> vault), and a desktop "save a copy" fallback. */
function diagramHostContext(
    ctx: RenderContext,
    logLabel: string,
    saveFilter: { name: string; extensions: string[] }
): MermaidViewerContext {
    const { app, file, filePath, host } = ctx;
    const context: MermaidViewerContext = {
        assets: {
            resolveAssetUrl: async (assetPath: string) => assetPath
        },
        i18n: {
            t: (key, args) => resolveCatalogMessage(key, args)
        },
        logger: {
            log: (level, message) => {
                const prefix = `[omni-viewer ${logLabel}]`;
                if (level === 'error') console.error(prefix, message);
                else if (level === 'warn') console.warn(prefix, message);
            }
        }
    };
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
        context.clipboard = {
            writeText: (text: string) => navigator.clipboard.writeText(text)
        };
    }
    context.writeback = {
        write: async (data) => {
            host.markInternalWrite?.();
            await app.vault.modifyBinary(file, toArrayBuffer(data));
        }
    };
    context.save = {
        saveFile: async (name, data) => {
            if (Platform.isMobileApp) {
                await saveBinaryBesideFile(app, file, name, data);
                return;
            }
            const targetPath = await showSaveDialog(
                path.join(path.dirname(filePath), name),
                [saveFilter]
            );
            if (!targetPath) return;
            await fs.promises.writeFile(targetPath, data);
        }
    };
    return context;
}

export const mermaidViewer: ViewerDefinition = {
    viewType: 'omni-viewer.mermaidViewer',
    displayName: 'Mermaid Viewer',
    extensions: ['mmd', 'mermaid'],
    icon: 'git-fork',
    errorContent: {
        title: 'Failed to load Mermaid file',
        message: 'Unable to render the Mermaid diagram due to an error:',
        icon: 'M'
    },
    async render(ctx) {
        if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
            throw new Error('Host does not support direct DOM mounting');
        }
        const buffer = await ctx.app.vault.readBinary(ctx.file);
        const container = ctx.host.provideDomContainer();
        const handle = await mountMermaidViewer(
            { fileName: ctx.fileName, data: new Uint8Array(buffer) },
            container,
            diagramHostContext(ctx, 'mermaid', { name: 'Mermaid', extensions: ['mmd', 'mermaid'] }),
            { renderMermaid, initialTheme: isDarkTheme() ? 'dark' : 'default' }
        );
        ctx.host.setCoreViewerHandle(handle);
    }
};

export const plantumlViewer: ViewerDefinition = {
    viewType: 'omni-viewer.plantumlViewer',
    displayName: 'PlantUML Viewer',
    extensions: ['puml', 'plantuml', 'iuml'],
    icon: 'workflow',
    errorContent: {
        title: 'Failed to load PlantUML file',
        message: 'Unable to render the PlantUML diagram due to an error:',
        icon: 'P'
    },
    async render(ctx) {
        if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
            throw new Error('Host does not support direct DOM mounting');
        }
        const buffer = await ctx.app.vault.readBinary(ctx.file);
        const container = ctx.host.provideDomContainer();
        const handle = await mountPlantUmlViewer(
            { fileName: ctx.fileName, data: new Uint8Array(buffer) },
            container,
            diagramHostContext(ctx, 'plantuml', { name: 'PlantUML', extensions: ['puml', 'plantuml', 'iuml'] }),
            { renderPlantUml, initialTheme: isDarkTheme() ? 'dark' : 'light' }
        );
        ctx.host.setCoreViewerHandle(handle);
    }
};

export const protoViewer: ViewerDefinition = {
    viewType: 'omni-viewer.protoViewer',
    displayName: 'Proto Viewer',
    extensions: ['proto'],
    icon: 'file-code-2',
    errorContent: {
        title: 'Failed to load Proto file',
        message: 'Unable to parse the proto file due to an error:',
        icon: '{}'
    },
    async render(ctx) {
        const { parseProto } = await import('../utils/protoParser');
        const source = await fs.promises.readFile(ctx.filePath, 'utf8');
        const model = parseProto(source, ctx.fileName);
        const html = await TemplateUtils.loadTemplate(ctx.templatesDir, 'proto/protoViewer.html', {
            fileName: ctx.fileName,
            protoSource: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(source)),
            protoModel: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(model))
        });

        ctx.host.setHtml(html);
        ctx.host.setupDefaultMessages();
    }
};
