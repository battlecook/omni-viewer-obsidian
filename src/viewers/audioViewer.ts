import * as fs from 'fs';
import * as path from 'path';
import { FileUtils } from '../utils/fileUtils';
import { TemplateUtils } from '../utils/templateUtils';
import { AudioEngine } from '../audioEngine';
import { ViewerDefinition } from '../viewerCore';

const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024; // 50MB
const LONG_DURATION_THRESHOLD = 300; // 5 minutes

// Conservative (low) bitrate estimates in bytes/sec for duration estimation
// Using low estimates so we overestimate duration → prefer WASM path
const BITRATE_ESTIMATES: Record<string, number> = {
    '.mp3': 16000,   // ~128kbps
    '.ogg': 16000,   // ~128kbps
    '.aac': 16000,   // ~128kbps
    '.m4a': 16000,   // ~128kbps
    '.flac': 100000, // ~800kbps
    '.wav': 176400,  // 44.1kHz 16-bit stereo
};

// OGG metadata duration is unreliable (music-metadata often reads only the first page)
const UNRELIABLE_METADATA_EXTS = new Set(['.ogg']);

function estimateDuration(fileSize: number, ext: string, metadataDuration?: number): number {
    if (metadataDuration && metadataDuration > 0 && !UNRELIABLE_METADATA_EXTS.has(ext)) {
        return metadataDuration;
    }
    const bytesPerSec = BITRATE_ESTIMATES[ext];
    if (bytesPerSec) {
        return fileSize / bytesPerSec;
    }
    return 0;
}

let audioEngine: AudioEngine | null = null;

export const audioViewer: ViewerDefinition = {
    viewType: 'omni-viewer.audioViewer',
    displayName: 'Audio Viewer',
    extensions: ['mp3', 'wav', 'pcm', 'aiff', 'aif', 'aifc', 'amr', 'awb', 'ogg', 'flac', 'ac3', 'aac', 'm4a'],
    icon: 'file-audio',
    errorContent: {
        title: 'Failed to load audio file',
        message: 'Unable to load the audio file due to an error:',
        icon: '🎵'
    },
    async render(ctx) {
        const audioPath = ctx.filePath;
        const audioFileName = ctx.fileName;

        const metadata = await FileUtils.getAudioMetadata(audioPath);
        const stats = await fs.promises.stat(audioPath);
        const fileSize = stats.size;
        const ext = path.extname(audioPath).toLowerCase();
        const estDuration = estimateDuration(fileSize, ext, metadata.duration);
        // Use WASM path for large files OR long-duration audio (compressed formats like MP3)
        const isLargeFile = fileSize > LARGE_FILE_THRESHOLD || estDuration > LONG_DURATION_THRESHOLD;

        let templateVars: Record<string, string>;

        if (isLargeFile) {
            if (ext === '.pcm') {
                const audioSource = await FileUtils.getAudioWebviewSource(audioPath);
                templateVars = {
                    fileName: audioFileName,
                    audioSrc: audioSource.dataUrl,
                    metadata: JSON.stringify(metadata),
                    peaks: '',
                    duration: '',
                    spectrogram: '',
                    sampleRate: '',
                    mode: 'default'
                };
            } else {
                // Large file: stream directly from disk via a resource URL
                const audioResourceUri = ctx.host.asWebviewUri(audioPath);

                // Try WASM engine for peaks/spectrogram
                try {
                    if (!audioEngine) {
                        audioEngine = new AudioEngine(ctx.wasmDir);
                        await audioEngine.init();
                    }

                    const analysis = await audioEngine.analyze(audioPath);

                    // Sanity check: verify WASM decoded duration is reasonable
                    // Use file-size estimate as ground truth (metadata may be unreliable for OGG)
                    const expectedDuration = estDuration;
                    if (expectedDuration > 60 && analysis.duration < expectedDuration * 0.5) {
                        console.warn(`[AudioViewer] WASM decoded ${analysis.duration.toFixed(1)}s but expected ~${expectedDuration.toFixed(1)}s. Falling back to streaming.`);
                        throw new Error(`Decode duration mismatch: got ${analysis.duration.toFixed(1)}s, expected ~${expectedDuration.toFixed(1)}s`);
                    }

                    templateVars = {
                        fileName: audioFileName,
                        audioSrc: audioResourceUri,
                        metadata: JSON.stringify(metadata),
                        peaks: JSON.stringify(analysis.peaks),
                        duration: String(analysis.duration),
                        spectrogram: JSON.stringify(analysis.spectrogram),
                        sampleRate: String(analysis.sampleRate),
                        mode: 'precomputed'
                    };
                } catch (wasmError) {
                    // Fallback: stream via MediaElement without precomputed data
                    console.warn(`[AudioViewer] WASM analysis failed, falling back to streaming mode: ${wasmError}`);
                    templateVars = {
                        fileName: audioFileName,
                        audioSrc: audioResourceUri,
                        metadata: JSON.stringify(metadata),
                        peaks: '',
                        duration: '',
                        spectrogram: '',
                        sampleRate: '',
                        mode: 'streaming'
                    };
                }
            }
        } else {
            // Small file: use an embeddable source so unsupported browser codecs can be wrapped/transcoded.
            const audioSource = await FileUtils.getAudioWebviewSource(audioPath);

            templateVars = {
                fileName: audioFileName,
                audioSrc: audioSource.dataUrl,
                metadata: JSON.stringify(metadata),
                peaks: '',
                duration: '',
                spectrogram: '',
                sampleRate: '',
                mode: 'default'
            };
        }

        const html = await TemplateUtils.loadTemplate(ctx.templatesDir, 'audio/audioViewer.html', templateVars);
        ctx.host.setHtml(html);
        ctx.host.setupDefaultMessages();
    }
};
