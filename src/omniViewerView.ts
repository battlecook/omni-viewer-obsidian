import { FileSystemAdapter, FileView, TFile, WorkspaceLeaf, normalizePath } from 'obsidian';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { MessageHandler } from './utils/messageHandler';
import { WebviewMessage } from './utils/messageHandlers/types';
import { MessageContext } from './utils/messageHandlers/context';
import { FileUtils, OmniViewerViewType } from './utils/fileUtils';
import { RenderContext, ViewerDefinition, ViewerHost, renderErrorHtml } from './viewerCore';
import { buildVscodeThemeCss } from './themeBridge';
import { getBundledAssetDataUri } from './utils/bundledAssets';

const BRIDGE_SCRIPT = `<script>
(function () {
    var state = undefined;
    var api = {
        postMessage: function (message) {
            try { window.parent.postMessage({ __omniViewerBridge: true, message: message }, '*'); } catch (e) {}
        },
        getState: function () { return state; },
        setState: function (newState) { state = newState; return newState; }
    };
    window.acquireVsCodeApi = function () { return api; };
})();
</script>`;

type MessageListener = (message: WebviewMessage) => void | Promise<void>;

/**
 * Build a leaf → view factory whose identity methods read from the closure,
 * so they return correct values even while the base View constructor runs
 * (before instance fields are assigned).
 */
export function createViewFactory(
    definition: ViewerDefinition,
    templatesDir: string,
    wasmDir: string,
    registeredViewTypes: Set<string>
): (leaf: WorkspaceLeaf) => OmniViewerView {
    class DefinedOmniViewerView extends OmniViewerView {
        constructor(leaf: WorkspaceLeaf) {
            super(leaf, definition, templatesDir, wasmDir, registeredViewTypes);
        }

        getViewType(): string {
            return definition.viewType;
        }

        getIcon(): string {
            return definition.icon;
        }
    }

    return (leaf) => new DefinedOmniViewerView(leaf);
}

export class OmniViewerView extends FileView implements ViewerHost {
    allowNoFile = false;

    private iframe: HTMLIFrameElement | null = null;
    private messageListeners: MessageListener[] = [];
    private defaultListener: MessageListener | null = null;
    private renderToken = 0;

    constructor(
        leaf: WorkspaceLeaf,
        private readonly definition: ViewerDefinition,
        private readonly templatesDir: string,
        private readonly wasmDir: string,
        private readonly registeredViewTypes: Set<string>
    ) {
        super(leaf);
    }

    // NOTE: Obsidian's View base constructor calls getViewType()/getIcon()
    // before our constructor body has assigned `definition`, so these must
    // not assume the field exists. createViewFactory() overrides them with
    // closure-based versions that are always correct.
    getViewType(): string {
        return this.definition?.viewType ?? '';
    }

    getDisplayText(): string {
        return this.file?.name ?? this.definition?.displayName ?? 'Omni Viewer';
    }

    getIcon(): string {
        return this.definition?.icon ?? 'eye';
    }

    canAcceptExtension(extension: string): boolean {
        return this.definition.extensions.includes(extension.toLowerCase());
    }

    onload(): void {
        super.onload();
        this.contentEl.addClass('omni-viewer-content');
        this.registerDomEvent(window, 'message', (event: MessageEvent) => {
            if (!this.iframe || event.source !== this.iframe.contentWindow) {
                return;
            }
            const data = event.data as { __omniViewerBridge?: boolean; message?: WebviewMessage } | undefined;
            if (!data || data.__omniViewerBridge !== true || !data.message) {
                return;
            }
            for (const listener of [...this.messageListeners]) {
                Promise.resolve(listener(data.message)).catch((error) => {
                    console.error('Omni Viewer message handler error:', error);
                });
            }
        });
    }

    async onLoadFile(file: TFile): Promise<void> {
        console.log(`[Omni Viewer] opening ${file.path} with ${this.definition.viewType}`);
        await this.renderFile(file);
    }

    async onUnloadFile(_file: TFile): Promise<void> {
        this.messageListeners = [];
        this.defaultListener = null;
        this.iframe = null;
        this.contentEl.empty();
    }

    public async refresh(): Promise<void> {
        if (this.file) {
            await this.renderFile(this.file);
        }
    }

