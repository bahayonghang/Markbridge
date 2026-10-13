import '@testing-library/jest-dom/vitest';

// jsdom lacks the native dialog methods. Browser tests cover focus and Escape.
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
}
