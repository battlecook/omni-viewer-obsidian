import { mountEmlViewer, EML_VIEWER_META, EML_MAX_INPUT_BYTES } from 'omni-viewer-core/viewers/eml';
import { createCoreVaultViewer } from './coreVaultViewer';

export const emlViewer = createCoreVaultViewer({
    id: 'eml', displayName: 'Email Viewer', extensions: EML_VIEWER_META.extensions,
    icon: 'mail', maxInputBytes: EML_MAX_INPUT_BYTES,
    mount: (input, container, services, ctx) => mountEmlViewer(input, container, services, { signal: ctx.signal })
});
