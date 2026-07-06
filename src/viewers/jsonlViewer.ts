import { FileUtils } from '../utils/fileUtils';
import { TemplateUtils } from '../utils/templateUtils';
import { WebviewMessage } from '../utils/messageHandlers/types';
import { ViewerDefinition } from '../viewerCore';

const PREVIEW_LIMIT_BYTES = 1 * 1024 * 1024;

export const jsonlViewer: ViewerDefinition = {
    viewType: 'omni-viewer.jsonlViewer',
    displayName: 'JSONL Viewer',
    extensions: ['jsonl', 'ndjson', 'jsonlines'],
    icon: 'list',
    errorContent: {
        title: 'Failed to load JSONL file',
        message: 'Unable to load the JSONL file due to an error:',
        icon: '📄'
    },
    async render(ctx) {
        const jsonlContent = await FileUtils.readJsonlFilePreview(ctx.filePath, PREVIEW_LIMIT_BYTES);
        let loadedBytes = jsonlContent.loadedBytes;
        const html = await TemplateUtils.loadTemplate(ctx.templatesDir, 'jsonl/jsonlViewer.html', {
            fileName: ctx.fileName,
            jsonlData: JSON.stringify(jsonlContent)
        });

        ctx.host.setHtml(html);
        ctx.host.setupDefaultMessages({
            loadMoreJsonl: async (_message: WebviewMessage) => {
                const nextPreviewBytes = Math.min(loadedBytes + PREVIEW_LIMIT_BYTES, jsonlContent.totalBytes);
                const nextJsonlContent = await FileUtils.readJsonlFilePreview(ctx.filePath, nextPreviewBytes);
                loadedBytes = nextJsonlContent.loadedBytes;
                ctx.host.postMessage({
                    type: 'updateData',
                    data: nextJsonlContent
                });
            },
            loadAllJsonl: async (_message: WebviewMessage) => {
                const fullJsonlContent = await FileUtils.readJsonlFile(ctx.filePath);
                loadedBytes = jsonlContent.totalBytes;
                ctx.host.postMessage({
                    type: 'updateData',
                    data: {
                        ...fullJsonlContent,
                        isPreview: false,
                        previewBytes: PREVIEW_LIMIT_BYTES,
                        loadedBytes,
                        totalBytes: jsonlContent.totalBytes,
                        hasMoreContent: false
                    }
                });
            }
        });
    }
};
