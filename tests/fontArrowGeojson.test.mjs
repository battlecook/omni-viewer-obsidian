import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { tableFromArrays, tableToIPC } from 'apache-arrow';

const projectDir = fileURLToPath(new URL('../', import.meta.url));
const tempDir = await mkdtemp(path.join(tmpdir(), 'omni-font-arrow-geojson-'));
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://obsidian.test' });
const originalGlobals = new Map();
for (const key of ['window', 'document', 'navigator']) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
window.require = createRequire(import.meta.url);
const fonts = new Set();
Object.defineProperty(document, 'fonts', { value: fonts });
window.FontFace = class {
    async load() { return this; }
};
const clipboard = [];
Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { clipboard.push(text); } } });
after(async () => {
    dom.window.close();
    for (const [key, descriptor] of originalGlobals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
    }
    await rm(tempDir, { recursive: true, force: true });
});

const runtimePath = path.join(tempDir, 'runtime.mjs');
await build({
    stdin: {
        contents: `export { fontViewer } from './src/viewers/fontViewer.ts';
export { arrowViewer } from './src/viewers/arrowViewer.ts';
export { geojsonViewer } from './src/viewers/geojsonViewer.ts';
export { FileUtils } from './src/utils/fileUtils.ts';
export { TFile, Platform } from 'obsidian';`,
        resolveDir: projectDir, loader: 'ts'
    },
    outfile: runtimePath, bundle: true, platform: 'node', format: 'esm',
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    plugins: [{
        name: 'obsidian-test-host',
        setup(builder) {
            builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: path.join(projectDir, 'tests/helpers/obsidian.mjs') }));
            builder.onResolve({ filter: /^\.\.\/platform$/ }, () => ({ path: 'prompt', namespace: 'test' }));
            builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
                contents: 'export async function promptText() { return globalThis.__saveName; }'
            }));
        }
    }]
});
const { fontViewer, arrowViewer, geojsonViewer, FileUtils, TFile, Platform } = await import(pathToFileURL(runtimePath));
const ttf = await readFile(path.join(projectDir, 'node_modules/katex/dist/fonts/KaTeX_Main-Regular.ttf'));
const woff = await readFile(path.join(projectDir, 'node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff'));
const table = tableFromArrays({ id: new Int32Array([2, 1]), city: ['Seoul', 'Busan'] });
const ipc = tableToIPC(table, 'file');
const stream = tableToIPC(table, 'stream');
const geojson = JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'Seoul', properties: { name: '<script>unsafe()</script>' }, geometry: { type: 'Point', coordinates: [127, 37.5] } },
    { type: 'Feature', properties: { name: 'Park' }, geometry: { type: 'Polygon', coordinates: [
        [[126, 36], [128, 36], [128, 38], [126, 36]],
        [[126.5, 36.5], [127, 36.5], [127, 37], [126.5, 36.5]]
    ] } }
] });

function context(viewer, source, options = {}) {
    const bytes = typeof source === 'string' ? Buffer.from(source) : source;
    const container = document.createElement('div'), handles = [], saved = [];
    let reads = 0, mounts = 0;
    const fileName = options.fileName ?? `sample.${viewer.extensions[0]}`;
    const ctx = {
        app: { vault: {
            readBinary: async () => { reads++; options.onRead?.(); return Uint8Array.from(bytes).buffer; },
            getAbstractFileByPath: () => null,
            createBinary: async (path, data) => {
                saved.push({ path, data: Buffer.from(data) });
                return { name: path.split('/').pop() };
            }
        } },
        file: Object.assign(new TFile(), { name: fileName, parent: { path: 'data' }, stat: { size: options.size ?? bytes.length, mtime: 0 } }),
        fileName, filePath: `/vault/${fileName}`,
        host: {
            provideDomContainer() { mounts++; return container; },
            setCoreViewerHandle(handle) { handles.push(handle); }
        },
        signal: options.signal
    };
    return { ctx, container, handles, saved, get reads() { return reads; }, get mounts() { return mounts; } };
}
const button = (root, text) => [...root.querySelectorAll('button')].find(node => node.textContent === text);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('Font: parses local TTF/WOFF, mounts specimen/glyph controls on both hosts and releases FontFace', async () => {
    for (const mobile of [false, true]) for (const data of [ttf, woff]) {
        Platform.isMobileApp = mobile;
        const host = context(fontViewer, data);
        await fontViewer.render(host.ctx);
        const root = host.container.shadowRoot;
        assert.match(root.textContent, /KaTeX/);
        assert.equal(root.querySelector('.omni-font__preview').hidden, false);
        assert.ok(root.querySelectorAll('.omni-font__glyph').length > 0);
        const text = root.querySelector('textarea');
        text.value = 'Hello 한글'; text.dispatchEvent(new window.Event('input'));
        assert.equal(root.querySelector('.omni-font__specimen').textContent, text.value);
        const size = root.querySelector('input[type=range]');
        size.value = '72'; size.dispatchEvent(new window.Event('input'));
        assert.equal(root.querySelector('.omni-font__specimen').style.fontSize, '72px');
        const search = root.querySelector('input[type=search]');
        search.value = 'U+0041'; search.dispatchEvent(new window.Event('input'));
        assert.equal(root.querySelectorAll('.omni-font__glyph').length, 1);
        assert.equal(fonts.size, 1);
        host.handles[0].dispose(); host.handles[0].dispose();
        assert.equal(fonts.size, 0);
        assert.equal(root.childNodes.length, 0);
    }
    Platform.isMobileApp = false;
});

