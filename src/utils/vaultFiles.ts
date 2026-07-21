import { App, FuzzySuggestModal, Notice, TFile, normalizePath } from 'obsidian';
import { promptText } from '../platform';

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

function parentPath(file: TFile): string {
    return file.parent?.path ?? '';
}

export async function saveBinaryBesideFile(app: App, source: TFile, suggestedName: string, data: Uint8Array): Promise<TFile | null> {
    const name = await promptText(
        app,
        'Save in vault',
        suggestedName,
        (value) => {
            const trimmed = value.trim();
            if (!trimmed) return 'Enter a file name.';
            if (trimmed.includes('/') || trimmed.includes('\\')) return 'Enter a file name without folders.';
            return null;
        },
        suggestedName
    );
    if (!name) return null;

    const parent = parentPath(source);
    let targetPath = normalizePath(parent ? `${parent}/${name}` : name);
    if (app.vault.getAbstractFileByPath(targetPath)) {
        const dot = name.lastIndexOf('.');
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const extension = dot > 0 ? name.slice(dot) : '';
        targetPath = normalizePath(parent ? `${parent}/${stem}-${Date.now()}${extension}` : `${stem}-${Date.now()}${extension}`);
    }

    const created = await app.vault.createBinary(targetPath, toArrayBuffer(data));
    new Notice(`Saved ${targetPath}`);
    return created;
}

class VaultFilePicker extends FuzzySuggestModal<TFile> {
    constructor(
        app: App,
        private readonly extensions: Set<string>,
        private readonly resolve: (file: TFile | null) => void
    ) {
        super(app);
        this.setPlaceholder('Choose a file from this vault');
    }

    getItems(): TFile[] {
        return this.app.vault.getFiles().filter((file) => this.extensions.has(file.extension.toLowerCase()));
    }

    getItemText(file: TFile): string {
        return file.path;
    }

    onChooseItem(file: TFile): void {
        this.resolve(file);
    }

    onClose(): void {
        super.onClose();
        window.setTimeout(() => this.resolve(null), 0);
    }
}

export function pickVaultFile(app: App, extensions: readonly string[]): Promise<TFile | null> {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (file: TFile | null) => {
            if (settled) return;
            settled = true;
            resolve(file);
        };
        new VaultFilePicker(app, new Set(extensions.map((extension) => extension.replace(/^\./, '').toLowerCase())), finish).open();
    });
}
