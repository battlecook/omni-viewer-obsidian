type NativeOs = typeof import('os');

function nativeOs(): NativeOs | null {
    try {
        const req = (window as Window & { require?: (id: string) => unknown }).require;
        return req ? req('os') as NativeOs : null;
    } catch {
        return null;
    }
}

const os = nativeOs();

export const tmpdir: NativeOs['tmpdir'] = (() => {
    if (!os) throw new Error('Temporary directories are available on Obsidian desktop only.');
    return os.tmpdir();
}) as NativeOs['tmpdir'];

export default os;
