// Shared PDF.js runtime for the core viewers that render PDF surfaces:
// the PDF viewer itself and the PPT viewer's LibreOffice conversion fallback.
//
// PDF.js is bundled statically at build time. The `pdfjs-process-shim` esbuild
// plugin prepends `const process = undefined;` to this module so PDF.js picks
// its browser DOM path instead of the Node path (Obsidian's Electron renderer
// exposes `process`). A static import keeps this review-compliant — no dynamic
// import() of a runtime-built URL.
import type { AssetService } from 'omni-viewer-core/host';
import type { PdfJsModule } from 'omni-viewer-core/viewers/pdf';
import { getBundledTextAsset } from '../utils/bundledAssets';
import * as bundledPdfjsModule from '../../templates/vendor/pdfjs/pdf.min.mjs';

const PDF_WORKER_ASSET = 'assets/pdfjs/pdf.worker.min.mjs';
const BUNDLED_PDF_WORKER = 'templates/vendor/pdfjs/pdf.worker.min.mjs';

export const bundledPdfjs = bundledPdfjsModule as unknown as PdfJsModule;

export const loadBundledPdfjs = async (): Promise<PdfJsModule> => bundledPdfjs;

/**
 * Asset service resolving the one asset PDF.js needs — its worker — from the
 * bundled source to a blob URL. Created URLs are added to `objectUrls` so the
 * caller can revoke them when the viewer is disposed.
 */
export function createPdfjsAssetService(objectUrls: Set<string>): AssetService {
    let workerUrl: string | undefined;

    return {
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
    };
}
