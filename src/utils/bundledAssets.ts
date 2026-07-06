import * as path from 'path';
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
        return BUNDLED_TEXT_ASSETS[directKey];
    }

    const derivedKey = bundledAssetKeyFromPath(keyOrPath, baseDir);
    return BUNDLED_TEXT_ASSETS[derivedKey];
}

export function getBundledBinaryAssetBase64(keyOrPath: string, baseDir?: string): string | undefined {
    const directKey = normalizeAssetKey(keyOrPath);
    if (Object.prototype.hasOwnProperty.call(BUNDLED_BINARY_ASSETS_BASE64, directKey)) {
        return BUNDLED_BINARY_ASSETS_BASE64[directKey];
    }

    const derivedKey = bundledAssetKeyFromPath(keyOrPath, baseDir);
    return BUNDLED_BINARY_ASSETS_BASE64[derivedKey];
}

export function getBundledBinaryAsset(keyOrPath: string, baseDir?: string): Uint8Array | undefined {
    const base64 = getBundledBinaryAssetBase64(keyOrPath, baseDir);
    if (!base64) {
        return undefined;
    }

    return Uint8Array.from(Buffer.from(base64, 'base64'));
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
