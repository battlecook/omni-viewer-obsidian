import { Platform } from 'obsidian';

type Pipeline = typeof import('stream/promises').pipeline;

export const pipeline: Pipeline = (async (...args: unknown[]) => {
    try {
        if (!Platform.isDesktopApp) throw new Error();
        const req = (window as Window & { require?: (id: string) => unknown }).require;
        if (!req) throw new Error();
        const native = req('stream/promises') as { pipeline: (...values: unknown[]) => Promise<unknown> };
        return await native.pipeline(...args);
    } catch {
        throw new Error('Streaming file export is available on Obsidian desktop only.');
    }
}) as Pipeline;
