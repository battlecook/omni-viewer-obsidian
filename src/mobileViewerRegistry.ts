import { Buffer } from 'buffer';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { normalizePath, Notice, TFile } from 'obsidian';
import { mountArchiveViewer, type ArchiveViewerContext } from 'omni-viewer-core/viewers/archive';
import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import { buildYamlViewerModel } from './utils/yamlNodeBuilder';
import { DbcParser } from './utils/dbcParser';
import { parseProto } from './utils/protoParser';
import { TemplateUtils } from './utils/templateUtils';
import { TomlParser } from './utils/tomlParser';
import { ViewerDefinition } from './viewerCore';
import { csvViewer } from './viewers/csvViewer';
import { jsonViewer } from './viewers/jsonViewer';
import { pdfViewer } from './viewers/pdfViewer';
import { pptViewer } from './viewers/pptViewer';
import { safetensorsViewer } from './viewers/safetensorsViewer';
import { mobileWordViewer } from './viewers/wordViewer';
import { saveBinaryBesideFile } from './utils/vaultFiles';
import { confirmDialog } from './platform';

const MAX_MOBILE_DOCUMENT_BYTES = 50 * 1024 * 1024;

function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index++;
    }
    return `${value.toFixed(index === 0 || value >= 100 ? 0 : 1)} ${units[index]}`;
}

function mimeFor(extension: string, category: 'image' | 'video' | 'audio'): string {
    const values: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
        bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml',
        mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v',
        mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
        aac: 'audio/aac', m4a: 'audio/mp4', aiff: 'audio/aiff', aif: 'audio/aiff'
    };
    return values[extension] ?? `${category}/*`;
}

async function readText(ctx: Parameters<ViewerDefinition['render']>[0]): Promise<string> {
    return await ctx.app.vault.cachedRead(ctx.file);
}

async function saveSourceMessages(ctx: Parameters<ViewerDefinition['render']>[0]): Promise<void> {
    ctx.host.onMessage(async (message) => {
        if (message.type !== 'saveSource' || typeof message.source !== 'string') return;
        try {
            await ctx.app.vault.modify(ctx.file, message.source);
            ctx.host.postMessage({ type: 'saveSourceResult', ok: true });
        } catch (error) {
            ctx.host.postMessage({
                type: 'saveSourceResult',
                ok: false,
                message: error instanceof Error ? error.message : String(error)
            });
        }
    });
}

function simpleTextViewer(options: {
    viewType: string;
    displayName: string;
    extensions: string[];
    icon: string;
    template: string;
    variables(source: string, ctx: Parameters<ViewerDefinition['render']>[0]): Record<string, string>;
    editable?: boolean;
}): ViewerDefinition {
    return {
        viewType: options.viewType,
        displayName: options.displayName,
        extensions: options.extensions,
        icon: options.icon,
        errorContent: {
            title: `Failed to load ${options.displayName}`,
            message: 'Unable to read or parse this vault file:',
            icon: options.icon
        },
        async render(ctx) {
            const source = await readText(ctx);
            if (options.editable) await saveSourceMessages(ctx);
            const html = await TemplateUtils.loadTemplate(
                ctx.templatesDir,
                options.template,
                options.variables(source, ctx),
                ctx.host
            );
            ctx.host.setHtml(html);
        }
    };
}

const yamlViewer = simpleTextViewer({
    viewType: 'omni-viewer.yamlViewer', displayName: 'YAML Viewer', extensions: ['yaml', 'yml'], icon: 'file-code',
    template: 'yaml/yamlViewer.html',
    variables: (source, ctx) => ({
        fileName: ctx.fileName,
        yamlModel: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(buildYamlViewerModel(source, formatBytes(ctx.file.stat.size))))
    })
});

const tomlViewer = simpleTextViewer({
    viewType: 'omni-viewer.tomlViewer', displayName: 'TOML Viewer', extensions: ['toml'], icon: 'file-cog',
    template: 'toml/tomlViewer.html',
    variables: (source, ctx) => ({
        fileName: ctx.fileName,
        tomlSource: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(source)),
        tomlModel: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(TomlParser.parse(source)))
    })
});

