import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

const projectDir = fileURLToPath(new URL('../', import.meta.url));
const tempDir = await mkdtemp(path.join(tmpdir(), 'omni-npy-pt2-ov-test-'));
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://obsidian.test' });
const originalGlobals = new Map();
for (const key of ['window', 'document', 'navigator', 'ShadowRoot', 'HTMLElement', 'Event']) {
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
        contents: `export { numpyViewer } from './src/viewers/numpyViewer.ts';
export { pt2Viewer } from './src/viewers/pt2Viewer.ts';
export { openvinoViewer } from './src/viewers/openvinoViewer.ts';
export { FileUtils } from './src/utils/fileUtils.ts';
export { TFile } from 'obsidian';`,
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
            builder.onResolve({ filter: /generated\/assets$/ }, () => ({ path: 'empty-assets', namespace: 'test' }));
            builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
                contents: 'export const BUNDLED_TEXT_ASSETS = {}; export const BUNDLED_BINARY_ASSETS_BASE64 = {};',
                loader: 'js'
            }));
        }
    }]
});
const { numpyViewer, pt2Viewer, openvinoViewer, FileUtils, TFile } = await import(pathToFileURL(runtimePath));

const MAX_BYTES = 512 * 1024 * 1024;

/** A version-1.0 `.npy` holding a C-ordered little-endian float32 array. */
function npy(shape, values) {
    let header = `{'descr': '<f4', 'fortran_order': False, 'shape': (${shape.join(', ')}${shape.length === 1 ? ',' : ''}), }`;
    header += ' '.repeat(63 - ((10 + header.length) % 64)) + '\n';
    const out = Buffer.alloc(10 + header.length + values.length * 4);
    Buffer.from([0x93, 0x4E, 0x55, 0x4D, 0x50, 0x59, 1, 0]).copy(out);
    out.writeUInt16LE(header.length, 8);
    out.write(header, 10, 'latin1');
    values.forEach((value, index) => out.writeFloatLE(value, 10 + header.length + index * 4));
    return out;
}

/** Parameter → Add(Const) → Result, with the Const's one float in the `.bin`. */
const IR_XML = `<?xml version="1.0"?>
<net name="add_const" version="11">
    <layers>
        <layer id="0" name="x" type="Parameter" version="opset1">
            <data element_type="f32" shape="1,2"/>
            <output><port id="0" precision="FP32" names="x"><dim>1</dim><dim>2</dim></port></output>
        </layer>
        <layer id="1" name="bias" type="Const" version="opset1">
            <data element_type="f32" shape="" offset="0" size="4"/>
            <output><port id="0" precision="FP32"/></output>
        </layer>
        <layer id="2" name="sum" type="Add" version="opset1">
            <data auto_broadcast="numpy"/>
            <input><port id="0" precision="FP32"><dim>1</dim><dim>2</dim></port><port id="1" precision="FP32"/></input>
            <output><port id="2" precision="FP32" names="y"><dim>1</dim><dim>2</dim></port></output>
        </layer>
        <layer id="3" name="y" type="Result" version="opset1">
            <input><port id="0" precision="FP32"><dim>1</dim><dim>2</dim></port></input>
        </layer>
    </layers>
    <edges>
        <edge from-layer="0" from-port="0" to-layer="2" to-port="0"/>
        <edge from-layer="1" from-port="0" to-layer="2" to-port="1"/>
        <edge from-layer="2" from-port="2" to-layer="3" to-port="0"/>
    </edges>
</net>
`;
const IR_BIN = (() => { const bin = Buffer.alloc(4); bin.writeFloatLE(2.5); return bin; })();

const fixtures = {
    'grid.npy': npy([2, 3], [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]),
    'arrays.npz': await readFile(new URL('./fixtures/arrays.npz', import.meta.url)),
    'add.pt2': await readFile(new URL('./fixtures/add.pt2', import.meta.url)),
    'models/add_const.xml': Buffer.from(IR_XML),
    'models/add_const.bin': IR_BIN,
    'models/no_weights.xml': Buffer.from(IR_XML),
    'root.xml': Buffer.from(IR_XML),
    'root.bin': IR_BIN,
    // Unquoted element-text commas: the CSV heuristic skips quoted attribute values.
    'notes.xml': Buffer.from('<?xml version="1.0"?>\n<doc>\n' + '  <row>1,2,3</row>\n'.repeat(5) + '</doc>\n')
};

function vaultFile(filePath, size = fixtures[filePath].length) {
    const file = new TFile();
    const name = filePath.split('/').pop();
    const dir = filePath.split('/').slice(0, -1).join('/');
    Object.assign(file, {
        path: filePath, name,
        extension: name.split('.').pop(),
        basename: name.replace(/\.[^.]+$/, ''),
        parent: { path: dir || '/' },
        stat: { size, mtime: 0 }
    });
    return file;
}

