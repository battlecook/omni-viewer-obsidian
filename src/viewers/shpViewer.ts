import { FileUtils } from '../utils/fileUtils';
import { TemplateUtils } from '../utils/templateUtils';
import { WebviewMessage } from '../utils/messageHandlers/types';
import { ViewerDefinition } from '../viewerCore';

const PREVIEW_FEATURE_COUNT = 10000;

export const shpViewer: ViewerDefinition = {
    viewType: 'omni-viewer.shpViewer',
    displayName: 'Shapefile Viewer',
    extensions: ['shp'],
    icon: 'map',
    errorContent: {
        title: 'Failed to load Shapefile',
        message: 'Unable to inspect the Shapefile due to an error:',
        icon: 'SHP'
    },
    async render(ctx) {
        const shpData = await FileUtils.readShapefile(ctx.filePath, {
            featureLimit: PREVIEW_FEATURE_COUNT
        });
        let loadedFeatures = shpData.metadata.nextFeatureStart;

        const html = await TemplateUtils.loadTemplate(ctx.templatesDir, 'shp/shpViewer.html', {
            fileName: ctx.fileName,
            shpData: TemplateUtils.escapeJsonForHtmlScriptTag(JSON.stringify(shpData))
        });

        ctx.host.setHtml(html);
        ctx.host.setupDefaultMessages({
            loadMoreShapefile: async (_message: WebviewMessage) => {
                const nextData = await FileUtils.readShapefile(ctx.filePath, {
                    featureStart: loadedFeatures,
                    featureLimit: PREVIEW_FEATURE_COUNT
                });

                loadedFeatures = nextData.metadata.nextFeatureStart;
                ctx.host.postMessage({
                    type: 'appendShapefileData',
                    data: nextData
                });
            }
        });
    }
};
