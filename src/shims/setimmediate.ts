type SetImmediateShim = (callback: (...args: unknown[]) => void, ...args: unknown[]) => unknown;

const globalScope = window as unknown as Record<string, unknown>;

if (typeof globalScope.setImmediate !== 'function') {
    globalScope.setImmediate = ((callback, ...args) => window.setTimeout(callback, 0, ...args)) satisfies SetImmediateShim;
}

if (typeof globalScope.clearImmediate !== 'function') {
    globalScope.clearImmediate = (handle: unknown) => window.clearTimeout(handle as number);
}
