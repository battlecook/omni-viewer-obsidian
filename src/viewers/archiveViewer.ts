import { FileUtils } from '../utils/fileUtils';
import { MessageHandler } from '../utils/messageHandler';
import { TemplateUtils } from '../utils/templateUtils';
import { ViewerDefinition } from '../viewerCore';

export const archiveViewer: ViewerDefinition = {
    viewType: 'omni-viewer.archiveViewer',
    displayName: 'Archive Viewer',
    extensions: ['zip', 'rar', '7z', 'dmg', 'jar', 'apk', 'tar', 'tgz', 'gz', 'tbz2', 'bz2', 'txz', 'xz'],
    icon: 'folder-archive',
    errorContent: {
        title: 'Failed to load archive file',
        message: 'Unable to inspect the archive contents due to an error:',
        icon: '🗜️'
    },
    async render(ctx) {
        const archiveContent = await FileUtils.readArchiveFile(ctx.filePath);
        const html = await TemplateUtils.loadTemplate(ctx.templatesDir, 'archive/archiveViewer.html', {
            fileName: ctx.fileName,
            archiveData: JSON.stringify(archiveContent)
        });

        ctx.host.setHtml(html);
        ctx.host.onMessage(async (message: any) => {
            if (!message) {
                return;
            }

            if (message.type !== 'requestEntryPreview' || typeof message.path !== 'string') {
                await MessageHandler.handleWebviewMessage(message, {
                    app: ctx.app,
                    file: ctx.file,
                    absPath: ctx.filePath,
                    postMessage: (m) => ctx.host.postMessage(m),
                    reopen: async () => { /* not applicable for archives */ }
                });
                return;
            }

            const selectedEntry = archiveContent.entries.find((entry) => entry.path === message.path);
            if (!selectedEntry) {
                ctx.host.postMessage({
                    type: 'entryPreview',
                    path: message.path,
                    status: 'error',
                    message: 'The selected entry is no longer available in the preview list.'
                });
                return;
            }

            if (selectedEntry.kind === 'directory') {
                ctx.host.postMessage({
                    type: 'entryPreview',
                    path: selectedEntry.path,
                    status: 'unsupported',
                    message: 'Directory entries do not have inline content to preview.'
                });
                return;
            }

            const preview = await FileUtils.readArchiveEntryPreview(ctx.filePath, selectedEntry.path);
            ctx.host.postMessage({
                type: 'entryPreview',
                ...preview
            });
        });
    }
};
