type NativeChildProcess = typeof import('child_process');

function nativeChildProcess(): NativeChildProcess | null {
    try {
        const req = (window as Window & { require?: (id: string) => unknown }).require;
        return req ? req('child_process') as NativeChildProcess : null;
    } catch {
        return null;
    }
}

function unavailable(): never {
    throw new Error('External processes are available on Obsidian desktop only.');
}

const childProcess = nativeChildProcess();

export const spawn: NativeChildProcess['spawn'] = ((...args: Parameters<NativeChildProcess['spawn']>) =>
    childProcess ? childProcess.spawn(...args) : unavailable()) as NativeChildProcess['spawn'];
export const execFile: NativeChildProcess['execFile'] = ((...args: Parameters<NativeChildProcess['execFile']>) =>
    childProcess ? (childProcess.execFile as (...values: unknown[]) => unknown)(...args) : unavailable()) as NativeChildProcess['execFile'];

export default childProcess;
