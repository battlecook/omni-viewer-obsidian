import * as fs from 'fs';
import * as path from 'path';
import { FileUtils } from '../utils/fileUtils';
import { TemplateUtils } from '../utils/templateUtils';
import { ViewerDefinition } from '../viewerCore';

export const excelViewer: ViewerDefinition = {
    viewType: 'omni-viewer.excelViewer',
    displayName: 'Excel Viewer',
    extensions: ['xlsx', 'xls'],
    icon: 'sheet',
    errorContent: {
        title: 'Failed to load Excel file',
        message: 'Unable to load the Excel file due to an error:',
        icon: '📊'
    },
    async render(ctx) {
        const excelContent = await FileUtils.readExcelFile(ctx.filePath);
        const excelData = JSON.stringify(excelContent);

        const html = await TemplateUtils.loadTemplate(ctx.templatesDir, 'excel/excelViewer.html', {
            fileName: ctx.fileName,
            excelData: excelData
        });

        ctx.host.setHtml(html);
        ctx.host.setupDefaultMessages();
    }
};

function formatFileSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) {
        return '';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }

    const precision = size >= 100 || unitIndex === 0 ? 0 : 1;
    return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

export const hwpViewer: ViewerDefinition = {
    viewType: 'omni-viewer.hwpViewer',
    displayName: 'HWP Viewer',
    extensions: ['hwp', 'hwpx'],
    icon: 'file-text',
    errorContent: {
        title: 'HWP 파일을 불러올 수 없습니다',
        message: '파일을 로드하는 중 오류가 발생했습니다:',
        icon: '📄',
        lang: 'ko'
    },
    async render(ctx) {
        const stats = await fs.promises.stat(ctx.filePath);
        const payload = TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify({
            fileName: ctx.fileName,
            fileSize: formatFileSize(stats.size),
            documentUri: ctx.host.asWebviewUri(ctx.filePath),
            rhwpModuleUri: ctx.host.asWebviewUri(path.join(ctx.templatesDir, 'hwp', 'vendor', 'rhwp', 'rhwp.js')),
            rhwpWasmUri: ctx.host.asWebviewUri(path.join(ctx.templatesDir, 'hwp', 'vendor', 'rhwp', 'rhwp_bg.wasm'))
        }));

        const html = await TemplateUtils.loadTemplate(ctx.templatesDir, 'hwp/hwpViewer.html', {
            fileName: ctx.fileName,
            hwpPayload: payload,
            fileSize: formatFileSize(stats.size)
        });

        ctx.host.setHtml(html);
        ctx.host.setupDefaultMessages();
    }
};

export const psdViewer: ViewerDefinition = {
    viewType: 'omni-viewer.psdViewer',
    displayName: 'PSD Viewer',
    extensions: ['psd'],
    icon: 'image',
    errorContent: {
        title: 'Failed to load PSD file',
        message: 'Unable to load the PSD file due to an error:',
        icon: '🖼️'
    },
    async render(ctx) {
        const buffer = await fs.promises.readFile(ctx.filePath);
        const psdBase64 = buffer.toString('base64');
        const fileSize = await FileUtils.getFileSize(ctx.filePath);

        const agPsdScriptUri = ctx.host.asWebviewUri(path.join(ctx.templatesDir, 'psd', 'vendor', 'ag-psd.bundle.js'));

        const html = await TemplateUtils.loadTemplate(ctx.templatesDir, 'psd/psdViewer.html', {
            fileName: ctx.fileName,
            psdBase64,
            fileSize,
            agPsdScriptUri: agPsdScriptUri
        });

        ctx.host.setHtml(html);
        ctx.host.setupDefaultMessages();
    }
};
