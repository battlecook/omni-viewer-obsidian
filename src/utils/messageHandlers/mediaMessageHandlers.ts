import * as path from 'path';
import * as fs from 'fs';
import { Notice } from 'obsidian';
import { WebviewMessage } from './types';
import { MessageContext } from './context';
import { confirmDialog, revealInOS, showSaveDialog } from '../../platform';

export class MediaMessageHandlers {
    public static async handleSaveFilteredImage(message: WebviewMessage, context: MessageContext): Promise<void> {
        try {
            if (!message.fileName || !message.imageData) {
                throw new Error('No filename or image data provided');
            }

            const adapter = context.app.vault.adapter;

            // The viewer sends only a bare filename (e.g. "<name>_saved.png").
            // Save it next to the original file so it appears in the same folder,
            // rather than at the vault root.
            const baseName = path.basename(message.fileName);
            const parentPath = context.file.parent?.path ?? '';
            const vaultPath = parentPath && parentPath !== '/'
                ? `${parentPath}/${baseName}`
                : baseName;

            if (await adapter.exists(vaultPath)) {
                const overwrite = await confirmDialog(
                    context.app,
                    `File "${vaultPath}" already exists. Do you want to overwrite it?`
                );
                if (!overwrite) {
                    return;
                }
            }

            const imageBuffer = Buffer.from(message.imageData, 'base64');
            await adapter.writeBinary(vaultPath, imageBuffer.buffer.slice(imageBuffer.byteOffset, imageBuffer.byteOffset + imageBuffer.byteLength) as ArrayBuffer);

            new Notice(`Image saved: ${vaultPath}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            new Notice(`Failed to save filtered image: ${errorMessage}`);
            console.error('Error saving filtered image:', error);
        }
    }

    public static async handleSaveRegionFile(message: WebviewMessage, context: MessageContext): Promise<void> {
        try {
            if (!message.fileName || !message.blob) {
                throw new Error('No filename or blob data provided');
            }

            const defaultFileName = this.sanitizeFileName(message.fileName);
            const defaultDir = path.dirname(context.absPath);
            const savePath = await showSaveDialog(
                path.join(defaultDir, defaultFileName),
                [
                    { name: 'Audio files', extensions: ['wav', 'mp3', 'flac', 'aac', 'ogg', 'm4a'] },
                    { name: 'All files', extensions: ['*'] }
                ]
            );

            if (!savePath) {
                return;
            }

            const audioBuffer = Buffer.from(message.blob, 'base64');
            await fs.promises.writeFile(savePath, audioBuffer);

            const fileSize = (audioBuffer.length / 1024).toFixed(2);
            new Notice(`오디오 저장 완료: ${path.basename(savePath)} (${fileSize} KB)`);
            revealInOS(savePath);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            new Notice(`오디오 저장 실패: ${errorMessage}`);
            console.error('Error saving region file:', error);
        }
    }

    public static async handleDownloadFile(message: WebviewMessage, context: MessageContext): Promise<void> {
        try {
            const originalFileName = path.basename(context.absPath);
            const fileName = message.fileName || originalFileName || 'audio_file';
            const defaultFileName = this.sanitizeFileName(fileName);
            const savePath = await showSaveDialog(
                path.join(path.dirname(context.absPath), defaultFileName),
                [
                    { name: 'Audio files', extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'] },
                    { name: 'All files', extensions: ['*'] }
                ]
            );

            if (!savePath) {
                return;
            }

            try {
                await fs.promises.copyFile(context.absPath, savePath);
                new Notice(`File downloaded successfully: ${savePath}`);
            } catch (copyError) {
                console.error('Error copying file:', copyError);
                revealInOS(context.absPath);
                new Notice('Please manually copy the file from the revealed location');
            }
        } catch (error) {
            console.error('Error handling download request:', error);
            new Notice(`Download failed: ${error}`);
        }
    }

    private static sanitizeFileName(fileName: string): string {
        return fileName
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, '_')
            .replace(/_{2,}/g, '_')
            .replace(/^_|_$/g, '')
            .substring(0, 255);
    }
}