const dbcViewer = simpleTextViewer({
    viewType: 'omni-viewer.dbcViewer', displayName: 'DBC Viewer', extensions: ['dbc'], icon: 'network',
    template: 'dbc/dbcViewer.html',
    variables: (source, ctx) => ({
        fileName: ctx.fileName,
        dbcSource: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(source)),
        dbcModel: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(DbcParser.parse(source)))
    })
});

const protoViewer = simpleTextViewer({
    viewType: 'omni-viewer.protoViewer', displayName: 'Proto Viewer', extensions: ['proto'], icon: 'file-code-2',
    template: 'proto/protoViewer.html',
    variables: (source, ctx) => ({
        fileName: ctx.fileName,
        protoSource: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(source)),
        protoModel: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(parseProto(source, ctx.fileName)))
    })
});

const markdownViewer = simpleTextViewer({
    viewType: 'omni-viewer.markdownViewer', displayName: 'Markdown Viewer', extensions: ['md', 'markdown'], icon: 'file-text',
    template: 'markdown/markdownViewer.html', editable: true,
    variables: (source, ctx) => ({ fileName: ctx.fileName, fileSize: formatBytes(ctx.file.stat.size), markdownSource: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(source)) })
});

const mermaidViewer = simpleTextViewer({
    viewType: 'omni-viewer.mermaidViewer', displayName: 'Mermaid Viewer', extensions: ['mmd', 'mermaid'], icon: 'git-fork',
    template: 'mermaid/mermaidViewer.html', editable: true,
    variables: (source, ctx) => ({ fileName: ctx.fileName, fileSize: formatBytes(ctx.file.stat.size), mermaidSource: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(source)) })
});

const plantumlViewer = simpleTextViewer({
    viewType: 'omni-viewer.plantumlViewer', displayName: 'PlantUML Viewer', extensions: ['puml', 'plantuml', 'iuml'], icon: 'workflow',
    template: 'plantuml/plantumlViewer.html', editable: true,
    variables: (source, ctx) => ({
        fileName: ctx.fileName,
        fileNameJson: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(ctx.fileName)),
        fileSize: formatBytes(ctx.file.stat.size),
        fileSizeJson: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(formatBytes(ctx.file.stat.size))),
        plantumlSource: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(source)),
        plantumlTemplateBase: 'about:blank'
    })
});

const jsonlViewer: ViewerDefinition = {
    viewType: 'omni-viewer.jsonlViewer', displayName: 'JSONL Viewer', extensions: ['jsonl', 'ndjson', 'jsonlines'], icon: 'list',
    errorContent: { title: 'Failed to load JSONL', message: 'Unable to parse this JSONL file:', icon: 'list' },
    async render(ctx) {
        const source = await readText(ctx);
        const lines = source.split(/\r?\n/).filter((line) => line.trim()).map((content, index) => {
            try { return { lineNumber: index + 1, content, parsedJson: JSON.parse(content), isValid: true }; }
            catch { return { lineNumber: index + 1, content, isValid: false }; }
        });
        const validLines = lines.filter((line) => line.isValid).length;
        const data = { lines, totalLines: lines.length, validLines, invalidLines: lines.length - validLines, fileSize: formatBytes(ctx.file.stat.size), isPreview: false, loadedBytes: ctx.file.stat.size, totalBytes: ctx.file.stat.size, hasMoreContent: false };
        ctx.host.setHtml(await TemplateUtils.loadTemplate(ctx.templatesDir, 'jsonl/jsonlViewer.html', {
            fileName: ctx.fileName,
            jsonlData: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(data))
        }));
    }
};

