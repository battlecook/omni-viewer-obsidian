import type { HostContext, ClipboardService, FileSaveService } from 'omni-viewer-core/host';
import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import type { ViewerHandle, ViewerInput } from 'omni-viewer-core/viewers/types';
import { RenderContext, ViewerDefinition } from '../viewerCore';
import { saveBinaryBesideFile } from '../utils/vaultFiles';

export type VaultViewerServices = HostContext & { clipboard?: ClipboardService; save: FileSaveService };
export interface CoreVaultViewer extends ViewerDefinition {
    /** Refine a generic viewer without reading the same vault file twice. */
    renderBytes(ctx: RenderContext, buffer: ArrayBuffer): Promise<void>;
}

export function createCoreVaultViewer(options: {
    id: string;
    displayName: string;
    extensions: readonly string[];
    icon: string;
    maxInputBytes: number;
    mount(input: ViewerInput, container: HTMLElement, services: VaultViewerServices, ctx: RenderContext): Promise<ViewerHandle>;
}): CoreVaultViewer {
    function check(ctx: RenderContext, size: number): boolean {
        if (ctx.signal?.aborted) return false;
        if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
            throw new Error('Host does not support direct DOM mounting');
        }
        if (size > options.maxInputBytes) {
            throw new Error(`${options.displayName} files above ${options.maxInputBytes / (1024 * 1024)} MB cannot be opened: the file has to be read into memory in full.`);
        }
        return true;
    }

    async function renderBytes(ctx: RenderContext, buffer: ArrayBuffer): Promise<void> {
        if (!check(ctx, Math.max(ctx.file.stat.size, buffer.byteLength))) return;
        const services: VaultViewerServices = {
            assets: { resolveAssetUrl: async path => path },
            i18n: { t: (key, args) => resolveCatalogMessage(key, args) },
            logger: { log: (level, message) => {
                if (level === 'error') console.error(`[omni-viewer ${options.id}]`, message);
                else if (level === 'warn') console.warn(`[omni-viewer ${options.id}]`, message);
            } },
            save: { saveFile: async (name, bytes) => {
                if (ctx.signal?.aborted) return { status: 'cancelled' };
                const saved = await saveBinaryBesideFile(ctx.app, ctx.file, name, bytes);
                return saved ? { status: 'saved', fileName: saved.name } : { status: 'cancelled' };
            } }
        };
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
            services.clipboard = { writeText: text => navigator.clipboard.writeText(text) };
        }
        const container = ctx.host.provideDomContainer!();
        // Mesh/email surfaces can exceed the pane height on small screens.
        container.style.overflow = 'auto';
        const handle = await options.mount(
            { fileName: ctx.fileName, data: new Uint8Array(buffer), lastModified: ctx.file.stat.mtime },
            container, services, ctx
        );
        if (ctx.signal?.aborted) { handle.dispose(); return; }
        ctx.host.setCoreViewerHandle!(handle);
    }

    return {
        viewType: `omni-viewer.${options.id}Viewer`,
        displayName: options.displayName,
        extensions: [...options.extensions],
        icon: options.icon,
        errorContent: { title: `Failed to load ${options.displayName}`, message: 'Unable to open this vault file:', icon: options.icon },
        renderBytes,
        async render(ctx) {
            if (!check(ctx, ctx.file.stat.size)) return;
            await renderBytes(ctx, await ctx.app.vault.readBinary(ctx.file));
        }
    };
}
