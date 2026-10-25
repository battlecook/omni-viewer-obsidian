import assert from 'node:assert/strict';
import { createDecipheriv, createCipheriv, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectDir = fileURLToPath(new URL('../', import.meta.url));
const bundled = await build({
    entryPoints: [`${projectDir}src/utils/shareCrypto.ts`],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false
});
const {
    decodeShareKey,
    decryptShareFile,
    encodeShareKey,
    encryptShareFile,
    readShareLinkKey,
    ShareDecryptError
} = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

const meta = { filename: 'clip.wav', content_type: 'application/octet-stream', file_type: '', file_meta: {} };
const fileBytes = new TextEncoder().encode('RIFF fake audio payload');

// Opens an envelope with Node's own AES-GCM so the format is checked against
// the server spec rather than against our decrypt.
function openWithNode(envelope, key) {
    const buf = Buffer.from(envelope);
    assert.equal(buf.subarray(0, 4).toString('ascii'), 'OVS2');
    const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(4, 16));
    decipher.setAAD(Buffer.from('OVS2', 'ascii'));
    decipher.setAuthTag(buf.subarray(buf.length - 16));
    const plain = Buffer.concat([decipher.update(buf.subarray(16, buf.length - 16)), decipher.final()]);
    const metaLength = plain.readUInt32BE(0);
    return { meta: JSON.parse(plain.subarray(4, 4 + metaLength).toString('utf8')), bytes: plain.subarray(4 + metaLength) };
}

test('encrypted envelope matches the OVS2 spec', async () => {
    const { envelope, key } = await encryptShareFile(fileBytes, meta);
    assert.match(key, /^[A-Za-z0-9_-]{43}$/);
    const opened = openWithNode(envelope, Buffer.from(decodeShareKey(key)));
    assert.deepEqual(opened.meta, meta);
    assert.deepEqual(new Uint8Array(opened.bytes), fileBytes);
    assert.equal(envelope.length, 16 + 4 + JSON.stringify(meta).length + fileBytes.length + 16);
});

test('every share gets a fresh key and nonce', async () => {
    const a = await encryptShareFile(fileBytes, meta);
    const b = await encryptShareFile(fileBytes, meta);
    assert.notEqual(a.key, b.key);
    assert.notDeepEqual(a.envelope.subarray(4, 16), b.envelope.subarray(4, 16));
});

test('decrypts an envelope sealed by another client', async () => {
    const key = randomBytes(32);
    const nonce = randomBytes(12);
    const metaJson = Buffer.from(JSON.stringify({ filename: 'a.png', content_type: 'image/png', file_type: 'image' }));
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(metaJson.length);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from('OVS2'));
    const ct = Buffer.concat([cipher.update(Buffer.concat([prefix, metaJson, Buffer.from([1, 2, 3])])), cipher.final()]);
    const envelope = Buffer.concat([Buffer.from('OVS2'), nonce, ct, cipher.getAuthTag()]);
    const encoded = key.toString('base64url');
    assert.equal(readShareLinkKey(`#k=${encoded}`).status, 'valid');

    const opened = await decryptShareFile(new Uint8Array(envelope).buffer, decodeShareKey(encoded));
    assert.equal(opened.meta.filename, 'a.png');
    assert.equal(opened.meta.file_type, 'image');
    assert.deepEqual([...opened.bytes], [1, 2, 3]);
});

test('wrong key, tampering and plaintext uploads are rejected', async () => {
    const { envelope, key } = await encryptShareFile(fileBytes, meta);
    const otherKey = decodeShareKey(encodeShareKey(randomBytes(32)));
    await assert.rejects(decryptShareFile(envelope.slice().buffer, otherKey), ShareDecryptError);

    const tampered = envelope.slice();
    tampered[tampered.length - 1] ^= 1;
    await assert.rejects(decryptShareFile(tampered.buffer, decodeShareKey(key)), ShareDecryptError);

    const fake = new Uint8Array(64);
    fake.set(new TextEncoder().encode('OVS2'));
    await assert.rejects(decryptShareFile(fake.buffer, decodeShareKey(key)), ShareDecryptError);
});

test('link keys are parsed strictly', () => {
    const encoded = encodeShareKey(new Uint8Array(32).fill(7));
    assert.equal(readShareLinkKey('').status, 'absent');
    assert.equal(readShareLinkKey('#other=1').status, 'absent');
    assert.equal(readShareLinkKey(`#k=${encoded}`).status, 'valid');
    assert.equal(readShareLinkKey(`#k=${encoded}=`).status, 'invalid');
    assert.equal(readShareLinkKey(`#k=${encoded.slice(1)}`).status, 'invalid');
    assert.equal(readShareLinkKey(`#k=${encoded}&x=1`).status, 'invalid');
    // The last character holds 4 unused bits; a set bit must not alias the zero key.
    assert.ok(decodeShareKey('A'.repeat(43)));
    assert.equal(decodeShareKey(`${'A'.repeat(42)}B`), null);
});
