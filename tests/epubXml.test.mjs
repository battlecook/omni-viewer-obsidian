import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

const projectDir = fileURLToPath(new URL('../', import.meta.url));
const tempDir = await mkdtemp(path.join(tmpdir(), 'omni-epub-xml-test-'));
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://obsidian.test' });
const originalGlobals = new Map();
for (const key of ['window', 'document', 'navigator', 'ShadowRoot', 'HTMLElement', 'Element', 'Node', 'Event', 'DOMParser', 'AbortController', 'AbortSignal']) {
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
        contents: `export { epubViewer } from './src/viewers/epubViewer.ts';
export { xmlViewer } from './src/viewers/xmlViewer.ts';
export { openvinoViewer } from './src/viewers/openvinoViewer.ts';
export { FileUtils } from './src/utils/fileUtils.ts';
export { TFile, Platform } from 'obsidian';`,
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
const { epubViewer, xmlViewer, openvinoViewer, FileUtils, TFile, Platform } = await import(pathToFileURL(runtimePath));

const EPUB_MAX_BYTES = 256 * 1024 * 1024;
const XML_MAX_BYTES = 64 * 1024 * 1024;
const IR_MAX_BYTES = 512 * 1024 * 1024;

const chapter = (title, body) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body>${body}</body></html>`;

/** An EPUB 3 book: stored `mimetype` first, then deflated members — under
 *  `word/` and `xl/` folders, which the Office checks would claim. */
async function epub() {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="word/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
    zip.file('word/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">urn:uuid:omni-test</dc:identifier>
    <dc:title>The Test Book</dc:title>
    <dc:creator>Omni Tester</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="../xl/one.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="../xl/two.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`);
    zip.file('word/nav.xhtml', chapter('Contents', `<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc"><ol>
<li><a href="../xl/one.xhtml">Opening</a></li><li><a href="../xl/two.xhtml">Closing</a></li></ol></nav>`));
    zip.file('xl/one.xhtml', chapter('Opening',
        '<h1>Opening</h1><p>It was a quiet vault.</p><script>window.__epubScriptRan = true;</script>'
        + '<p><a href="https://example.com/">outside</a></p>'));
    zip.file('xl/two.xhtml', chapter('Closing', '<h1>Closing</h1><p>The end of the book.</p>'));
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const IR_XML = `<?xml version="1.0"?>
<net name="tiny" version="11">
    <layers>
        <layer id="0" name="x" type="Parameter" version="opset1">
            <data element_type="f32" shape="1"/>
            <output><port id="0" precision="FP32"><dim>1</dim></port></output>
        </layer>
        <layer id="1" name="out" type="Result" version="opset1">
            <input><port id="0" precision="FP32"><dim>1</dim></port></input>
        </layer>
    </layers>
    <edges><edge from-layer="0" from-port="0" to-layer="1" to-port="0"/></edges>
</net>
`;

