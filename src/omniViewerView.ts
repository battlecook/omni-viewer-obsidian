import { FileSystemAdapter, FileView, Notice, TFile, WorkspaceLeaf, normalizePath } from 'obsidian';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { MessageHandler } from './utils/messageHandler';
import { WebviewMessage } from './utils/messageHandlers/types';
import { MessageContext } from './utils/messageHandlers/context';
import { FileUtils, OmniViewerViewType } from './utils/fileUtils';
import { RenderContext, ViewerDefinition, ViewerHost, renderErrorHtml } from './viewerCore';
import { buildVscodeThemeCss } from './themeBridge';
import { getBundledAssetDataUri } from './utils/bundledAssets';
import { openSharedLinkCommand, shareFileCommand } from './shareCommand';

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
    /** Active omni-viewer-core viewer handle (direct DOM mount path). */
    private coreViewerHandle: { dispose(): void; isDirty?(): boolean } | null = null;
    /** Deadline (ms epoch) until which a self-write reload echo is suppressed. */
    private suppressReloadUntil = 0;

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
        this.addAction(
            'cloud-upload',
            'Share with Omni Viewer (expires in 5 minutes)',
            () => {
                if (!this.file) {
                    new Notice('Omni Viewer: no file selected to share.');
                    return;
                }
                if (this.coreViewerHandle?.isDirty?.()) {
                    new Notice('Omni Viewer: save your changes before sharing.');
                    return;
                }
                void shareFileCommand(this.app, this.file);
            }
        );
        this.addAction('link', 'Open shared link', () => {
            void openSharedLinkCommand(this.app);
        });
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
        await this.renderFile(file);
    }

    async onUnloadFile(_file: TFile): Promise<void> {
        this.messageListeners = [];
        this.defaultListener = null;
        this.iframe = null;
        this.disposeCoreViewer();
        this.contentEl.empty();
    }

    private disposeCoreViewer(): void {
        if (this.coreViewerHandle) {
            try {
                this.coreViewerHandle.dispose();
            } catch (error) {
                console.error('Omni Viewer core dispose error:', error);
            }
            this.coreViewerHandle = null;
        }
    }

    public async refresh(): Promise<void> {
        if (this.file) {
            await this.renderFile(this.file);
        }
    }

    private async renderFile(file: TFile): Promise<void> {
        // A re-render (e.g. triggered by our own save touching the vault)
        // would rebuild the viewer and discard unsaved edits — hold off while
        // the core viewer reports dirty state.
        if (this.coreViewerHandle?.isDirty?.()) {
            return;
        }
        // Skip the single reload echo that Obsidian fires after our own
        // writeback: remounting the core viewer would reset its scroll/zoom/
        // selection even though the content is unchanged. The window is
        // consumed on first use so a later genuine reload still applies.
        if (this.suppressReloadUntil && Date.now() < this.suppressReloadUntil) {
            this.suppressReloadUntil = 0;
            return;
        }
        this.suppressReloadUntil = 0;
        const token = ++this.renderToken;
        this.messageListeners = [];
        this.defaultListener = null;
        this.disposeCoreViewer();

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

    public provideDomContainer(): HTMLElement {
        this.disposeCoreViewer();
        this.iframe = null;
        this.contentEl.empty();
        const container = this.contentEl.createDiv();
        container.setCssStyles({ width: '100%', height: '100%' });
        return container;
    }

    public setCoreViewerHandle(handle: { dispose(): void }): void {
        this.disposeCoreViewer();
        this.coreViewerHandle = handle;
    }

    public markInternalWrite(): void {
        // Cover the async gap between modifyBinary resolving and Obsidian
        // dispatching the reload; a short window is enough for the echo.
        this.suppressReloadUntil = Date.now() + 2000;
    }

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