function context(viewer, filePath, options = {}) {
    const container = document.createElement('div');
    const handles = [];
    const reads = [];
    const files = new Map(Object.keys(fixtures).map(key => [key, vaultFile(key)]));
    for (const [key, size] of Object.entries(options.sizes ?? {})) files.set(key, vaultFile(key, size));
    return {
        run: () => viewer.render({
            app: {
                vault: {
                    readBinary: async file => { reads.push(file.path); return Uint8Array.from(fixtures[file.path]).buffer; },
                    getAbstractFileByPath: p => files.get(p) ?? null
                }
            },
            file: files.get(filePath), fileName: files.get(filePath).name, filePath,
            host: {
                provideDomContainer() { return container; },
                setCoreViewerHandle(handle) { handles.push(handle); }
            },
            signal: options.signal
        }),
        container, handles, reads,
        get root() { return container.shadowRoot; }
    };
}

const tab = (root, label) => [...root.querySelectorAll('button')].find(button => button.textContent === label).click();

test('NumPy: mounts an .npy grid and disposes the mount', async () => {
    const host = context(numpyViewer, 'grid.npy');
    await host.run();
    assert.equal(host.root.querySelector('h1').textContent, 'grid.npy');
    assert.match(host.root.querySelector('.omni-numpy__grid tbody').textContent, /0\.5.*5\.5/s);
    host.handles[0].dispose();
    assert.equal(host.root.childNodes.length, 0);
});

test('NumPy: lists every array of an .npz and copies JSON', async () => {
    let copied;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied = text; } } });
    try {
        const host = context(numpyViewer, 'arrays.npz');
        await host.run();
        assert.deepEqual([...host.root.querySelectorAll('.omni-numpy__select option')].map(option => option.textContent.split(' ')[0]).sort(), ['ids', 'weights']);
        [...host.root.querySelectorAll('button')].find(button => /Copy JSON/.test(button.textContent)).click();
        await Promise.resolve();
        assert.match(copied, /weights/);
        host.handles[0].dispose();
    } finally {
        delete navigator.clipboard;
    }
});

test('PyTorch Export: mounts the graph with the Obsidian theme override, removed on dispose', async () => {
    const host = context(pt2Viewer, 'add.pt2');
    await host.run();
    assert.equal(host.root.querySelector('h1').textContent, 'add.pt2');
    assert.equal(host.root.querySelectorAll('.omni-pt2__node').length, 3);
    assert.match(host.root.querySelector('.omni-pt2__node--node').textContent, /aten\.add\.Tensor/);
    const styles = [...host.root.querySelectorAll('style')].map(style => style.textContent);
    assert.ok(styles.some(text => text.includes('.omni-pt2__node--input') && text.includes('--omni-panel-bg')));
    host.handles[0].dispose();
    assert.equal(host.root.childNodes.length, 0);
});

test('OpenVINO: reads the same-named .bin and previews constants', async () => {
    const host = context(openvinoViewer, 'models/add_const.xml');
    await host.run();
    assert.deepEqual(host.reads.sort(), ['models/add_const.bin', 'models/add_const.xml']);
    assert.match(host.root.querySelector('.omni-openvino__subtitle').textContent, /\.bin 4 B/);
    tab(host.root, 'Constants');
    assert.match(host.root.querySelector('tbody').textContent, /2\.5/);
    host.handles[0].dispose();
    assert.equal(host.root.childNodes.length, 0);
});

test('OpenVINO: finds the .bin beside an .xml at the vault root', async () => {
    const host = context(openvinoViewer, 'root.xml');
    await host.run();
    assert.deepEqual(host.reads.sort(), ['root.bin', 'root.xml']);
    host.handles[0].dispose();
});

test('OpenVINO: renders the topology without a .bin, and skips one too large to hold', async () => {
    const missing = context(openvinoViewer, 'models/no_weights.xml');
    await missing.run();
    assert.deepEqual(missing.reads, ['models/no_weights.xml']);
    assert.match(missing.root.textContent, /No \.bin was supplied/);
    assert.equal(missing.root.querySelectorAll('.omni-openvino__node').length, 4);
    missing.handles[0].dispose();

    const oversized = context(openvinoViewer, 'models/add_const.xml', { sizes: { 'models/add_const.bin': MAX_BYTES + 1 } });
    await oversized.run();
    assert.deepEqual(oversized.reads, ['models/add_const.xml']);
    oversized.handles[0].dispose();
});

test('OpenVINO: rejects XML that is not an IR without retaining a handle', async () => {
    const host = context(openvinoViewer, 'notes.xml');
    await assert.rejects(host.run(), /not an OpenVINO IR/);
    assert.equal(host.handles.length, 0);
});

