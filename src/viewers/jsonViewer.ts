import { FileUtils } from '../utils/fileUtils';
import { TemplateUtils } from '../utils/templateUtils';
import { ViewerDefinition } from '../viewerCore';

export const jsonViewer: ViewerDefinition = {
    viewType: 'omni-viewer.jsonViewer',
    displayName: 'JSON Viewer',
    extensions: ['json'],
    icon: 'braces',
    errorContent: {
        title: 'Failed to load JSON file',
        message: 'Unable to parse the JSON file due to an error:',
        icon: '🧾'
    },
    async render(ctx) {
        const jsonContent = await FileUtils.readJsonFile(ctx.filePath);
        const html = await TemplateUtils.loadTemplate(ctx.templatesDir, 'json/jsonViewer.html', {
            fileName: ctx.fileName,
            formattedJson: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(jsonContent.formattedJson))
        });

        ctx.host.setHtml(html);
        ctx.host.setupDefaultMessages();
    }
};
