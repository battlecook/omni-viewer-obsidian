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
const tempDir = await mkdtemp(path.join(tmpdir(), 'omni-notebook-test-'));
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://obsidian.test' });
const originalGlobals = new Map();
for (const key of ['window', 'document', 'DOMParser', 'XMLSerializer']) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
window.require = createRequire(import.meta.url);
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
        contents: `export { notebookViewer } from './src/viewers/notebookViewer.ts';
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
        }
    }]
});
const { notebookViewer, FileUtils, TFile, Platform } = await import(pathToFileURL(runtimePath));
const bytes = await readFile(new URL('./fixtures/notebook.ipynb', import.meta.url));
const notebook = JSON.parse(bytes);

function vaultFile(filePath, size = 0) {
    return Object.assign(new TFile(), {
        path: filePath, name: path.basename(filePath), extension: path.extname(filePath).slice(1),
        parent: { path: path.posix.dirname(filePath) === '.' ? '' : path.posix.dirname(filePath) },
        stat: { size, mtime: 0 }
    });
}

function context(options = {}) {
    const container = document.createElement('div');
    const handles = [], assetReads = [], resources = [];
    const image = vaultFile('notebooks/images/plot one.png');
    const text = vaultFile('notebooks/notes.txt');
    let readCount = 0, containerCount = 0;
    return {
        ctx: {
            app: { vault: {
                readBinary: async () => { readCount++; return Uint8Array.from(bytes).buffer; },
                getAbstractFileByPath: (value) => {
                    assetReads.push(value);
                    return value === image.path ? image : value === text.path ? text : null;
                },
                adapter: { getResourcePath: (value) => { resources.push(value); return `https://obsidian.test/vault/${encodeURIComponent(value)}`; } }
            } },
            file: vaultFile('notebooks/sample.ipynb', bytes.length), fileName: 'sample.ipynb', filePath: '/vault/notebooks/sample.ipynb',
            host: {
                provideDomContainer() { containerCount++; return container; },
                setCoreViewerHandle(handle) { handles.push(handle); }
            },
            ...options
        },
        container, handles, assetReads, resources,
        get readCount() { return readCount; },
        get containerCount() { return containerCount; }
    };
}

test('renders Markdown/math, highlighted code, saved rich outputs, errors, and raw cells', async () => {
    const host = context();
    await notebookViewer.render(host.ctx);
    const root = host.container;
    assert.equal(root.querySelector('h1').textContent, 'sample.ipynb');
    assert.equal(root.querySelectorAll('.omni-notebook__cell').length, 4);
    assert.ok(root.querySelector('.katex'));
    assert.ok(root.querySelector('.hljs-keyword'));
    assert.match(root.textContent, /In \[3\]:/);
    assert.match(root.textContent, /Out \[3\]:/);
    assert.match(root.textContent, /Saved table/);
    assert.ok(!root.textContent.includes('duplicate fallback'));
    assert.match(root.textContent, /ValueError: saved error/);
    assert.ok(!root.textContent.includes('\u001b'));
    assert.ok(root.textContent.includes('<b>raw text</b>'));
    assert.equal(root.querySelectorAll('img[src^="data:image/png"]').length, 2);
    const svg = root.querySelector('img[src^="data:image/svg+xml"]');
    assert.ok(svg, 'Saved SVG output did not render');
    const svgSource = decodeURIComponent(svg.src.slice(svg.src.indexOf(',') + 1));
    assert.ok(svgSource.includes('<rect'));
    assert.ok(!/script|onload/.test(svgSource));
    assert.equal(root.querySelector('style'), null);
    assert.equal(root.shadowRoot, null);
    host.handles[0].dispose();
    assert.equal(root.children.length, 0);
    assert.ok(!root.classList.contains('omni-viewer--notebook'));
});

test('sanitizes saved HTML and resolves only relative images inside the notebook folder', async () => {
    const host = context();
    await notebookViewer.render(host.ctx);
    await Promise.resolve();
    const root = host.container;
    assert.equal(root.querySelector('script,iframe,object,embed,[onerror],[onclick]'), null);
    assert.equal(root.querySelector('a[href^="javascript:"]'), null);
    assert.equal(root.querySelector('img[src^="https://example.invalid"]'), null);
    assert.equal(window.notebookExecuted, undefined);
    assert.deepEqual(host.assetReads, ['notebooks/images/plot one.png', 'notebooks/notes.txt']);
    assert.deepEqual(host.resources, ['notebooks/images/plot one.png']);
    host.handles[0].dispose();
});

