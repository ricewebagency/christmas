const SCREEN_LOADER_SELECTOR = '[data-screen-loader]';
const SCREEN_LOADER_DURATION_MS = 2200;

function initScreenLoader() {
    const loaderEl = document.querySelector(SCREEN_LOADER_SELECTOR);

    if (!(loaderEl instanceof HTMLElement)) {
        return;
    }

    loaderEl.addEventListener('animationend', () => {
        loaderEl.remove();
    }, { once: true });

    window.setTimeout(() => {
        loaderEl.remove();
    }, SCREEN_LOADER_DURATION_MS + 250);
}

window.addEventListener('DOMContentLoaded', () => {
    initScreenLoader();
});