const fixtures = {
    'book.epub': await epub(),
    'feed.rss': Buffer.from('<?xml version="1.0"?>\n<rss version="2.0"><channel><title>Feed</title></channel></rss>\n'),
    'catalog.xml': Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:x="urn:extra">
  <!-- two books -->
  <book id="b1" x:shelf="3"><title>Alpha</title><price>1,50</price></book>
  <book id="b2"><title>Beta</title><price>2,75</price></book>
</catalog>
`),
    'broken.xml': Buffer.from('<?xml version="1.0"?>\n<root><open></root>\n'),
    'model.xml': Buffer.from(IR_XML)
};

function vaultFile(filePath, size = fixtures[filePath].length) {
    const file = new TFile();
    const name = filePath.split('/').pop();
    Object.assign(file, {
        path: filePath, name,
        extension: name.split('.').pop(),
        basename: name.replace(/\.[^.]+$/, ''),
        parent: { path: '/' },
        stat: { size, mtime: 0 }
    });
    return file;
}

function context(viewer, filePath, options = {}) {
    const containers = [];
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
                provideDomContainer() {
                    const container = document.createElement('div');
                    document.body.append(container);
                    containers.push(container);
                    return container;
                },
                setCoreViewerHandle(handle) { handles.push(handle); }
            },
            signal: options.signal
        }),
        containers, handles, reads,
        get root() { return containers.at(-1)?.shadowRoot; }
    };
}

/** Visible text, without the CSS the viewers inject into their shadow root. */
const text = root => [...root.children].filter(node => node.tagName !== 'STYLE').map(node => node.textContent).join(' ');
const settle = () => new Promise(resolve => setTimeout(resolve, 50));

test('EPUB: opens the first chapter sanitized, lists the book contents, and disposes the mount', async () => {
    const host = context(epubViewer, 'book.epub');
    await host.run();
    await settle();
    const visible = text(host.root);
    assert.match(visible, /The Test Book/);
    assert.match(visible, /It was a quiet vault\./);
    assert.match(visible, /Closing/);
    assert.doesNotMatch(visible, /epub\.[a-z-]+\.[a-z-]+/, 'no untranslated catalog keys');
    assert.equal(host.root.querySelector('script'), null);
    assert.equal(window.__epubScriptRan, undefined);
    host.handles[0].dispose();
    assert.equal([...host.root.children].filter(node => node.tagName !== 'STYLE').length, 0);
});

test('EPUB: moves to the next chapter through the handle', async () => {
    const host = context(epubViewer, 'book.epub');
    await host.run();
    await settle();
    host.handles[0].goTo(1);
    await settle();
    assert.equal(host.handles[0].currentIndex(), 1);
    assert.match(text(host.root), /The end of the book\./);
    host.handles[0].dispose();
});

test('XML: mounts the element tree and the source, and disposes the mount', async () => {
    const host = context(xmlViewer, 'catalog.xml');
    await host.run();
    await settle();
    const visible = text(host.root);
    assert.match(visible, /catalog/);
    assert.match(visible, /book/);
    assert.doesNotMatch(visible, /xml\.[a-z-]+\.[a-z-]+/, 'no untranslated catalog keys');
    host.handles[0].dispose();
    assert.equal([...host.root.children].filter(node => node.tagName !== 'STYLE').length, 0);
});

test('XML: reports a malformed document in its own failure view', async () => {
    const host = context(xmlViewer, 'broken.xml');
    await host.run();
    assert.equal(host.handles.length, 1);
    assert.ok(text(host.root).length > 0);
    host.handles[0].dispose();
});

/** Runs `body` as Obsidian mobile, where nothing is rerouted by content. */
async function onMobile(body) {
    Platform.isMobileApp = true;
    try { await body(); } finally { Platform.isMobileApp = false; }
}

test('XML on mobile: hands an OpenVINO IR to the OpenVINO renderer without reading it twice', () => onMobile(async () => {
    const host = context(xmlViewer, 'model.xml');
    await host.run();
    assert.deepEqual(host.reads, ['model.xml']);
    assert.equal(host.containers.length, 1);
    assert.equal(host.root.querySelectorAll('.omni-openvino__node').length, 2);
    host.handles[0].dispose();
}));

test('XML on mobile: an .xml over the XML limit is still handed over when it is an IR, and refused otherwise', () => onMobile(async () => {
    const ir = context(xmlViewer, 'model.xml', { sizes: { 'model.xml': XML_MAX_BYTES + 1 } });
    await ir.run();
    assert.equal(ir.root.querySelectorAll('.omni-openvino__node').length, 2);
    ir.handles[0].dispose();

    const plain = context(xmlViewer, 'catalog.xml', { sizes: { 'catalog.xml': XML_MAX_BYTES + 1 } });
    await assert.rejects(plain.run(), /above 64 MB and OpenVINO topologies above 512 MB/);
    assert.equal(plain.containers.length, 0);

    const huge = context(xmlViewer, 'catalog.xml', { sizes: { 'catalog.xml': IR_MAX_BYTES + 1 } });
    await assert.rejects(huge.run(), /OpenVINO topologies above 512 MB/);
    assert.equal(huge.reads.length, 0);
}));

test('XML on desktop: refuses an .xml over the XML limit before reading, since an IR was rerouted already', async () => {
    const host = context(xmlViewer, 'catalog.xml', { sizes: { 'catalog.xml': XML_MAX_BYTES + 1 } });
    await assert.rejects(host.run(), /XML documents above 64 MB cannot be opened/);
    assert.equal(host.reads.length, 0);
});

test('both viewers refuse oversized files before reading and honour an aborted render', async () => {
    for (const [viewer, file, max] of [[epubViewer, 'book.epub', EPUB_MAX_BYTES], [xmlViewer, 'feed.rss', XML_MAX_BYTES]]) {
        const oversized = context(viewer, file, { sizes: { [file]: max + 1 } });
        await assert.rejects(oversized.run(), new RegExp(`above ${max / (1024 * 1024)} MB`));
        assert.equal(oversized.reads.length, 0);

        const controller = new AbortController();
        controller.abort();
        const aborted = context(viewer, file, { signal: controller.signal });
        await aborted.run();
        assert.equal(aborted.reads.length, 0);
        assert.equal(aborted.containers.length, 0);
    }
});

test('the viewers claim core\'s extensions', () => {
    assert.deepEqual(epubViewer.extensions, ['epub']);
    assert.ok(xmlViewer.extensions.includes('xml'));
    assert.ok(xmlViewer.extensions.includes('gpx'));
    assert.ok(!xmlViewer.extensions.includes('arxml'));
    assert.ok(!xmlViewer.extensions.includes('reqif'));
});

test('detection routes EPUB containers and XML text', async () => {
    const write = async (name, bytes) => { const file = path.join(tempDir, name); await writeFile(file, bytes); return file; };
    const svgLike = '<?xml version="1.0"?>\n<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">'
        + '<xsl:template match="/"><svg xmlns="http://www.w3.org/2000/svg"/></xsl:template></xsl:stylesheet>\n';
    const cases = [
        // Chapters under `word/` and `xl/` must not read as Office documents.
        [await write('book.epub', fixtures['book.epub']), epubViewer.viewType, epubViewer.viewType],
        [await write('book.dat', fixtures['book.epub']), undefined, epubViewer.viewType],
        // An archive extension keeps the archive viewer, as in core.
        [await write('book.zip', fixtures['book.epub']), 'omni-viewer.archiveViewer', 'omni-viewer.archiveViewer'],
        [await write('catalog.xml', fixtures['catalog.xml']), xmlViewer.viewType, xmlViewer.viewType],
        [await write('track.gpx', '<?xml version="1.0"?>\n<gpx version="1.1"><trk><name>a,b,c</name></trk></gpx>\n'), xmlViewer.viewType, xmlViewer.viewType],
        // The loose SVG test would send this XSLT to the image viewer.
        [await write('chart.xslt', svgLike), xmlViewer.viewType, xmlViewer.viewType],
        // A UTF-16LE byte-order mark (`FF FE`) passes the MP3 frame-sync test.
        [await write('task.xml', Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('<?xml version="1.0" encoding="UTF-16"?>\n<Task/>\n', 'utf16le')])), xmlViewer.viewType, xmlViewer.viewType],
        [await write('strings.resx', Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('<root><data name="a"/></root>', 'utf16le')])), xmlViewer.viewType, xmlViewer.viewType],
        [await write('icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>\n'), 'omni-viewer.imageViewer', 'omni-viewer.imageViewer'],
        // SVGs the image viewer's quick test misses must not leave it for XML.
        [await write('sketch.svg', '<!-- Generator: Sketch -->\n<svg xmlns="http://www.w3.org/2000/svg"/>\n'), 'omni-viewer.imageViewer', 'omni-viewer.imageViewer'],
        [await write('doctype.svg', '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg xmlns="http://www.w3.org/2000/svg"/>\n'), 'omni-viewer.imageViewer', 'omni-viewer.imageViewer'],
        [await write('licensed.svg', `<?xml version="1.0"?>\n<!-- ${'licence '.repeat(400)} -->\n<svg xmlns="http://www.w3.org/2000/svg"/>\n`), 'omni-viewer.imageViewer', 'omni-viewer.imageViewer'],
        // XML content under another viewer's extension keeps that viewer.
        [await write('report.xls', '<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"/>\n'), 'omni-viewer.excelViewer', 'omni-viewer.excelViewer'],
        [await write('page.txt', '<!DOCTYPE html>\n<html><body>a,b,c\nd,e,f\n</body></html>\n'), undefined, 'omni-viewer.csvViewer'],
        [await write('ecu.arxml', '<?xml version="1.0"?>\n<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>E</SHORT-NAME></AR-PACKAGE></AR-PACKAGES></AUTOSAR>\n'), 'omni-viewer.arxmlViewer', 'omni-viewer.arxmlViewer'],
        [await write('model.xml', IR_XML), xmlViewer.viewType, openvinoViewer.viewType]
    ];
    for (const [file, fallback, expected] of cases) {
        assert.equal((await FileUtils.detectViewerType(file, fallback)).viewType, expected, path.basename(file));
    }
});
