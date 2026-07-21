// path-browserify has no bundled TypeScript declaration.
// @ts-ignore
import browserPath from 'path-browserify';

type NativePath = typeof import('path');

function nativePath(): NativePath | null {
    try {
        const req = (window as Window & { require?: (id: string) => unknown }).require;
        return req ? req('path') as NativePath : null;
    } catch {
        return null;
    }
}

// Native path semantics remain important for Windows desktop vaults. Mobile
// receives the POSIX-compatible browser implementation for vault paths.
const path = nativePath() ?? browserPath as NativePath;

export const basename = path.basename.bind(path);
export const delimiter = path.delimiter;
export const dirname = path.dirname.bind(path);
export const extname = path.extname.bind(path);
export const isAbsolute = path.isAbsolute.bind(path);
export const join = path.join.bind(path);
export const normalize = path.normalize.bind(path);
export const parse = path.parse.bind(path);
export const relative = path.relative.bind(path);
export const resolve = path.resolve.bind(path);
export const sep = path.sep;

export default path;