    private async renderFile(file: TFile): Promise<void> {
        const token = ++this.renderToken;
        this.messageListeners = [];
        this.defaultListener = null;

        const absPath = this.getAbsolutePath(file);

        try {
            // Signature-based rerouting (vscode: rerouteIfNeeded). If the file
            // content matches another registered omni viewer better, switch views.
            const detection = await FileUtils.detectViewerType(absPath, this.definition.viewType as OmniViewerViewType);
            if (detection.viewType
                && detection.viewType !== this.definition.viewType
                && this.registeredViewTypes.has(detection.viewType)) {
                await this.leaf.setViewState({
                    type: detection.viewType,
                    state: { file: file.path }
                });
                return;
            }

            if (token !== this.renderToken) {
                return;
            }

            const ctx: RenderContext = {
                app: this.app,
                templatesDir: this.templatesDir,
                wasmDir: this.wasmDir,
                file,
                filePath: absPath,
                fileName: file.name,
                host: this
            };

            await this.definition.render(ctx);
        } catch (error) {
            console.error(`Error setting up ${this.definition.displayName}:`, error);
            if (token !== this.renderToken) {
                return;
            }
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            this.setHtml(renderErrorHtml(file.name, errorMessage, this.definition.errorContent));
        }
    }

    // ---------------------------------------------------------------- ViewerHost

    public setHtml(html: string): void {
        this.contentEl.empty();
        const iframe = this.contentEl.createEl('iframe');
        iframe.addClass('omni-viewer-frame');
        iframe.setAttribute('allow', 'clipboard-read; clipboard-write; fullscreen');
        iframe.setCssStyles({
            width: '100%',
            height: '100%',
            border: 'none',
            display: 'block',
            backgroundColor: 'transparent'
        });
        iframe.srcdoc = this.prepareHtml(html);
        this.iframe = iframe;
    }

    public postMessage(message: unknown): void {
        this.iframe?.contentWindow?.postMessage(message, '*');
    }

    public onMessage(handler: MessageListener): void {
        this.messageListeners.push(handler);
    }

    public setupDefaultMessages(customHandlers?: { [command: string]: (message: WebviewMessage) => void }): void {
        if (this.defaultListener) {
            this.messageListeners = this.messageListeners.filter((listener) => listener !== this.defaultListener);
        }

        this.defaultListener = async (message: WebviewMessage) => {
            const messageType = message.type || message.command;
            if (customHandlers && messageType && customHandlers[messageType]) {
                customHandlers[messageType](message);
                return;
            }
            await MessageHandler.handleWebviewMessage(message, this.buildMessageContext());
        };
        this.messageListeners.push(this.defaultListener);
    }

    public asWebviewUri(absolutePath: string): string {
        const bundledTemplateUri = getBundledAssetDataUri(absolutePath, this.templatesDir);
        if (bundledTemplateUri) {
            return bundledTemplateUri;
        }

        const bundledWasmUri = getBundledAssetDataUri(absolutePath, this.wasmDir);
        if (bundledWasmUri) {
            return bundledWasmUri;
        }

        const vaultPath = this.toVaultPath(absolutePath);
        if (vaultPath !== null) {
            return this.app.vault.adapter.getResourcePath(vaultPath);
        }
        return pathToFileURL(absolutePath).toString();
    }

    // ---------------------------------------------------------------- helpers

    private prepareHtml(html: string): string {
        const themeStyle = `<style>\n${buildVscodeThemeCss(this.containerEl)}\n</style>`;
        const injection = `${BRIDGE_SCRIPT}\n${themeStyle}`;

        const headMatch = /<head[^>]*>/i.exec(html);
        if (headMatch && headMatch.index !== undefined) {
            const insertAt = headMatch.index + headMatch[0].length;
            return html.slice(0, insertAt) + '\n' + injection + html.slice(insertAt);
        }

        return injection + '\n' + html;
    }

    private buildMessageContext(): MessageContext {
        const file = this.file;
        if (!file) {
            throw new Error('No file is loaded in this viewer.');
        }

        return {
            app: this.app,
            file,
            absPath: this.getAbsolutePath(file),
            postMessage: (message: unknown) => this.postMessage(message),
            reopen: async (absPath: string, viewType: string) => {
                const vaultPath = this.toVaultPath(absPath);
                if (vaultPath === null) {
                    return;
                }
                await this.leaf.setViewState({
                    type: viewType,
                    state: { file: vaultPath }
                });
            }
        };
    }

    private getAbsolutePath(file: TFile): string {
        const adapter = this.app.vault.adapter;
        if (adapter instanceof FileSystemAdapter) {
            return adapter.getFullPath(file.path);
        }
        throw new Error('Omni Viewer requires a local vault (desktop only).');
    }

    private toVaultPath(absolutePath: string): string | null {
        const adapter = this.app.vault.adapter;
        if (!(adapter instanceof FileSystemAdapter)) {
            return null;
        }
        const relative = path.relative(adapter.getBasePath(), absolutePath);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            return null;
        }
        return normalizePath(relative.split(path.sep).join('/'));
    }
}
