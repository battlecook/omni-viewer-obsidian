import fs from 'fs';
import path from 'path';

const rootDir = process.cwd();
const sourcePath = path.join(rootDir, 'src', 'styles.css');
const outputPath = path.join(rootDir, 'styles.css');
const coreLatexPath = path.join(rootDir, 'node_modules', 'omni-viewer-core', 'dist', 'styles', 'latex.css');
const coreWordPath = path.join(rootDir, 'node_modules', 'omni-viewer-core', 'dist', 'styles', 'word.css');
const katexPath = path.join(rootDir, 'node_modules', 'katex', 'dist', 'katex.min.css');
const katexFontDir = path.join(rootDir, 'node_modules', 'katex', 'dist', 'fonts');

function scopeRules(css, scope) {
    let output = '';
    let cursor = 0;

    while (cursor < css.length) {
        const open = css.indexOf('{', cursor);
        if (open === -1) {
            output += css.slice(cursor);
            break;
        }

        const prelude = css.slice(cursor, open);
        let depth = 1;
        let close = open + 1;
        while (close < css.length && depth > 0) {
            if (css[close] === '{') depth++;
            else if (css[close] === '}') depth--;
            close++;
        }
        if (depth !== 0) throw new Error('Unbalanced CSS while building styles.css.');

        if (prelude.trimStart().startsWith('@')) {
            output += css.slice(cursor, close);
        } else {
            const leading = prelude.match(/^\s*/)?.[0] ?? '';
            const selectors = prelude.trim().split(',').map((selector) => `${scope} ${selector.trim()}`).join(',');
            output += `${leading}${selectors}${css.slice(open, close)}`;
        }
        cursor = close;
    }

    return output;
}

function scopeNestedRules(css, scope) {
    let output = '';
    let cursor = 0;

    while (cursor < css.length) {
        const open = css.indexOf('{', cursor);
        if (open === -1) {
            output += css.slice(cursor);
            break;
        }

        let depth = 1;
        let close = open + 1;
        while (close < css.length && depth > 0) {
            if (css[close] === '{') depth++;
            else if (css[close] === '}') depth--;
            close++;
        }
        if (depth !== 0) throw new Error('Unbalanced CSS while scoping word styles.');

        const prelude = css.slice(cursor, open);
        const leading = prelude.match(/^(?:\s|\/\*[\s\S]*?\*\/)*$/)?.[0] ??
            prelude.match(/^(?:\s|\/\*[\s\S]*?\*\/)+/)?.[0] ?? '';
        const rule = prelude.slice(leading.length).trim();
        const body = css.slice(open + 1, close - 1);

        if (rule.startsWith('@media') || rule.startsWith('@supports') || rule.startsWith('@layer')) {
            output += `${leading}${rule}{${scopeNestedRules(body, scope)}}`;
        } else if (rule.startsWith('@')) {
            output += css.slice(cursor, close);
        } else {
            const selectors = rule.split(',').flatMap((selector) => {
                const trimmed = selector.trim();
                // `body` rules belong to the core's standalone web adapter and
                // must not be applied to Obsidian's viewer container.
                if (trimmed === 'body') return [];
                if (trimmed === ':host' || trimmed === ':root') return [scope];
                if (trimmed.startsWith(':host')) return [`${scope}${trimmed.slice(5)}`];
                return [`${scope} ${trimmed}`];
            });
            output += selectors.length ? `${leading}${selectors.join(',')}{${body}}` : '';
        }
        cursor = close;
    }

    return output;
}

function bundledKatexCss() {
    return fs.readFileSync(katexPath, 'utf8')
        .replace(/,url\(fonts\/[^)]+\.(?:woff|ttf)\) format\("(?:woff|truetype)"\)/g, '')
        .replace(/url\(fonts\/([^)]+\.woff2)\)/g, (_match, fileName) => {
            const font = fs.readFileSync(path.join(katexFontDir, fileName)).toString('base64');
            return `url(data:font/woff2;base64,${font})`;
        });
}

const sourceCss = fs.readFileSync(sourcePath, 'utf8').trimEnd();
const coreLatexCss = fs.readFileSync(coreLatexPath, 'utf8').trim();
const coreWordCss = scopeNestedRules(
    fs.readFileSync(coreWordPath, 'utf8').trim(),
    '.omni-viewer-content .omni-viewer--word'
).trim();
const katexCss = scopeRules(bundledKatexCss(), '.omni-viewer-content .omni-viewer--latex').trim();

const output = `${sourceCss}\n\n/* Generated from omni-viewer-core. */\n${coreLatexCss}\n\n/* Generated from omni-viewer-core; selectors are limited to the Word viewer. */\n${coreWordCss}\n\n/* Generated from KaTeX; selectors are limited to the LaTeX viewer. */\n${katexCss}\n`;
fs.writeFileSync(outputPath, output);
console.log(`Generated ${path.relative(rootDir, outputPath)}`);
