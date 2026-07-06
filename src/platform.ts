import { App, Modal, Notice, Setting } from 'obsidian';

export interface FileDialogFilter {
    name: string;
    extensions: string[];
}

function getElectronRemote(): any | null {
    try {
        const req = (window as any).require;
        if (!req) {
            return null;
        }
        const electron = req('electron');
        return electron?.remote ?? null;
    } catch {
        return null;
    }
}

export async function showSaveDialog(defaultPath: string, filters: FileDialogFilter[]): Promise<string | null> {
    const remote = getElectronRemote();
    if (remote?.dialog?.showSaveDialog) {
        const result = await remote.dialog.showSaveDialog({ defaultPath, filters });
        if (result.canceled || !result.filePath) {
            return null;
        }
        return result.filePath;
    }

    // Fallback: save to the suggested location without prompting.
    new Notice(`Saving to ${defaultPath}`);
    return defaultPath;
}

export async function showOpenDialog(filters: FileDialogFilter[]): Promise<string | null> {
    const remote = getElectronRemote();
    if (remote?.dialog?.showOpenDialog) {
        const result = await remote.dialog.showOpenDialog({
            properties: ['openFile'],
            filters
        });
        if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
            return null;
        }
        return result.filePaths[0];
    }

    new Notice('File open dialog is not available in this environment.');
    return null;
}

export function revealInOS(absolutePath: string): void {
    const remote = getElectronRemote();
    try {
        const req = (window as any).require;
        const shell = req ? req('electron')?.shell : null;
        if (shell?.showItemInFolder) {
            shell.showItemInFolder(absolutePath);
            return;
        }
        if (remote?.shell?.showItemInFolder) {
            remote.shell.showItemInFolder(absolutePath);
        }
    } catch (error) {
        console.error('Failed to reveal file in OS:', error);
    }
}

export function openExternal(url: string): void {
    window.open(url);
}

class ConfirmModal extends Modal {
    private resolved = false;

    constructor(
        app: App,
        private readonly message: string,
        private readonly confirmLabel: string,
        private readonly resolve: (confirmed: boolean) => void
    ) {
        super(app);
    }

    onOpen(): void {
        this.contentEl.createEl('p', { text: this.message });
        new Setting(this.contentEl)
            .addButton((button) => button
                .setButtonText(this.confirmLabel)
                .setCta()
                .onClick(() => {
                    this.resolved = true;
                    this.resolve(true);
                    this.close();
                }))
            .addButton((button) => button
                .setButtonText('Cancel')
                .onClick(() => {
                    this.resolved = true;
                    this.resolve(false);
                    this.close();
                }));
    }

    onClose(): void {
        if (!this.resolved) {
            this.resolve(false);
        }
        this.contentEl.empty();
    }
}

export function confirmDialog(app: App, message: string, confirmLabel = 'Yes'): Promise<boolean> {
    return new Promise((resolve) => {
        new ConfirmModal(app, message, confirmLabel, resolve).open();
    });
}

class TextInputModal extends Modal {
    private resolved = false;
    private value = '';

    constructor(
        app: App,
        private readonly title: string,
        private readonly placeholder: string,
        private readonly validate: (value: string) => string | null,
        private readonly resolve: (value: string | null) => void,
        private readonly initialValue = ''
    ) {
        super(app);
    }

    onOpen(): void {
        this.titleEl.setText(this.title);
        const errorEl = this.contentEl.createEl('p', { cls: 'mod-warning', text: '' });
        errorEl.style.minHeight = '1em';

        this.value = this.initialValue;
        const input = this.contentEl.createEl('input', { type: 'text' });
        input.placeholder = this.placeholder;
        input.value = this.initialValue;
        input.style.width = '100%';
        input.addEventListener('input', () => {
            this.value = input.value;
            errorEl.setText('');
        });
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.submit(errorEl);
            }
        });
        window.setTimeout(() => {
            input.focus();
            input.select();
        }, 0);

        new Setting(this.contentEl)
            .addButton((button) => button
                .setButtonText('OK')
                .setCta()
                .onClick(() => this.submit(errorEl)))
            .addButton((button) => button
                .setButtonText('Cancel')
                .onClick(() => {
                    this.resolved = true;
                    this.resolve(null);
                    this.close();
                }));
    }

    private submit(errorEl: HTMLElement): void {
        const error = this.validate(this.value);
        if (error) {
            errorEl.setText(error);
            return;
        }
        this.resolved = true;
        this.resolve(this.value);
        this.close();
    }

    onClose(): void {
        if (!this.resolved) {
            this.resolve(null);
        }
        this.contentEl.empty();
    }
}

export function promptText(
    app: App,
    title: string,
    placeholder: string,
    validate: (value: string) => string | null,
    initialValue = ''
): Promise<string | null> {
    return new Promise((resolve) => {
        new TextInputModal(app, title, placeholder, validate, resolve, initialValue).open();
    });
}
