import { App, Notice, TFile, normalizePath, requestUrl } from 'obsidian';
import * as path from './shims/desktopPath';
import { openExternal, promptText } from './platform';
import { decryptShareFile, encryptShareFile, readShareLinkKey } from './utils/shareCrypto';

const SHARE_API_BASE = 'https://omni-viewer-share-624036133562.us-west1.run.app';
const WEB_BASE = 'https://omni-viewer-web.web.app';
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const DEFAULT_EXPIRES_IN_MINUTES = 5;
const SHARE_PATH_PATTERN = /\/share\/([^/?#]+)/;
const BARE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const SHARED_DOWNLOAD_FOLDER = 'omni-viewer-shared';
// The only filename `POST /v2/shares` accepts: the real name is sealed in the envelope.
const ENCRYPTED_SHARE_FILENAME = 'encrypted.bin';

type ShareApiVersion = 'v1' | 'v2';

interface HttpResponse {
    status: number;
    body: Buffer;
}

interface UploadTokenResponse {
    upload_token: string;
    token_type?: string;
    expires_in?: number;
    platform?: string;
}

interface CreateShareResponse {
    share_id: string;
    download_url: string;
    expires_at: string;
    file_size: number;
    encryption_version: number;
}

interface DownloadTicket {
    download_url: string;
    // v1 only; v2 tickets carry no name, it is sealed inside the envelope.
    filename?: string;
    content_type: string;
}

function send(method: string, url: string, headers: Record<string, string | number>, body?: Buffer): Promise<HttpResponse> {
    const finalHeaders = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
    const bodyArrayBuffer = body
        ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer
        : undefined;
    return requestUrl({
        url,
        method,
        headers: finalHeaders,
        ...(bodyArrayBuffer ? { body: bodyArrayBuffer } : {}),
        throw: false
    }).then((response) => ({ status: response.status, body: Buffer.from(response.arrayBuffer) }));
}

function postJson(url: string, payload: object, extraHeaders: Record<string, string> = {}): Promise<HttpResponse> {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    return send('POST', url, { 'Content-Type': 'application/json', ...extraHeaders }, body);
}

interface MultipartPart {
    name: string;
    value: string | Buffer;
    filename?: string;
    contentType?: string;
}

function buildMultipartBody(parts: MultipartPart[]): { body: Buffer; contentType: string } {
    const boundary = `----OmniViewerBoundary${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
    const segments: Buffer[] = [];
    for (const part of parts) {
        const escapedName = part.name.replace(/"/g, '\\"');
        let header = `--${boundary}\r\nContent-Disposition: form-data; name="${escapedName}"`;
        if (part.filename !== undefined) {
            const escapedFilename = part.filename.replace(/"/g, '\\"');
            header += `; filename="${escapedFilename}"`;
        }
        header += '\r\n';
        if (part.contentType) {
            header += `Content-Type: ${part.contentType}\r\n`;
        }
        header += '\r\n';
        segments.push(Buffer.from(header, 'utf8'));
        segments.push(typeof part.value === 'string' ? Buffer.from(part.value, 'utf8') : part.value);
        segments.push(Buffer.from('\r\n', 'utf8'));
    }
    segments.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
    return {
        body: Buffer.concat(segments),
        contentType: `multipart/form-data; boundary=${boundary}`
    };
}

function postMultipart(url: string, parts: MultipartPart[], extraHeaders: Record<string, string> = {}): Promise<HttpResponse> {
    const { body, contentType } = buildMultipartBody(parts);
    return send('POST', url, { 'Content-Type': contentType, ...extraHeaders }, body);
}

function extractErrorMessage(res: HttpResponse): string {
    const trimmed = res.body.toString('utf8').trim();
    if (trimmed) {
        try {
            const parsed = JSON.parse(trimmed) as { error?: { message?: string; code?: string }; message?: string };
            const fromError = parsed?.error?.message;
            if (typeof fromError === 'string' && fromError.trim()) return fromError.trim();
            const fromTop = parsed?.message;
            if (typeof fromTop === 'string' && fromTop.trim()) return fromTop.trim();
        } catch {
            return trimmed;
        }
    }
    return `Request failed with status ${res.status}`;
}

async function fetchUploadToken(): Promise<string> {
    const res = await postJson(`${SHARE_API_BASE}/v2/share-upload-tokens`, { platform: 'obsidian' });
    if (res.status < 200 || res.status >= 300) {
        throw new Error(extractErrorMessage(res));
    }
    let parsed: UploadTokenResponse;
    try {
        parsed = JSON.parse(res.body.toString('utf8')) as UploadTokenResponse;
    } catch {
        throw new Error('Invalid response from upload token endpoint.');
    }
    if (!parsed?.upload_token) {
        throw new Error('Upload token missing in response.');
    }
    return parsed.upload_token;
}

async function uploadShare(envelope: Uint8Array, token: string): Promise<CreateShareResponse> {
    const url = `${SHARE_API_BASE}/v2/shares?expires_in_minutes=${DEFAULT_EXPIRES_IN_MINUTES}`;
    // The server rejects any plaintext field beyond platform, is_paid_user,
    // max_access_count and jb_license, so nothing about the file goes here.
    const res = await postMultipart(
        url,
        [
            { name: 'platform', value: 'obsidian' },
            { name: 'is_paid_user', value: 'false' },
            {
                name: 'file',
                value: Buffer.from(envelope.buffer, envelope.byteOffset, envelope.byteLength),
                filename: ENCRYPTED_SHARE_FILENAME,
                contentType: 'application/octet-stream'
            }
        ],
        { 'X-Upload-Token': token }
    );
    if (res.status < 200 || res.status >= 300) {
        throw new Error(extractErrorMessage(res));
    }
    try {
        return JSON.parse(res.body.toString('utf8')) as CreateShareResponse;
    } catch {
        throw new Error('Invalid response from share upload endpoint.');
    }
}

export async function shareFileCommand(app: App, file?: TFile): Promise<void> {
    const target = file ?? app.workspace.getActiveFile() ?? undefined;
    if (!target) {
        new Notice('Omni Viewer: no file selected to share.');
        return;
    }

    if (target.stat.size > MAX_FILE_SIZE_BYTES) {
        new Notice('Omni Viewer: file is too large to share (max 10 MB).');
        return;
    }

    const progressNotice = new Notice(`Omni Viewer: uploading ${target.name}…`, 0);
    try {
        const fileBytes = new Uint8Array(await app.vault.readBinary(target));
        const { envelope, key } = await encryptShareFile(fileBytes, {
            filename: target.name,
            content_type: 'application/octet-stream',
            // Left empty so the receiving viewer detects the type itself, as
            // it did for v1 shares from Obsidian.
            file_type: '',
            file_meta: {}
        });
        // The server limit applies to the envelope, which is slightly larger.
        if (envelope.byteLength > MAX_FILE_SIZE_BYTES) {
            throw new Error('file is too large to share once encrypted (max 10 MB).');
        }
        const token = await fetchUploadToken();
        const share = await uploadShare(envelope, token);
        // The key only ever leaves this client in the link fragment.
        const shareUrl = `${WEB_BASE}/share/${encodeURIComponent(share.share_id)}#k=${key}`;
        await navigator.clipboard.writeText(shareUrl);

        new Notice(
            `Share link copied to clipboard: ${shareUrl} The link is valid for ${DEFAULT_EXPIRES_IN_MINUTES} minutes only, then it expires.`,
            10000
        );
        openExternal(shareUrl);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        new Notice(`Omni Viewer: share failed — ${message}`);
    } finally {
        progressNotice.hide();
    }
}

interface ParsedShareInput {
    shareId: string;
    // The URL's `#...` fragment, which carries the v2 key as `#k=<key>`.
    fragment: string;
}

function parseShareInput(input: string): ParsedShareInput | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const match = trimmed.match(SHARE_PATH_PATTERN);
    if (match && match[1]) {
        let shareId = match[1];
        try {
            shareId = decodeURIComponent(shareId);
        } catch {
            // Keep the raw segment if the URL is malformed.
        }
        const hashIndex = trimmed.indexOf('#');
        return { shareId, fragment: hashIndex >= 0 ? trimmed.slice(hashIndex) : '' };
    }
    if (BARE_ID_PATTERN.test(trimmed)) {
        return { shareId: trimmed, fragment: '' };
    }
    return null;
}