test('searches cells and toggles source/output visibility', async () => {
    const host = context();
    await notebookViewer.render(host.ctx);
    const root = host.container;
    const search = root.querySelector('input[type="search"]');
    search.value = 'ValueError';
    search.dispatchEvent(new window.Event('input'));
    assert.equal([...root.querySelectorAll('.omni-notebook__cell')].filter(card => !card.hidden).length, 1);
    search.value = 'nothing matches';
    search.dispatchEvent(new window.Event('input'));
    assert.equal(root.querySelector('.omni-notebook__empty').hidden, false);
    search.value = '';
    search.dispatchEvent(new window.Event('input'));
    const toggles = [...root.querySelectorAll('input[type="checkbox"]')];
    for (const [toggle, selector] of [[toggles[0], '.omni-notebook__source'], [toggles[1], '.omni-notebook__outputs']]) {
        toggle.checked = false;
        toggle.dispatchEvent(new window.Event('change'));
        assert.ok([...root.querySelectorAll(selector)].every(node => node.hidden));
        toggle.checked = true;
        toggle.dispatchEvent(new window.Event('change'));
        assert.ok([...root.querySelectorAll(selector)].every(node => !node.hidden));
    }
    host.handles[0].dispose();
});

test('opens allowed external links through the Obsidian navigation service', async () => {
    const host = context();
    const originalOpen = window.open;
    let openedUrl;
    window.open = (url) => { openedUrl = url; return null; };
    try {
        await notebookViewer.render(host.ctx);
        const link = [...host.container.querySelectorAll('a[role="link"]')].find(anchor => anchor.textContent === 'Jupyter');
        assert.ok(link);
        link.click();
        assert.equal(openedUrl, 'https://jupyter.org');
    } finally {
        window.open = originalOpen;
        host.handles[0]?.dispose();
    }
});

test('uses vault APIs on mobile and accepts empty notebooks', async () => {
    Platform.isMobileApp = true;
    try {
        const data = new TextEncoder().encode(JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [] }));
        const host = context({ app: { vault: { readBinary: async () => data.buffer } } });
        await notebookViewer.render(host.ctx);
        assert.equal(host.container.querySelectorAll('.omni-notebook__cell').length, 0);
        assert.equal(host.container.querySelector('.omni-notebook__empty').hidden, false);
        host.handles[0].dispose();
    } finally { Platform.isMobileApp = false; }
});

test('rejects oversized input before reading and rejects malformed/legacy notebooks without a handle', async () => {
    const oversized = context({ file: vaultFile('large.ipynb', 64 * 1024 * 1024 + 1) });
    await assert.rejects(notebookViewer.render(oversized.ctx), /above 64 MB/);
    assert.equal(oversized.readCount, 0);
    assert.equal(oversized.containerCount, 0);
    for (const source of ['', '{"nbformat":3,"worksheets":[]}', '{"notebook":false}']) {
        const data = new TextEncoder().encode(source);
        const host = context({ app: { vault: { readBinary: async () => data.buffer } } });
        await assert.rejects(notebookViewer.render(host.ctx));
        assert.equal(host.handles.length, 0);
        assert.equal(host.container.children.length, 0);
    }
});

test('does not mount stale content after cancellation during a vault read or handle registration', async () => {
    const cancelled = new AbortController();
    cancelled.abort();
    const before = context({ signal: cancelled.signal });
    await notebookViewer.render(before.ctx);
    assert.equal(before.readCount, 0);
    const controller = new AbortController();
    const during = context({ signal: controller.signal, app: { vault: { readBinary: async () => {
        controller.abort();
        return Uint8Array.from(bytes).buffer;
    } } } });
    await notebookViewer.render(during.ctx);
    assert.equal(during.containerCount, 0);
    const afterRead = new AbortController();
    const mounted = context({ signal: afterRead.signal });
    mounted.ctx.host.provideDomContainer = () => {
        queueMicrotask(() => afterRead.abort());
        return mounted.container;
    };
    await notebookViewer.render(mounted.ctx);
    assert.equal(mounted.handles.length, 0);
    assert.equal(mounted.container.children.length, 0);
});

