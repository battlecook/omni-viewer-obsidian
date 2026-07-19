// PPT viewer — Obsidian adapter over omni-viewer-core.
//
// Like the CSV and PDF viewers, this mounts the core DOM viewer directly into
// the view content instead of rendering a template into a sandboxed iframe.
// The core owns both parsing (the same PPTX/PPT binary parsers this plugin
// used to vendor) and rendering; this adapter only supplies host services.
//
// The core falls back to rendering a PDF when a deck has no renderable slides,
// delegating the conversion to `convertToPdf` — here, the existing LibreOffice
// (soffice) path. Without that dependency the core would simply report the
// deck as unreadable, so wiring it preserves the previous behaviour.

import * as fs from 'fs';
import * as path from 'path';
import type { FileSaveService, HostContext } from 'omni-viewer-core/host';
import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import { mountPptViewer, type PptViewerHandle } from 'omni-viewer-core/viewers/ppt';
import { showSaveDialog } from '../platform';
import { FileUtils } from '../utils/fileUtils';
import { RenderContext, ViewerDefinition } from '../viewerCore';
import { createPdfjsAssetService, loadBundledPdfjs } from './pdfjsRuntime';

type PptHostContext = HostContext & { save: FileSaveService };

function coreHostContext(renderCtx: RenderContext, objectUrls: Set<string>): PptHostContext {
    const { filePath } = renderCtx;
    return {
        assets: createPdfjsAssetService(objectUrls),
        i18n: {
            t: (key, args) => resolveCatalogMessage(key, args)
        },
        logger: {
            log: (level, message) => {
                const prefix = '[omni-viewer ppt]';
                if (level === 'error') console.error(prefix, message);
                else if (level === 'warn') console.warn(prefix, message);
                else console.info(prefix, message);
            }
        },
        // Export only. Deliberately no `writeback`: in the PDF fallback the core
        // mounts its PDF viewer, whose save would otherwise overwrite the source
        // .ppt/.pptx with PDF bytes.
        save: {
            saveFile: async (name, data) => {
                const targetPath = await showSaveDialog(
                    path.join(path.dirname(filePath), name),
                    [{ name: 'PDF files', extensions: ['pdf'] }]
                );
                if (!targetPath) return;
                await fs.promises.writeFile(targetPath, data);
            }
        }
    };
}

export const pptViewer: ViewerDefinition = {
    viewType: 'omni-viewer.pptViewer',
    displayName: 'PowerPoint Viewer',
    extensions: ['ppt', 'pptx'],
    icon: 'presentation',
    errorContent: {
        title: 'Failed to load PowerPoint file',
        message: 'Unable to parse and render the file:',
        icon: '📽️'
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
            const handle = await mountPptViewer(
                { fileName: ctx.fileName, data: new Uint8Array(buffer) },
                container,
                coreHostContext(ctx, objectUrls),
                {
                    loadPdfjs: loadBundledPdfjs,
                    // soffice reads from disk, so convert the file in place and
                    // ignore the bytes the core hands us (same content).
                    convertToPdf: async () => {
                        const pdf = await FileUtils.convertPresentationToPdf(ctx.filePath);
                        return new Uint8Array(pdf);
                    }
                }
            );
            const managedHandle: PptViewerHandle = {
                controller: handle.controller,
                mode: handle.mode,
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
