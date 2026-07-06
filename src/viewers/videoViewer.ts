import { FileUtils } from '../utils/fileUtils';
import { TemplateUtils } from '../utils/templateUtils';
import { ViewerDefinition } from '../viewerCore';

export const videoViewer: ViewerDefinition = {
    viewType: 'omni-viewer.videoViewer',
    displayName: 'Video Viewer',
    extensions: ['mp4', 'mts', 'm2ts', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv'],
    icon: 'clapperboard',
    errorContent: {
        title: 'Failed to load video file',
        message: 'Unable to load the video file due to an error:',
        icon: '🎬'
    },
    async render(ctx) {
        const mimeType = FileUtils.getVideoMimeType(ctx.filePath);
        const videoData = await FileUtils.fileToDataUrl(ctx.filePath, mimeType);
        const fileSize = await FileUtils.getFileSize(ctx.filePath);

        const html = await TemplateUtils.loadTemplate(ctx.templatesDir, 'videoViewer.html', {
            fileName: ctx.fileName,
            videoSrc: videoData,
            mimeType: mimeType,
            fileSize: fileSize
        });

        ctx.host.setHtml(html);
        ctx.host.setupDefaultMessages();
    }
};
