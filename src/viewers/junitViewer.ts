import { mountJUnitViewer, JUNIT_VIEWER_META, JUNIT_DEFAULT_MAX_INPUT_BYTES } from 'omni-viewer-core/viewers/junit';
import { createCoreVaultViewer } from './coreVaultViewer';

// Generic XML owns .xml; content refinement selects JUnit on both hosts.
export const junitViewer = createCoreVaultViewer({
    id: 'junit', displayName: 'JUnit Test Report Viewer', extensions: JUNIT_VIEWER_META.extensions,
    icon: 'list-checks', maxInputBytes: JUNIT_DEFAULT_MAX_INPUT_BYTES,
    mount: (input, container, services, ctx) => mountJUnitViewer(input, container, services, { signal: ctx.signal })
});