test('Arrow: IPC file/stream render, search, sorting, schema, clipboard and vault JSON export', async () => {
    for (const mobile of [false, true]) for (const data of [ipc, stream]) {
        Platform.isMobileApp = mobile;
        const host = context(arrowViewer, data);
        await arrowViewer.render(host.ctx);
        const root = host.container.shadowRoot;
        assert.match(root.querySelector('tbody').textContent, /Seoul.*Busan/);
        root.querySelector('th button').click();
        assert.match(root.querySelector('tbody tr').textContent, /1Busan/);
        const search = root.querySelector('input[type=search]');
        search.value = 'Seoul'; search.dispatchEvent(new window.Event('input'));
        assert.equal(root.querySelectorAll('tbody tr').length, 1);
        assert.match(root.querySelector('tbody').textContent, /Seoul/);
        button(root, 'Copy JSON').click(); await tick();
        assert.match(clipboard.at(-1), /Seoul/);
        assert.doesNotMatch(clipboard.at(-1), /Busan/);
        button(root, 'Schema').click();
        assert.match(root.querySelector('pre').textContent, /"fields"/);
        globalThis.__saveName = 'selection.json';
        button(root, 'Export JSON').click(); await tick();
        assert.equal(host.saved[0].path, 'data/selection.json');
        assert.match(host.saved[0].data.toString(), /Seoul/);
        globalThis.__saveName = null;
        button(root, 'Export JSON').click(); await tick();
        assert.equal(host.saved.length, 1, 'cancelled save creates no file');
        host.handles[0].dispose();
        assert.equal(root.childNodes.length, 0);
    }
    delete globalThis.__saveName;
    Platform.isMobileApp = false;
});

test('Arrow: PyArrow Feather V2 with LZ4 and ZSTD compression renders without network dependencies', async () => {
    for (const codec of ['lz4', 'zstd']) {
        const data = Buffer.from(await readFile(path.join(projectDir, `tests/fixtures/arrow-${codec}.feather.b64`), 'utf8'), 'base64');
        const host = context(arrowViewer, data, { fileName: 'sample.feather' });
        await arrowViewer.render(host.ctx);
        const root = host.container.shadowRoot;
        assert.match(root.querySelector('tbody').textContent, /9007199254740993.*alpha/);
        assert.equal(root.querySelectorAll('tbody tr').length, 3);
        button(root, 'Schema').click();
        assert.match(root.querySelector('pre').textContent, new RegExp(codec.toUpperCase()));
        host.handles[0].dispose();
    }
});

test('GeoJSON: offline SVG map, polygon holes, feature selection, safe properties and zoom on both hosts', async () => {
    for (const mobile of [false, true]) {
        Platform.isMobileApp = mobile;
        const host = context(geojsonViewer, geojson);
        await geojsonViewer.render(host.ctx);
        const root = host.container.shadowRoot, svg = root.querySelector('svg');
        assert.equal(root.querySelectorAll('[data-feature]').length, 2);
        assert.equal(root.querySelector('path').getAttribute('fill-rule'), 'evenodd');
        const initial = svg.getAttribute('viewBox');
        root.querySelector('button').click();
        assert.notEqual(svg.getAttribute('viewBox'), initial);
        const select = root.querySelector('select');
        select.value = '0'; select.dispatchEvent(new window.Event('change'));
        assert.match(root.querySelector('.omni-geojson__properties').textContent, /<script>unsafe\(\)<\/script>/);
        assert.equal(root.querySelector('script'), null);
        assert.equal(root.querySelectorAll('img, iframe').length, 0);
        host.handles[0].dispose();
        assert.equal(root.childNodes.length, 0);
    }
    Platform.isMobileApp = false;
});

