import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const projectDir = fileURLToPath(new URL('../', import.meta.url));
const tempDir = await mkdtemp(path.join(tmpdir(), 'omni-pte-test-'));
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://obsidian.test' });
const originalGlobals = new Map();
for (const key of ['window', 'document', 'navigator', 'ShadowRoot', 'HTMLElement', 'Event']) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
window.require = createRequire(import.meta.url);
Object.assign(HTMLElement.prototype, {
    empty() { this.replaceChildren(); },
    createDiv() {
        const element = document.createElement('div');
        this.append(element);
        return element;
    },
    setCssStyles(styles) { Object.assign(this.style, styles); }
});
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
        contents: `export { pteViewer } from './src/viewers/pteViewer.ts';
export { FileUtils } from './src/utils/fileUtils.ts';
export { OmniViewerView } from './src/omniViewerView.ts';
export { Platform } from 'obsidian';`,
        resolveDir: projectDir,
        loader: 'ts'
    },
    outfile: runtimePath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    plugins: [{
        name: 'obsidian-test-host',
        setup(builder) {
            builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: path.join(projectDir, 'tests/helpers/obsidian.mjs') }));
            // PTE mounts directly; legacy iframe assets are irrelevant here.
            builder.onResolve({ filter: /generated\/assets$/ }, () => ({ path: 'empty-assets', namespace: 'test' }));
            builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
                contents: 'export const BUNDLED_TEXT_ASSETS = {}; export const BUNDLED_BINARY_ASSETS_BASE64 = {};',
                loader: 'js'
            }));
        }
    }]
});
const { pteViewer, FileUtils, OmniViewerView, Platform } = await import(pathToFileURL(runtimePath));
const bytes = await readFile(new URL('./fixtures/program.pte', import.meta.url));
const file = (name = 'program.pte', size = bytes.length) => ({ name, path: name, extension: 'pte', stat: { size, mtime: 0 } });
const data = () => Uint8Array.from(bytes).buffer;
const pending = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};

function context(options = {}) {
    const container = document.createElement('div');
    const handles = [];
    let readCount = 0;
    let containerCount = 0;
    return {
        ctx: {
            app: { vault: { readBinary: async () => { readCount++; return data(); } } },
            file: file(), fileName: 'program.pte', filePath: 'program.pte',
            host: {
                provideDomContainer() { containerCount++; return container; },
                setCoreViewerHandle(handle) { handles.push(handle); }
            },
            ...options
        },
        container, handles,
        get readCount() { return readCount; },
        get containerCount() { return containerCount; }
    };
}

test('mounts the core graph, switches methods, searches tables, and copies JSON', async () => {
    let copied;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied = text; } } });
    const host = context();
    await pteViewer.render(host.ctx);
    const root = host.container.shadowRoot;
    assert.ok(root.querySelector('style').textContent.includes('.omni-pte'));
    assert.equal(root.querySelector('h1').textContent, 'program.pte');
    assert.equal(root.querySelectorAll('.omni-pte__node--node').length, 3);
    assert.equal(root.querySelectorAll('.omni-pte__node--constant').length, 2);
    const buttons = () => [...root.querySelectorAll('button')];
    const tab = label => buttons().find(button => button.textContent === label).click();
    const search = text => {
        const input = root.querySelector('input[type="search"]');
        input.value = text;
        input.dispatchEvent(new Event('input'));
    };
    tab('Instructions');
    search('relu');
    assert.equal(root.querySelectorAll('tbody tr').length, 1);
    assert.match(root.querySelector('tbody').textContent, /aten::relu\.out/);
    search('');
    const picker = root.querySelector('select');
    assert.equal(picker.hidden, false);
    picker.value = '1';
    picker.dispatchEvent(new Event('change'));
    tab('Delegates');
    assert.match(root.querySelector('tbody').textContent, /XnnpackBackend/);
    tab('Segments');
    assert.equal(root.querySelectorAll('tbody tr').length, 4);
    buttons().find(button => /Copy JSON/i.test(button.textContent)).click();
    await Promise.resolve();
    assert.equal(JSON.parse(copied).format, 'pte');
    assert.deepEqual(JSON.parse(copied).methods.map(method => method.name), ['forward', 'delegated']);
    host.handles[0].dispose();
    assert.equal(root.childNodes.length, 0);
    delete navigator.clipboard;
});

