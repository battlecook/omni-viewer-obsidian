import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const projectDir = fileURLToPath(new URL('../', import.meta.url));
const tempDir = await mkdtemp(path.join(tmpdir(), 'omni-core023-'));
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://obsidian.test', pretendToBeVisual: true });
const originalGlobals = new Map();
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'ShadowRoot', 'ProgressEvent']) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
window.require = createRequire(import.meta.url);
const clipboard = [], gpu = [], liveUrls = new Set();
let nextUrl = 0;
window.URL.createObjectURL = () => { const url = `blob:fixture-${++nextUrl}`; liveUrls.add(url); return url; };
window.URL.revokeObjectURL = url => liveUrls.delete(url);
Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { clipboard.push(text); } } });
dom.window.HTMLCanvasElement.prototype.getContext = function () {
    const canvas = this;
    return {
        createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
        putImageData: image => { canvas.__pixels = image.data; }
    };
};
globalThis.__meshRenderer = () => {
    const state = { renders: 0, disposed: false, lost: false };
    gpu.push(state);
    return {
        domElement: document.createElement('canvas'), setPixelRatio() {}, setSize() {},
        render() { state.renders++; }, dispose() { state.disposed = true; }, forceContextLoss() { state.lost = true; }
    };
};
after(async () => {
    dom.window.close();
    delete globalThis.__meshRenderer; delete globalThis.__saveName;
    for (const [key, descriptor] of originalGlobals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
    }
    await rm(tempDir, { recursive: true, force: true });
});

const runtimePath = path.join(tempDir, 'runtime.mjs');
await build({
    stdin: { contents: `
export { textViewer } from './src/viewers/textViewer.ts';
export { dicomViewer } from './src/viewers/dicomViewer.ts';
export { junitViewer } from './src/viewers/junitViewer.ts';
export { openapiViewer } from './src/viewers/openapiViewer.ts';
export { emlViewer } from './src/viewers/emlViewer.ts';
export { mcapViewer } from './src/viewers/mcapViewer.ts';
export { meshViewer, createMeshAssets } from './src/viewers/meshViewer.ts';
export { xmlViewer } from './src/viewers/xmlViewer.ts';
export { jsonViewer } from './src/viewers/jsonViewer.ts';
export { yamlViewer } from './src/viewers/yamlViewer.ts';
export { FileUtils } from './src/utils/fileUtils.ts';
export { TFile, Platform } from 'obsidian';`, resolveDir: projectDir, loader: 'ts' },
    outfile: runtimePath, bundle: true, platform: 'node', format: 'esm',
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    plugins: [{ name: 'test-host', setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: path.join(projectDir, 'tests/helpers/obsidian.mjs') }));
        builder.onResolve({ filter: /^\.\.\/platform$/ }, () => ({ path: 'platform', namespace: 'test' }));
        builder.onResolve({ filter: /generated\/assets$/ }, () => ({ path: 'assets', namespace: 'test' }));
        builder.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: args.path === 'platform'
            ? 'export async function promptText() { return globalThis.__saveName; } export async function showSaveDialog() { return null; }'
            : 'export const BUNDLED_TEXT_ASSETS = {}; export const BUNDLED_BINARY_ASSETS_BASE64 = {};' }));
        // Exercise real Three.js loaders, scene construction and controls; only
        // the GPU drawing seam is replaced for the headless DOM.
        builder.onLoad({ filter: /viewers\/mesh\/self-loading\.js$/ }, async args => ({
            contents: (await readFile(args.path, 'utf8')).replace(
                'return { THREE, GLTFLoader, STLLoader, OBJLoader, OrbitControls };',
                'return { THREE, GLTFLoader, STLLoader, OBJLoader, OrbitControls, createRenderer: globalThis.__meshRenderer };'
            ), loader: 'js'
        }));
    } }]
});
const { textViewer, dicomViewer, junitViewer, openapiViewer, emlViewer, mcapViewer, meshViewer,
    createMeshAssets, xmlViewer, jsonViewer, yamlViewer, FileUtils, TFile, Platform } = await import(pathToFileURL(runtimePath));
