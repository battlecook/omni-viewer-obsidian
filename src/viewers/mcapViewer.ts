import { mountSelfLoadingMcapViewer, MCAP_VIEWER_META } from 'omni-viewer-core/viewers/mcap/self-loading';
import { createCoreVaultViewer } from './coreVaultViewer';

export const mcapViewer = createCoreVaultViewer({
    id: 'mcap', displayName: 'MCAP Viewer', extensions: MCAP_VIEWER_META.extensions,
    icon: 'radio', maxInputBytes: 256 * 1024 * 1024,
    mount: (input, container, services, ctx) => mountSelfLoadingMcapViewer(input, container, services, { signal: ctx.signal })
});
