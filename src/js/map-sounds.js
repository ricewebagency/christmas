// Sound effects on the map page. Plain <audio> elements, so the global mute toggle
// (audio-toggle.js hooks play()) also silences these.
const SOUNDS = {
    // 10.08 s of steady steps, one step every ~570 ms (map-footsteps.js matches its walkers to that).
    // 16 s of wind; the castle lights play a stretch of it while they are on.
    woosh: { src: './assets/music/map/christmas-wind-woosh.mp3', volume: 0.12 },
    footsteps: { src: './assets/music/map/footsteps.mp3', volume: 0.22 },
    paper: { src: './assets/music/map/paper-rustle.mp3', volume: 0.7 },
    // Opening a parchment popup (House Cup, pincode). `instant`: played through Web Audio from a decoded buffer,
    // so it starts together with the popup (an <audio> element needs a moment to get going).
    // `offset`: seconds skipped at the start of the clip, so the sound lands right on the tap.
    popup: { src: './assets/music/map/open-pop-up.mp3', volume: 0.3, instant: true, offset: 0.4 },
    peek: { src: './assets/music/peek.mp3', volume: 0.03 },
    spell: { src: './assets/music/map/magic-spell.mp3', volume: 0.5 },
    // Dumbledore saying the incantation when the guest casts Revelio.
    revelioVoice: { src: './assets/music/dumbledore/revelio-spell-cast.mp3', volume: 0.9 },
    spin: { src: './assets/images/map/paper-spin.mp3', volume: 0.2 },
    twinkle: { src: './assets/music/map/magic-twinkle.mp3', volume: 0.45 }
};

const templates = new Map();

function getTemplate(name) {
    if (!templates.has(name) && SOUNDS[name]) {
        const audio = new Audio(SOUNDS[name].src);
        audio.preload = 'auto';
        templates.set(name, audio);
    }

    return templates.get(name);
}

// Web Audio for `instant` sounds. Web Audio bypasses the play() hook in audio-toggle.js, so the mute state
// is read from the same storage key (keep in sync there).
const MUTED_STORAGE_KEY = 'audio-muted';
const buffers = new Map();
let audioContext = null;

