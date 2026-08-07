// GGUF viewer — Obsidian adapter over omni-viewer-core.
//
// GGUF model files are routinely multi-gigabyte, and only the header, metadata
// and tensor index are ever needed. On desktop we therefore hand the core parser
// a `fetch` implementation backed by fs range reads (same idea as the parquet
// adapter's random-access source), so the tensor payload is never read. On
// mobile there is no filesystem, so we fall back to the whole-buffer path with a
// size guard — the core's in-memory transport still stops before the payload,
// but the vault read itself would otherwise materialize the entire model.
//
// The core's `parsers/gguf/node` helper does the same thing with
// `fs.createReadStream` + `Readable.toWeb`; it is unusable here because the
// bundle maps `node:fs` onto the desktop shim and has no `node:stream`.

import * as fs from '../shims/desktopFs';
import { parseGgufUri } from 'omni-viewer-core/parsers/gguf';
import {
    mountGgufDocument,
    mountGgufViewer,
    type GgufViewerContext
} from 'omni-viewer-core/viewers/gguf';
import { resolveCatalogMessage } from 'omni-viewer-core/i18n';
import { Platform } from 'obsidian';
import { RenderContext, ViewerDefinition } from '../viewerCore';

/** Whole-file reads only happen without a filesystem; keep them off phones. */
const MAX_IN_MEMORY_BYTES = 512 * 1024 * 1024;

/** Placeholder origin: the range fetch below never performs a network request. */
const LOCAL_FILE_URI = 'https://omni-viewer.invalid/local-file.gguf';

function coreHostContext(): GgufViewerContext {
    const ctx: GgufViewerContext = {
        assets: {
            resolveAssetUrl: async (assetPath: string) => assetPath
        },
        i18n: {
            t: (key, args) => resolveCatalogMessage(key, args)
        },
        logger: {
            log: (level, message) => {
                const prefix = '[omni-viewer gguf]';
                if (level === 'error') console.error(prefix, message);
                else if (level === 'warn') console.warn(prefix, message);
            }
        }
    };

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
        ctx.clipboard = {
            writeText: (text: string) => navigator.clipboard.writeText(text)
        };
    }

    return ctx;
}

/**
 * Serves bounded ranges of a local file through the `fetch` contract the core
 * GGUF parser validates: 206 with a `Content-Range` that covers the requested
 * range through EOF, and a terminal 416 once the offset passes the end.
 */
function createFileRangeFetch(filePath: string, fileByteLength: number): typeof fetch {
    return (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const match = new Headers(init?.headers).get('range')?.match(/^bytes=(\d+)-(\d+)$/i);
        if (!match) return new Response(null, { status: 400 });
        const start = Number(match[1]);
        const requestedEnd = Number(match[2]);
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || requestedEnd < start) {
            return new Response(null, { status: 400 });
        }
        if (start >= fileByteLength) {
            return new Response(null, {
                status: 416,
                headers: { 'Content-Range': `bytes */${fileByteLength}` }
            });
        }

        const end = Math.min(requestedEnd, fileByteLength - 1);
        const length = end - start + 1;
        const bytes = new Uint8Array(length);
        const handle = await fs.promises.open(filePath, 'r');
        try {
            init?.signal?.throwIfAborted();
            const { bytesRead } = await handle.read(bytes, 0, length, start);
            if (bytesRead < length) throw new Error('GGUF file ended before the requested range.');
        } finally {
            await handle.close();
        }
        init?.signal?.throwIfAborted();
        return new Response(bytes, {
            status: 206,
            headers: {
                'Content-Range': `bytes ${start}-${end}/${fileByteLength}`,
                'Content-Length': String(length)
            }
        });
    }) as typeof fetch;
}

/** Real byte length of the vault file on disk, or null without a filesystem. */
async function fileByteLength(ctx: RenderContext): Promise<number | null> {
    if (Platform.isMobileApp) return null;
    try {
        return (await fs.promises.stat(ctx.filePath)).size;
    } catch {
        return null;
    }
}

export const ggufViewer: ViewerDefinition = {
    viewType: 'omni-viewer.ggufViewer',
    displayName: 'GGUF Viewer',
    extensions: ['gguf'],
    icon: 'brain-circuit',
    errorContent: {
        title: 'Failed to load GGUF file',
        message: 'Unable to inspect the GGUF model due to an error:',
        icon: 'brain-circuit'
    },
    async render(ctx) {
        if (!ctx.host.provideDomContainer || !ctx.host.setCoreViewerHandle) {
            throw new Error('Host does not support direct DOM mounting');
        }

        const byteLength = await fileByteLength(ctx);
        const container = ctx.host.provideDomContainer();

        if (byteLength === null) {
            if (ctx.file.stat.size > MAX_IN_MEMORY_BYTES) {
                throw new Error(
                    `GGUF models above ${MAX_IN_MEMORY_BYTES / (1024 * 1024)} MB can only be inspected on desktop, ` +
                    'where the metadata is read without loading the tensor payload.'
                );
            }
            const data = new Uint8Array(await ctx.app.vault.readBinary(ctx.file));
            const handle = await mountGgufViewer({ fileName: ctx.fileName, data }, container, coreHostContext());
            ctx.host.setCoreViewerHandle(handle);
            return;
        }

        const document = await parseGgufUri(LOCAL_FILE_URI, {
            fetch: createFileRangeFetch(ctx.filePath, byteLength),
            fileByteLength: byteLength
        });
        ctx.host.setCoreViewerHandle(
            mountGgufDocument(document, ctx.fileName, container, coreHostContext())
        );
    }
};
