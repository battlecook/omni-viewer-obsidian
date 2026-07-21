/*
 * Keep desktop-only file-system code loadable in the shared browser bundle.
 * Obsidian desktop exposes Node through window.require; mobile does not. Calls
 * are therefore resolved lazily and fail with a useful capability error only
 * if a desktop-only viewer accidentally reaches them on mobile.
 */

type NativeFs = typeof import('fs');

function nativeFs(): NativeFs | null {
    try {
        const req = (window as Window & { require?: (id: string) => unknown }).require;
        return req ? req('fs') as NativeFs : null;
    } catch {
        return null;
    }
}

function unavailable(): never {
    throw new Error('This file-system operation is available on Obsidian desktop only.');
}

const fs = nativeFs();

export const promises = fs?.promises ?? new Proxy({}, {
    get: () => async () => unavailable()
}) as NativeFs['promises'];
export const constants = fs?.constants ?? { X_OK: 1 } as NativeFs['constants'];
export const createReadStream: NativeFs['createReadStream'] = ((...args: Parameters<NativeFs['createReadStream']>) =>
    fs ? fs.createReadStream(...args) : unavailable()) as NativeFs['createReadStream'];
export const createWriteStream: NativeFs['createWriteStream'] = ((...args: Parameters<NativeFs['createWriteStream']>) =>
    fs ? fs.createWriteStream(...args) : unavailable()) as NativeFs['createWriteStream'];
export const openSync: NativeFs['openSync'] = ((...args: Parameters<NativeFs['openSync']>) =>
    fs ? fs.openSync(...args) : unavailable()) as NativeFs['openSync'];
export const closeSync: NativeFs['closeSync'] = ((...args: Parameters<NativeFs['closeSync']>) =>
    fs ? fs.closeSync(...args) : unavailable()) as NativeFs['closeSync'];
export const fstatSync: NativeFs['fstatSync'] = ((...args: Parameters<NativeFs['fstatSync']>) =>
    fs ? fs.fstatSync(...args) : unavailable()) as NativeFs['fstatSync'];
export const readSync: NativeFs['readSync'] = ((...args: Parameters<NativeFs['readSync']>) =>
    fs ? fs.readSync(...args) : unavailable()) as NativeFs['readSync'];
export const existsSync: NativeFs['existsSync'] = ((...args: Parameters<NativeFs['existsSync']>) =>
    fs ? fs.existsSync(...args) : false) as NativeFs['existsSync'];
export const readFileSync: NativeFs['readFileSync'] = ((...args: Parameters<NativeFs['readFileSync']>) =>
    fs ? (fs.readFileSync as (...values: unknown[]) => unknown)(...args) : unavailable()) as NativeFs['readFileSync'];

export default fs;
