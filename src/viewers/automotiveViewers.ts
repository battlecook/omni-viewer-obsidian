import * as fs from 'fs';
import { AutomotiveParsers } from '../utils/automotiveParsers';
import { Hdf5Parser } from '../utils/hdf5Parser';
import { MatParser } from '../utils/matParser';
import { FileUtils } from '../utils/fileUtils';
import { TemplateUtils } from '../utils/templateUtils';
import { ViewerDefinition, ViewerErrorContent } from '../viewerCore';

/**
 * All of these viewers share the generic automotive/table template: parse the
 * file into a viewer model and hand it to automotive/automotiveViewer.html.
 */
function createAutomotiveViewer(options: {
    viewType: string;
    displayName: string;
    extensions: string[];
    icon: string;
    errorContent: ViewerErrorContent;
    parse: (filePath: string, fileSize: string) => Promise<unknown> | unknown;
}): ViewerDefinition {
    return {
        viewType: options.viewType,
        displayName: options.displayName,
        extensions: options.extensions,
        icon: options.icon,
        errorContent: options.errorContent,
        async render(ctx) {
            const model = await options.parse(ctx.filePath, await FileUtils.getFileSize(ctx.filePath));
            const html = await TemplateUtils.loadTemplate(ctx.templatesDir, 'automotive/automotiveViewer.html', {
                fileName: ctx.fileName,
                viewerData: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(model))
            });
            ctx.host.setHtml(html);
            ctx.host.setupDefaultMessages();
        }
    };
}

const readText = (filePath: string) => fs.promises.readFile(filePath, 'utf8');

export const arxmlViewer = createAutomotiveViewer({
    viewType: 'omni-viewer.arxmlViewer',
    displayName: 'ARXML Viewer',
    extensions: ['arxml'],
    icon: 'car',
    errorContent: {
        title: 'Failed to load ARXML file',
        message: 'Unable to parse the ARXML file due to an error:',
        icon: 'AR'
    },
    parse: async (filePath, fileSize) => AutomotiveParsers.parseArxml(await readText(filePath), fileSize)
});

export const a2lViewer = createAutomotiveViewer({
    viewType: 'omni-viewer.a2lViewer',
    displayName: 'A2L Viewer',
    extensions: ['a2l'],
    icon: 'car',
    errorContent: {
        title: 'Failed to load A2L file',
        message: 'Unable to parse the A2L file due to an error:',
        icon: 'A2L'
    },
    parse: async (filePath, fileSize) => AutomotiveParsers.parseA2l(await readText(filePath), fileSize)
});

export const ascViewer = createAutomotiveViewer({
    viewType: 'omni-viewer.ascViewer',
    displayName: 'ASC Viewer',
    extensions: ['asc'],
    icon: 'car',
    errorContent: {
        title: 'Failed to load ASC file',
        message: 'Unable to parse the ASC file due to an error:',
        icon: 'ASC'
    },
    parse: async (filePath, fileSize) => AutomotiveParsers.parseAsc(await readText(filePath), fileSize)
});

export const blfViewer = createAutomotiveViewer({
    viewType: 'omni-viewer.blfViewer',
    displayName: 'BLF Viewer',
    extensions: ['blf'],
    icon: 'car',
    errorContent: {
        title: 'Failed to load BLF file',
        message: 'Unable to inspect the BLF file due to an error:',
        icon: 'BLF'
    },
    parse: (filePath, fileSize) => AutomotiveParsers.parseBlf(filePath, fileSize)
});

export const mf4Viewer = createAutomotiveViewer({
    viewType: 'omni-viewer.mf4Viewer',
    displayName: 'MF4 Viewer',
    extensions: ['mf4'],
    icon: 'car',
    errorContent: {
        title: 'Failed to load MF4 file',
        message: 'Unable to inspect the MF4 file due to an error:',
        icon: 'MF4'
    },
    parse: (filePath, fileSize) => AutomotiveParsers.parseMf4(filePath, fileSize)
});

export const avroViewer = createAutomotiveViewer({
    viewType: 'omni-viewer.avroViewer',
    displayName: 'Avro Viewer',
    extensions: ['avro'],
    icon: 'database',
    errorContent: {
        title: 'Failed to load Avro file',
        message: 'Unable to inspect the Avro file due to an error:',
        icon: 'AVRO'
    },
    parse: (filePath, fileSize) => AutomotiveParsers.parseAvro(filePath, fileSize)
});