function validateShareInput(value: string): string | null {
    const parsed = parseShareInput(value);
    if (!parsed) return 'Invalid share URL or ID.';
    if (readShareLinkKey(parsed.fragment).status === 'invalid') {
        return 'Invalid share link: the decryption key is malformed.';
    }
    return null;
}

async function fetchTicket(version: ShareApiVersion, shareId: string): Promise<DownloadTicket> {
    const url = `${SHARE_API_BASE}/${version}/shares/${encodeURIComponent(shareId)}/download`;
    const res = await send('GET', url, {});
    if (res.status === 404) {
        throw new Error('Shared file not found.');
    }
    if (res.status === 410) {
        throw new Error('Shared file has expired or reached its access limit.');
    }
    if (res.status < 200 || res.status >= 300) {
        throw new Error(extractErrorMessage(res));
    }
    try {
        return JSON.parse(res.body.toString('utf8')) as DownloadTicket;
    } catch {
        throw new Error('Invalid response from download endpoint.');
    }
}

async function downloadBytes(url: string): Promise<Buffer> {
    const res = await send('GET', url, {});
    if (res.status < 200 || res.status >= 300) {
        throw new Error(`Download failed with status ${res.status}`);
    }
    return res.body;
}

function sanitizeFilename(name: string): string {
    let cleaned = '';
    for (const ch of name) {
        const code = ch.charCodeAt(0);
        if (ch === '/' || ch === '\\' || code < 0x20) {
            cleaned += '_';
        } else {
            cleaned += ch;
        }
    }
    cleaned = cleaned.trim().slice(0, 200);
    // `.` and `..` would resolve outside the download folder.
    return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'shared-file';
}

