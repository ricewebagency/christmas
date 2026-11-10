// Dumbledore's voice lines for the easter egg rewards, with subtitles (assets/files/dumbledore-subtitles.json).
// Which line plays:
// - Revelio: always its own line;
// - the first egg a guest finds: 'first-find'; the last one: 'all-found';
// - in between: either the line about that egg, or a general one the guest hasn't heard yet.
// After the first find, a follow-up tells the guest how many secrets there are.
// Plain <audio>, so the global mute toggle silences him too; the subtitles show either way.
// The recordings stop abruptly, so every line fades out over its last FADE_OUT_S seconds. iOS ignores
// <audio>.volume, so the voice runs through a Web Audio gain node when the audio context is running
// (unlocked on the first tap); otherwise it falls back to fading the element's volume.
import { readJsonFromLocalStorage, writeJsonToLocalStorage } from './storage-utils.js';

const AUDIO_DIR = new URL('../assets/music/dumbledore/', import.meta.url);
const SUBTITLES_URL = new URL('../assets/files/dumbledore-subtitles.json', import.meta.url);
const EGG_LINES = { compass: 'compass', footsteps: 'footsteps', castle: 'castle', snow: 'snow', nox: 'nox', revelio: 'revelio' };
// 'mischief' has no line of its own; it gets a general one.
const GENERAL_LINES = ['well-spotted', 'remarkable', 'quite-forgotten', 'look-closely'];
const FIRST_FIND_FOLLOW_UP = 'more-secrets';
const FOLLOW_UP_PAUSE_MS = 500;
const HEARD_STORAGE_KEY = 'christmas-at-the-great-hall.dumbledore-heard';
const VOICE_VOLUME = 0.9;
// The background music steps back while he speaks.
const DUCKED_MUSIC_VOLUME = 0.07;
const DUCK_MS = 400;
const FADE_OUT_S = 0.7;

let subtitlesPromise = null;
let subtitleEl = null;
let speechToken = 0;
let audioContext = null;
// Also kept in memory, so the no-repeat rule holds when localStorage is unavailable.
let lastGeneralLine = null;

function getAudioContext() {
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;

    if (!audioContext && AudioContextClass) {
        try {
            audioContext = new AudioContextClass();
        } catch {
            audioContext = null;
        }
    }

    return audioContext;
}

// Browsers only let an audio context run after a user gesture; resume it on the first tap.
function unlockAudioContextOnGesture() {
    const unlock = () => {
        const context = getAudioContext();

        if (context?.state === 'running') {
            ['pointerdown', 'touchend', 'keydown'].forEach((type) => document.removeEventListener(type, unlock, true));
        } else {
            context?.resume().catch(() => {});
        }
    };

    ['pointerdown', 'touchend', 'keydown'].forEach((type) => document.addEventListener(type, unlock, true));
}

// Returns a setter for the voice's loudness (0..1 of VOICE_VOLUME).
function createVoiceVolume(audio) {
    const context = getAudioContext();

    if (context?.state === 'running') {
        try {
            const gain = context.createGain();
            context.createMediaElementSource(audio).connect(gain).connect(context.destination);
            // Web Audio may bypass the element's mute, so follow the global mute toggle by hand.
            let level = 1;
            const apply = () => gain.gain.setTargetAtTime(audio.muted ? 0 : VOICE_VOLUME * level, context.currentTime, 0.015);
            audio.addEventListener('volumechange', apply);
            apply();
            return (value) => {
                level = value;
                apply();
            };
        } catch {
            // Fall through to the element's own volume.
        }
    }

    audio.volume = VOICE_VOLUME;
    return (value) => {
        audio.volume = VOICE_VOLUME * value;
    };
}

