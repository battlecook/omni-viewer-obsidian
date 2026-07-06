import * as path from 'path';
import * as fs from 'fs';
import { Notice } from 'obsidian';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { WebviewMessage } from './types';
import { MessageContext } from './context';
import { showOpenDialog, showSaveDialog } from '../../platform';

export class PdfMessageHandlers {
    private static readonly mergedPdfCache = new Map<string, string[]>();

    public static setupDocumentCacheKey(context?: MessageContext): string | null {
        return context ? context.absPath : null;
    }

    public static resetMergedPdfCache(context?: MessageContext): void {
        const key = this.setupDocumentCacheKey(context);
        if (key) {
            this.mergedPdfCache.delete(key);
        }
    }

    public static async handleSelectMergePdf(context?: MessageContext): Promise<void> {
        try {
            if (!context) {
                throw new Error('No active PDF document');
            }

            const selectedPath = await showOpenDialog([{ name: 'PDF files', extensions: ['pdf'] }]);
            if (!selectedPath) {
                return;
            }

            const mergeBytes = await fs.promises.readFile(selectedPath);
            const mergeBase64 = mergeBytes.toString('base64');
            const cacheKey = this.setupDocumentCacheKey(context);
            if (cacheKey) {
                this.mergedPdfCache.set(cacheKey, [mergeBase64]);
            }

            const mergedFileName = path.basename(selectedPath);
            const maxWebviewBase64Bytes = 1_500_000;

            if (mergeBytes.length <= maxWebviewBase64Bytes) {
                context.postMessage({
                    type: 'selectedMergePdf',
                    data: {
                        base64: mergeBase64,
                        fileName: mergedFileName
                    }
                });
                return;
            }

            context.postMessage({
                type: 'selectedMergePdfMeta',
                data: { fileName: mergedFileName }
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            new Notice(`Failed to select merge PDF: ${errorMessage}`);
            console.error('Error selecting merge PDF:', error);
        }
    }

    public static async handleSavePdf(message: WebviewMessage, context?: MessageContext): Promise<void> {
        try {
            if (!context || !message.data) {
                throw new Error('No document or annotation data');
            }

            const isSaveAs = message.data.saveAs === true || message.command === 'savePdfAs' || message.type === 'savePdfAs';
            let targetPath = context.absPath;
            if (isSaveAs) {
                const sourcePath = context.absPath;
                const sourceExt = path.extname(sourcePath) || '.pdf';
                const sourceBase = path.basename(sourcePath, sourceExt);
                const defaultPath = path.join(path.dirname(sourcePath), `${sourceBase}-edited.pdf`);
                const saveAsPath = await showSaveDialog(defaultPath, [{ name: 'PDF files', extensions: ['pdf'] }]);

                if (!saveAsPath) {
                    return;
                }
                targetPath = saveAsPath;
            }

            const pdfBytes = await fs.promises.readFile(context.absPath);
            const baseDoc = await PDFDocument.load(pdfBytes);
            const sourceDocs: PDFDocument[] = [baseDoc];
            const cacheKey = this.setupDocumentCacheKey(context);
            const cachedExtraPdfs = cacheKey ? (this.mergedPdfCache.get(cacheKey) || []) : [];
            const extraPdfBase64List: string[] = Array.isArray(message.data.extraPdfBase64List)
                ? message.data.extraPdfBase64List
                : (message.data.hasMerge ? cachedExtraPdfs : []);

            for (const extraBase64 of extraPdfBase64List) {
                if (!extraBase64) {
                    continue;
                }
                const extraBytes = Buffer.from(extraBase64, 'base64');
                sourceDocs.push(await PDFDocument.load(extraBytes));
            }

            const mergedDoc = await PDFDocument.create();
            for (const srcDoc of sourceDocs) {
                const pageIndices = srcDoc.getPages().map((_, index) => index);
                const copiedPages = await mergedDoc.copyPages(srcDoc, pageIndices);
                copiedPages.forEach((copiedPage) => mergedDoc.addPage(copiedPage));
            }

            let workingDoc = mergedDoc;
            const totalPages = mergedDoc.getPageCount();
            const requestedPageOrder: number[] = Array.isArray(message.data.pageOrder) ? message.data.pageOrder : [];
            if (requestedPageOrder.length > 0) {
                const seen = new Set<number>();
                const normalizedOrder: number[] = [];
                for (const rawIndex of requestedPageOrder) {
                    const pageIndex = Number(rawIndex);
                    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= totalPages || seen.has(pageIndex)) {
                        continue;
                    }
                    seen.add(pageIndex);
                    normalizedOrder.push(pageIndex);
                }

                if (normalizedOrder.length === 0) {
                    throw new Error('No valid pages left to save.');
                }

                if (message.data.hasMerge === true && message.data.previewIncludesMergedPages !== true) {
                    for (let i = 0; i < totalPages; i++) {
                        if (!seen.has(i)) {
                            normalizedOrder.push(i);
                        }
                    }
                }

                const reorderedDoc = await PDFDocument.create();
                const reorderedPages = await reorderedDoc.copyPages(mergedDoc, normalizedOrder);
                reorderedPages.forEach((copiedPage) => reorderedDoc.addPage(copiedPage));
                workingDoc = reorderedDoc;
            }

            const helvetica = await workingDoc.embedFont(StandardFonts.Helvetica);
            const pages = workingDoc.getPages();
            const texts = Array.isArray(message.data.texts) ? message.data.texts : [];
            const textStamps = Array.isArray(message.data.textStamps) ? message.data.textStamps : [];
            const signatures = Array.isArray(message.data.signatures) ? message.data.signatures : [];

            if (textStamps.length > 0) {
                for (const stamp of textStamps) {
                    if (stamp.pageIndex < 0 || stamp.pageIndex >= pages.length) {
                        continue;
                    }
                    const page = pages[stamp.pageIndex];
                    const pngImage = await workingDoc.embedPng(Buffer.from(stamp.imageBase64, 'base64'));
                    page.drawImage(pngImage, {
                        x: stamp.x,
                        y: stamp.y,
                        width: stamp.width,
                        height: stamp.height
                    });
                }
            } else {
                for (const text of texts) {
                    if (text.pageIndex < 0 || text.pageIndex >= pages.length) {
                        continue;
                    }
                    const page = pages[text.pageIndex];
                    const textColor = this.hexToRgb(text.color);
                    page.drawText(text.text, {
                        x: text.x,
                        y: text.y,
                        size: text.fontSize || 12,
                        font: helvetica,
                        color: rgb(textColor.r, textColor.g, textColor.b)
                    });
                }
            }

            for (const sig of signatures) {
                if (sig.pageIndex < 0 || sig.pageIndex >= pages.length) {
                    continue;
                }
                const page = pages[sig.pageIndex];
                const pngImage = await workingDoc.embedPng(Buffer.from(sig.imageBase64, 'base64'));
                page.drawImage(pngImage, {
                    x: sig.x,
                    y: sig.y,
                    width: sig.width,
                    height: sig.height
                });
            }

            const savedBytes = await workingDoc.save();
            await fs.promises.writeFile(targetPath, Buffer.from(savedBytes));
            new Notice(`PDF saved: ${path.basename(targetPath)}`);
            this.resetMergedPdfCache(context);

            context.postMessage({
                type: 'pdfSaved',
                data: {
                    base64: Buffer.from(savedBytes).toString('base64'),
                    fileName: path.basename(targetPath)
                }
            });

            await context.reopen(targetPath, 'omni-viewer.pdfViewer');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            new Notice(`Failed to save PDF: ${errorMessage}`);
            console.error('Error saving PDF:', error);
        }
    }

    private static hexToRgb(hex?: string): { r: number; g: number; b: number } {
        if (!hex || typeof hex !== 'string') {
            return { r: 0, g: 0, b: 0 };
        }

        const normalized = hex.trim().replace('#', '');
        const fullHex = normalized.length === 3
            ? normalized.split('').map((char) => char + char).join('')
            : normalized;

        if (!/^[0-9a-fA-F]{6}$/.test(fullHex)) {
            return { r: 0, g: 0, b: 0 };
        }

        const intVal = parseInt(fullHex, 16);
        return {
            r: ((intVal >> 16) & 255) / 255,
            g: ((intVal >> 8) & 255) / 255,
            b: (intVal & 255) / 255
        };
    }
}
