// Global mute toggle: fixed button bottom-left, state persisted across pages.
// Load as a classic (non-deferred) script in <head> so the play() hook is installed
// before any other script creates or plays audio.
(() => {
    const STORAGE_KEY = "audio-muted";
    // Written by api-client.js from the API's `isAdmin` for the guest's pincode; keep the key in sync there.
    const GUEST_ADMIN_KEY = "christmas-at-the-great-hall.guest-is-admin";
    // This script lives in <root>/js/, so the admin page is ../admin/ relative to it.
    const ADMIN_URL = document.currentScript ? new URL("../admin/", document.currentScript.src).href : null;
    const trackedMedia = new Set();

    // Only show the admin button when the API confirmed the guest's pincode is admin.
    const isAdmin = () => {
        try {
            return window.localStorage.getItem(GUEST_ADMIN_KEY) === "true";
        } catch {
            return false;
        }
    };

    const readMuted = () => {
        try {
            return window.localStorage.getItem(STORAGE_KEY) === "true";
        } catch {
            return false;
        }
    };

    const writeMuted = (value) => {
        try {
            window.localStorage.setItem(STORAGE_KEY, String(value));
        } catch {
            // Storage unavailable: state only lasts for this page.
        }
    };

    let isMuted = readMuted();

    const enforce = (media) => {
        if (isMuted && !media.muted) {
            media.muted = true;
        }
    };

    // Re-mute when page scripts set `muted = false` while globally muted.
    const onVolumeChange = (event) => enforce(event.currentTarget);

    const track = (media) => {
        if (!trackedMedia.has(media)) {
            trackedMedia.add(media);
            media.addEventListener("volumechange", onVolumeChange);
        }

        enforce(media);
    };

    // Covers `new Audio()` instances that never enter the DOM.
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function play(...args) {
        track(this);
        return originalPlay.apply(this, args);
    };

    // Covers autoplaying elements in the DOM (media events don't bubble, so capture).
    document.addEventListener("play", (event) => {
        if (event.target instanceof HTMLMediaElement) {
            track(event.target);
        }
    }, true);

    const ICON_ON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
    const ICON_OFF = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m16 9 6 6"/><path d="m22 9-6 6"/></svg>';
    const ICON_ADMIN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/></svg>';

    let button = null;

    const render = () => {
        if (!button) {
            return;
        }

        const label = isMuted ? "Audio inschakelen" : "Audio uitschakelen";
        button.innerHTML = isMuted ? ICON_OFF : ICON_ON;
        button.setAttribute("aria-label", label);
        button.setAttribute("aria-pressed", String(isMuted));
        button.title = label;
    };

    const setMuted = (value) => {
        isMuted = value;
        writeMuted(value);

        document.querySelectorAll("audio, video").forEach((media) => track(media));

        for (const media of trackedMedia) {
            media.muted = value;
        }

        render();
    };

    const mount = () => {
        document.querySelectorAll("audio, video").forEach((media) => track(media));

        button = document.createElement("button");
        button.type = "button";
        button.className = "fixed bottom-3 left-3 z-[1000] flex h-8 w-8 items-center justify-center rounded-full bg-neutral-950/30 text-amber-50 opacity-50 backdrop-blur-sm transition hover:bg-neutral-950/60 hover:opacity-100 focus:outline-none focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-amber-200/60 sm:bottom-4 sm:left-4";

        // Keep clicks from reaching page-level bubble handlers (capture-phase audio unlock still runs).
        button.addEventListener("pointerdown", (event) => event.stopPropagation());
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            setMuted(!isMuted);
        });

        render();
        document.body.appendChild(button);

        renderAdminLink();
        // api-client.js fires this whenever fresh guest state arrives (also on this page).
        window.addEventListener("guest-admin-change", renderAdminLink);
    };

    let adminLink = null;

    const renderAdminLink = () => {
        if (!ADMIN_URL || !isAdmin()) {
            adminLink?.remove();
            adminLink = null;
            return;
        }

        if (!adminLink) {
            adminLink = document.createElement("a");
            adminLink.href = ADMIN_URL;
            adminLink.className = "fixed bottom-[3.25rem] left-3 z-[1000] flex h-8 w-8 items-center justify-center rounded-full bg-neutral-950/30 text-amber-50 opacity-50 backdrop-blur-sm transition hover:bg-neutral-950/60 hover:opacity-100 focus:outline-none focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-amber-200/60 sm:bottom-14 sm:left-4";
            adminLink.innerHTML = ICON_ADMIN;
            adminLink.setAttribute("aria-label", "Admin Panel");
            adminLink.title = "Admin Panel";
            adminLink.addEventListener("pointerdown", (event) => event.stopPropagation());
            adminLink.addEventListener("click", (event) => event.stopPropagation());
            document.body.appendChild(adminLink);
        }
    };

    window.isAudioMuted = () => isMuted;
    window.setAudioMuted = setMuted;

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", mount, { once: true });
    } else {
        mount();
    }
})();
