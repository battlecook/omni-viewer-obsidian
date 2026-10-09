// Minimal host surface for testing the real viewer in a DOM and vault stub.
export const Platform = { isDesktopApp: true, isMobileApp: false };
export class FileView {
    constructor(leaf) {
        this.leaf = leaf;
        this.app = leaf.app;
        this.contentEl = document.createElement('div');
        this.containerEl = this.contentEl;
    }
}
export class FileSystemAdapter {}
export class TFile {}
export class Notice {}
export class Modal {}
export class FuzzySuggestModal {}
export class Setting {}
export const normalizePath = (value) => value.replaceAll('\\', '/');
export const requestUrl = () => { throw new Error('Network access is unexpected in viewer tests.'); };