const fixture = async name => Buffer.from(await readFile(path.join(projectDir, `tests/fixtures/${name}`), 'utf8'), 'base64');
const dicom = await fixture('synthetic-native.dcm.b64');
const mcap = await fixture('sample-lz4.mcap.b64');
const eml = await readFile(path.join(projectDir, 'tests/fixtures/multipart.eml'), 'utf8');
const junit = '<testsuites><testsuite name="main" tests="3" failures="1" skipped="1"><testcase name="passes"/><testcase name="fails"><failure message="Expected 42">stack: example.js:10</failure><system-out>debug output</system-out></testcase><testcase name="later"><skipped/></testcase></testsuite></testsuites>';
const api = { openapi: '3.1.0', info: { title: 'Pets API', version: '1.0' }, paths: { '/pets': { get: { summary: 'List pets', responses: { 200: { description: 'OK' } } } } }, components: { schemas: { Pet: { type: 'object', properties: { name: { type: 'string' } } } } } };
const apiJson = JSON.stringify(api);
const apiYaml = 'openapi: 3.1.0\ninfo:\n  title: Pets API\n  version: "1.0"\npaths:\n  /pets:\n    get:\n      summary: List pets\n      responses:\n        "200":\n          description: OK\n';
const viewers = [textViewer, dicomViewer, junitViewer, openapiViewer, emlViewer, mcapViewer, meshViewer];
const button = (root, pattern) => [...root.querySelectorAll('button')].find(node => pattern.test(node.textContent));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function context(viewer, source, options = {}) {
    const bytes = typeof source === 'string' ? Buffer.from(source) : source;
    const name = options.name ?? `sample.${viewer.extensions[0] ?? 'xml'}`;
    const container = document.createElement('div'), handles = [], saved = [];
    let reads = 0, mounts = 0;
    const file = Object.assign(new TFile(), { name, extension: name.split('.').pop(), path: `models/${name}`, parent: { path: 'models' }, stat: { size: options.size ?? bytes.length, mtime: 0 } });
    const ctx = {
        file, fileName: name, filePath: path.join(tempDir, name), templatesDir: 'templates',
        app: { vault: {
            readBinary: async () => { reads++; options.onRead?.(); return Uint8Array.from(bytes).buffer; },
            cachedRead: async () => bytes.toString('utf8'),
            getAbstractFileByPath: () => null,
            createBinary: async (path, data) => { saved.push({ path, bytes: Buffer.from(data) }); return { name: path.split('/').pop() }; }
        } },
        host: { provideDomContainer() { mounts++; return container; }, setCoreViewerHandle(handle) { handles.push(handle); } },
        signal: options.signal
    };
    return { ctx, handles, saved, container, get reads() { return reads; }, get mounts() { return mounts; } };
}

test('Text: literal whitespace/HTML, Unicode decoding, soft wrap and bounded previews', async () => {
    for (const source of ['  <script>x</script>\n\t한글\r\n', Buffer.concat([Buffer.from([255, 254]), Buffer.from('한글\n  text', 'utf16le')])]) {
        const host = context(textViewer, source);
        await textViewer.render(host.ctx);
        const root = host.container.shadowRoot, pre = root.querySelector('pre');
        assert.match(pre.textContent, /한글/);
        assert.equal(root.querySelector('script'), null);
        const wrap = root.querySelector('button');
        assert.equal(wrap.getAttribute('aria-pressed'), 'true'); wrap.click();
        assert.equal(wrap.getAttribute('aria-pressed'), 'false');
        host.handles[0].dispose(); assert.equal(root.childNodes.length, 0);
    }
    const host = context(textViewer, Buffer.alloc(9 * 1024 * 1024, 65));
    await textViewer.render(host.ctx);
    assert.ok(host.container.shadowRoot.querySelector('pre').textContent.length <= 8 * 1024 * 1024);
    assert.ok(host.container.shadowRoot.querySelector('.omni-text__note'));
    host.handles[0].dispose();
});