export async function openSharedLinkCommand(app: App): Promise<void> {
    let initialValue = '';
    try {
        const clipboard = (await navigator.clipboard.readText()).trim();
        if (clipboard.startsWith(`${WEB_BASE}/share`)) {
            initialValue = clipboard;
        }
    } catch {
        // Clipboard access can be denied or unavailable; ignore and start empty.
    }

    const input = await promptText(
        app,
        'Open Omni Viewer shared link',
        `${WEB_BASE}/share/<id>#k=<key> or <id>`,
        (value) => {
            if (!value.trim()) return 'Please enter a share URL or ID.';
            return validateShareInput(value);
        },
        initialValue
    );
    if (!input) return;

    const parsed = parseShareInput(input);
    const linkKey = parsed ? readShareLinkKey(parsed.fragment) : null;
    if (!parsed || !linkKey || linkKey.status === 'invalid') {
        new Notice(`Omni Viewer: ${validateShareInput(input) ?? 'invalid share URL or ID.'}`);
        return;
    }
    const { shareId } = parsed;

    const progressNotice = new Notice('Omni Viewer: downloading shared file…', 0);
    try {
        // A `#k=` key means v2, no key means v1. The server keeps the two
        // apart (each 404s on the other's shares) and a ticket spends an
        // access, so never probe one version and fall back to the other.
        const ticket = await fetchTicket(linkKey.status === 'valid' ? 'v2' : 'v1', shareId);
        let bytes = await downloadBytes(ticket.download_url);
        let filename = ticket.filename;
        if (linkKey.status === 'valid') {
            let opened: Awaited<ReturnType<typeof decryptShareFile>>;
            try {
                opened = await decryptShareFile(
                    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
                    linkKey.key
                );
            } catch {
                // Wrong key, tampered or non-encrypted upload: never save it.
                throw new Error('could not decrypt the shared file. The link may be incomplete or corrupted.');
            }
            bytes = Buffer.from(opened.bytes.buffer, opened.bytes.byteOffset, opened.bytes.byteLength);
            filename = opened.meta.filename;
        }
        const safeName = sanitizeFilename(filename || `share-${shareId}`);

        const folder = normalizePath(SHARED_DOWNLOAD_FOLDER);
        if (!(await app.vault.adapter.exists(folder))) {
            await app.vault.createFolder(folder);
        }

        let targetPath = normalizePath(`${folder}/${safeName}`);
        if (await app.vault.adapter.exists(targetPath)) {
            const ext = path.extname(safeName);
            const base = path.basename(safeName, ext);
            targetPath = normalizePath(`${folder}/${base}-${Date.now()}${ext}`);
        }

        const created = await app.vault.createBinary(
            targetPath,
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
        );
        await app.workspace.getLeaf(true).openFile(created);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        new Notice(`Omni Viewer: download failed — ${message}`);
    } finally {
        progressNotice.hide();
    }
}
