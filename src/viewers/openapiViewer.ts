import { mountSelfLoadingOpenApiViewer, OPENAPI_VIEWER_META } from 'omni-viewer-core/viewers/openapi/self-loading';
import { OPENAPI_MAX_INPUT_BYTES } from 'omni-viewer-core/parsers/openapi';
import { createCoreVaultViewer } from './coreVaultViewer';

// JSON/YAML own the extensions; their adapters refine OpenAPI by content.
export const openapiViewer = createCoreVaultViewer({
    id: 'openapi', displayName: 'OpenAPI / Swagger Viewer', extensions: OPENAPI_VIEWER_META.extensions,
    icon: 'network', maxInputBytes: OPENAPI_MAX_INPUT_BYTES,
    mount: (input, container, services, ctx) => mountSelfLoadingOpenApiViewer(input, container, services, { signal: ctx.signal })
});
