import { mountTextViewer, TEXT_VIEWER_META } from 'omni-viewer-core/viewers/text';
import { createCoreVaultViewer } from './coreVaultViewer';

export const textViewer = createCoreVaultViewer({
    id: 'text', displayName: 'Text Viewer', extensions: TEXT_VIEWER_META.extensions,
    icon: 'file-text', maxInputBytes: 64 * 1024 * 1024,
    mount: (input, container, services, ctx) => mountTextViewer(input, container, services, {
        signal: ctx.signal, parse: { limits: { maxInputBytes: 64 * 1024 * 1024 } }
    })
});