test('DICOM: renders native frames, inversion/windowing, metadata and compressed-image limitation', async () => {
    const host = context(dicomViewer, dicom);
    await dicomViewer.render(host.ctx);
    const root = host.container.shadowRoot, canvas = root.querySelector('canvas');
    assert.match(root.textContent, /SYNTHETIC/);
    const first = canvas.__pixels[0];
    root.querySelector('.omni-dicom__next').click();
    assert.notEqual(canvas.__pixels[0], first);
    root.querySelector('.omni-dicom__invert').click();
    assert.equal(canvas.__pixels[0], first);
    host.handles[0].dispose(); assert.equal(root.childNodes.length, 0);
    const compressed = context(dicomViewer, await fixture('synthetic-compressed.dcm.b64'));
    await dicomViewer.render(compressed.ctx);
    assert.equal(compressed.container.shadowRoot.querySelector('canvas').hidden, true);
    assert.match(compressed.container.shadowRoot.textContent, /SYNTHETIC/);
    assert.ok(compressed.container.shadowRoot.querySelector('.omni-dicom__message').textContent);
    compressed.handles[0].dispose();
});

test('JUnit: XML handoff reads once on both hosts, shows failure details and copies report', async () => {
    for (const mobile of [false, true]) {
        Platform.isMobileApp = mobile;
        const host = context(xmlViewer, junit, { name: 'tests.xml' });
        await xmlViewer.render(host.ctx);
        assert.equal(host.reads, 1);
        const root = host.container.shadowRoot;
        assert.ok(root.querySelector('.omni-junit'));
        assert.match(root.textContent, /Expected 42/);
        assert.match(root.textContent, /stack: example.js:10/);
        button(root, /^Copy/i).click(); await tick();
        assert.match(clipboard.at(-1), /Expected 42/);
        host.handles[0].dispose(); assert.equal(root.childNodes.length, 0);
    }
    Platform.isMobileApp = false;
});

test('OpenAPI: JSON/YAML render operations offline and generic adapters refine on both hosts', async () => {
    for (const [viewer, source, name] of [[openapiViewer, apiYaml, 'api.yaml'], [yamlViewer, apiYaml, 'spec.yml'], [jsonViewer, apiJson, 'api.json']]) {
        for (const mobile of [false, true]) {
            Platform.isMobileApp = mobile;
            const host = context(viewer, source, { name });
            await writeFile(host.ctx.filePath, source);
            await viewer.render(host.ctx);
            const root = host.container.shadowRoot;
            assert.ok(root.querySelector('.omni-openapi'));
            assert.match(root.textContent, /Pets API/);
            assert.match(root.textContent, /\/pets/);
            assert.match(root.textContent, /List pets/);
            host.handles[0].dispose(); assert.equal(root.childNodes.length, 0);
        }
    }
    Platform.isMobileApp = false;
});

