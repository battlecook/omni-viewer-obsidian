import * as fs from 'fs';
import * as path from 'path';
import { Notice } from 'obsidian';
import * as pdfLib from 'pdf-lib';
import {
    mountPdfViewer,
    type PdfViewerContext,
    type PdfViewerHandle
} from 'omni-viewer-core/viewers/pdf';
import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import { showOpenDialog, showSaveDialog } from '../platform';
import { ViewerDefinition } from '../viewerCore';
import { createPdfjsAssetService, loadBundledPdfjs } from './pdfjsRuntime';

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

function createCoreContext(
    ctx: Parameters<ViewerDefinition['render']>[0],
    objectUrls: Set<string>
): PdfViewerContext {
    return {
        assets: createPdfjsAssetService(objectUrls),
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
            const handle = await mountPdfViewer(
                { fileName: ctx.fileName, data: new Uint8Array(buffer) },
                container,
                createCoreContext(ctx, objectUrls),
                {
                    loadPdfjs: loadBundledPdfjs,
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