test('every viewer refuses files over 512 MiB before reading and honours an aborted render', async () => {
    for (const [viewer, file] of [[numpyViewer, 'grid.npy'], [pt2Viewer, 'add.pt2'], [openvinoViewer, 'models/add_const.xml']]) {
        const oversized = context(viewer, file, { sizes: { [file]: MAX_BYTES + 1 } });
        await assert.rejects(oversized.run(), /above 512 MB/);
        assert.equal(oversized.reads.length, 0);

        const controller = new AbortController();
        controller.abort();
        const aborted = context(viewer, file, { signal: controller.signal });
        await aborted.run();
        assert.equal(aborted.reads.length, 0);
        assert.equal(aborted.container.shadowRoot, null);
    }
});

test('OpenVINO never claims .xml, which belongs to the XML viewer', () => {
    assert.deepEqual(openvinoViewer.extensions, []);
    assert.deepEqual(numpyViewer.extensions, ['npy', 'npz']);
    assert.deepEqual(pt2Viewer.extensions, ['pt2']);
});

test('detection reroutes renamed arrays and packages, and keeps plain ZIPs in the archive viewer', async () => {
    const write = async (name, bytes) => { const file = path.join(tempDir, name); await writeFile(file, bytes); return file; };
    const zip = async entries => {
        const archive = new JSZip();
        for (const [name, bytes] of Object.entries(entries)) archive.file(name, bytes);
        return archive.generateAsync({ type: 'nodebuffer' });
    };
    const cases = [
        [await write('renamed.dat', fixtures['grid.npy']), undefined, numpyViewer.viewType],
        [await write('arrays.zip', await zip({ 'a.npy': fixtures['grid.npy'], 'b.npy': fixtures['grid.npy'] })), 'omni-viewer.archiveViewer', numpyViewer.viewType],
        [await write('mixed.zip', await zip({ 'a.npy': fixtures['grid.npy'], 'readme.txt': 'hi' })), 'omni-viewer.archiveViewer', 'omni-viewer.archiveViewer'],
        // torch writes archives JSZip rejects, so this also covers the pre-JSZip check.
        [await write('model.zip', fixtures['add.pt2']), 'omni-viewer.archiveViewer', pt2Viewer.viewType],
        [await write('model.pt2', fixtures['add.pt2']), pt2Viewer.viewType, pt2Viewer.viewType],
        [await write('arrays.npz', fixtures['arrays.npz']), numpyViewer.viewType, numpyViewer.viewType]
    ];
    for (const [file, fallback, expected] of cases) {
        assert.equal((await FileUtils.detectViewerType(file, fallback)).viewType, expected, path.basename(file));
    }
});

test('detection routes IR content to OpenVINO and any other .xml to the XML viewer', async () => {
    const ir = path.join(tempDir, 'model.xml');
    await writeFile(ir, IR_XML);
    const detected = await FileUtils.detectViewerType(ir, 'omni-viewer.xmlViewer');
    assert.equal(detected.viewType, openvinoViewer.viewType);

    // Element-text commas read as CSV rows under another extension; the XML
    // extension check comes first and keeps them out.
    const notes = path.join(tempDir, 'notes.xml');
    await writeFile(notes, fixtures['notes.xml']);
    assert.equal((await FileUtils.detectViewerType(notes, openvinoViewer.viewType)).viewType, 'omni-viewer.xmlViewer');
    const asText = path.join(tempDir, 'notes.txt');
    await writeFile(asText, fixtures['notes.xml']);
    assert.equal((await FileUtils.detectViewerType(asText, openvinoViewer.viewType)).viewType, 'omni-viewer.csvViewer');

    // Like core, `.xml` keeps the XML viewer whatever dialect it holds; the
    // ARXML viewer keeps its own extension and extensionless AUTOSAR content.
    const autosar = '<?xml version="1.0"?>\n<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>Ecu</SHORT-NAME></AR-PACKAGE></AR-PACKAGES></AUTOSAR>\n';
    const arxmlAsXml = path.join(tempDir, 'ecu.xml');
    await writeFile(arxmlAsXml, autosar);
    assert.equal((await FileUtils.detectViewerType(arxmlAsXml, 'omni-viewer.xmlViewer')).viewType, 'omni-viewer.xmlViewer');
    const arxmlAsText = path.join(tempDir, 'ecu.txt');
    await writeFile(arxmlAsText, autosar);
    assert.equal((await FileUtils.detectViewerType(arxmlAsText, undefined)).viewType, 'omni-viewer.arxmlViewer');
});

test('detection does not reroute an oversized .npy', async () => {
    const large = path.join(tempDir, 'large.bin');
    await writeFile(large, fixtures['grid.npy']);
    await truncate(large, MAX_BYTES + 1);
    // Neither rerouted to NumPy nor left to the text heuristics, which read the
    // header's commas as CSV.
    for (const fallback of [undefined, 'omni-viewer.hdf5Viewer', numpyViewer.viewType]) {
        const detected = await FileUtils.detectViewerType(large, fallback);
        assert.equal(detected.viewType, fallback ?? null);
        assert.equal(detected.matchedBySignature, false);
    }
});
