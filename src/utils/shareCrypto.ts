/**
 * Client-side encryption for v2 shares (omni-viewer-server docs/API.md §3.6).
 *
 * Envelope: `OVS2` | 12-byte nonce | AES-256-GCM ciphertext + 16-byte tag,
 * with `OVS2` as the additional data. The plaintext is a 4-byte big-endian
 * metadata JSON length, the UTF-8 metadata JSON, then the original file
 * bytes. The key never reaches the server: it travels in the link fragment
 * as `#k=<key>`, the 32 raw bytes in unpadded base64url (exactly 43 chars).
 *
 * Mirrors `app/utils/shareCrypto.ts` in omni-viewer-web and
 * `src/utils/shareCrypto.ts` in omni-viewer-chrome so links round-trip
 * between clients.
 */

// ASCII `OVS2`.
const MAGIC = Uint8Array.of(0x4f, 0x56, 0x53, 0x32);
const NONCE_LENGTH = 12;
const HEADER_LENGTH = MAGIC.length + NONCE_LENGTH;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const META_LENGTH_PREFIX = 4;
const KEY_FRAGMENT_PREFIX = '#k=';
const ENCODED_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Original file details sealed inside the envelope. */
export interface SharedFileMeta {
    filename: string;
    content_type: string;
    file_type: string;
    file_meta?: Record<string, unknown>;
}

export type ShareLinkKey =
    | { status: 'absent' }
    | { status: 'invalid' }
    | { status: 'valid'; key: Uint8Array<ArrayBuffer> };

/**
 * Raised for anything wrong with the envelope or what it decrypts to. The
 * server cannot check the GCM tag, so a forged or truncated file and a wrong
 * key all land here, and the file must not be shown.
 */
export class ShareDecryptError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ShareDecryptError';
    }
}

export function encodeShareKey(key: Uint8Array): string {
    let binary = '';
    for (const byte of key) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Strict: 43 base64url characters that re-encode to themselves, so the
 * unused trailing bits are zero and every platform agrees on one spelling.
 */
export function decodeShareKey(encoded: string): Uint8Array<ArrayBuffer> | null {
    if (!ENCODED_KEY_PATTERN.test(encoded)) return null;
    let binary: string;
    try {
        binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/') + '=');
    } catch {
        return null;
    }
    if (binary.length !== KEY_LENGTH) return null;
    const key = new Uint8Array(KEY_LENGTH);
    for (let i = 0; i < KEY_LENGTH; i++) key[i] = binary.charCodeAt(i);
    return encodeShareKey(key) === encoded ? key : null;
}

/**
 * v1 links carry no key. Only a `#k=` fragment marks a v2 link, and it must
 * be exactly `#k=<key>` with nothing else alongside it.
 */
export function readShareLinkKey(hash: string): ShareLinkKey {
    if (!hash.startsWith(KEY_FRAGMENT_PREFIX)) return { status: 'absent' };
    const key = decodeShareKey(hash.slice(KEY_FRAGMENT_PREFIX.length));
    return key ? { status: 'valid', key } : { status: 'invalid' };
}

function importKey(raw: Uint8Array<ArrayBuffer>, usage: KeyUsage): Promise<CryptoKey> {
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [usage]);
}

function gcmParams(nonce: Uint8Array<ArrayBuffer>): AesGcmParams {
    return {
        name: 'AES-GCM',
        iv: nonce,
        additionalData: MAGIC,
        tagLength: TAG_LENGTH * 8
    };
}

export async function encryptShareFile(
    fileBytes: Uint8Array,
    meta: SharedFileMeta
): Promise<{ envelope: Uint8Array<ArrayBuffer>; key: string }> {
    // A fresh key per share, so a fresh random nonce never repeats under it.
    const rawKey = crypto.getRandomValues(new Uint8Array(KEY_LENGTH));
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
    const metaBytes = new TextEncoder().encode(JSON.stringify(meta));

    const plaintext = new Uint8Array(META_LENGTH_PREFIX + metaBytes.length + fileBytes.length);
    new DataView(plaintext.buffer).setUint32(0, metaBytes.length, false);
    plaintext.set(metaBytes, META_LENGTH_PREFIX);
    plaintext.set(fileBytes, META_LENGTH_PREFIX + metaBytes.length);

    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
        gcmParams(nonce),
        await importKey(rawKey, 'encrypt'),
        plaintext
    ));
    const envelope = new Uint8Array(HEADER_LENGTH + ciphertext.length);
    envelope.set(MAGIC, 0);
    envelope.set(nonce, MAGIC.length);
    envelope.set(ciphertext, HEADER_LENGTH);
    return { envelope, key: encodeShareKey(rawKey) };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The metadata is authenticated, but it was still written by whoever made
 * the link, so its shape is checked rather than cast.
 */
function parseMeta(bytes: Uint8Array): SharedFileMeta {
    let value: unknown;
    try {
        value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
        throw new ShareDecryptError('invalid metadata JSON');
    }
    if (!isPlainObject(value)) throw new ShareDecryptError('invalid metadata');
    const { filename, content_type: contentType, file_type: fileType, file_meta: fileMeta } = value;
    if (typeof filename !== 'string' || !filename.trim()) throw new ShareDecryptError('invalid filename');
    if (typeof contentType !== 'string') throw new ShareDecryptError('invalid content_type');
    if (typeof fileType !== 'string') throw new ShareDecryptError('invalid file_type');
    if (fileMeta != null && !isPlainObject(fileMeta)) throw new ShareDecryptError('invalid file_meta');
    return {
        filename,
        content_type: contentType,
        file_type: fileType,
        file_meta: fileMeta ?? undefined
    };
}

export async function decryptShareFile(
    envelope: ArrayBuffer,
    key: Uint8Array<ArrayBuffer>
): Promise<{ bytes: Uint8Array<ArrayBuffer>; meta: SharedFileMeta }> {
    const bytes = new Uint8Array(envelope);
    if (bytes.length < HEADER_LENGTH + TAG_LENGTH + META_LENGTH_PREFIX) {
        throw new ShareDecryptError('envelope too short');
    }
    if (MAGIC.some((byte, i) => bytes[i] !== byte)) throw new ShareDecryptError('missing OVS2 header');

    let plaintext: Uint8Array<ArrayBuffer>;
    try {
        plaintext = new Uint8Array(await crypto.subtle.decrypt(
            gcmParams(bytes.slice(MAGIC.length, HEADER_LENGTH)),
            await importKey(key, 'decrypt'),
            bytes.subarray(HEADER_LENGTH)
        ));
    } catch {
        throw new ShareDecryptError('authentication failed');
    }

    if (plaintext.length < META_LENGTH_PREFIX) throw new ShareDecryptError('plaintext too short');
    const metaLength = new DataView(plaintext.buffer).getUint32(0, false);
    if (metaLength > plaintext.length - META_LENGTH_PREFIX) {
        throw new ShareDecryptError('metadata length out of range');
    }
    const metaEnd = META_LENGTH_PREFIX + metaLength;
    const meta = parseMeta(plaintext.subarray(META_LENGTH_PREFIX, metaEnd));
    return { bytes: plaintext.subarray(metaEnd), meta };
}
