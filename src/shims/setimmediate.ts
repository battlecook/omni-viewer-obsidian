type SetImmediateShim = (callback: (...args: unknown[]) => void, ...args: unknown[]) => unknown;

const globalScope = global as Record<string, unknown>;

if (typeof globalScope.setImmediate !== 'function') {
    globalScope.setImmediate = ((callback, ...args) => setTimeout(callback, 0, ...args)) satisfies SetImmediateShim;
}

if (typeof globalScope.clearImmediate !== 'function') {
    globalScope.clearImmediate = (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>);
}
