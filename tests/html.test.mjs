import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const projectDir = fileURLToPath(new URL('../', import.meta.url));
const tempDir = await mkdtemp(path.join(tmpdir(), 'omni-html-test-'));
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://obsidian.test' });
const originalGlobals = new Map();
for (const key of ['window', 'document']) {
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
        contents: `export { htmlViewer } from './src/viewers/htmlViewer.ts';
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
const { htmlViewer, FileUtils, TFile, Platform } = await import(pathToFileURL(runtimePath));

function context(source, options = {}) {
    const bytes = typeof source === 'string' ? Buffer.from(source) : source;
    const container = document.createElement('div');
    const handles = [];
    let reads = 0, mounts = 0;
    const ctx = {
        app: { vault: { readBinary: async () => {
            reads++;
            options.onRead?.();
            return Uint8Array.from(bytes).buffer;
        } } },
        file: Object.assign(new TFile(), { stat: { size: options.size ?? bytes.length, mtime: 0 } }),
        fileName: 'page.html', filePath: '/vault/page.html',
        host: {
            provideDomContainer() { mounts++; return container; },
            setCoreViewerHandle(handle) { handles.push(handle); }
        },
        signal: options.signal
    };
    return { ctx, container, handles, get reads() { return reads; }, get mounts() { return mounts; } };
}

test('HTML: vault adapter mounts preview/source tabs on desktop and mobile and disposes the frame', async () => {
    for (const mobile of [false, true]) {
        Platform.isMobileApp = mobile;
        try {
            const source = '<!doctype html><html><body><h1>Hello vault</h1></body></html>';
            const host = context(source);
            await htmlViewer.render(host.ctx);
            const root = host.container.shadowRoot;
            const frame = root.querySelector('iframe');
            const pane = root.querySelector('pre');
            const buttons = root.querySelectorAll('button');
            assert.equal(host.reads, 1);
            assert.ok(root.querySelector('style').textContent.includes('.omni-html'));
            assert.deepEqual([...buttons].map(button => button.textContent), ['Preview', 'Source']);
            assert.equal(frame.hidden, false);
            assert.match(frame.srcdoc, /Hello vault/);
            assert.equal(pane.hidden, true);
            buttons[1].click();
            assert.equal(frame.hidden, true);
            assert.equal(pane.hidden, false);
            assert.equal(pane.textContent, source);
            buttons[0].click();
            assert.equal(frame.hidden, false);
            host.handles[0].dispose();
            assert.equal(frame.hasAttribute('srcdoc'), false);
            assert.equal(root.children.length, 0);
        } finally { Platform.isMobileApp = false; }
    }
});

test('HTML: preview retains inline styles/data images and removes active content and remote resources', async () => {
    const source = `<html><head><style>h1{color:red}</style><meta http-equiv="refresh" content="0;url=https://example.com"></head>
<body onload="alert(1)"><h1>Safe</h1><script>alert(1)</script><iframe src="https://example.com"></iframe>
<img src="https://example.com/tracker.png"><img src="data:image/png;base64,AAAA">
<a href="https://example.com">Remote</a><form action="https://example.com"><input></form></body></html>`;
    const host = context(source);
    await htmlViewer.render(host.ctx);
    const frame = host.container.shadowRoot.querySelector('iframe');
    assert.equal(frame.getAttribute('sandbox'), '');
    const preview = new dom.window.DOMParser().parseFromString(frame.srcdoc, 'text/html');
    assert.equal(preview.querySelector('script,iframe,form,[onload],meta[http-equiv="refresh"]'), null);
    assert.equal(preview.querySelector('a').hasAttribute('href'), false);
    assert.equal(preview.querySelector('img').hasAttribute('src'), false);
    assert.ok(preview.querySelector('img[src^="data:image/png"]'));
    assert.match(preview.querySelector('style').textContent, /color:red/);
    assert.match(preview.querySelector('meta[http-equiv="Content-Security-Policy"]').content, /default-src 'none'/);
    host.handles[0].dispose();
});

test('HTML: BOM and declared legacy encodings decode through core', async () => {
    for (const bytes of [
        Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<html><body>café</body></html>', 'utf16le')]),
        Buffer.from('<html><head><meta charset="windows-1252"></head><body>café</body></html>', 'latin1')
    ]) {
        const host = context(bytes);
        await htmlViewer.render(host.ctx);
        assert.match(host.container.shadowRoot.querySelector('pre').textContent, /café/);
        assert.match(host.container.shadowRoot.querySelector('iframe').srcdoc, /café/);
        host.handles[0].dispose();
    }
});

test('HTML: oversized or dense markup uses core source-only mode', async () => {
    for (const source of [Buffer.alloc(8 * 1024 * 1024 + 1, 32), '<p>x</p>'.repeat(10_001)]) {
        const host = context(source);
        await htmlViewer.render(host.ctx);
        const root = host.container.shadowRoot;
        assert.equal(root.querySelector('button').disabled, true);
        assert.equal(root.querySelector('iframe').hasAttribute('srcdoc'), false);
        assert.equal(root.querySelector('pre').hidden, false);
        assert.ok(root.querySelector('pre').textContent.length <= 256 * 1024);
        assert.ok(root.querySelector('.omni-html__note').textContent.length > 0);
        host.handles[0].dispose();
    }
});

test('HTML: refuses excessive vault reads and ignores cancelled loads', async () => {
    const oversized = context('', { size: 64 * 1024 * 1024 + 1 });
    await assert.rejects(htmlViewer.render(oversized.ctx), /above 64 MB/);
    assert.equal(oversized.reads, 0);
    for (const cancelDuringRead of [false, true]) {
        const controller = new AbortController();
        if (!cancelDuringRead) controller.abort();
        const host = context('<p>Old file</p>', {
            signal: controller.signal,
            onRead: () => controller.abort()
        });
        await htmlViewer.render(host.ctx);
        assert.equal(host.reads, cancelDuringRead ? 1 : 0);
        assert.equal(host.mounts, 0);
        assert.equal(host.handles.length, 0);
    }
});

test('HTML: detection preserves explicit extensions, recognises documents, and avoids XML/audio/CSV confusion', async () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<html><body>x</body></html>', 'utf16le')]);
    const cases = [
        ['page.html', '<p>fragment,with,commas</p>', 'omni-viewer.htmlViewer'],
        ['page.HTM', '<?xml version="1.0"?><html><svg/></html>', 'omni-viewer.htmlViewer'],
        ['utf16.html', utf16, 'omni-viewer.htmlViewer'],
        ['utf16.dat', utf16, 'omni-viewer.htmlViewer'],
        ['utf16-document', utf16, 'omni-viewer.htmlViewer'],
        ['audio.dat', Buffer.from([0xff, 0xfb, 0x90, 0x64]), 'omni-viewer.audioViewer'],
        ['non-html-bom.dat', Buffer.from([0xff, 0xfe, 0x90, 0x64]), 'omni-viewer.audioViewer'],
        ['document', '<!-- saved page --><!DOCTYPE html><html><body>a,b,c\nd,e,f</body></html>', 'omni-viewer.htmlViewer'],
        ['renamed.dat', '<html><body>Hello</body></html>', 'omni-viewer.htmlViewer'],
        ['fragment.dat', '<p>fragment</p>', null],
        ['page.xml', '<html><body>Hello</body></html>', 'omni-viewer.xmlViewer'],
        ['page.md', '<html><body>Hello</body></html>', 'omni-viewer.markdownViewer'],
        ['page.csv', '<html><body>a,b,c\nd,e,f</body></html>', 'omni-viewer.csvViewer'],
        ['table.csv', 'a,b,c\nd,e,f', 'omni-viewer.csvViewer'],
        ['image.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>', 'omni-viewer.imageViewer']
    ];
    for (const [name, bytes, expected] of cases) {
        const filePath = path.join(tempDir, name);
        await writeFile(filePath, bytes);
        assert.equal((await FileUtils.detectViewerType(filePath)).viewType, expected, name);
    }
});
