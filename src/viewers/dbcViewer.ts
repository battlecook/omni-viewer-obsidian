import * as fs from 'fs';
import { DbcParser } from '../utils/dbcParser';
import { TemplateUtils } from '../utils/templateUtils';
import { ViewerDefinition } from '../viewerCore';

export const dbcViewer: ViewerDefinition = {
    viewType: 'omni-viewer.dbcViewer',
    displayName: 'DBC Viewer',
    extensions: ['dbc'],
    icon: 'network',
    errorContent: {
        title: 'Failed to load DBC file',
        message: 'Unable to parse the DBC file due to an error:',
        icon: 'DBC'
    },
    async render(ctx) {
        const source = await fs.promises.readFile(ctx.filePath, 'utf8');
        const model = DbcParser.parse(source);
        const html = await TemplateUtils.loadTemplate(ctx.templatesDir, 'dbc/dbcViewer.html', {
            fileName: ctx.fileName,
            dbcSource: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(source)),
            dbcModel: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(model))
        });

        ctx.host.setHtml(html);
        ctx.host.setupDefaultMessages();
    }
};