// Fades the voice out over the last FADE_OUT_S seconds of the file, so it never ends on a cut.
function fadeOutAtEnd(audio, setLevel) {
    const step = () => {
        if (audio.ended || audio.error) {
            setLevel(0);
            return;
        }

        if (Number.isFinite(audio.duration) && audio.duration > 0) {
            const remaining = Math.max(0, audio.duration - audio.currentTime);
            const progress = Math.min(1, remaining / Math.min(FADE_OUT_S, audio.duration / 2));
            // Squared, so the fade sounds even rather than dropping off at the very end.
            setLevel(progress * progress);
        }

        requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

function loadSubtitles() {
    subtitlesPromise ??= fetch(SUBTITLES_URL, { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : []))
        .then((data) => new Map((Array.isArray(data) ? data : []).flatMap((entry) => {
            const lineId = String(entry?.fileName ?? '').replace(/\.mp3$/i, '');
            const sentences = (Array.isArray(entry?.sentences) ? entry.sentences : [])
                .map((sentence) => ({ text: String(sentence?.text ?? '').trim(), durationMs: Number(sentence?.durationMs) }))
                .filter((sentence) => sentence.text && Number.isFinite(sentence.durationMs) && sentence.durationMs > 0);
            return lineId && sentences.length ? [[lineId, sentences]] : [];
        })))
        .catch(() => new Map());

    return subtitlesPromise;
}

function getSubtitleEl() {
    if (!subtitleEl) {
        subtitleEl = document.createElement('p');
        subtitleEl.setAttribute('aria-live', 'polite');
        subtitleEl.setAttribute('aria-atomic', 'true');
        subtitleEl.className = 'pointer-events-none fixed inset-x-4 bottom-28 z-[80] mx-auto max-w-xl text-center font-inkpot text-base leading-relaxed text-white opacity-0 transition-opacity duration-300 ease-out [-webkit-text-stroke:5px_#000] [paint-order:stroke_fill] [text-shadow:-2px_-2px_0_#000,0_-2px_0_#000,2px_-2px_0_#000,2px_0_0_#000,2px_2px_0_#000,0_2px_0_#000,-2px_2px_0_#000,-2px_0_0_#000,0_0_10px_#000] sm:bottom-32 sm:text-lg';
        document.body.append(subtitleEl);
    }

    return subtitleEl;
}

const wait = (ms) => new Promise((resolve) => {
    window.setTimeout(resolve, ms);
});

async function showSubtitles(sentences, token) {
    const el = getSubtitleEl();

    for (const sentence of sentences) {
        if (token !== speechToken) {
            return;
        }

        el.textContent = sentence.text;
        el.classList.replace('opacity-0', 'opacity-100');
        await wait(sentence.durationMs);
    }

    if (token === speechToken) {
        el.classList.replace('opacity-100', 'opacity-0');
    }
}

function rampVolume(audio, target, durationMs) {
    const from = audio.volume;
    const startTime = performance.now();
    const step = (now) => {
        const progress = Math.min(1, (now - startTime) / durationMs);
        audio.volume = Math.min(1, Math.max(0, from + (target - from) * progress));
        if (progress < 1) {
            requestAnimationFrame(step);
        }
    };
    requestAnimationFrame(step);
}

// Lowers the background music; returns a function that brings it back.
function duckMusic() {
    const music = document.getElementById('background-audio');

    if (!(music instanceof HTMLMediaElement) || music.paused || music.volume <= DUCKED_MUSIC_VOLUME) {
        return () => {};
    }

    const original = music.volume;
    rampVolume(music, DUCKED_MUSIC_VOLUME, DUCK_MS);
    return () => rampVolume(music, original, DUCK_MS * 2);
}

function pickLine(eggId, foundCount, totalEggs) {
    // Revelio reveals the party details, so it always gets its own line.
    if (eggId === 'revelio') {
        return 'revelio';
    }

    if (foundCount >= totalEggs) {
        return 'all-found';
    }

    if (foundCount <= 1) {
        return 'first-find';
    }

    if (EGG_LINES[eggId] && Math.random() < 0.5) {
        return EGG_LINES[eggId];
    }

    // General lines take turns: none comes back before all of them have been heard, and a new round
    // never opens with the line that closed the previous one (stored in play order, so the last is known).
    const stored = readJsonFromLocalStorage(HEARD_STORAGE_KEY, []);
    const heard = (Array.isArray(stored) ? stored : []).filter((line) => GENERAL_LINES.includes(line));
    let fresh = GENERAL_LINES.filter((line) => !heard.includes(line) && line !== lastGeneralLine);

    if (!fresh.length) {
        const previous = lastGeneralLine ?? heard.at(-1);
        heard.length = 0;
        fresh = GENERAL_LINES.filter((line) => line !== previous);
    }

    const line = fresh[Math.floor(Math.random() * fresh.length)];
    lastGeneralLine = line;
    heard.push(line);
    writeJsonToLocalStorage(HEARD_STORAGE_KEY, heard);
    return line;
}

export function preloadDumbledore() {
    void loadSubtitles();
    unlockAudioContextOnGesture();
    ['first-find', 'all-found', ...Object.values(EGG_LINES), ...GENERAL_LINES, FIRST_FIND_FOLLOW_UP].forEach((lineId) => {
        const audio = new Audio(new URL(`${lineId}.mp3`, AUDIO_DIR).href);
        audio.preload = 'auto';
    });
}

function playLine(lineId) {
    const audio = new Audio(new URL(`${lineId}.mp3`, AUDIO_DIR).href);
    const setLevel = createVoiceVolume(audio);
    audio.play().then(() => fadeOutAtEnd(audio, setLevel), () => {});
}

// Plays the lines one after another. The subtitle timings drive the sequence, so a follow-up still
// shows its subtitles when the audio is blocked or missing.
async function speakLines(parts, token) {
    for (const [index, part] of parts.entries()) {
        if (index > 0) {
            await wait(FOLLOW_UP_PAUSE_MS);
        }

        if (token !== speechToken) {
            return;
        }

        playLine(part.lineId);
        await showSubtitles(part.sentences, token);
    }
}

// Plays the right line for this find. Resolves (with how long he speaks, in ms) once it has started,
// so the caller can keep the banner up for as long as he talks.
export async function speakForEgg({ eggId, foundCount, totalEggs }) {
    const lineId = pickLine(eggId, foundCount, totalEggs);
    const followUp = foundCount <= 1 && foundCount < totalEggs ? FIRST_FIND_FOLLOW_UP : undefined;
    const subtitles = await loadSubtitles();
    const parts = [lineId, followUp].filter(Boolean).map((id) => ({ lineId: id, sentences: subtitles.get(id) ?? [] }));
    const durationMs = parts.reduce((total, part) => total + part.sentences.reduce((sum, sentence) => sum + sentence.durationMs, 0), 0)
        + FOLLOW_UP_PAUSE_MS * (parts.length - 1);
    const token = ++speechToken;

    const restoreMusic = duckMusic();
    let restored = false;
    const restore = () => {
        if (!restored) {
            restored = true;
            restoreMusic();
        }
    };

    void speakLines(parts, token).finally(restore);
    // Safety net in case the subtitles are missing.
    window.setTimeout(restore, (durationMs || 5000) + 1000);
    return durationMs;
}