function mediaViewer(category: 'image' | 'video' | 'audio', extensions: string[]): ViewerDefinition {
    return {
        viewType: `omni-viewer.${category}Viewer`, displayName: `${category[0].toUpperCase()}${category.slice(1)} Viewer`, extensions,
        icon: category === 'video' ? 'clapperboard' : category === 'audio' ? 'file-audio' : 'image',
        errorContent: { title: `Failed to load ${category}`, message: 'The mobile WebView could not open this media file:', icon: category },
        async render(ctx) {
            const source = ctx.app.vault.adapter.getResourcePath(ctx.file.path);
            const mimeType = mimeFor(ctx.file.extension.toLowerCase(), category);
            let template: string;
            let variables: Record<string, string>;
            if (category === 'image') {
                template = 'image/imageViewer.html';
                variables = { fileName: ctx.fileName, imageSrc: source, fileSize: formatBytes(ctx.file.stat.size), workspacePath: '' };
                ctx.host.onMessage(async (message) => {
                    if (message.command !== 'saveFilteredImage' || typeof message.imageData !== 'string') return;
                    const name = (typeof message.fileName === 'string' ? message.fileName : `${ctx.file.basename}-saved.png`).trim();
                    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
                        new Notice('Enter a file name without folders.');
                        return;
                    }
                    const parent = ctx.file.parent?.path ?? '';
                    const targetPath = normalizePath(parent ? `${parent}/${name}` : name);
                    const bytes = Buffer.from(message.imageData, 'base64');
                    const existing = ctx.app.vault.getAbstractFileByPath(targetPath);
                    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
                    if (existing) {
                        if (!(existing instanceof TFile)) {
                            new Notice(`Cannot save ${targetPath}: a folder already uses that name.`);
                            return;
                        }
                        const overwrite = await confirmDialog(ctx.app, `File "${targetPath}" already exists. Do you want to overwrite it?`, 'Overwrite');
                        if (!overwrite) return;
                        await ctx.app.vault.modifyBinary(existing, data);
                    } else {
                        await ctx.app.vault.createBinary(targetPath, data);
                    }
                    new Notice(`Saved ${targetPath}`);
                });
            } else if (category === 'video') {
                template = 'videoViewer.html';
                variables = { fileName: ctx.fileName, videoSrc: source, mimeType, fileSize: formatBytes(ctx.file.stat.size) };
            } else {
                template = 'audio/audioViewer.html';
                variables = {
                    fileName: ctx.fileName,
                    audioSrc: source,
                    metadata: JSON.stringify({ fileName: ctx.fileName, fileSize: formatBytes(ctx.file.stat.size), format: ctx.file.extension.toUpperCase() }),
                    peaks: '', duration: '', spectrogram: '', sampleRate: '', mode: 'streaming'
                };
                ctx.host.onMessage(async (message) => {
                    try {
                        if (message.command === 'downloadFile') {
                            const data = new Uint8Array(await ctx.app.vault.readBinary(ctx.file));
                            await saveBinaryBesideFile(ctx.app, ctx.file, message.fileName || ctx.file.name, data);
                        } else if (message.command === 'saveRegionFile' && typeof message.blob === 'string') {
                            const data = Buffer.from(message.blob, 'base64');
                            await saveBinaryBesideFile(ctx.app, ctx.file, message.fileName || `${ctx.file.basename}-region.wav`, data);
                        }
                    } catch (error) {
                        const detail = error instanceof Error ? error.message : String(error);
                        new Notice(`Failed to save audio: ${detail}`);
                    }
                });
            }
            ctx.host.setHtml(await TemplateUtils.loadTemplate(ctx.templatesDir, template, variables));
        }
    };
}

const excelViewer: ViewerDefinition = {
    viewType: 'omni-viewer.excelViewer', displayName: 'Excel Viewer', extensions: ['xlsx', 'xls'], icon: 'sheet',
    errorContent: { title: 'Failed to load Excel file', message: 'Unable to parse this workbook on mobile:', icon: 'sheet' },
    async render(ctx) {
        if (ctx.file.stat.size > MAX_MOBILE_DOCUMENT_BYTES) throw new Error('Workbook exceeds the 50 MB mobile limit.');
        const bytes = new Uint8Array(await ctx.app.vault.readBinary(ctx.file));
        const workbook = XLSX.read(bytes, { type: 'array', cellDates: true });
        const sheets = workbook.SheetNames.map((name) => {
            const raw = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: '', raw: false });
            const headers = (raw[0] ?? []).map(String);
            const rows = raw.slice(1).map((row) => Array.isArray(row) ? row : []);
            const totalColumns = Math.max(headers.length, ...rows.map((row) => row.length), 0);
            return { name, headers, rows, totalRows: rows.length, totalColumns };
        });
        const excelData = { sheetNames: workbook.SheetNames, sheets, fileSize: formatBytes(ctx.file.stat.size) };
        ctx.host.setHtml(await TemplateUtils.loadTemplate(ctx.templatesDir, 'excel/excelViewer.html', {
            fileName: ctx.fileName,
            excelData: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(excelData))
        }));
    }
};


