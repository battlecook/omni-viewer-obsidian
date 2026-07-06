import { App, TFile } from 'obsidian';

/**
 * Everything a message handler needs to act on the document that the
 * webview-style viewer is currently displaying.
 */
export interface MessageContext {
    app: App;
    /** The vault file being displayed. */
    file: TFile;
    /** Absolute filesystem path of the file. */
    absPath: string;
    /** Send a message back into the viewer iframe. */
    postMessage(message: unknown): void;
    /** Re-open the given absolute path with an omni-viewer view type (used after PDF save). */
    reopen(absPath: string, viewType: string): Promise<void>;
}
