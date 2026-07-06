/**
 * The vscode templates style themselves with --vscode-* CSS variables.
 * Obsidian exposes its theme through --background-primary etc., but the
 * viewer iframe (srcdoc) does not inherit the parent's custom properties,
 * so we snapshot the computed Obsidian values and emit literal --vscode-*
 * declarations into every viewer document.
 */

interface VarMapping {
    vscodeVar: string;
    obsidianVar?: string;
    fallbackDark: string;
    fallbackLight?: string;
}

const VAR_MAPPINGS: VarMapping[] = [
    { vscodeVar: '--vscode-editor-background', obsidianVar: '--background-primary', fallbackDark: '#1e1e1e', fallbackLight: '#ffffff' },
    { vscodeVar: '--vscode-editor-foreground', obsidianVar: '--text-normal', fallbackDark: '#d4d4d4', fallbackLight: '#222222' },
    { vscodeVar: '--vscode-foreground', obsidianVar: '--text-normal', fallbackDark: '#d4d4d4', fallbackLight: '#222222' },
    { vscodeVar: '--vscode-descriptionForeground', obsidianVar: '--text-muted', fallbackDark: '#9d9d9d', fallbackLight: '#717171' },
    { vscodeVar: '--vscode-disabledForeground', obsidianVar: '--text-faint', fallbackDark: '#6f6f6f', fallbackLight: '#a0a0a0' },
    { vscodeVar: '--vscode-panel-border', obsidianVar: '--background-modifier-border', fallbackDark: '#3c3c3c', fallbackLight: '#dddddd' },
    { vscodeVar: '--vscode-widget-border', obsidianVar: '--background-modifier-border', fallbackDark: '#3c3c3c', fallbackLight: '#dddddd' },
    { vscodeVar: '--vscode-focusBorder', obsidianVar: '--interactive-accent', fallbackDark: '#007fd4', fallbackLight: '#0066bf' },
    { vscodeVar: '--vscode-button-background', obsidianVar: '--interactive-accent', fallbackDark: '#0e639c', fallbackLight: '#007acc' },
    { vscodeVar: '--vscode-button-foreground', obsidianVar: '--text-on-accent', fallbackDark: '#ffffff', fallbackLight: '#ffffff' },
    { vscodeVar: '--vscode-button-hoverBackground', obsidianVar: '--interactive-accent-hover', fallbackDark: '#1177bb', fallbackLight: '#0062a3' },
    { vscodeVar: '--vscode-button-border', obsidianVar: '--background-modifier-border', fallbackDark: 'transparent', fallbackLight: 'transparent' },
    { vscodeVar: '--vscode-button-secondaryBackground', obsidianVar: '--interactive-normal', fallbackDark: '#3a3d41', fallbackLight: '#e5e5e5' },
    { vscodeVar: '--vscode-button-secondaryForeground', obsidianVar: '--text-normal', fallbackDark: '#f3f3f3', fallbackLight: '#222222' },
    { vscodeVar: '--vscode-button-secondaryHoverBackground', obsidianVar: '--interactive-hover', fallbackDark: '#45494e', fallbackLight: '#d8d8d8' },
    { vscodeVar: '--vscode-sideBar-background', obsidianVar: '--background-secondary', fallbackDark: '#252526', fallbackLight: '#f3f3f3' },
    { vscodeVar: '--vscode-sideBar-foreground', obsidianVar: '--text-normal', fallbackDark: '#cccccc', fallbackLight: '#222222' },
    { vscodeVar: '--vscode-panel-background', obsidianVar: '--background-secondary', fallbackDark: '#252526', fallbackLight: '#f3f3f3' },
    { vscodeVar: '--vscode-editorWidget-background', obsidianVar: '--background-secondary', fallbackDark: '#252526', fallbackLight: '#f3f3f3' },
    { vscodeVar: '--vscode-editorWidget-border', obsidianVar: '--background-modifier-border', fallbackDark: '#454545', fallbackLight: '#c8c8c8' },
    { vscodeVar: '--vscode-input-background', obsidianVar: '--background-modifier-form-field', fallbackDark: '#3c3c3c', fallbackLight: '#ffffff' },
    { vscodeVar: '--vscode-input-foreground', obsidianVar: '--text-normal', fallbackDark: '#cccccc', fallbackLight: '#222222' },
    { vscodeVar: '--vscode-input-border', obsidianVar: '--background-modifier-border', fallbackDark: '#3c3c3c', fallbackLight: '#cecece' },
    { vscodeVar: '--vscode-inputOption-activeBorder', obsidianVar: '--interactive-accent', fallbackDark: '#007acc', fallbackLight: '#007acc' },
    { vscodeVar: '--vscode-errorForeground', obsidianVar: '--text-error', fallbackDark: '#f48771', fallbackLight: '#a1260d' },
    { vscodeVar: '--vscode-editorError-foreground', obsidianVar: '--text-error', fallbackDark: '#f48771', fallbackLight: '#e51400' },
    { vscodeVar: '--vscode-editorWarning-foreground', obsidianVar: '--color-yellow', fallbackDark: '#cca700', fallbackLight: '#bf8803' },
    { vscodeVar: '--vscode-list-hoverBackground', obsidianVar: '--background-modifier-hover', fallbackDark: '#2a2d2e', fallbackLight: '#e8e8e8' },
    { vscodeVar: '--vscode-list-activeSelectionBackground', obsidianVar: '--background-modifier-active-hover', fallbackDark: '#094771', fallbackLight: '#0060c0' },
    { vscodeVar: '--vscode-list-activeSelectionForeground', obsidianVar: '--text-normal', fallbackDark: '#ffffff', fallbackLight: '#ffffff' },
    { vscodeVar: '--vscode-list-inactiveSelectionBackground', obsidianVar: '--background-modifier-hover', fallbackDark: '#37373d', fallbackLight: '#e4e6f1' },
    { vscodeVar: '--vscode-scrollbarSlider-background', fallbackDark: 'rgba(121, 121, 121, 0.4)', fallbackLight: 'rgba(100, 100, 100, 0.4)' },
    { vscodeVar: '--vscode-scrollbarSlider-hoverBackground', fallbackDark: 'rgba(100, 100, 100, 0.7)', fallbackLight: 'rgba(100, 100, 100, 0.7)' },
    { vscodeVar: '--vscode-scrollbarSlider-activeBackground', fallbackDark: 'rgba(191, 191, 191, 0.4)', fallbackLight: 'rgba(0, 0, 0, 0.6)' },
    { vscodeVar: '--vscode-toolbar-hoverBackground', obsidianVar: '--background-modifier-hover', fallbackDark: 'rgba(90, 93, 94, 0.31)', fallbackLight: 'rgba(184, 184, 184, 0.31)' },
    { vscodeVar: '--vscode-titleBar-activeBackground', obsidianVar: '--background-secondary-alt', fallbackDark: '#3c3c3c', fallbackLight: '#dddddd' },
    { vscodeVar: '--vscode-titleBar-activeForeground', obsidianVar: '--text-normal', fallbackDark: '#cccccc', fallbackLight: '#333333' },
    { vscodeVar: '--vscode-menu-background', obsidianVar: '--background-primary', fallbackDark: '#252526', fallbackLight: '#ffffff' },
    { vscodeVar: '--vscode-menu-foreground', obsidianVar: '--text-normal', fallbackDark: '#cccccc', fallbackLight: '#616161' },
    { vscodeVar: '--vscode-menu-border', obsidianVar: '--background-modifier-border', fallbackDark: '#454545', fallbackLight: '#d4d4d4' },
    { vscodeVar: '--vscode-menu-selectionBackground', obsidianVar: '--background-modifier-hover', fallbackDark: '#094771', fallbackLight: '#0060c0' },
    { vscodeVar: '--vscode-inputValidation-errorBackground', obsidianVar: '--background-modifier-error', fallbackDark: '#5a1d1d', fallbackLight: '#f2dede' },
    { vscodeVar: '--vscode-inputValidation-errorBorder', obsidianVar: '--text-error', fallbackDark: '#be1100', fallbackLight: '#be1100' },
    { vscodeVar: '--vscode-inputValidation-warningBackground', fallbackDark: '#352a05', fallbackLight: '#f6f5d2' },
    { vscodeVar: '--vscode-inputValidation-warningForeground', obsidianVar: '--text-normal', fallbackDark: '#cccccc', fallbackLight: '#222222' },
    { vscodeVar: '--vscode-inputValidation-warningBorder', obsidianVar: '--color-yellow', fallbackDark: '#b89500', fallbackLight: '#b89500' },
    { vscodeVar: '--vscode-editorInfo-foreground', obsidianVar: '--text-accent', fallbackDark: '#3794ff', fallbackLight: '#1a85ff' },
    { vscodeVar: '--vscode-editorInfo-background', obsidianVar: '--background-secondary', fallbackDark: '#252526', fallbackLight: '#f3f3f3' },
    { vscodeVar: '--vscode-testing-iconPassed', obsidianVar: '--color-green', fallbackDark: '#73c991', fallbackLight: '#388a34' },
    { vscodeVar: '--vscode-textBlockQuote-background', obsidianVar: '--background-secondary', fallbackDark: '#222222', fallbackLight: '#f2f2f2' },
    { vscodeVar: '--vscode-textBlockQuote-border', obsidianVar: '--background-modifier-border', fallbackDark: '#007acc80', fallbackLight: '#007acc80' },
    { vscodeVar: '--vscode-textLink-foreground', obsidianVar: '--text-accent', fallbackDark: '#3794ff', fallbackLight: '#006ab1' },
    { vscodeVar: '--vscode-textLink-activeForeground', obsidianVar: '--text-accent-hover', fallbackDark: '#3794ff', fallbackLight: '#006ab1' },
    { vscodeVar: '--vscode-textCodeBlock-background', obsidianVar: '--code-background', fallbackDark: '#0a0a0a66', fallbackLight: '#dcdcdc66' },
    { vscodeVar: '--vscode-textPreformat-foreground', obsidianVar: '--text-normal', fallbackDark: '#d7ba7d', fallbackLight: '#a31515' },
    { vscodeVar: '--vscode-badge-background', obsidianVar: '--interactive-accent', fallbackDark: '#4d4d4d', fallbackLight: '#c4c4c4' },
    { vscodeVar: '--vscode-badge-foreground', obsidianVar: '--text-on-accent', fallbackDark: '#ffffff', fallbackLight: '#333333' },
    { vscodeVar: '--vscode-progressBar-background', obsidianVar: '--interactive-accent', fallbackDark: '#0e70c0', fallbackLight: '#0e70c0' },
    { vscodeVar: '--vscode-notifications-background', obsidianVar: '--background-secondary', fallbackDark: '#252526', fallbackLight: '#f3f3f3' },
    { vscodeVar: '--vscode-symbolIcon-classForeground', obsidianVar: '--color-orange', fallbackDark: '#ee9d28', fallbackLight: '#d67e00' },
    { vscodeVar: '--vscode-symbolIcon-fieldForeground', obsidianVar: '--color-blue', fallbackDark: '#75beff', fallbackLight: '#007acc' },
    { vscodeVar: '--vscode-charts-blue', obsidianVar: '--color-blue', fallbackDark: '#3794ff', fallbackLight: '#1a85ff' },
    { vscodeVar: '--vscode-charts-red', obsidianVar: '--color-red', fallbackDark: '#f14c4c', fallbackLight: '#e51400' },
    { vscodeVar: '--vscode-charts-green', obsidianVar: '--color-green', fallbackDark: '#89d185', fallbackLight: '#388a34' },
    { vscodeVar: '--vscode-charts-yellow', obsidianVar: '--color-yellow', fallbackDark: '#cca700', fallbackLight: '#bf8803' },
    { vscodeVar: '--vscode-charts-orange', obsidianVar: '--color-orange', fallbackDark: '#d18616', fallbackLight: '#d18616' },
    { vscodeVar: '--vscode-charts-purple', obsidianVar: '--color-purple', fallbackDark: '#b180d7', fallbackLight: '#652d90' },
];

