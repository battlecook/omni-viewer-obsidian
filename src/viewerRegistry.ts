import { ViewerDefinition } from './viewerCore';
import { archiveViewer } from './viewers/archiveViewer';
import { audioViewer } from './viewers/audioViewer';
import { videoViewer } from './viewers/videoViewer';
import { imageViewer } from './viewers/imageViewer';
import { csvViewer } from './viewers/csvViewer';
import { dbcViewer } from './viewers/dbcViewer';
import { jsonViewer } from './viewers/jsonViewer';
import { yamlViewer } from './viewers/yamlViewer';
import { jsonlViewer } from './viewers/jsonlViewer';
import { tomlViewer } from './viewers/tomlViewer';
import { markdownViewer, mermaidViewer, plantumlViewer, protoViewer } from './viewers/sourceDiagramViewers';
import {
    a2lViewer,
    arxmlViewer,
    ascViewer,
    avroViewer,
    bagViewer,
    blfViewer,
    db3Viewer,
    hdf5Viewer,
    matViewer,
    mf4Viewer,
    pcapViewer,
    pcapngViewer,
    reqifViewer,
    stpViewer
} from './viewers/automotiveViewers';
import { parquetViewer } from './viewers/parquetViewer';
import { shpViewer } from './viewers/shpViewer';
import { pdfViewer } from './viewers/pdfViewer';
import { pptViewer } from './viewers/pptViewer';
import { excelViewer, hwpViewer, psdViewer } from './viewers/officeViewers';
import { wordViewer } from './viewers/wordViewer';
import { safetensorsViewer } from './viewers/safetensorsViewer';

export const VIEWER_DEFINITIONS: ViewerDefinition[] = [
    archiveViewer,
    audioViewer,
    imageViewer,
    videoViewer,
    csvViewer,
    dbcViewer,
    arxmlViewer,
    a2lViewer,
    ascViewer,
    blfViewer,
    mf4Viewer,
    avroViewer,
    bagViewer,
    stpViewer,
    db3Viewer,
    reqifViewer,
    pcapViewer,
    pcapngViewer,
    jsonViewer,
    yamlViewer,
    jsonlViewer,
    tomlViewer,
    markdownViewer,
    mermaidViewer,
    plantumlViewer,
    protoViewer,
    parquetViewer,
    shpViewer,
    hdf5Viewer,
    matViewer,
    safetensorsViewer,
    hwpViewer,
    psdViewer,
    excelViewer,
    wordViewer,
    pdfViewer,
    pptViewer
];