test('renders without a clipboard service', async () => {
    const host = context();
    await pteViewer.render(host.ctx);
    const button = [...host.container.shadowRoot.querySelectorAll('button')].find(button => /Copy JSON/i.test(button.textContent));
    assert.equal(button.disabled, true);
    host.handles[0].dispose();
});

test('graph and inspector labels remain readable in light and dark themes', async () => {
    const host = context();
    await pteViewer.render(host.ctx);
    const root = host.container.shadowRoot;
    root.querySelector('.omni-pte__node--constant').click();
    assert.ok(root.querySelector('.omni-pte__attribute b'));
    const luminance = color => {
        const channels = color.match(/\d+(?:\.\d+)?/g).slice(0, 3).map(Number);
        return channels.map(channel => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    };
    try {
        for (const [foreground, muted, background] of [['#222222', '#666666', '#f5f5f5'], ['#dddddd', '#aaaaaa', '#20242b']]) {
            const preview = new JSDOM('<!doctype html><body></body>');
            try {
                const palette = {
                    '--omni-fg': foreground, '--omni-muted': muted,
                    '--omni-bg': background, '--omni-panel-bg': background, '--omni-button-bg': background
                };
                const style = preview.window.document.createElement('style');
                // JSDOM does not resolve shadow CSS or custom properties. Apply
                // the mounted styles to a clone with explicit host theme tokens.
                style.textContent = [...root.querySelectorAll('style')].map(item => item.textContent).join('\n')
                    .replace(/var\((--[\w-]+),([^()]*)\)/g, (_match, token, fallback) => palette[token] ?? fallback);
                preview.window.document.head.append(style);
                preview.window.document.body.append(preview.window.document.importNode(root.querySelector('.omni-pte'), true));
                const inheritedColor = element => {
                    const color = preview.window.getComputedStyle(element).color;
                    return color && color !== 'inherit' ? color : inheritedColor(element.parentElement);
                };
                for (const label of preview.window.document.querySelectorAll('.omni-pte__node strong, .omni-pte__node small, .omni-pte__attribute b')) {
                    const surface = label.closest('.omni-pte__node') ?? label.closest('.omni-pte__inspector');
                    const a = luminance(inheritedColor(label));
                    const b = luminance(preview.window.getComputedStyle(surface).backgroundColor);
                    const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
                    assert.ok(contrast >= 4.5, `${label.textContent}: contrast ${contrast.toFixed(2)} with ${foreground} theme text`);
                }
            } finally {
                preview.window.close();
            }
        }
    } finally {
        host.handles[0].dispose();
    }
    assert.equal(root.childNodes.length, 0);
});

test('rejects files over 512 MiB before reading them, and accepts the boundary', async () => {
    const oversized = context({ file: file('large.pte', 512 * 1024 * 1024 + 1) });
    await assert.rejects(pteViewer.render(oversized.ctx), /above 512 MB/);
    assert.equal(oversized.readCount, 0);
    assert.equal(oversized.containerCount, 0);
    const boundary = context({ file: file('boundary.pte', 512 * 1024 * 1024) });
    await pteViewer.render(boundary.ctx);
    boundary.handles[0].dispose();
});

test('rejects unsupported hosts before reading the vault', async () => {
    const host = context({ host: {} });
    await assert.rejects(pteViewer.render(host.ctx), /direct DOM mounting/);
    assert.equal(host.readCount, 0);
});

test('rejects empty and truncated programs without retaining a viewer handle', async () => {
    for (const invalid of [new Uint8Array(), bytes.subarray(0, 20)]) {
        const host = context({ app: { vault: { readBinary: async () => Uint8Array.from(invalid).buffer } } });
        await assert.rejects(pteViewer.render(host.ctx));
        assert.equal(host.handles.length, 0);
        assert.equal(host.container.shadowRoot, null);
    }
});

test('an aborted render never reads or clears the current container', async () => {
    const controller = new AbortController();
    controller.abort();
    const host = context({ signal: controller.signal });
    await pteViewer.render(host.ctx);
    assert.equal(host.readCount, 0);
    assert.equal(host.containerCount, 0);
});

test('cleans up a mount aborted before its handle is registered', async () => {
    const controller = new AbortController();
    const host = context({ signal: controller.signal });
    host.ctx.host.provideDomContainer = () => {
        queueMicrotask(() => controller.abort());
        return host.container;
    };
    await pteViewer.render(host.ctx);
    assert.equal(host.handles.length, 0);
    assert.equal(host.container.shadowRoot.childNodes.length, 0);
});

function viewWithReads(reads) {
    Platform.isMobileApp = true;
    const app = { vault: { adapter: {}, readBinary: item => reads.get(item.name).promise } };
    return new OmniViewerView({ app }, pteViewer, '', '', new Set([pteViewer.viewType]));
}

test('switching files prevents a slow older read from replacing the new program', async () => {
    const oldRead = pending();
    const newRead = pending();
    const view = viewWithReads(new Map([['old.pte', oldRead], ['new.pte', newRead]]));
    const oldRender = view.onLoadFile(file('old.pte'));
    const newRender = view.onLoadFile(file('new.pte'));
    newRead.resolve(data());
    await newRender;
    const container = view.contentEl.firstElementChild;
    oldRead.resolve(data());
    await oldRender;
    assert.equal(view.contentEl.firstElementChild, container);
    assert.equal(container.shadowRoot.querySelector('h1').textContent, 'new.pte');
    await view.onUnloadFile(file('new.pte'));
    assert.equal(container.shadowRoot.childNodes.length, 0);
});

test('unloading a file or view cancels a pending vault read', async () => {
    for (const unload of [view => view.onUnloadFile(file()), view => view.onunload()]) {
        const read = pending();
        const view = viewWithReads(new Map([['program.pte', read]]));
        const render = view.onLoadFile(file());
        await unload(view);
        read.resolve(data());
        await render;
        assert.equal(view.contentEl.childNodes.length, 0);
    }
});

test('signature detection reroutes renamed programs and preserves other formats', async () => {
    Platform.isMobileApp = false;
    const renamed = path.join(tempDir, 'renamed.json');
    await writeFile(renamed, bytes);
    const detected = await FileUtils.detectViewerType(renamed, 'omni-viewer.jsonViewer');
    assert.equal(detected.viewType, pteViewer.viewType);
    assert.equal(detected.matchedBySignature, true);
    for (const [identifier, expected] of [['TFL3', 'omni-viewer.tfliteViewer'], ['FT01', null], ['ET13', null]]) {
        const other = path.join(tempDir, `${identifier}.bin`);
        await writeFile(other, Buffer.concat([Buffer.alloc(4), Buffer.from(identifier), Buffer.alloc(64)]));
        assert.equal((await FileUtils.detectViewerType(other)).viewType, expected);
    }
    assert.deepEqual(pteViewer.extensions, ['pte']);
});

test('signature detection does not reroute an oversized program', async () => {
    const large = path.join(tempDir, 'large.bin');
    await writeFile(large, bytes);
    // A sparse file exercises the actual filesystem limit without allocating weights.
    await truncate(large, 512 * 1024 * 1024 + 1);
    const detected = await FileUtils.detectViewerType(large, 'omni-viewer.onnxViewer');
    assert.notEqual(detected.viewType, pteViewer.viewType);
    assert.equal(detected.matchedBySignature, false);
});
