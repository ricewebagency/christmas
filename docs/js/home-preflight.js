// Classic script in <head>: when a code is about to be checked (stored or ?code=), mark <html> before first paint
// so the home page starts black instead of flashing the burnt paper before redirecting. home.js clears it.
(() => {
    // Keep in sync with GUEST_CODE_STORAGE_KEY in api-client.js.
    const GUEST_CODE_KEY = 'christmas-at-the-great-hall.guest-code';

    let hasStoredCode = false;

    try {
        hasStoredCode = JSON.parse(localStorage.getItem(GUEST_CODE_KEY) ?? 'null') !== null;
    } catch {
        hasStoredCode = false;
    }

    if (hasStoredCode || new URLSearchParams(window.location.search).has('code')) {
        document.documentElement.setAttribute('data-home-checking', '');
    }
})();
