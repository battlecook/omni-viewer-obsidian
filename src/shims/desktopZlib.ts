// browserify-zlib has no bundled TypeScript declaration.
// @ts-ignore
import browserZlib from 'browserify-zlib';

type NativeZlib = typeof import('zlib');

function nativeZlib(): NativeZlib | null {
    try {
        const req = (window as Window & { require?: (id: string) => unknown }).require;
        return req ? req('zlib') as NativeZlib : null;
    } catch {
        return null;
    }
}

const zlib = nativeZlib() ?? browserZlib as NativeZlib;

export const createGunzip = zlib.createGunzip.bind(zlib);
export const gunzipSync = zlib.gunzipSync.bind(zlib);

export default zlib;
