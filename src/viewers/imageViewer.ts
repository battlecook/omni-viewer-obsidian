import { FileSystemAdapter } from 'obsidian';
import { FileUtils } from '../utils/fileUtils';
import { TemplateUtils } from '../utils/templateUtils';
import { ViewerDefinition } from '../viewerCore';

export const imageViewer: ViewerDefinition = {
    viewType: 'omni-viewer.imageViewer',
    displayName: 'Image Viewer',
    extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'],
    icon: 'image',
    errorContent: {
        title: 'Failed to load image file',
        message: 'Unable to load the image file due to an error:',
        icon: '🖼️'
    },
    async render(ctx) {
        const mimeType = FileUtils.getImageMimeType(ctx.filePath);
        const imageData = await FileUtils.fileToDataUrl(ctx.filePath, mimeType);
        const fileSize = await FileUtils.getFileSize(ctx.filePath);

        const adapter = ctx.app.vault.adapter;
        const workspacePath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '';

        const html = await TemplateUtils.loadTemplate(ctx.templatesDir, 'image/imageViewer.html', {
            fileName: ctx.fileName,
            imageSrc: imageData,
            fileSize: fileSize,
            workspacePath: workspacePath
        });

        ctx.host.setHtml(html);
        ctx.host.setupDefaultMessages();
    }
};
