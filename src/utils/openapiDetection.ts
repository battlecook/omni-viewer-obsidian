import { looksLikeOpenApi } from 'omni-viewer-core/registry';
import { loadOpenApiYamlDeps } from 'omni-viewer-core/viewers/openapi/self-loading';

let yamlDeps: ReturnType<typeof loadOpenApiYamlDeps> | undefined;

/** Use the installed YAML parser for flow mappings, aliases and quoted keys. */
export async function looksLikeOpenApiSource(source: string, extension: string): Promise<boolean> {
    if (!/(?:openapi|swagger|\\)/.test(source)) return false;
    if (extension.toLowerCase().replace(/^\./, '') === 'json') {
        return looksLikeOpenApi(source, { format: 'json' });
    }
    yamlDeps ??= loadOpenApiYamlDeps();
    return looksLikeOpenApi(source, { yamlDeps: await yamlDeps });
}
