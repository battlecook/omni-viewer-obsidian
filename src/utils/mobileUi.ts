import { Platform } from 'obsidian';

const MOBILE_CORE_CSS = `
@media (max-width: 760px), (pointer: coarse) {
  button, input, select, [role="button"] { min-height: 40px; font-size: 16px; }
  .omni-csv__toolbar, .omni-pdf__toolbar, .omni-ppt__toolbar, .omni-safetensors__toolbar { flex-wrap: wrap; gap: 8px; }
  .omni-csv__toolbar > *, .omni-pdf__toolbar > * { max-width: 100%; }
  .omni-csv__table-wrap, .omni-pdf__workspace, .omni-ppt__viewport { overscroll-behavior: contain; }
  .omni-ppt__viewport { padding: 10px; }
  .omni-ppt__toolbar { overflow-x: auto; }
  .omni-archive__entry { min-height: 44px; }
  .omni-safetensors__table-wrap { overscroll-behavior: contain; }
}
`;

export function applyMobileCoreStyles(container: HTMLElement): void {
    if (!Platform.isMobileApp) return;
    const root = container.shadowRoot ?? container;
    if (root.querySelector('style[data-omni-mobile-core]')) return;
    const style = document.createElement('style');
    style.dataset.omniMobileCore = 'true';
    style.textContent = MOBILE_CORE_CSS;
    root.append(style);
}
