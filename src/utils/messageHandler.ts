import { Notice } from 'obsidian';
import { MediaMessageHandlers } from './messageHandlers/mediaMessageHandlers';
import { PdfMessageHandlers } from './messageHandlers/pdfMessageHandlers';
import { TextMessageHandlers } from './messageHandlers/textMessageHandlers';
import { WebviewMessage } from './messageHandlers/types';
import { MessageContext } from './messageHandlers/context';

export type { WebviewMessage } from './messageHandlers/types';
export type { MessageContext } from './messageHandlers/context';

export class MessageHandler {
    public static async handleWebviewMessage(
        message: WebviewMessage,
        context: MessageContext
    ): Promise<void> {
        const messageType = message.type || message.command;

        switch (messageType) {
            case 'log':
                break;
            case 'error':
                new Notice(`Webview Error: ${message.text}`);
                break;
            case 'info':
                new Notice(`Webview: ${message.text}`);
                break;
            case 'warning':
                new Notice(`Webview: ${message.text}`);
                break;
            case 'saveFilteredImage':
                await MediaMessageHandlers.handleSaveFilteredImage(message, context);
                break;
            case 'saveRegionFile':
                await MediaMessageHandlers.handleSaveRegionFile(message, context);
                break;
            case 'saveChanges':
                await TextMessageHandlers.handleSaveChanges(message, context);
                break;
            case 'updateLine':
                await TextMessageHandlers.handleUpdateLine(message, context);
                break;
            case 'deleteLine':
                await TextMessageHandlers.handleDeleteLine(message, context);
                break;
            case 'insertLine':
                await TextMessageHandlers.handleInsertLine(message, context);
                break;
            case 'insertMultipleLines':
                await TextMessageHandlers.handleInsertMultipleLines(message, context);
                break;
            case 'deleteMultipleLines':
                await TextMessageHandlers.handleDeleteMultipleLines(message, context);
                break;
            case 'downloadFile':
                await MediaMessageHandlers.handleDownloadFile(message, context);
                break;
            case 'savePdf':
            case 'savePdfAs':
                await PdfMessageHandlers.handleSavePdf(message, context);
                break;
            case 'selectMergePdf':
                await PdfMessageHandlers.handleSelectMergePdf(context);
                break;
            case 'resetMergePdfCache':
                PdfMessageHandlers.resetMergedPdfCache(context);
                break;
        }
    }

    public static convertToDelimitedString(headers: string[], rows: string[][], delimiter = ','): string {
        return TextMessageHandlers.convertToDelimitedString(headers, rows, delimiter);
    }
}