test('routes explicit and renamed notebooks ahead of JSON and preserves other JSON formats', async () => {
    for (const [name, source, expected] of [
        ['valid.ipynb', JSON.stringify(notebook), 'notebookViewer'],
        ['valid.json', JSON.stringify(notebook), 'notebookViewer'],
        ['uppercase.IPYNB', JSON.stringify(notebook), 'notebookViewer'],
        ['malformed.ipynb', '{"bad":true}\n{"notebook":false}', 'notebookViewer'],
        ['metadata.json', JSON.stringify({ metadata: { large: 'x'.repeat(24000) }, nbformat: 4, cells: notebook.cells }), 'notebookViewer'],
        ['truncated.json', '{"nbformat":4,"cells":[{"cell_type":"code","source":"' + 'x'.repeat(70000), 'notebookViewer'],
        ['nested.json', JSON.stringify({ metadata: { nbformat: 4, cells: [] } }), 'jsonViewer'],
        ['plain.json', '{"answer":42}', 'jsonViewer'],
        ['records.jsonl', '{"a":1}\n{"b":2}', 'jsonlViewer'],
        ['capture.json', JSON.stringify({ log: { version: '1.2', entries: [] } }), 'harViewer']
    ]) {
        const filePath = path.join(tempDir, name);
        await writeFile(filePath, source);
        const detection = await FileUtils.detectViewerType(filePath, 'omni-viewer.jsonViewer');
        assert.equal(detection.viewType, `omni-viewer.${expected}`, name);
    }
});

test('preserves JSONL streams of notebook records while keeping explicit .ipynb files in the Notebook viewer', async () => {
    const record = JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [] });
    const stream = `${record}\n${record}`;
    for (const [name, source, expected] of [
        ['notebook-records.jsonl', stream, 'jsonlViewer'],
        ['notebook-records.ndjson', stream, 'jsonlViewer'],
        ['notebook-records.jsonlines', stream, 'jsonlViewer'],
        ['notebook-records.json', stream, 'jsonlViewer'],
        ['single-notebook-record.jsonl', record, 'jsonlViewer'],
        ['malformed-stream.ipynb', stream, 'notebookViewer']
    ]) {
        const filePath = path.join(tempDir, name);
        await writeFile(filePath, source);
        const detection = await FileUtils.detectViewerType(filePath, 'omni-viewer.jsonViewer');
        assert.equal(detection.viewType, `omni-viewer.${expected}`, name);
    }
});

test('detects notebook JSONL records larger than the text sample and handles signature boundaries', async () => {
    const makeRecord = (padding) => JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { padding }, cells: [] });
    const largeRecord = makeRecord('x'.repeat(17000));
    const smallRecord = makeRecord('');
    const boundaryRecord = makeRecord('x'.repeat(64 * 1024 - smallRecord.length - 1 - makeRecord('').length));
    const boundaryStream = `${smallRecord}\n${boundaryRecord}`;
    assert.equal(Buffer.byteLength(boundaryStream), 64 * 1024);
    for (const [name, source, expected] of [
        ['large-notebook-records.json', `${largeRecord}\n${largeRecord}`, 'jsonlViewer'],
        ['truncated-notebook-records.json', Array(4).fill(largeRecord).join('\n'), 'jsonlViewer'],
        ['boundary-notebook-records.json', boundaryStream, 'jsonlViewer'],
        ['single-large-notebook.json', largeRecord, 'notebookViewer']
    ]) {
        const filePath = path.join(tempDir, name);
        await writeFile(filePath, source);
        const detection = await FileUtils.detectViewerType(filePath, 'omni-viewer.jsonViewer');
        assert.equal(detection.viewType, `omni-viewer.${expected}`, name);
    }
});

test('detects a JSONL stream when only its first record fits in the signature window', async () => {
    const makeRecord = (padding) => JSON.stringify({ nbformat: 4, nbformat_minor: 5, cells: [], metadata: { padding } });
    const largeRecord = makeRecord('x'.repeat(40000));
    const largerRecord = makeRecord('x'.repeat(70000));
    const smallRecord = makeRecord('');
    const exactBoundaryRecord = makeRecord('x'.repeat(64 * 1024 - smallRecord.length));
    assert.equal(Buffer.byteLength(exactBoundaryRecord), 64 * 1024);
    for (const [name, source, expected] of [
        ['one-complete-record.json', `${largeRecord}\n${largeRecord}`, 'jsonlViewer'],
        ['partial-second-record.json', `${smallRecord}\n${largerRecord}`, 'jsonlViewer'],
        ['blank-line-records.json', `${smallRecord}\r\n\r\n${largerRecord}`, 'jsonlViewer'],
        ['single-truncated-notebook.json', largerRecord, 'notebookViewer'],
        ['single-boundary-notebook.json', exactBoundaryRecord, 'notebookViewer'],
        ['formatted-notebook.json', JSON.stringify(JSON.parse(largerRecord), null, 2), 'notebookViewer']
    ]) {
        const filePath = path.join(tempDir, name);
        await writeFile(filePath, source);
        const detection = await FileUtils.detectViewerType(filePath, 'omni-viewer.jsonViewer');
        assert.equal(detection.viewType, `omni-viewer.${expected}`, name);
    }
});
