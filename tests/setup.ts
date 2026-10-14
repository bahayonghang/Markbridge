import '@testing-library/jest-dom/vitest';

// jsdom has no media-query API; appearance tests can replace this with a live query.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true });
}

// jsdom lacks the native dialog methods. Browser tests cover focus and Escape.
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
}
