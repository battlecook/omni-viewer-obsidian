import * as path from 'path';
import * as zlib from 'zlib';
import { BUNDLED_BINARY_ASSETS_BASE64, BUNDLED_TEXT_ASSETS } from '../generated/assets';

const MIME_TYPES: Record<string, string> = {
    '.css': 'text/css;charset=utf-8',
    '.html': 'text/html;charset=utf-8',
    '.js': 'application/javascript;charset=utf-8',
    '.mjs': 'application/javascript;charset=utf-8',
    '.json': 'application/json;charset=utf-8',
    '.map': 'application/json;charset=utf-8',
    '.wasm': 'application/wasm',
    '.txt': 'text/plain;charset=utf-8',
    '.md': 'text/markdown;charset=utf-8'
};

function normalizeAssetKey(assetPath: string): string {
    return assetPath.split(path.sep).join('/').replace(/^\.\//, '');
}

export function bundledAssetKeyFromPath(assetPath: string, baseDir?: string): string {
    if (baseDir) {
        const relativeToBase = path.relative(baseDir, assetPath);
        if (relativeToBase && !relativeToBase.startsWith('..') && !path.isAbsolute(relativeToBase)) {
            return normalizeAssetKey(path.join(path.basename(baseDir), relativeToBase));
        }
    }

    return normalizeAssetKey(path.relative(process.cwd(), assetPath));
}

export function getBundledTextAsset(keyOrPath: string, baseDir?: string): string | undefined {
    const directKey = normalizeAssetKey(keyOrPath);
    if (Object.prototype.hasOwnProperty.call(BUNDLED_TEXT_ASSETS, directKey)) {
        return inflateBundledTextAsset(BUNDLED_TEXT_ASSETS[directKey]);
    }

    const derivedKey = bundledAssetKeyFromPath(keyOrPath, baseDir);
    const asset = BUNDLED_TEXT_ASSETS[derivedKey];
    return asset === undefined ? undefined : inflateBundledTextAsset(asset);
}

function inflateBundledTextAsset(gzipBase64: string): string {
    return zlib.gunzipSync(Buffer.from(gzipBase64, 'base64')).toString('utf8');
}

export function getBundledBinaryAssetBase64(keyOrPath: string, baseDir?: string): string | undefined {
    const binaryAsset = getBundledBinaryAsset(keyOrPath, baseDir);
    return binaryAsset === undefined ? undefined : Buffer.from(binaryAsset).toString('base64');
}

export function getBundledBinaryAsset(keyOrPath: string, baseDir?: string): Uint8Array | undefined {
    const directKey = normalizeAssetKey(keyOrPath);
    if (Object.prototype.hasOwnProperty.call(BUNDLED_BINARY_ASSETS_BASE64, directKey)) {
        return inflateBundledBinaryAsset(BUNDLED_BINARY_ASSETS_BASE64[directKey]);
    }

    const derivedKey = bundledAssetKeyFromPath(keyOrPath, baseDir);
    const asset = BUNDLED_BINARY_ASSETS_BASE64[derivedKey];
    return asset === undefined ? undefined : inflateBundledBinaryAsset(asset);
}

function inflateBundledBinaryAsset(gzipBase64: string): Uint8Array {
    return Uint8Array.from(zlib.gunzipSync(Buffer.from(gzipBase64, 'base64')));
}

export function getBundledAssetDataUri(keyOrPath: string, baseDir?: string): string | undefined {
    const text = getBundledTextAsset(keyOrPath, baseDir);
    const key = bundledAssetKeyFromPath(keyOrPath, baseDir);
    const mimeType = MIME_TYPES[path.extname(key).toLowerCase()] ?? 'application/octet-stream';

    if (text !== undefined) {
        return `data:${mimeType};base64,${Buffer.from(text, 'utf8').toString('base64')}`;
    }

    const binaryBase64 = getBundledBinaryAssetBase64(keyOrPath, baseDir);
    if (binaryBase64 !== undefined) {
        return `data:${mimeType};base64,${binaryBase64}`;
    }

    return undefined;
}
