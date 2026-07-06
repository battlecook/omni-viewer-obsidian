import { App, TFile } from 'obsidian';
import { WebviewMessage } from './utils/messageHandlers/types';

export interface ViewerErrorContent {
    title: string;
    message: string;
    icon: string;
    lang?: string;
}

/**
 * Minimal surface the ported vscode viewer providers need from their
 * hosting environment (in vscode this was the webview panel).
 */
export interface ViewerHost {
    /** Replace the viewer content with a full HTML document (rendered in a sandboxed iframe). */
    setHtml(html: string): void;
    /** Send a message into the viewer iframe (vscode: webview.postMessage). */
    postMessage(message: unknown): void;
    /** Add a raw message listener (vscode: webview.onDidReceiveMessage). Multiple listeners may coexist. */
    onMessage(handler: (message: WebviewMessage) => void | Promise<void>): void;
    /**
     * Wire the shared MessageHandler for save/log/share messages
     * (vscode: MessageHandler.setupMessageListener). Custom handlers take priority.
     */
    setupDefaultMessages(customHandlers?: { [command: string]: (message: WebviewMessage) => void }): void;
    /** Convert an absolute filesystem path to a URL loadable inside the viewer (vscode: webview.asWebviewUri). */
    asWebviewUri(absolutePath: string): string;
}

export interface RenderContext {
    app: App;
    /** Absolute path of the bundled templates directory. */
    templatesDir: string;
    /** Absolute path of the bundled wasm directory (audio engine). */
    wasmDir: string;
    file: TFile;
    /** Absolute filesystem path of the file being displayed. */
    filePath: string;
    fileName: string;
    host: ViewerHost;
}

export interface ViewerDefinition {
    viewType: string;
    displayName: string;
    extensions: string[];
    icon: string;
    errorContent: ViewerErrorContent;
    render(ctx: RenderContext): Promise<void>;
}

export function renderErrorHtml(
    fileName: string,
    errorMessage: string,
    content: ViewerErrorContent
): string {
    const lang = content.lang || 'en';

    return `<!DOCTYPE html>
<html lang="${lang}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${content.title} - ${fileName}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            margin: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            text-align: center;
            padding: 20px;
            min-height: 100vh;
        }
        .error-container {
            max-width: 560px;
        }
        .error-icon {
            font-size: 48px;
            margin-bottom: 20px;
        }
        .error-title {
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 10px;
            color: var(--vscode-errorForeground);
        }
        .error-message {
            font-size: 14px;
            line-height: 1.5;
            margin-bottom: 20px;
        }
        .file-name {
            font-family: 'Monaco', 'Menlo', monospace;
            background: var(--vscode-textBlockQuote-background);
            padding: 8px 12px;
            border-radius: 4px;
            margin: 10px 0;
            word-break: break-all;
        }
    </style>
</head>
<body>
    <div class="error-container">
        <div class="error-icon">${content.icon}</div>
        <div class="error-title">${content.title}</div>
        <div class="error-message">${content.message}</div>
        <div class="file-name">${fileName}</div>
        <div class="error-message">${errorMessage}</div>
    </div>
</body>
</html>`;
}
