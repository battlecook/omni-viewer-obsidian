import * as path from 'path';
import * as fs from 'fs';
import { getBundledTextAsset } from './bundledAssets';
import { escapeJsonForHtmlScriptTag } from './htmlEscaping';

export interface TemplateResourceResolver {
    asWebviewUri(absolutePath: string): string;
}

export class TemplateUtils {
    public static escapeJsonForHtmlScriptTag(json: string): string {
        return escapeJsonForHtmlScriptTag(json);
    }

    public static async loadTemplate(
        templatesDir: string,
        templateName: string,
        variables: { [key: string]: string },
        resolver?: TemplateResourceResolver
    ): Promise<string> {
        const templatePath = path.join(templatesDir, templateName);

        try {
            let template = await this.readTextAsset(templatePath, templatesDir);

            template = await this.inlineExternalFiles(templatePath, template, templatesDir, resolver);

            for (const [key, value] of Object.entries(variables)) {
                const placeholder = `{{${key}}}`;
                const safeValue = value === null || value === undefined ? '' : String(value);
                // Use split/join to avoid `$` replacement semantics in String.replace.
                template = template.split(placeholder).join(safeValue);
            }

            return template;
        } catch (error) {
            console.error(`Error loading template ${templateName}:`, error);
            throw new Error(`Failed to load template: ${templateName}`);
        }
    }

    private static async inlineExternalFiles(
        templatePath: string,
        html: string,
        templatesDir: string,
        resolver?: TemplateResourceResolver
    ): Promise<string> {
        const templateDir = path.dirname(templatePath);

        const cssMatch = html.match(/<link[^>]*href="([^"]*\.css)"[^>]*>/g);
        if (cssMatch) {
            for (const linkTag of cssMatch) {
                const hrefMatch = linkTag.match(/href="([^"]*\.css)"/);
                if (hrefMatch) {
                    const cssRelativePath = hrefMatch[1];
                    const cssPath = path.join(templateDir, cssRelativePath);

                    try {
                        const cssContent = await this.readTextAsset(cssPath, templatesDir);
                        const styleTag = `<style>\n${cssContent}\n</style>`;
                        html = html.replace(linkTag, () => styleTag);
                    } catch (error) {
                        console.error(`Failed to inline required CSS file ${cssRelativePath}:`, error);
                        throw new Error(`Required CSS asset could not be loaded: ${cssRelativePath}`);
                    }
                }
            }
        }

        const jsMatch = html.match(/<script[^>]*src="([^"]*\.js)"[^>]*><\/script>/g);
        if (jsMatch) {
            for (const scriptTag of jsMatch) {
                const srcMatch = scriptTag.match(/src="([^"]*\.js)"/);
                if (srcMatch) {
                    const jsRelativePath = srcMatch[1];

                    if (jsRelativePath.startsWith('http://') || jsRelativePath.startsWith('https://')) {
                        continue;
                    }

                    const jsPath = path.join(templateDir, jsRelativePath);

                    try {
                        if (/\sdata-omni-no-inline(?:\s|=|>)/.test(scriptTag)) {
                            if (!resolver) {
                                throw new Error(`Resource URI conversion is required for non-inlined script: ${jsRelativePath}`);
                            }

                            const resourceSrc = resolver.asWebviewUri(jsPath);
                            const scriptTagWithUri = scriptTag.replace(srcMatch[0], `src="${resourceSrc}"`);
                            html = html.replace(scriptTag, () => scriptTagWithUri);
                            continue;
                        }

                        const jsContent = await this.readTextAsset(jsPath, templatesDir);
                        const inlineScriptTag = `<script>\n${jsContent}\n</script>`;
                        html = html.replace(scriptTag, () => inlineScriptTag);
                    } catch (error) {
                        console.error(`Failed to inline required JavaScript file ${jsRelativePath}:`, error);
                        throw new Error(`Required JavaScript asset could not be loaded: ${jsRelativePath}`);
                    }
                }
            }
        }

        return html;
    }

    private static async readTextAsset(assetPath: string, templatesDir: string): Promise<string> {
        const bundled = getBundledTextAsset(assetPath, templatesDir);
        if (bundled !== undefined) {
            return bundled;
        }

        return fs.promises.readFile(assetPath, 'utf8');
    }
}
