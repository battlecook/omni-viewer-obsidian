import * as fs from 'fs';
import * as path from 'path';
import { FileUtils } from '../utils/fileUtils';
import { MessageHandler } from '../utils/messageHandler';
import { TemplateUtils } from '../utils/templateUtils';
import { RenderContext, ViewerDefinition } from '../viewerCore';

/**
 * Shared wiring for the markdown/mermaid/plantuml viewers: the template can
 * push edited source back with a `saveSource` message and expects a
 * `saveSourceResult` reply; everything else goes to the shared MessageHandler.
 */
function setupSaveSourceMessages(ctx: RenderContext): void {
    ctx.host.onMessage(async (message: any) => {
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
        setupSaveSourceMessages(ctx);

        const [source, fileSize] = await Promise.all([
            fs.promises.readFile(ctx.filePath, 'utf8'),
            FileUtils.getFileSize(ctx.filePath)
        ]);
        const html = await TemplateUtils.loadTemplate(ctx.templatesDir, 'mermaid/mermaidViewer.html', {
            fileName: ctx.fileName,
            fileSize,
            mermaidSource: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(source))
        }, ctx.host);

        ctx.host.setHtml(html);
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
        setupSaveSourceMessages(ctx);

        // Strip the ?mtime cache-buster: this URI is used as a base for joining
        // further relative asset paths inside the template.
        const templateBaseUri = ctx.host.asWebviewUri(path.join(ctx.templatesDir, 'plantuml')).split('?')[0];
        const [source, fileSize] = await Promise.all([
            fs.promises.readFile(ctx.filePath, 'utf8'),
            FileUtils.getFileSize(ctx.filePath)
        ]);
        const html = await TemplateUtils.loadTemplate(ctx.templatesDir, 'plantuml/plantumlViewer.html', {
            fileName: ctx.fileName,
            fileNameJson: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(ctx.fileName)),
            fileSize,
            fileSizeJson: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(fileSize)),
            plantumlSource: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(source)),
            plantumlTemplateBase: templateBaseUri.replace(/\/?$/, '/')
        });

        ctx.host.setHtml(html);
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