function isMuted() {
    try {
        return window.localStorage.getItem(MUTED_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

function getAudioContext() {
    if (!audioContext) {
        const Context = window.AudioContext || window.webkitAudioContext;

        if (!Context) {
            return null;
        }

        audioContext = new Context();
        // Browsers start it suspended until a user gesture; resume on the first one.
        const unlock = () => {
            void audioContext.resume().catch(() => {});
        };
        document.addEventListener('pointerdown', unlock, { capture: true });
        document.addEventListener('keydown', unlock, { capture: true });
    }

    return audioContext;
}

function loadBuffer(name) {
    const context = getAudioContext();

    if (!context || buffers.has(name)) {
        return;
    }

    buffers.set(name, null);
    fetch(SOUNDS[name].src)
        .then((response) => response.arrayBuffer())
        .then((data) => context.decodeAudioData(data))
        .then((buffer) => buffers.set(name, buffer))
        .catch(() => buffers.delete(name));
}

// Returns false when the buffer isn't ready yet, so the caller falls back to an <audio> element.
function playInstant(name, volume) {
    const buffer = buffers.get(name);
    const context = audioContext;

    if (!buffer || !context) {
        return false;
    }

    if (isMuted()) {
        return true;
    }

    const start = () => {
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = buffer;
        gain.gain.value = Math.min(1, SOUNDS[name].volume * volume);
        source.connect(gain).connect(context.destination);
        source.start(0, Math.min(SOUNDS[name].offset ?? 0, buffer.duration));
    };

    if (context.state === 'running') {
        start();
        return true;
    }

    // Still suspended: only play if resuming succeeds right away, never as a stray sound on a later tap.
    const requestedAt = performance.now();
    context.resume().then(() => {
        if (context.state === 'running' && performance.now() - requestedAt < 300) {
            start();
        }
    }).catch(() => {});
    return true;
}

export function preloadMapSounds(names = Object.keys(SOUNDS)) {
    names.forEach((name) => {
        getTemplate(name);

        if (SOUNDS[name]?.instant) {
            loadBuffer(name);
        }
    });
}

// Ramps the volume from its current level to `target` over `durationMs`. Starting a new ramp
// on the same element cancels the previous one, so a fade-out can cut into a fade-in.
const ramps = new WeakMap();

function rampVolume(audio, target, durationMs, onDone) {
    cancelAnimationFrame(ramps.get(audio));
    const from = audio.volume;
    const startTime = performance.now();

    const step = (now) => {
        const progress = durationMs > 0 ? Math.min(1, (now - startTime) / durationMs) : 1;
        audio.volume = Math.min(1, Math.max(0, from + (target - from) * progress));

        if (progress < 1) {
            ramps.set(audio, requestAnimationFrame(step));
        } else {
            onDone?.();
        }
    };

    ramps.set(audio, requestAnimationFrame(step));
}

// A fresh clone per play, so overlapping plays (two flaps) don't cut each other off.
// `rate` shifts speed and pitch together (lower = deeper, heavier paper); `volume` scales the base volume.
// `fadeInMs` ramps up from silence; `fadeAfterMs` starts a `fadeMs` fade-out that long after the sound starts.
export function playMapSound(name, delayMs = 0, { rate = 1, volume = 1, fadeInMs = 0, fadeAfterMs = null, fadeMs = 600 } = {}) {
    const template = getTemplate(name);

    if (!template) {
        return;
    }

    if (SOUNDS[name].instant && delayMs === 0 && playInstant(name, volume)) {
        return;
    }

    window.setTimeout(() => {
        const audio = template.cloneNode();

        if (SOUNDS[name].offset) {
            try {
                audio.currentTime = SOUNDS[name].offset;
            } catch {
                // Not seekable yet: start from the top.
            }
        }

        const targetVolume = Math.min(1, SOUNDS[name].volume * volume);
        audio.volume = fadeInMs > 0 ? 0 : targetVolume;
        audio.preservesPitch = false;
        audio.playbackRate = rate;
        audio.play().then(() => {
            if (fadeInMs > 0) {
                rampVolume(audio, targetVolume, fadeInMs);
            }

            if (fadeAfterMs !== null) {
                window.setTimeout(() => rampVolume(audio, 0, fadeMs, () => audio.pause()), fadeAfterMs);
            }
        }).catch(() => {
            // Autoplay blocked or file missing: stay silent.
        });
    }, delayMs);
}

// A reusable channel for a sound that lasts as long as something on screen does (one per walker),
// so long-running plays reuse one <audio> element instead of piling up clones.
export function createMapSoundVoice(name) {
    const config = SOUNDS[name];

    if (!config) {
        return { play() {}, stop() {} };
    }

    const audio = new Audio(config.src);
    audio.preload = 'auto';
    let token = 0;
    let fadeFrame = null;
    let endTimer = null;

    const rampTo = (target, durationMs, onDone) => {
        cancelAnimationFrame(fadeFrame);
        const from = audio.volume;
        const startTime = performance.now();

        const step = (now) => {
            const progress = durationMs > 0 ? Math.min(1, (now - startTime) / durationMs) : 1;
            // Clamped: float rounding can land a hair below 0 (e.g. -2e-11), which volume rejects with an error.
            audio.volume = Math.min(1, Math.max(0, from + (target - from) * progress));

            if (progress < 1) {
                fadeFrame = requestAnimationFrame(step);
            } else {
                fadeFrame = null;
                onDone?.();
            }
        };

        fadeFrame = requestAnimationFrame(step);
    };

    const stop = (fadeMs = 300) => {
        const current = ++token;
        window.clearTimeout(endTimer);

        if (!audio.paused) {
            rampTo(0, fadeMs, () => {
                if (current === token) {
                    audio.pause();
                }
            });
        }
    };

    // Sounds for `durationMs` of wall-clock time at `rate`: starts at a random offset that still fits,
    // loops when the clip is too short, and fades out so it ends together with the action.
    // `fadeInMs` defaults to `fadeMs` (the fade-out).
    const play = (durationMs, { rate = 1, volume = 1, fadeMs = 250, fadeInMs = fadeMs } = {}) => {
        const current = ++token;
        window.clearTimeout(endTimer);
        cancelAnimationFrame(fadeFrame);

        const clipSeconds = Number.isFinite(audio.duration) ? audio.duration : 0;
        const neededSeconds = (durationMs / 1000) * rate;
        const fits = clipSeconds > neededSeconds;
        audio.loop = !fits;
        audio.playbackRate = rate;

        try {
            audio.currentTime = Math.random() * (fits ? clipSeconds - neededSeconds : clipSeconds);
        } catch {
            // Not seekable yet: start from the top.
        }

        audio.volume = 0;
        audio.play().then(() => {
            if (current === token) {
                rampTo(Math.min(1, config.volume * volume), fadeInMs);
            }
        }).catch(() => {
            // Autoplay blocked or file missing: stay silent.
        });

        endTimer = window.setTimeout(() => stop(fadeMs), Math.max(0, durationMs - fadeMs));
    };

    return { play, stop };
}