const FONT_MAPPINGS: VarMapping[] = [
    { vscodeVar: '--vscode-font-family', obsidianVar: '--font-interface', fallbackDark: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
    { vscodeVar: '--vscode-editor-font-family', obsidianVar: '--font-monospace', fallbackDark: "'SF Mono', Monaco, Menlo, Consolas, 'Courier New', monospace" },
    { vscodeVar: '--vscode-font-size', fallbackDark: '13px' },
    { vscodeVar: '--vscode-editor-font-size', fallbackDark: '13px' },
];

export function buildVscodeThemeCss(referenceEl: HTMLElement): string {
    const computed = window.getComputedStyle(referenceEl);
    const isDark = document.body.classList.contains('theme-dark');

    const lines: string[] = [];
    for (const mapping of [...VAR_MAPPINGS, ...FONT_MAPPINGS]) {
        let value = '';
        if (mapping.obsidianVar) {
            value = computed.getPropertyValue(mapping.obsidianVar).trim();
        }
        if (!value) {
            value = (!isDark && mapping.fallbackLight) ? mapping.fallbackLight : mapping.fallbackDark;
        }
        lines.push(`    ${mapping.vscodeVar}: ${value};`);
    }

    return `:root {\n${lines.join('\n')}\n    color-scheme: ${isDark ? 'dark' : 'light'};\n}`;
}
