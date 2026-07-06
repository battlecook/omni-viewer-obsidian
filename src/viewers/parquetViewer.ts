import { FileUtils } from '../utils/fileUtils';
import { TemplateUtils } from '../utils/templateUtils';
import { WebviewMessage } from '../utils/messageHandlers/types';
import { ViewerDefinition } from '../viewerCore';

const PREVIEW_ROW_COUNT = 10000;

export const parquetViewer: ViewerDefinition = {
    viewType: 'omni-viewer.parquetViewer',
    displayName: 'Parquet Viewer',
    extensions: ['parquet'],
    icon: 'table-2',
    errorContent: {
        title: 'Failed to load Parquet file',
        message: 'Unable to load the Parquet file due to an error:',
        icon: '📊'
    },
    async render(ctx) {
        const parquetContent = await FileUtils.readParquetFile(ctx.filePath);
        const parquetData = TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(parquetContent));
        let loadedRows = parquetContent.totalRows;

        const html = await TemplateUtils.loadTemplate(ctx.templatesDir, 'parquet/parquetViewer.html', {
            fileName: ctx.fileName,
            parquetData: parquetData
        });

        ctx.host.setHtml(html);
        ctx.host.setupDefaultMessages({
            loadMoreParquet: async (_message: WebviewMessage) => {
                const nextParquetContent = await FileUtils.readParquetFile(ctx.filePath, {
                    rowStart: loadedRows,
                    rowEnd: loadedRows + PREVIEW_ROW_COUNT
                });

                loadedRows += nextParquetContent.totalRows;
                ctx.host.postMessage({
                    type: 'appendData',
                    data: nextParquetContent
                });
            }
        });
    }
};
