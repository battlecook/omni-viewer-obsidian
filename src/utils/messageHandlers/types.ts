export type WebviewMessageData = Record<string, unknown>;

export interface WebviewMessage {
    command: string;
    text?: string;
    data?: WebviewMessageData;
    fileName?: string;
    blob?: string;
    imageData?: string;
    type?: string;
    source?: string;
    path?: string;
    lineNumber?: number;
    mimeType?: string;
    duration?: string;
    startTime?: string;
    endTime?: string;
    content?: string;
}