test('New viewers: reject excessive reads, ignore cancelled loads and report invalid inputs', async () => {
    for (const [viewer, data, maxMB] of [[fontViewer, ttf, 64], [arrowViewer, ipc, 256], [geojsonViewer, geojson, 64]]) {
        const huge = context(viewer, data, { size: maxMB * 1024 * 1024 + 1 });
        await assert.rejects(viewer.render(huge.ctx), new RegExp(`above ${maxMB} MB`));
        assert.equal(huge.reads, 0);
        for (const duringRead of [false, true]) {
            const controller = new AbortController();
            if (!duringRead) controller.abort();
            const host = context(viewer, data, { signal: controller.signal, onRead: () => controller.abort() });
            await viewer.render(host.ctx);
            assert.equal(host.reads, duringRead ? 1 : 0);
            assert.equal(host.mounts, 0);
            assert.equal(host.handles.length, 0);
        }
        const invalid = context(viewer, 'invalid input');
        if (viewer === arrowViewer) {
            await viewer.render(invalid.ctx);
            assert.ok(invalid.container.shadowRoot.querySelector('[role=alert]').textContent);
            invalid.handles[0].dispose();
        } else await assert.rejects(viewer.render(invalid.ctx));
    }
});

test('Detection: font magic, Arrow files/streams, GeoJSON before JSON, and explicit-format fallbacks', async () => {
    const legacyTtf = Buffer.from(ttf);
    legacyTtf.write('true', 0, 'ascii');
    const cases = [
        ['font.dat', ttf, fontViewer.viewType], ['font', woff, fontViewer.viewType],
        ['legacy-font.dat', legacyTtf, fontViewer.viewType],
        ['flag.json', 'true', 'omni-viewer.jsonViewer'],
        ['flags.yaml', 'true: enabled\nfalse: disabled', 'omni-viewer.yamlViewer'],
        ['flags.csv', 'true,false\nyes,no', 'omni-viewer.csvViewer'],
        ['font.TTF', 'invalid', fontViewer.viewType], ['font.otf', 'invalid', fontViewer.viewType],
        ['font.woff', 'invalid', fontViewer.viewType],
        ['arrow.dat', ipc, arrowViewer.viewType], ['stream', stream, arrowViewer.viewType],
        ['table.ARROW', 'invalid', arrowViewer.viewType], ['table.feather', 'invalid', arrowViewer.viewType],
        ['map.geojson', 'invalid', geojsonViewer.viewType], ['map.GEOJSON', geojson, geojsonViewer.viewType],
        ['map.json', geojson, geojsonViewer.viewType], ['map', geojson, geojsonViewer.viewType],
        ['point.dat', '{"type":"Point","coordinates":[127,37.5]}', geojsonViewer.viewType],
        ['generic.json', '{"type":"Point","value":1}', 'omni-viewer.jsonViewer'],
        ['nested.json', '{"data":{"type":"Point","coordinates":[1,2]}}', 'omni-viewer.jsonViewer'],
        ['records.jsonl', '{"type":"Point","coordinates":[1,2]}\n{"type":"Point","coordinates":[3,4]}', 'omni-viewer.jsonlViewer'],
        ['map.md', geojson, 'omni-viewer.markdownViewer']
    ];
    for (const [name, data, expected] of cases) {
        const file = path.join(tempDir, name); await writeFile(file, data);
        assert.equal((await FileUtils.detectViewerType(file)).viewType, expected, name);
    }
    for (const registry of ['src/viewerRegistry.ts', 'src/mobileViewerRegistry.ts']) {
        const source = await readFile(path.join(projectDir, registry), 'utf8');
        for (const name of ['fontViewer', 'arrowViewer', 'geojsonViewer']) {
            assert.match(source, new RegExp(`^    ${name},$`, 'm'));
        }
    }
});
