import { normalizePath, TFile } from 'obsidian';
import { mountSelfLoadingMeshViewer, MESH_VIEWER_META, isMeshRelativePath } from 'omni-viewer-core/viewers/mesh/self-loading';
import type { DocumentAssetsService } from 'omni-viewer-core/host';
import { RenderContext } from '../viewerCore';
import { createCoreVaultViewer } from './coreVaultViewer';

const MAX_INPUT_BYTES = 128 * 1024 * 1024;
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES = 256 * 1024 * 1024;

/** Local blobs bound to the model's folder; never return remote or filesystem URLs. */
export function createMeshAssets(ctx: RenderContext, urls: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>) {
    const owned = new Set<string>();
    const parent = ctx.file.parent?.path ?? '';
    const prefix = parent ? `${parent}/` : '';
    let total = 0, disposed = false;
    const service: DocumentAssetsService = {
        async resolve(uri) {
            if (disposed || ctx.signal?.aborted || !isMeshRelativePath(uri)) return null;
            const path = normalizePath(`${prefix}${decodeURIComponent(uri)}`);
            if (prefix && !path.startsWith(prefix)) return null;
            const target = ctx.app.vault.getAbstractFileByPath(path);
            if (!(target instanceof TFile)) return null;
            const reservedBytes = target.stat.size;
            if (reservedBytes > MAX_ASSET_BYTES || total + reservedBytes > MAX_TOTAL_ASSET_BYTES) return null;
            total += reservedBytes;
            const data = await ctx.app.vault.readBinary(target);
            if (disposed || ctx.signal?.aborted) return null;
            // The vault may have changed while the read was pending.
            if (data.byteLength > MAX_ASSET_BYTES) return null;
            total += Math.max(0, data.byteLength - reservedBytes);
            if (total > MAX_TOTAL_ASSET_BYTES) return null;
            const extension = target.extension.toLowerCase();
            const mime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif' } as Record<string, string>)[extension] ?? 'application/octet-stream';
            const url = urls.createObjectURL(new Blob([data], { type: mime }));
            owned.add(url);
            return { url, dispose() { if (owned.delete(url)) urls.revokeObjectURL(url); } };
        }
    };
    return {
        service,
        dispose() { disposed = true; owned.forEach(url => urls.revokeObjectURL(url)); owned.clear(); }
    };
}

export const meshViewer = createCoreVaultViewer({
    id: 'mesh', displayName: '3D Mesh Viewer', extensions: MESH_VIEWER_META.extensions,
    icon: 'box', maxInputBytes: MAX_INPUT_BYTES,
    async mount(input, container, services, ctx) {
        const assets = createMeshAssets(ctx, container.ownerDocument.defaultView?.URL ?? URL);
        try {
            const handle = await mountSelfLoadingMeshViewer(input, container, { ...services, documentAssets: assets.service }, { signal: ctx.signal });
            return { dispose() { try { handle.dispose(); } finally { assets.dispose(); } } };
        } catch (error) { assets.dispose(); throw error; }
    }
});
