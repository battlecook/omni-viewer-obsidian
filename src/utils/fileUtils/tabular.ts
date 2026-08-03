import * as fs from '../../shims/desktopFs';
import * as path from '../../shims/desktopPath';
import * as XLSX from 'xlsx';
import { getFileSize } from './media';

const DEFAULT_DELIMITER = ',';
type TableCell = unknown;
type TableRow = TableCell[];

export function getDelimitedFileDelimiter(filePath: string, lines: string[] = []): string {
    if (path.extname(filePath).toLowerCase() === '.tsv') {
        return '\t';
    }

    return detectDelimiter(lines) ?? DEFAULT_DELIMITER;
}

export async function readJsonlFile(filePath: string): Promise<{
    lines: Array<{ lineNumber: number; content: string; parsedJson?: unknown; isValid: boolean }>;
    totalLines: number;
    validLines: number;
    invalidLines: number;
    fileSize: string;
}> {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return {
        ...parseJsonlContent(content),
        fileSize: await getFileSize(filePath)
    };
}

export async function readJsonlFilePreview(
    filePath: string,
    previewBytes = 10 * 1024 * 1024
): Promise<{
    lines: Array<{ lineNumber: number; content: string; parsedJson?: unknown; isValid: boolean }>;
    totalLines: number;
    validLines: number;
    invalidLines: number;
    fileSize: string;
    isPreview: boolean;
    previewBytes: number;
    loadedBytes: number;
    totalBytes: number;
    hasMoreContent: boolean;
}> {
    const stats = await fs.promises.stat(filePath);
    const totalBytes = stats.size;
    const fileSize = await getFileSize(filePath);

    if (totalBytes <= previewBytes) {
        return {
            ...(await readJsonlFile(filePath)),
            isPreview: false,
            previewBytes,
            loadedBytes: totalBytes,
            totalBytes,
            hasMoreContent: false
        };
    }

    const fileHandle = await fs.promises.open(filePath, 'r');

    try {
        const buffer = Buffer.alloc(previewBytes);
        const { bytesRead } = await fileHandle.read(buffer, 0, previewBytes, 0);
        const previewContent = trimPartialJsonlChunk(buffer.subarray(0, bytesRead).toString('utf8'));
        const loadedBytes = Buffer.byteLength(previewContent, 'utf8');

        return {
            ...parseJsonlContent(previewContent),
            fileSize,
            isPreview: true,
            previewBytes,
            loadedBytes,
            totalBytes,
            hasMoreContent: loadedBytes < totalBytes
        };
    } finally {
        await fileHandle.close();
    }
}

export async function readExcelFile(filePath: string): Promise<{
    sheetNames: string[];
        sheets: Array<{
        name: string;
        headers: string[];
        rows: TableRow[];
        totalRows: number;
        totalColumns: number;
    }>;
    fileSize: string;
}> {
    const stats = await fs.promises.stat(filePath);
    const fileSizeBytes = stats.size;
    const maxExcelFileSize = 50 * 1024 * 1024;
    if (fileSizeBytes > maxExcelFileSize) {
        throw new Error(`File too large (${(fileSizeBytes / 1024 / 1024).toFixed(1)}MB). Maximum size is ${maxExcelFileSize / 1024 / 1024}MB.`);
    }

    const buffer = await fs.promises.readFile(filePath);
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetNames = workbook.SheetNames || [];
    const sheets = sheetNames.map((name) => buildSheetSummary(name, workbook.Sheets[name]));

    return {
        sheetNames,
        sheets,
        fileSize: await getFileSize(filePath)
    };
}

function buildSheetSummary(name: string, worksheet: XLSX.WorkSheet | undefined) {
    if (!worksheet) {
        return { name, headers: [], rows: [], totalRows: 0, totalColumns: 0 };
    }

    const rawRows = XLSX.utils.sheet_to_json<TableRow>(worksheet, {
        header: 1,
        defval: '',
        raw: false
    });

    if (!rawRows || rawRows.length === 0) {
        return { name, headers: [], rows: [], totalRows: 0, totalColumns: 0 };
    }

    const headers = (rawRows[0] || []).map((cell) => cell === null || cell === undefined ? '' : String(cell));
    const dataRows = rawRows.slice(1).map((row) =>
        (Array.isArray(row) ? row : []).map((cell) => {
            if (cell === null || cell === undefined) return '';
            if (typeof cell === 'object' && cell instanceof Date) return cell.toISOString();
            return cell;
        })
    );

    const maxCols = Math.max(headers.length, ...dataRows.map((row) => row.length));
    const normalizedHeaders = maxCols > headers.length
        ? [...headers, ...Array(maxCols - headers.length).fill('')]
        : headers;
    const normalizedRows = dataRows.map((row) =>
        row.length < maxCols ? [...row, ...Array(maxCols - row.length).fill('')] : row
    );

    return {
        name,
        headers: normalizedHeaders,
        rows: normalizedRows,
        totalRows: normalizedRows.length,
        totalColumns: normalizedHeaders.length
    };
}

function parseJsonlContent(content: string): {
    lines: Array<{ lineNumber: number; content: string; parsedJson?: unknown; isValid: boolean }>;
    totalLines: number;
    validLines: number;
    invalidLines: number;
} {
    const lines = content.split('\n').filter((line) => line.trim() !== '');
    const parsedLines: Array<{ lineNumber: number; content: string; parsedJson?: unknown; isValid: boolean }> = [];
    let validLines = 0;
    let invalidLines = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) {
            continue;
        }

        try {
            parsedLines.push({
                lineNumber: i + 1,
                content: line,
                parsedJson: JSON.parse(line),
                isValid: true
            });
            validLines++;
        } catch {
            parsedLines.push({
                lineNumber: i + 1,
                content: line,
                isValid: false
            });
            invalidLines++;
        }
    }

    return {
        lines: parsedLines,
        totalLines: parsedLines.length,
        validLines,
        invalidLines
    };
}

function trimPartialJsonlChunk(content: string): string {
    if (!content) {
        return '';
    }

    if (content.endsWith('\n')) {
        return content;
    }

    const lastNewlineIndex = content.lastIndexOf('\n');
    if (lastNewlineIndex === -1) {
        return '';
    }

    return content.slice(0, lastNewlineIndex);
}

function detectDelimiter(lines: string[]): string | null {
    const sampleLines = lines
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(0, 10);

    if (sampleLines.length === 0) {
        return null;
    }

    const candidates = [',', ';', '\t', '|'];
    let bestDelimiter: string | null = null;
    let bestScore = 0;

    for (const candidate of candidates) {
        const counts = sampleLines.map((line) => countDelimiterOccurrences(line, candidate));
        const positiveCounts = counts.filter((count) => count > 0);
        if (positiveCounts.length === 0) {
            continue;
        }

        const score = positiveCounts.length * 100 + positiveCounts.reduce((sum, count) => sum + count, 0);
        if (score > bestScore) {
            bestScore = score;
            bestDelimiter = candidate;
        }
    }

    return bestDelimiter;
}

function countDelimiterOccurrences(line: string, delimiter: string): number {
    let count = 0;
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === delimiter && !inQuotes) {
            count++;
        }
    }

    return count;
}