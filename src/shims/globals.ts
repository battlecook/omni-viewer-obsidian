import { Buffer as BrowserBuffer } from 'buffer';
// process/browser has no bundled TypeScript declaration.
// @ts-ignore
import browserProcess from 'process/browser';

type NativeProcess = typeof import('process');

function nativeProcess(): NativeProcess | null {
    try {
        const req = (window as Window & { require?: (id: string) => unknown }).require;
        return req ? req('process') as NativeProcess : null;
    } catch {
        return null;
    }
}

function nativeBuffer(): typeof BrowserBuffer | null {
    try {
        const req = (window as Window & { require?: (id: string) => unknown }).require;
        if (!req) return null;
        return (req('buffer') as { Buffer: typeof BrowserBuffer }).Buffer;
    } catch {
        return null;
    }
}

export const Buffer = nativeBuffer() ?? BrowserBuffer;
export const process = nativeProcess() ?? browserProcess as NativeProcess;
