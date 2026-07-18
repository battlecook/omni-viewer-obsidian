import * as fs from 'fs';
import * as path from 'path';
import { Notice } from 'obsidian';
import * as pdfLib from 'pdf-lib';
import {
    mountPdfViewer,
    type PdfJsModule,
    type PdfViewerContext,
    type PdfViewerHandle
} from 'omni-viewer-core/viewers/pdf';
import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import { showOpenDialog, showSaveDialog } from '../platform';
import { getBundledTextAsset } from '../utils/bundledAssets';
import { ViewerDefinition } from '../viewerCore';

const BUNDLED_PDF_JS = 'templates/vendor/pdfjs/pdf.min.mjs';
const PDF_WORKER_ASSET = 'assets/pdfjs/pdf.worker.min.mjs';
const BUNDLED_PDF_WORKER = 'templates/vendor/pdfjs/pdf.worker.min.mjs';

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

async function loadBundledPdfJs(objectUrls: Set<string>): Promise<PdfJsModule> {
    const source = getBundledTextAsset(BUNDLED_PDF_JS);
    if (!source) {
        throw new Error('Bundled PDF.js module is missing.');
    }

    // Obsidian exposes Node's `process` in its Electron renderer. PDF.js uses
    // that global to choose its Node canvas path, but this viewer is mounted in
    // the browser DOM. Shadow it so PDF.js selects its DOM implementation.
    const moduleUrl = URL.createObjectURL(new Blob([
        'const process = undefined;\n',
        source
    ], { type: 'application/javascript' }));
    objectUrls.add(moduleUrl);
    return await import(moduleUrl) as PdfJsModule;
}

function createCoreContext(
    ctx: Parameters<ViewerDefinition['render']>[0],
    objectUrls: Set<string>
): PdfViewerContext {
    let workerUrl: string | undefined;

    return {
        assets: {
            resolveAssetUrl: async (assetPath: string) => {
                if (assetPath !== PDF_WORKER_ASSET) {
                    throw new Error(`Unsupported PDF asset: ${assetPath}`);
                }
                if (!workerUrl) {
                    const source = getBundledTextAsset(BUNDLED_PDF_WORKER);
                    if (!source) {
                        throw new Error('Bundled PDF.js worker is missing.');
                    }
                    workerUrl = URL.createObjectURL(new Blob([source], {
                        type: 'application/javascript'
                    }));
                    objectUrls.add(workerUrl);
                }
                return workerUrl;
            }
        },
        i18n: {
            t: (key, args) => resolveCatalogMessage(key, args)
        },
        logger: {
            log: (level, message) => {
                const prefix = '[omni-viewer pdf]';
                if (level === 'error') console.error(prefix, message);
                else if (level === 'warn') console.warn(prefix, message);
                else console.info(prefix, message);
            }
        },
        writeback: {
            write: async (data) => {
                ctx.host.markInternalWrite?.();
                await ctx.app.vault.modifyBinary(ctx.file, toArrayBuffer(data));
            }
        },
        save: {
            saveFile: async (name, data) => {
                const targetPath = await showSaveDialog(
                    path.join(path.dirname(ctx.filePath), name),
                    [{ name: 'PDF files', extensions: ['pdf'] }]
                );
                if (!targetPath) return;
                await fs.promises.writeFile(targetPath, data);
            }
        },
        filePick: {
            pickFile: async ({ maxBytes }) => {
                try {
                    const selectedPath = await showOpenDialog([
                        { name: 'PDF files', extensions: ['pdf'] }
                    ]);
                    if (!selectedPath) return undefined;

                    const data = await fs.promises.readFile(selectedPath);
                    if (maxBytes !== undefined && data.byteLength > maxBytes) {
                        new Notice(`PDF is too large to merge (maximum ${maxBytes} bytes).`);
                        return undefined;
                    }
                    return {
                        fileName: path.basename(selectedPath),
                        data: new Uint8Array(data),
                        mimeType: 'application/pdf'
                    };
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    new Notice(`Failed to open PDF: ${message}`);
                    return undefined;
                }
            }
        }
    };
}

export const pdfViewer: ViewerDefinition = {
    viewType: 'omni-viewer.pdfViewer',
    displayName: 'PDF Editor',
    extensions: ['pdf'],
    icon: 'file-text',
    errorContent: {
        title: 'Failed to load PDF file',
        message: 'Unable to load the PDF file due to an error:',
        icon: '📄'
    },
    async render(ctx) {
        if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
            throw new Error('Host does not support direct DOM mounting');
        }

        const objectUrls = new Set<string>();
        const disposeObjectUrls = () => {
            for (const url of objectUrls) URL.revokeObjectURL(url);
            objectUrls.clear();
        };

        try {
            const buffer = await ctx.app.vault.readBinary(ctx.file);
            const container = ctx.host.provideDomContainer();
            let pdfJsPromise: Promise<PdfJsModule> | undefined;
            const handle = await mountPdfViewer(
                { fileName: ctx.fileName, data: new Uint8Array(buffer) },
                container,
                createCoreContext(ctx, objectUrls),
                {
                    loadPdfjs: () => pdfJsPromise ??= loadBundledPdfJs(objectUrls),
                    loadPdfLib: async () => pdfLib
                }
            );
            const managedHandle: PdfViewerHandle = {
                controller: handle.controller,
                isDirty: () => handle.isDirty(),
                dispose: () => {
                    handle.dispose();
                    disposeObjectUrls();
                }
            };
            ctx.host.setCoreViewerHandle(managedHandle);
        } catch (error) {
            disposeObjectUrls();
            throw error;
        }
    }
};
