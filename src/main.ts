import { FileSystemAdapter, Menu, Notice, Plugin, TFile } from 'obsidian';
import * as path from 'path';
import { OmniViewerView, createViewFactory } from './omniViewerView';
import { VIEWER_DEFINITIONS } from './viewerRegistry';
import { ViewerDefinition } from './viewerCore';
import { openSharedLinkCommand, shareFileCommand } from './shareCommand';

export default class OmniViewerPlugin extends Plugin {
    private readonly registeredViewTypes = new Set<string>();
    private templatesDir = '';
    private wasmDir = '';

    async onload(): Promise<void> {
        const adapter = this.app.vault.adapter;
        if (!(adapter instanceof FileSystemAdapter)) {
            new Notice('Omni Viewer requires a local vault (desktop only).');
            return;
        }

        const pluginDir = path.join(adapter.getBasePath(), this.manifest.dir ?? '');
        this.templatesDir = path.join(pluginDir, 'templates');
        this.wasmDir = path.join(pluginDir, 'wasm');

        for (const definition of VIEWER_DEFINITIONS) {
            this.registeredViewTypes.add(definition.viewType);
            this.registerView(
                definition.viewType,
                createViewFactory(definition, this.templatesDir, this.wasmDir, this.registeredViewTypes)
            );
            this.registerViewerExtensions(definition);
        }

        this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
            if (!(file instanceof TFile)) {
                return;
            }
            this.addFileMenuItems(menu, file);
        }));

        this.addCommand({
            id: 'refresh-viewer',
            name: 'Refresh viewer',
            checkCallback: (checking) => {
                const view = this.app.workspace.getActiveViewOfType(OmniViewerView);
                if (!view) {
                    return false;
                }
                if (!checking) {
                    void view.refresh();
                }
                return true;
            }
        });

        this.addCommand({
            id: 'share-file',
            name: 'Share current file',
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!file) {
                    return false;
                }
                if (!checking) {
                    void shareFileCommand(this.app, file);
                }
                return true;
            }
        });

        this.addCommand({
            id: 'open-shared-link',
            name: 'Open shared link',
            callback: () => {
                void openSharedLinkCommand(this.app);
            }
        });
    }

    /**
     * Claim file extensions for the viewer. Obsidian throws when another view
     * (including core viewers for md/pdf/images/media) already owns an
     * extension, so register one-by-one; files whose extension stays with the
     * core viewer remain reachable through the "Open with …" file menu.
     */
    private registerViewerExtensions(definition: ViewerDefinition): string[] {
        const failed: string[] = [];
        for (const extension of definition.extensions) {
            try {
                this.registerExtensions([extension], definition.viewType);
            } catch (error) {
                failed.push(extension);
            }
        }
        return failed;
    }

    private addFileMenuItems(menu: Menu, file: TFile): void {
        const extension = file.extension.toLowerCase();
        const matching = VIEWER_DEFINITIONS.filter((definition) => definition.extensions.includes(extension));

        for (const definition of matching) {
            menu.addItem((item) => item
                .setTitle(`Open with ${definition.displayName}`)
                .setIcon(definition.icon)
                .setSection('open')
                .onClick(async () => {
                    const leaf = this.app.workspace.getLeaf(false);
                    await leaf.setViewState({
                        type: definition.viewType,
                        state: { file: file.path }
                    });
                    this.app.workspace.setActiveLeaf(leaf, { focus: true });
                }));
        }

        menu.addItem((item) => item
            .setTitle('Share with Omni Viewer')
            .setIcon('cloud-upload')
            .setSection('action')
            .onClick(() => {
                void shareFileCommand(this.app, file);
            }));
    }
}
