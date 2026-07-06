import { FileUtils } from '../utils/fileUtils';
import { TemplateUtils } from '../utils/templateUtils';
import { ViewerDefinition } from '../viewerCore';

export const csvViewer: ViewerDefinition = {
    viewType: 'omni-viewer.csvViewer',
    displayName: 'CSV Viewer',
    extensions: ['csv', 'tsv'],
    icon: 'table',
    errorContent: {
        title: 'Failed to load CSV file',
        message: 'Unable to load the CSV file due to an error:',
        icon: '📊'
    },
    async render(ctx) {
        const csvContent = await FileUtils.readCsvFile(ctx.filePath);
        const csvData = JSON.stringify(csvContent);

        const html = await TemplateUtils.loadTemplate(ctx.templatesDir, 'csv/csvViewer.html', {
            fileName: ctx.fileName,
            csvData: csvData
        });

        ctx.host.setHtml(html);
        ctx.host.setupDefaultMessages();
    }
};
