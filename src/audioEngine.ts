import * as fs from 'fs';
import * as path from 'path';
import AudioEngineModule from '../wasm/audio_engine.js';
import { getBundledBinaryAsset } from './utils/bundledAssets';

interface AudioEngineWasmModule {
    HEAPU8: Uint8Array;
    HEAPF32: Float32Array;
    _malloc(size: number): number;
    _free(ptr: number): void;
    _free_audio(ptr: number): void;
    _free_buffer(ptr: number): void;
    _decode_audio(inputPtr: number, inputLength: number): number;
    _audio_get_channels(audioPtr: number): number;
    _audio_get_sample_rate(audioPtr: number): number;
    _audio_get_total_frames(audioPtr: number): number;
    _audio_get_total_frames_high(audioPtr: number): number;
    _generate_peaks(audioPtr: number, peaksWidth: number): number;
    _generate_spectrogram(
        audioPtr: number,
        fftSize: number,
        hopSize: number,
        outWidthPtr: number,
        outHeightPtr: number
    ): number;
    getValue(ptr: number, type: 'i32'): number;
}

interface AudioEngineOptions {
    wasmBinary?: Uint8Array;
    locateFile: (file: string) => string;
}

type AudioEngineFactory = (options: AudioEngineOptions) => Promise<AudioEngineWasmModule>;

export interface AudioAnalysis {
    peaks: number[][];       // wavesurfer peaks format: [[...]]
    duration: number;        // seconds
    sampleRate: number;
    channels: number;
    spectrogram: number[][]; // [time][frequency] uint8 values (downsampled)
}

const MAX_SPEC_WIDTH = 3500;   // max time columns for spectrogram (~10MB JSON)
const MAX_SPEC_HEIGHT = 1024;  // full frequency resolution (no downsampling)
const FFT_SIZE = 2048;
const DEFAULT_PEAKS_WIDTH = 32000; // high-density peaks for zoomed view

export class AudioEngine {
    private module: AudioEngineWasmModule | null = null;

    constructor(private readonly wasmDir: string) {}

    async init(): Promise<void> {
        if (this.module) { return; }

        const wasmDir = this.wasmDir;
        const jsPath = path.join(wasmDir, 'audio_engine.js');

        const audioEngineModule: AudioEngineFactory = fs.existsSync(jsPath)
            ? this.loadAudioEngineFromFile(jsPath)
            : (AudioEngineModule as unknown as AudioEngineFactory);
        const wasmBinary = getBundledBinaryAsset('wasm/audio_engine.wasm') ?? getBundledBinaryAsset(path.join(wasmDir, 'audio_engine.wasm'), wasmDir);
        this.module = await audioEngineModule({
            ...(wasmBinary ? { wasmBinary } : {}),
            locateFile: (file: string) => path.join(wasmDir, file)
        });
    }

    private loadAudioEngineFromFile(jsPath: string): AudioEngineFactory {
        // Load the emscripten glue at runtime so the bundler does not inline it.
        const requireFn: NodeRequire = require;
        const loadedModule = requireFn(jsPath) as { default?: AudioEngineFactory } | AudioEngineFactory;
        const factory = typeof loadedModule === 'function' ? loadedModule : loadedModule.default;
        if (!factory) {
            throw new Error(`Invalid audio engine module: ${jsPath}`);
        }
        return factory;
    }

    async analyze(filePath: string, peaksWidth: number = DEFAULT_PEAKS_WIDTH): Promise<AudioAnalysis> {
        if (!this.module) {
            await this.init();
        }
        const module = this.module;
        if (!module) {
            throw new Error('Audio engine failed to initialize.');
        }

        const fileBuffer = await fs.promises.readFile(filePath);
        const uint8 = new Uint8Array(fileBuffer);
        const ext = path.extname(filePath).toLowerCase();

        // Copy input data to WASM memory
        const inputPtr = module._malloc(uint8.length);
        if (!inputPtr) {
            throw new Error(`WASM malloc failed for input buffer (${(uint8.length / 1024 / 1024).toFixed(1)}MB)`);
        }
        module.HEAPU8.set(uint8, inputPtr);

        // Decode audio
        const audioPtr = module._decode_audio(inputPtr, uint8.length);
        module._free(inputPtr);

        if (!audioPtr) {
            const supported = ['.wav', '.mp3', '.flac', '.ogg'];
            if (!supported.includes(ext)) {
                throw new Error(`Unsupported audio format: ${ext}. WASM engine supports: ${supported.join(', ')}`);
            }
            throw new Error(`Failed to decode audio file (${ext}, ${(uint8.length / 1024 / 1024).toFixed(1)}MB). Possible memory limit exceeded.`);
        }

        try {
            // Read audio properties via accessor functions
            const channels = module._audio_get_channels(audioPtr);
            const sampleRate = module._audio_get_sample_rate(audioPtr);
            const totalFramesLow = module._audio_get_total_frames(audioPtr);
            const totalFramesHigh = module._audio_get_total_frames_high(audioPtr);
            const totalFrames = totalFramesLow + totalFramesHigh * 0x100000000;
            const duration = totalFrames / sampleRate;

            // Generate peaks
            const peaksPtr = module._generate_peaks(audioPtr, peaksWidth);
            if (!peaksPtr) {
                throw new Error('Failed to generate peaks');
            }

            const peaksArray = new Float32Array(
                module.HEAPF32.buffer, peaksPtr, peaksWidth
            ).slice(); // copy out of WASM memory
            module._free_buffer(peaksPtr);

            // Calculate hop_size to limit spectrogram time columns
            const hopSize = Math.max(512, Math.ceil(totalFrames / MAX_SPEC_WIDTH));

            // Generate spectrogram
            const outWidthPtr = module._malloc(4);
            const outHeightPtr = module._malloc(4);
            const specPtr = module._generate_spectrogram(
                audioPtr, FFT_SIZE, hopSize, outWidthPtr, outHeightPtr
            );

            const specWidth = module.getValue(outWidthPtr, 'i32');
            const specHeight = module.getValue(outHeightPtr, 'i32'); // FFT_SIZE / 2 = 1024
            module._free(outWidthPtr);
            module._free(outHeightPtr);

            let spectrogram: number[][] = [];
            if (specPtr && specWidth > 0 && specHeight > 0) {
                const outHeight = Math.min(specHeight, MAX_SPEC_HEIGHT);
                const freqStep = Math.max(1, Math.floor(specHeight / outHeight));

                for (let t = 0; t < specWidth; t++) {
                    const column: number[] = new Array(outHeight);
                    if (freqStep === 1) {
                        // No downsampling — copy directly
                        for (let f = 0; f < outHeight; f++) {
                            column[f] = module.HEAPU8[specPtr + t * specHeight + f];
                        }
                    } else {
                        for (let fOut = 0; fOut < outHeight; fOut++) {
                            const fStart = fOut * freqStep;
                            const fEnd = Math.min(fStart + freqStep, specHeight);
                            let sum = 0;
                            for (let f = fStart; f < fEnd; f++) {
                                sum += module.HEAPU8[specPtr + t * specHeight + f];
                            }
                            column[fOut] = Math.round(sum / (fEnd - fStart));
                        }
                    }
                    spectrogram.push(column);
                }
                module._free_buffer(specPtr);
            }

            return {
                peaks: [Array.from(peaksArray)],
                duration,
                sampleRate,
                channels,
                spectrogram
            };
        } finally {
            module._free_audio(audioPtr);
        }
    }
}
