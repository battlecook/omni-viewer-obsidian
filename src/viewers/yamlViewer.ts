import * as fs from 'fs';
import { buildYamlViewerModel } from '../utils/yamlNodeBuilder';
import { FileUtils } from '../utils/fileUtils';
import { TemplateUtils } from '../utils/templateUtils';
import { ViewerDefinition } from '../viewerCore';

export const yamlViewer: ViewerDefinition = {
    viewType: 'omni-viewer.yamlViewer',
    displayName: 'YAML Viewer',
    extensions: ['yaml', 'yml'],
    icon: 'file-code',
    errorContent: {
        title: 'Failed to load YAML file',
        message: 'Unable to parse the YAML file due to an error:',
        icon: 'YAML'
    },
    async render(ctx) {
        const [source, fileSize] = await Promise.all([
            fs.promises.readFile(ctx.filePath, 'utf8'),
            FileUtils.getFileSize(ctx.filePath)
        ]);
        const model = buildYamlViewerModel(source, fileSize);
        const html = await TemplateUtils.loadTemplate(ctx.templatesDir, 'yaml/yamlViewer.html', {
            fileName: ctx.fileName,
            yamlModel: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(model))
        });

        ctx.host.setHtml(html);
        // vscode had editor-selection sync + revealSource jumping into the text
        // editor; Obsidian has no parallel text editor for the same leaf, so
        // revealSource is accepted and ignored.
        ctx.host.setupDefaultMessages({
            revealSource: () => { /* no text editor to reveal in Obsidian */ }
        });
    }
};
