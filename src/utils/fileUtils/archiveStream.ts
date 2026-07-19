// Streaming archive decoder for omni-viewer-core.
//
// Core's archive viewer drives listing + single-entry extraction lazily through
// an OpenArchiveHandle and never receives the whole file. This adapter wraps the
// existing path-based logic (JSZip / zlib / system `7z` / `tar`) so multi-GB
// archives are inspected without materializing the archive in renderer memory.
// Entry bytes are bounded per call by the caller's `maxBytes` (execFile
// maxBuffer / a capped gunzip stream), matching core's preview/limit budgets.

import * as fs from 'fs';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import JSZip from 'jszip';
import type { ArchiveEntry, OpenArchiveHandle } from 'omni-viewer-core/viewers/archive';
import {
    asBuffer,
    deriveGzipEntryName,
    getTarExtractArgs,
    getTarListArgs,
    parseSevenZipListing
} from './archive';

const execFileAsync = promisify(execFile);
const LIST_MAX_BUFFER = 16 * 1024 * 1024;
const GZIP_HEADER_BYTES = 4096;

// GUI apps launched outside a login shell (e.g. Obsidian from the macOS Dock)
// inherit a minimal PATH that omits Homebrew/MacPorts, so bare `7z`/`tar`
// resolve to ENOENT. Append the common install dirs so they are found.
const EXTRA_BIN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin', '/usr/bin', '/bin'];
function commandEnv(): NodeJS.ProcessEnv {
    const existing = process.env.PATH ?? '';
    const dirs = [existing, ...EXTRA_BIN_DIRS].filter(Boolean);
    return { ...process.env, PATH: dirs.join(':') };
}

type TarCompression = 'plain' | 'gzip' | 'bzip2' | 'xz';
type ArchiveFormat =
    | { kind: 'zip' }
    | { kind: 'gzip' }
    | { kind: 'sevenzip' }
    | { kind: 'tar'; compression: TarCompression };

function detectFormat(filePath: string): ArchiveFormat {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.zip') || lower.endsWith('.jar') || lower.endsWith('.apk')) return { kind: 'zip' };
    if (lower.endsWith('.rar') || lower.endsWith('.7z') || lower.endsWith('.dmg')) return { kind: 'sevenzip' };
    if (lower.endsWith('.tar')) return { kind: 'tar', compression: 'plain' };
    if (lower.endsWith('.tgz') || lower.endsWith('.tar.gz')) return { kind: 'tar', compression: 'gzip' };
    if (lower.endsWith('.tbz2') || lower.endsWith('.tar.bz2')) return { kind: 'tar', compression: 'bzip2' };
    if (lower.endsWith('.txz') || lower.endsWith('.tar.xz')) return { kind: 'tar', compression: 'xz' };
    if (lower.endsWith('.gz')) return { kind: 'gzip' };
    throw new Error('Unsupported archive format.');
}

function toUint8(buffer: Buffer): Uint8Array {
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

/** Open the archive lazily and return a core OpenArchiveHandle. */
export async function openArchiveStreamHandle(filePath: string, signal?: AbortSignal): Promise<OpenArchiveHandle> {
    const format = detectFormat(filePath);
    switch (format.kind) {
        case 'zip': return openZipHandle(filePath);
        case 'gzip': return openGzipHandle(filePath);
        case 'sevenzip': return openSevenZipHandle(filePath, signal);
        case 'tar': return openTarHandle(filePath, format.compression, signal);
    }
}

async function openZipHandle(filePath: string): Promise<OpenArchiveHandle> {
    const buffer = await fs.promises.readFile(filePath);
    const zip = await JSZip.loadAsync(buffer);
    const files = Object.values(zip.files).sort((left, right) => left.name.localeCompare(right.name));
    const entries: ArchiveEntry[] = files.map((file, index) => {
        const internal = file as JSZip.JSZipObject & { _data?: { compressedSize?: number; uncompressedSize?: number } };
        const modified = file.date instanceof Date && !Number.isNaN(file.date.getTime()) ? file.date.toISOString() : undefined;
        return {
            entryId: index,
            path: file.name,
            isDirectory: file.dir,
            compressedSize: internal._data?.compressedSize,
            uncompressedSize: internal._data?.uncompressedSize,
            modifiedAt: modified
        };
    });
    return {
        entries,
        async extract(entryId) {
            const file = files[entryId];
            if (!file || file.dir) throw new Error('Archive entry not found.');
            return await file.async('uint8array');
        },
        close() { /* JSZip keeps no OS handle */ }
    };
}

async function openGzipHandle(filePath: string): Promise<OpenArchiveHandle> {
    const handle = await fs.promises.open(filePath, 'r');
    let name: string;
    let size: number;
    try {
        const stat = await handle.stat();
        size = stat.size;
        const header = Buffer.alloc(Math.min(size, GZIP_HEADER_BYTES));
        await handle.read(header, 0, header.length, 0);
        name = deriveGzipEntryName(filePath, header);
    } finally {
        await handle.close();
    }
    const entries: ArchiveEntry[] = [{ entryId: 0, path: name, isDirectory: false, compressedSize: size, uncompressedSize: undefined, modifiedAt: undefined }];
    return {
        entries,
        async extract(entryId, options) {
            if (entryId !== 0) throw new Error('Archive entry not found.');
            return await gunzipCapped(filePath, options.maxBytes, options.signal);
        },
        close() { /* nothing to release */ }
    };
}

/** Stream-decompress a gzip file, refusing to buffer past `maxBytes`. */
function gunzipCapped(filePath: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const source = fs.createReadStream(filePath);
        const gunzip = createGunzip();
        const chunks: Buffer[] = [];
        let total = 0;
        let settled = false;
        const cleanup = () => { if (signal) signal.removeEventListener('abort', onAbort); };
        const fail = (error: Error) => { if (settled) return; settled = true; cleanup(); source.destroy(); gunzip.destroy(); reject(error); };
        const done = (value: Uint8Array) => { if (settled) return; settled = true; cleanup(); resolve(value); };
        function onAbort() { fail(new Error('Aborted.')); }
        if (signal) {
            if (signal.aborted) { fail(new Error('Aborted.')); return; }
            signal.addEventListener('abort', onAbort);
        }
        source.on('error', fail);
        gunzip.on('error', fail);
        gunzip.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total > maxBytes) { fail(new Error('Entry exceeds the preview limit.')); return; }
            chunks.push(chunk);
        });
        gunzip.on('end', () => done(toUint8(Buffer.concat(chunks))));
        source.pipe(gunzip);
    });
}

