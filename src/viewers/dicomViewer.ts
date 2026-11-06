import { mountDicomViewer, DICOM_VIEWER_META } from 'omni-viewer-core/viewers/dicom';
import { createCoreVaultViewer } from './coreVaultViewer';

export const dicomViewer = createCoreVaultViewer({
    id: 'dicom', displayName: 'DICOM Viewer', extensions: DICOM_VIEWER_META.extensions,
    icon: 'scan', maxInputBytes: 256 * 1024 * 1024,
    mount: (input, container, services, ctx) => mountDicomViewer(input, container, services, { signal: ctx.signal })
});
