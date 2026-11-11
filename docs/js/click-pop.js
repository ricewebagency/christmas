// Game-like "bop" when the guest clicks a menu button. Mark an element with `data-pop="<kind>"`:
//   high   - primary forward actions (confirm, send, choose)
//   medium - picking an option (dish, yes/no, answer, course); also the default for an empty `data-pop`
//   small  - mini buttons (carousel arrows, dots, go back, inline links)
// Inside a `data-pop-scope` element every <button>/<select> pops (medium), unless it sets its own `data-pop`.
// Buttons pop on click, <select> pops on change. Importing this module is enough.
// Played through Web Audio so it starts on the tap; that bypasses the play() hook in audio-toggle.js,
// so the mute state is read from the same storage key (keep in sync there).
// Volume per file: small-bop-sound.mp3 is recorded ~10x quieter than the other two.
const SOUNDS = {
    small: { src: './assets/music/button-sounds/small-bop-sound.mp3', volume: 0.4 },
    medium: { src: './assets/music/button-sounds/medium-bop-sound.mp3', volume: 0.05 },
    high: { src: './assets/music/button-sounds/high-bop-sound.mp3', volume: 0.05 },
};
const DEFAULT_KIND = 'medium';
const MUTED_STORAGE_KEY = 'audio-muted';

let context = null;
const buffers = {};
const fallbacks = {};

function isMuted() {
    try {
        return window.localStorage.getItem(MUTED_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

function init() {
    const Context = window.AudioContext || window.webkitAudioContext;

    if (Context) {
        context = new Context();
    }

    Object.entries(SOUNDS).forEach(([kind, { src, volume }]) => {
        if (context) {
            fetch(src)
                .then((response) => response.arrayBuffer())
                .then((data) => context.decodeAudioData(data))
                .then((decoded) => { buffers[kind] = decoded; })
                .catch(() => {});
        }

        // Until the buffer is decoded (or without Web Audio), use an <audio> element; the play() hook mutes it.
        const fallback = new Audio(src);
        fallback.preload = 'auto';
        fallback.volume = volume;
        fallbacks[kind] = fallback;
    });
}

function soundKind(target) {
    const kind = target.dataset.pop;
    return kind && kind in SOUNDS ? kind : DEFAULT_KIND;
}

// Also for gestures that are not a click (e.g. swiping a carousel).
export function playPop(kind = DEFAULT_KIND) {
    kind = kind in SOUNDS ? kind : DEFAULT_KIND;
    const buffer = buffers[kind];

    if (buffer && context) {
        if (isMuted()) {
            return;
        }

        void context.resume().catch(() => {});
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = buffer;
        gain.gain.value = SOUNDS[kind].volume;
        source.connect(gain).connect(context.destination);
        source.start();
        return;
    }

    const fallback = fallbacks[kind];

    if (fallback) {
        fallback.currentTime = 0;
        void fallback.play().catch(() => {});
    }
}

function popTarget(event) {
    if (!(event.target instanceof Element)) {
        return null;
    }

    const marked = event.target.closest('[data-pop]');

    if (marked) {
        return marked;
    }

    const control = event.target.closest('button, select');
    return control?.closest('[data-pop-scope]') ? control : null;
}

init();

document.addEventListener('click', (event) => {
    const target = popTarget(event);

    if (target instanceof HTMLElement && !(target instanceof HTMLSelectElement) && !target.disabled) {
        playPop(soundKind(target));
    }
}, { capture: true });

document.addEventListener('change', (event) => {
    const target = popTarget(event);

    if (target instanceof HTMLSelectElement) {
        playPop(soundKind(target));
    }
}, { capture: true });