async function openSevenZipHandle(filePath: string, signal?: AbortSignal): Promise<OpenArchiveHandle> {
    const { stdout } = await execFileAsync('7z', ['l', '-slt', filePath], { maxBuffer: LIST_MAX_BUFFER, env: commandEnv(), ...(signal ? { signal } : {}) });
    const { entries: raw } = parseSevenZipListing(stdout, filePath);
    const entries: ArchiveEntry[] = raw.map((entry, index) => ({
        entryId: index,
        path: entry.path,
        isDirectory: entry.kind === 'directory',
        compressedSize: entry.compressedSize ?? undefined,
        uncompressedSize: entry.uncompressedSize ?? undefined,
        modifiedAt: entry.modifiedAt ?? undefined
    }));
    const idToPath = new Map<number, string>(entries.map((entry) => [entry.entryId, entry.path]));
    return {
        entries,
        async extract(entryId, options) {
            const entryPath = idToPath.get(entryId);
            if (entryPath === undefined) throw new Error('Archive entry not found.');
            const result = await execFileAsync('7z', ['x', '-so', filePath, entryPath], { encoding: 'buffer', maxBuffer: options.maxBytes, env: commandEnv(), ...(options.signal ? { signal: options.signal } : {}) });
            return toUint8(asBuffer(result.stdout));
        },
        close() { /* nothing to release */ }
    };
}

async function openTarHandle(filePath: string, compression: TarCompression, signal?: AbortSignal): Promise<OpenArchiveHandle> {
    const { stdout } = await execFileAsync('tar', getTarListArgs(filePath, compression), { maxBuffer: LIST_MAX_BUFFER, env: commandEnv(), ...(signal ? { signal } : {}) });
    const paths = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).sort((left, right) => left.localeCompare(right));
    const entries: ArchiveEntry[] = paths.map((entryPath, index) => ({
        entryId: index,
        path: entryPath,
        isDirectory: entryPath.endsWith('/'),
        compressedSize: undefined,
        uncompressedSize: undefined,
        modifiedAt: undefined
    }));
    const idToPath = new Map<number, string>(entries.map((entry) => [entry.entryId, entry.path]));
    return {
        entries,
        async extract(entryId, options) {
            const entryPath = idToPath.get(entryId);
            if (entryPath === undefined || entryPath.endsWith('/')) throw new Error('Archive entry not found.');
            const result = await execFileAsync('tar', getTarExtractArgs(filePath, entryPath, compression), { encoding: 'buffer', maxBuffer: options.maxBytes, env: commandEnv(), ...(options.signal ? { signal: options.signal } : {}) });
            return toUint8(asBuffer(result.stdout));
        },
        close() { /* nothing to release */ }
    };
}

/** Stream one entry to disk without buffering it whole (core ArchiveEntrySaver). */
export async function saveArchiveEntry(filePath: string, entry: ArchiveEntry, destPath: string, signal?: AbortSignal): Promise<void> {
    const format = detectFormat(filePath);
    if (format.kind === 'zip') {
        const buffer = await fs.promises.readFile(filePath);
        const zip = await JSZip.loadAsync(buffer);
        const file = zip.file(entry.path);
        if (!file) throw new Error('Archive entry not found.');
        await pipeline(file.nodeStream(), fs.createWriteStream(destPath));
        return;
    }
    if (format.kind === 'gzip') {
        await pipeline(fs.createReadStream(filePath), createGunzip(), fs.createWriteStream(destPath), signal ? { signal } : {});
        return;
    }
    const [command, args]: [string, string[]] = format.kind === 'sevenzip'
        ? ['7z', ['e', '-so', filePath, entry.path]]
        : ['tar', getTarExtractArgs(filePath, entry.path, format.compression)];
    await spawnEntryToFile(command, args, destPath, signal);
}

function spawnEntryToFile(command: string, args: string[], destPath: string, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { env: commandEnv(), ...(signal ? { signal } : {}) });
        const stderr: Buffer[] = [];
        child.on('error', reject);
        child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
        pipeline(child.stdout, fs.createWriteStream(destPath))
            .then(() => {
                if (child.exitCode !== null && child.exitCode !== 0) {
                    reject(new Error(Buffer.concat(stderr).toString().trim() || `${command} exited with code ${child.exitCode}`));
                    return;
                }
                child.on('close', (code) => {
                    if (code && code !== 0) reject(new Error(Buffer.concat(stderr).toString().trim() || `${command} exited with code ${code}`));
                    else resolve();
                });
            })
            .catch((error: unknown) => { child.kill(); reject(error instanceof Error ? error : new Error(String(error))); });
    });
}
