import * as fs from 'fs';
import { TomlParser } from '../utils/tomlParser';
import { TemplateUtils } from '../utils/templateUtils';
import { ViewerDefinition } from '../viewerCore';

export const tomlViewer: ViewerDefinition = {
    viewType: 'omni-viewer.tomlViewer',
    displayName: 'TOML Viewer',
    extensions: ['toml'],
    icon: 'file-cog',
    errorContent: {
        title: 'Failed to load TOML file',
        message: 'Unable to parse the TOML file due to an error:',
        icon: 'T'
    },
    async render(ctx) {
        const source = await fs.promises.readFile(ctx.filePath, 'utf8');
        const parsed = TomlParser.parse(source);
        const html = await TemplateUtils.loadTemplate(ctx.templatesDir, 'toml/tomlViewer.html', {
            fileName: ctx.fileName,
            tomlSource: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(source)),
            tomlModel: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(parsed))
        });

        ctx.host.setHtml(html);
        ctx.host.setupDefaultMessages();
    }
};