const archiveViewer: ViewerDefinition = {
    viewType: 'omni-viewer.archiveViewer', displayName: 'ZIP Archive Viewer', extensions: ['zip', 'jar', 'apk'], icon: 'folder-archive',
    errorContent: { title: 'Failed to load ZIP archive', message: 'Mobile currently supports ZIP-compatible archives only:', icon: 'folder-archive' },
    async render(ctx) {
        if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) throw new Error('Host does not support direct DOM mounting.');
        const data = new Uint8Array(await ctx.app.vault.readBinary(ctx.file));
        const hostContext: ArchiveViewerContext = {
            assets: { resolveAssetUrl: async (assetPath) => assetPath },
            i18n: { t: (key, args) => resolveCatalogMessage(key, args) },
            logger: { log: (level, message) => level === 'error' ? console.error(message) : level === 'warn' ? console.warn(message) : console.info(message) },
            save: { saveFile: async (name, bytes) => { await saveBinaryBesideFile(ctx.app, ctx.file, name, bytes); } }
        };
        const decoder = {
            openArchive: async (archiveBytes: Uint8Array, options?: { signal?: AbortSignal; maxEntries?: number; maxDecompressedBytes?: number }) => {
                const zip = await JSZip.loadAsync(archiveBytes);
                const files = Object.values(zip.files).slice(0, options?.maxEntries);
                return {
                    entries: files.map((file, index) => ({ entryId: index, path: file.name, isDirectory: file.dir, modifiedAt: file.date })),
                    extract: async (entryId: number, extractOptions: { signal?: AbortSignal; maxBytes: number }) => {
                        if (extractOptions.signal?.aborted) throw new Error('Aborted.');
                        const file = files[entryId];
                        if (!file || file.dir) throw new Error('Archive entry not found.');
                        const bytes = await file.async('uint8array');
                        if (bytes.byteLength > extractOptions.maxBytes) throw new Error('Archive entry exceeds the mobile preview limit.');
                        return bytes;
                    },
                    close: () => undefined
                };
            }
        };
        const container = ctx.host.provideDomContainer();
        const handle = await mountArchiveViewer(
            { fileName: ctx.fileName, data },
            container,
            hostContext,
            decoder,
            { limits: { maxInputBytes: 128 * 1024 * 1024, maxDecompressedBytes: 256 * 1024 * 1024 } }
        );
        ctx.host.setCoreViewerHandle(handle);
    }
};

const hwpViewer: ViewerDefinition = {
    viewType: 'omni-viewer.hwpViewer', displayName: 'HWP Viewer', extensions: ['hwp', 'hwpx'], icon: 'file-text',
    errorContent: { title: 'HWP 파일을 불러올 수 없습니다', message: '모바일에서 문서를 렌더링하지 못했습니다:', icon: 'file-text', lang: 'ko' },
    async render(ctx) {
        const fileSize = formatBytes(ctx.file.stat.size);
        const payload = TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify({
            fileName: ctx.fileName,
            fileSize,
            documentUri: ctx.app.vault.adapter.getResourcePath(ctx.file.path),
            rhwpModuleUri: ctx.host.asWebviewUri('templates/hwp/vendor/rhwp/rhwp.js'),
            rhwpWasmUri: ctx.host.asWebviewUri('templates/hwp/vendor/rhwp/rhwp_bg.wasm')
        }));
        ctx.host.setHtml(await TemplateUtils.loadTemplate(ctx.templatesDir, 'hwp/hwpViewer.html', { fileName: ctx.fileName, hwpPayload: payload, fileSize }));
    }
};

export const MOBILE_VIEWER_DEFINITIONS: ViewerDefinition[] = [
    archiveViewer,
    mediaViewer('audio', ['mp3', 'wav', 'aiff', 'aif', 'ogg', 'flac', 'aac', 'm4a']),
    mediaViewer('image', ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg']),
    mediaViewer('video', ['mp4', 'mov', 'webm', 'm4v']),
    csvViewer,
    pdfViewer,
    jsonViewer,
    jsonlViewer,
    yamlViewer,
    tomlViewer,
    dbcViewer,
    markdownViewer,
    mermaidViewer,
    plantumlViewer,
    protoViewer,
    safetensorsViewer,
    excelViewer,
    mobileWordViewer,
    hwpViewer,
    pptViewer
];