export const bagViewer = createAutomotiveViewer({
    viewType: 'omni-viewer.bagViewer',
    displayName: 'BAG Viewer',
    extensions: ['bag'],
    icon: 'bot',
    errorContent: {
        title: 'Failed to load BAG file',
        message: 'Unable to inspect the BAG file due to an error:',
        icon: 'BAG'
    },
    parse: (filePath, fileSize) => AutomotiveParsers.parseBag(filePath, fileSize)
});

export const stpViewer = createAutomotiveViewer({
    viewType: 'omni-viewer.stpViewer',
    displayName: 'STEP Viewer',
    extensions: ['stp', 'step'],
    icon: 'box',
    errorContent: {
        title: 'Failed to load STEP file',
        message: 'Unable to inspect the STEP file due to an error:',
        icon: 'STP'
    },
    parse: (filePath, fileSize) => AutomotiveParsers.parseStp(filePath, fileSize)
});

export const db3Viewer = createAutomotiveViewer({
    viewType: 'omni-viewer.db3Viewer',
    displayName: 'DB3 Viewer',
    extensions: ['db3'],
    icon: 'database',
    errorContent: {
        title: 'Failed to load DB3 file',
        message: 'Unable to inspect the DB3 file due to an error:',
        icon: 'DB3'
    },
    parse: (filePath, fileSize) => AutomotiveParsers.parseDb3(filePath, fileSize)
});

export const reqifViewer = createAutomotiveViewer({
    viewType: 'omni-viewer.reqifViewer',
    displayName: 'ReqIF Viewer',
    extensions: ['reqif'],
    icon: 'clipboard-list',
    errorContent: {
        title: 'Failed to load ReqIF file',
        message: 'Unable to inspect the ReqIF file due to an error:',
        icon: 'REQIF'
    },
    parse: async (filePath, fileSize) => AutomotiveParsers.parseReqif(await readText(filePath), fileSize)
});

export const pcapViewer = createAutomotiveViewer({
    viewType: 'omni-viewer.pcapViewer',
    displayName: 'PCAP Viewer',
    extensions: ['pcap'],
    icon: 'radio-tower',
    errorContent: {
        title: 'Failed to load PCAP file',
        message: 'Unable to inspect the PCAP file due to an error:',
        icon: 'PCAP'
    },
    parse: (filePath, fileSize) => AutomotiveParsers.parsePcap(filePath, fileSize)
});

export const pcapngViewer = createAutomotiveViewer({
    viewType: 'omni-viewer.pcapngViewer',
    displayName: 'PCAPNG Viewer',
    extensions: ['pcapng'],
    icon: 'radio-tower',
    errorContent: {
        title: 'Failed to load PCAPNG file',
        message: 'Unable to inspect the PCAPNG file due to an error:',
        icon: 'PCAPNG'
    },
    parse: (filePath, fileSize) => AutomotiveParsers.parsePcapng(filePath, fileSize)
});

export const hdf5Viewer = createAutomotiveViewer({
    viewType: 'omni-viewer.hdf5Viewer',
    displayName: 'HDF5 Viewer',
    extensions: ['h5', 'hdf5', 'he5'],
    icon: 'layers',
    errorContent: {
        title: 'Failed to load HDF5 file',
        message: 'Unable to inspect the HDF5 file due to an error:',
        icon: 'HDF5'
    },
    // Only metadata is read on demand (via fd), so multi-GB/TB files open without
    // loading the whole file into memory.
    parse: (filePath, fileSize) => Hdf5Parser.parseFile(filePath, fileSize)
});

export const matViewer = createAutomotiveViewer({
    viewType: 'omni-viewer.matViewer',
    displayName: 'MAT Viewer',
    extensions: ['mat'],
    icon: 'sigma',
    errorContent: {
        title: 'Failed to load MAT file',
        message: 'Unable to inspect the MATLAB MAT-file due to an error:',
        icon: 'MAT'
    },
    parse: (filePath, fileSize) => MatParser.parseFile(filePath, fileSize)
});