test('Email: MIME/charset/CID preview isolation, attachment vault save and clipboard', async () => {
    const source = eml.replace('<h1>', '<script>unsafe()</script><img src="https://evil.test/pixel"><h1>');
    const host = context(emlViewer, source);
    await emlViewer.render(host.ctx);
    const root = host.container.shadowRoot, frame = root.querySelector('iframe');
    assert.match(root.textContent, /안녕/);
    assert.equal(frame.getAttribute('sandbox'), '');
    assert.doesNotMatch(frame.srcdoc, /<script|src="https:\/\/evil/i);
    assert.match(frame.srcdoc, /data:image\/png;base64/);
    button(root, /Copy text/i).click(); await tick(); assert.match(clipboard.at(-1), /안녕하세요/);
    globalThis.__saveName = 'saved-attachment.txt';
    root.querySelector('.omni-eml__attachments button').click(); await tick();
    assert.equal(host.saved[0].path, 'models/saved-attachment.txt');
    assert.ok(host.saved[0].bytes.length > 0);
    host.handles[0].dispose(); assert.equal(root.childNodes.length, 0);
    delete globalThis.__saveName;
});

test('MCAP: real LZ4/ZSTD decoders, exact timestamps, topic/message inspection and copy', async () => {
    for (const codec of ['lz4', 'zstd']) {
        const host = context(mcapViewer, await fixture(`sample-${codec}.mcap.b64`));
        await mcapViewer.render(host.ctx);
        const root = host.container.shadowRoot;
        assert.match(root.textContent, /\/telemetry/);
        button(root, /^Messages$/).click();
        assert.equal(root.querySelectorAll('tbody tr').length, 2);
        assert.match(root.textContent, /1700000000\.000000123/);
        button(root, /Copy JSON/i).click(); await tick(); assert.match(clipboard.at(-1), /1700000000\.000000123/);
        host.handles[0].dispose(); assert.equal(root.childNodes.length, 0);
    }
});

test('Mesh: actual loaders build OBJ/STL/glTF/GLB scenes, controls work and GPU resources are disposed', async () => {
    for (const extension of ['obj', 'stl', 'gltf', 'glb']) {
        const host = context(meshViewer, await fixture(`mesh-${extension}.b64`), { name: `scene.${extension}` });
        await meshViewer.render(host.ctx);
        const root = host.container.shadowRoot, renderer = gpu.at(-1);
        assert.ok(root.querySelector('canvas'));
        assert.ok(renderer.renders > 0);
        const wire = root.querySelector('.omni-mesh__wireframe'); wire.click();
        assert.equal(wire.getAttribute('aria-pressed'), 'true');
        host.handles[0].dispose(); host.handles[0].dispose();
        assert.equal(renderer.disposed, true); assert.equal(renderer.lost, true);
        assert.equal(root.childNodes.length, 0);
    }
});

test('Mesh sidecars: vault-folder boundary, size budgets, cancellation and URL cleanup', async () => {
    const host = context(meshViewer, '');
    const target = Object.assign(new TFile(), { path: 'models/data/mesh.bin', extension: 'bin', stat: { size: 12 } });
    const paths = [];
    host.ctx.app.vault.getAbstractFileByPath = path => { paths.push(path); return target; };
    host.ctx.app.vault.readBinary = async () => new ArrayBuffer(12);
    const assets = createMeshAssets(host.ctx, window.URL);
    for (const uri of ['../secret.bin', '%2e%2e/secret.bin', '/secret.bin', 'https://evil.test/a', 'data:x', '%252e%252e/a', 'a\\b']) {
        assert.equal(await assets.service.resolve(uri), null, uri);
    }
    assert.deepEqual(paths, []);
    const resource = await assets.service.resolve('data/mesh.bin');
    assert.equal(paths[0], target.path); assert.ok(liveUrls.has(resource.url));
    resource.dispose(); assert.equal(liveUrls.size, 0);
    target.stat.size = 64 * 1024 * 1024 + 1;
    assert.equal(await assets.service.resolve('huge.bin'), null);
    target.stat.size = 12;
    await assets.service.resolve('data/mesh.bin');
    assets.dispose(); assert.equal(liveUrls.size, 0);
    assert.equal(await assets.service.resolve('data/mesh.bin'), null);
    const controller = new AbortController(); host.ctx.signal = controller.signal;
    const cancelled = createMeshAssets(host.ctx, window.URL);
    host.ctx.app.vault.readBinary = async () => { controller.abort(); return new ArrayBuffer(12); };
    assert.equal(await cancelled.service.resolve('data/mesh.bin'), null);
    assert.equal(liveUrls.size, 0); cancelled.dispose();
});

test('All new adapters: reject oversized vault reads and discard cancelled reads before replacing content', async () => {
    const sizes = [64, 256, 64, 10, 32, 256, 128];
    for (const [index, viewer] of viewers.entries()) {
        const host = context(viewer, '', { size: sizes[index] * 1024 * 1024 + 1 });
        await assert.rejects(viewer.render(host.ctx), /above .* MB/); assert.equal(host.reads, 0);
        for (const duringRead of [false, true]) {
            const controller = new AbortController(); if (!duringRead) controller.abort();
            const cancelled = context(viewer, '', { signal: controller.signal, onRead: () => controller.abort() });
            await viewer.render(cancelled.ctx);
            assert.equal(cancelled.reads, duringRead ? 1 : 0); assert.equal(cancelled.mounts, 0); assert.equal(cancelled.handles.length, 0);
        }
    }
});

test('Detection: explicit TXT, native binary signatures, EML, JUnit/OpenAPI refinement and generic fallbacks', async () => {
    const dicomMarkerJson = JSON.stringify({ text: 'a'.repeat(119) + 'DICM' + 'b'.repeat(64) });
    assert.equal(Buffer.from(dicomMarkerJson).subarray(128, 132).toString(), 'DICM');
    const pdfPreambleDicom = Buffer.from(dicom);
    pdfPreambleDicom.write('%PDF-', 0, 'ascii');
    const cases = [
        ['mesh-flags.yaml', 'glTF: enabled\nOBJ: enabled', 'omni-viewer.yamlViewer'],
        ['mesh-flags.csv', 'glTF,OBJ,STL\nyes,yes,no', 'omni-viewer.csvViewer'],
        ['marker.json', dicomMarkerJson, 'omni-viewer.jsonViewer'],
        ['scan-with-pdf-preamble.dat', pdfPreambleDicom, dicomViewer.viewType],
        ['literal.txt', apiJson, textViewer.viewType], ['report.TXT', junit, textViewer.viewType],
        ['page.txt', '<html><body>Hello</body></html>', textViewer.viewType], ['empty.txt', '', textViewer.viewType],
        ['capture.dat', mcap, mcapViewer.viewType], ['scan.dat', dicom, dicomViewer.viewType],
        ['scene.dat', await fixture('mesh-glb.b64'), meshViewer.viewType],
        ['scene.OBJ', 'invalid', meshViewer.viewType], ['bad.dcm', 'invalid', dicomViewer.viewType],
        ['report.xml', junit, junitViewer.viewType], ['report', junit, junitViewer.viewType],
        ['report.xsd', junit, 'omni-viewer.xmlViewer'], ['data.xml', '<root/>', 'omni-viewer.xmlViewer'],
        ['spec.json', apiJson, openapiViewer.viewType], ['spec.yaml', apiYaml, openapiViewer.viewType],
        ['spec', apiYaml, openapiViewer.viewType], ['flow.yaml', '{openapi: 3.1.0, info: {title: Flow, version: "1"}, paths: {}}', openapiViewer.viewType],
        ['generic.json', '{"value":42}', 'omni-viewer.jsonViewer'], ['generic.yaml', 'name: value', 'omni-viewer.yamlViewer'],
        ['nested.json', JSON.stringify({ nested: api }), 'omni-viewer.jsonViewer'],
        ['record.jsonl', apiJson + '\n' + apiJson, 'omni-viewer.jsonlViewer'],
        ['email.dat', eml, emlViewer.viewType], ['mail.eml', 'invalid', emlViewer.viewType]
    ];
    for (const [name, data, expected] of cases) {
        const file = path.join(tempDir, name); await writeFile(file, data);
        assert.equal((await FileUtils.detectViewerType(file)).viewType, expected, name);
    }
    for (const registry of ['src/viewerRegistry.ts', 'src/mobileViewerRegistry.ts']) {
        const source = await readFile(path.join(projectDir, registry), 'utf8');
        for (const viewer of viewers) assert.match(source, new RegExp(`^    ${viewer.viewType.split('.')[1]},$`, 'm'));
    }
});
