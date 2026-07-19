// Archive format helpers shared with the streaming decoder in `archiveStream.ts`.
//
// The eager path that used to live here (readArchiveFile / readArchiveEntryPreview
// and their per-format readers) is gone: the archive viewer now mounts
// omni-viewer-core, which drives listing and preview lazily through
// `archiveStream.ts`. What remains is the format-specific knowledge that has no
// equivalent in core — `tar` argument construction, `7z -slt` listing parsing,
// and the gzip header's original-name field.

import * as path from 'path';

export interface ArchivePreviewEntry {
    path: string;
    kind: 'file' | 'directory';
    compressedSize: number | null;
    uncompressedSize: number | null;
    modifiedAt: string | null;
}

export function getTarListArgs(filePath: string, compression: 'plain' | 'gzip' | 'bzip2' | 'xz'): string[] {
    switch (compression) {
    case 'gzip':
        return ['-tzf', filePath];
    case 'bzip2':
        return ['-tjf', filePath];
    case 'xz':
        return ['-tJf', filePath];
    case 'plain':
    default:
        return ['-tf', filePath];
    }
}

export function getTarExtractArgs(
    filePath: string,
    entryPath: string,
    compression: 'plain' | 'gzip' | 'bzip2' | 'xz'
): string[] {
    switch (compression) {
    case 'gzip':
        return ['-xOzf', filePath, entryPath];
    case 'bzip2':
        return ['-xOjf', filePath, entryPath];
    case 'xz':
        return ['-xOJf', filePath, entryPath];
    case 'plain':
    default:
        return ['-xOf', filePath, entryPath];
    }
}

export function parseSevenZipListing(
    output: string,
    archivePath: string
): { entries: ArchivePreviewEntry[]; warnings: string[] } {
    const lines = output.split(/\r?\n/);
    const warnings = lines
        .map((line) => line.trim())
        .filter((line) => line.includes('WARNING'));

    const separatorIndex = lines.findIndex((line) => line.trim() === '----------');
    if (separatorIndex === -1) {
        return { entries: [], warnings };
    }

    const records: Array<Record<string, string>> = [];
    let currentRecord: Record<string, string> = {};

    for (const line of lines.slice(separatorIndex + 1)) {
        const trimmed = line.trim();
        if (!trimmed) {
            if (Object.keys(currentRecord).length > 0) {
                records.push(currentRecord);
                currentRecord = {};
            }
            continue;
        }

        const delimiterIndex = line.indexOf(' = ');
        if (delimiterIndex === -1) {
            continue;
        }

        const key = line.slice(0, delimiterIndex).trim();
        const value = line.slice(delimiterIndex + 3).trim();
        currentRecord[key] = value;
    }

    if (Object.keys(currentRecord).length > 0) {
        records.push(currentRecord);
    }

    const entries = records
        .filter((record) => record.Path && record.Path !== archivePath)
        .map((record) => {
            const entryPath = record.Path;
            const isDirectory = record.Folder === '+'
                || entryPath.endsWith('/')
                || (record.Attributes || '').startsWith('D');

            return {
                path: entryPath,
                kind: isDirectory ? 'directory' as const : 'file' as const,
                compressedSize: parseArchiveNumber(record['Packed Size']),
                uncompressedSize: parseArchiveNumber(record.Size),
                modifiedAt: normalizeArchiveDate(record.Modified || record.Created || null)
            };
        })
        .sort((left, right) => left.path.localeCompare(right.path));

    return { entries, warnings };
}

function parseArchiveNumber(value: string | undefined): number | null {
    if (!value) {
        return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeArchiveDate(value: string | null): string | null {
    if (!value) {
        return null;
    }

    const normalized = value.replace(' ', 'T');
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date.toISOString();
}

export function deriveGzipEntryName(filePath: string, buffer: Buffer): string {
    const originalName = readGzipOriginalName(buffer);
    if (originalName) {
        return originalName;
    }

    const baseName = path.basename(filePath);
    if (baseName.toLowerCase().endsWith('.gz')) {
        return baseName.slice(0, -3) || baseName;
    }

    return baseName;
}

function readGzipOriginalName(buffer: Buffer): string | null {
    if (buffer.length < 10 || buffer[0] !== 0x1F || buffer[1] !== 0x8B) {
        return null;
    }

    const flags = buffer[3];
    let offset = 10;

    if (flags & 0x04) {
        if (offset + 2 > buffer.length) {
            return null;
        }
        const extraLength = buffer.readUInt16LE(offset);
        offset += 2 + extraLength;
    }

    if (flags & 0x08) {
        const end = buffer.indexOf(0x00, offset);
        if (end === -1) {
            return null;
        }
        return buffer.subarray(offset, end).toString('utf8');
    }

    return null;
}

export function asBuffer(value: string | Buffer): Buffer {
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
}
