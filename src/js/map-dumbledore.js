// Dumbledore's voice lines for the easter egg rewards, with subtitles (assets/files/dumbledore-subtitles.json).
// Which line plays:
// - Revelio: always its own line (followed by 'more-secrets' when it's the first, 'all-found' when it's the last one);
// - the first egg a guest finds: only 'more-secrets'; the last one: 'all-found', which starts the finale (map-finale.js);
// - the second: 'Ten points to <house>!', right after he told them points are to be earned;
// - in between: either the line about that egg, or a general one the guest hasn't heard yet
//   ('Ten points to <house>!' takes turns with the general ones).
// Plain <audio>, so the global mute toggle silences him too; the subtitles show either way.
// iOS ignores <audio>.volume, so the voice runs through a Web Audio gain node when the audio context is
// running (unlocked on the first tap); otherwise it falls back to the element's volume.
import { readJsonFromLocalStorage, writeJsonToLocalStorage } from './storage-utils.js';

const AUDIO_DIR = new URL('../assets/music/dumbledore/', import.meta.url);
const SUBTITLES_URL = new URL('../assets/files/dumbledore-subtitles.json', import.meta.url);
const EGG_LINES = { compass: 'compass', footsteps: 'footsteps', castle: 'castle', snow: 'snow', nox: 'nox', revelio: 'revelio' };
// Revelio as the very first find: the short version (the pudding line follows in 'revelio' otherwise).
const REVELIO_FIRST_FIND = 'well-cast';
// 'mischief' has no line of its own; it gets a general one.
const GENERAL_LINES = ['well-spotted', 'remarkable', 'quite-forgotten', 'look-closely'];
// Stands for the guest's own 'ten-points-to-<house>' line in the rotation (and in localStorage).
const TEN_POINTS = 'ten-points';
const HOUSES = ['gryffindor', 'hufflepuff', 'ravenclaw', 'slytherin'];
const tenPointsLine = (house) => `ten-points-to-${house}`;
const FIRST_FIND_FOLLOW_UP = 'more-secrets';
// Said before the Sorting Hat's points, as the reason for them.
const SORTING_WELCOME = 'A new member deserves a proper welcome';
// Incantations for Nox / Lumos (speakSpell), named after what he says.
const SPELL_LINES = {
    lumos: [
        'Lumos! Light for the tree, light for the hall, light for us all',
        'Lumos! Now... where did I leave my lemon drops',
        'A little light for the season of giving. Lumos!'
    ],
    nox: [
        'Nox (2)',
        'Nox. Do mind your step, for there is no light',
        'Nox. I do hope nobody trips over the Christmas tree'
    ]
};
const SPELL_MAX_MS = 10000;
const FOLLOW_UP_PAUSE_MS = 500;
// Subtitles stay up long enough to read: each sentence at least MIN_READ_MS + READ_MS_PER_CHAR per
// character (a short, quickly spoken line may then trail the voice slightly), and the last one lingers.
const MIN_READ_MS = 1000;
const READ_MS_PER_CHAR = 45;
const LINGER_MS = 2000;
const HEARD_STORAGE_KEY = 'christmas-at-the-great-hall.dumbledore-heard';
const VOICE_VOLUME = 0.9;
// The background music steps back while he speaks.
const DUCKED_MUSIC_VOLUME = 0.07;
const DUCK_MS = 400;

let subtitlesPromise = null;
let subtitleEl = null;
let speechToken = 0;
let audioContext = null;
// Also kept in memory, so the no-repeat rule holds when localStorage is unavailable.
let lastGeneralLine = null;
const lastSpellLines = {};
let spellVoice = null;
// The line speakLines is playing; a newer sequence stops it.
let lineVoice = null;
// Ducking is shared: the music only comes back once nobody is speaking any more.
let duckCount = 0;
let musicVolumeBeforeDuck = null;
let rampToken = 0;

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
        subtitleEl.className = 'pointer-events-none fixed inset-x-4 bottom-28 z-[80] mx-auto max-w-xl text-center font-inkpot text-[17px] leading-relaxed text-white opacity-0 transition-opacity duration-300 ease-out [-webkit-text-stroke:2px_#000] [paint-order:stroke_fill] [text-shadow:-1px_-1px_0_#000,0_-1px_0_#000,1px_-1px_0_#000,1px_0_0_#000,1px_1px_0_#000,0_1px_0_#000,-1px_1px_0_#000,-1px_0_0_#000,0_0_6px_#000] sm:bottom-32 sm:text-[19px]';
        document.body.append(subtitleEl);
    }

    return subtitleEl;
}

const wait = (ms) => new Promise((resolve) => {
    window.setTimeout(resolve, ms);
});

const displayMs = (sentence) => Math.max(sentence.durationMs, MIN_READ_MS + sentence.text.length * READ_MS_PER_CHAR);

const sentencesMs = (sentences) => sentences.reduce((sum, sentence) => sum + displayMs(sentence), 0);

// Mid-sequence parts pass { lingerMs: 0, hide: false }, so their last sentence stays up through the pause.
// onLastSentence runs as the last sentence appears.
async function showSubtitles(sentences, token, { lingerMs = LINGER_MS, hide = true, onLastSentence = null } = {}) {
    const el = getSubtitleEl();

    for (const [index, sentence] of sentences.entries()) {
        if (token !== speechToken) {
            return;
        }

        el.textContent = sentence.text;
        el.classList.replace('opacity-0', 'opacity-100');
        if (index === sentences.length - 1) {
            onLastSentence?.();
        }
        await wait(displayMs(sentence) + (index === sentences.length - 1 ? lingerMs : 0));
    }

    if (hide && token === speechToken) {
        el.classList.replace('opacity-100', 'opacity-0');
    }
}

// Only the newest ramp runs, so ducking and restoring never fight over the volume. onDone runs if it completes.
function rampVolume(audio, target, durationMs, onDone = () => {}) {
    const token = ++rampToken;
    const from = audio.volume;
    const startTime = performance.now();
    const step = (now) => {
        if (token !== rampToken) {
            return;
        }

        const progress = Math.min(1, (now - startTime) / durationMs);
        audio.volume = Math.min(1, Math.max(0, from + (target - from) * progress));
        if (progress < 1) {
            requestAnimationFrame(step);
        } else {
            onDone();
        }
    };
    requestAnimationFrame(step);
}

// Lowers the background music; returns a function that brings it back (once every speaker is done).
function duckMusic() {
    const music = document.getElementById('background-audio');

    if (!(music instanceof HTMLMediaElement)) {
        return () => {};
    }

    if (duckCount === 0) {
        // Still set while the music is coming back from an earlier duck: that's the volume to return to.
        if (musicVolumeBeforeDuck === null && (music.paused || music.volume <= DUCKED_MUSIC_VOLUME)) {
            return () => {};
        }

        musicVolumeBeforeDuck ??= music.volume;
        rampVolume(music, DUCKED_MUSIC_VOLUME, DUCK_MS);
    }

    duckCount += 1;
    let released = false;
    return () => {
        if (released) {
            return;
        }

        released = true;
        duckCount -= 1;
        if (duckCount === 0) {
            rampVolume(music, musicVolumeBeforeDuck, DUCK_MS * 2, () => {
                musicVolumeBeforeDuck = null;
            });
        }
    };
}

function readHeard(rotation) {
    const stored = readJsonFromLocalStorage(HEARD_STORAGE_KEY, []);
    return (Array.isArray(stored) ? stored : []).filter((line) => rotation.includes(line));
}

function markHeard(heard, line) {
    lastGeneralLine = line;
    heard.push(line);
    writeJsonToLocalStorage(HEARD_STORAGE_KEY, heard);
}

function pickLine(eggId, foundCount, totalEggs, house) {
    const hasTenPoints = HOUSES.includes(house);
    const rotation = hasTenPoints ? [...GENERAL_LINES, TEN_POINTS] : GENERAL_LINES;
    const toFile = (line) => (line === TEN_POINTS ? tenPointsLine(house) : line);

    // Revelio reveals the party details, so it always gets its own line.
    if (eggId === 'revelio') {
        return foundCount <= 1 ? REVELIO_FIRST_FIND : EGG_LINES.revelio;
    }

    if (foundCount >= totalEggs) {
        return 'all-found';
    }

    // The follow-up alone; it already tells the guest they found a secret.
    if (foundCount <= 1) {
        return FIRST_FIND_FOLLOW_UP;
    }

    // Counts as heard, so the rotation doesn't bring it straight back.
    if (foundCount === 2 && hasTenPoints) {
        markHeard(readHeard(rotation), TEN_POINTS);
        return toFile(TEN_POINTS);
    }

    if (EGG_LINES[eggId] && Math.random() < 0.5) {
        return EGG_LINES[eggId];
    }

    // General lines take turns: none comes back before all of them have been heard, and a new round
    // never opens with the line that closed the previous one (stored in play order, so the last is known).
    const heard = readHeard(rotation);
    let fresh = rotation.filter((line) => !heard.includes(line) && line !== lastGeneralLine);

    if (!fresh.length) {
        const previous = lastGeneralLine ?? heard.at(-1);
        heard.length = 0;
        fresh = rotation.filter((line) => line !== previous);
    }

    const line = fresh[Math.floor(Math.random() * fresh.length)];
    markHeard(heard, line);
    return toFile(line);
}

// house: the guest's house, so only their own 'Ten points to …' line is fetched.
export function preloadDumbledore(house) {
    void loadSubtitles();
    unlockAudioContextOnGesture();
    const tenPoints = HOUSES.includes(house) ? [tenPointsLine(house)] : [];
    const spellLines = Object.values(SPELL_LINES).flat();
    ['all-found', ...Object.values(EGG_LINES), REVELIO_FIRST_FIND, ...GENERAL_LINES, ...tenPoints, FIRST_FIND_FOLLOW_UP, ...spellLines].forEach((lineId) => {
        const audio = new Audio(new URL(`${lineId}.mp3`, AUDIO_DIR).href);
        audio.preload = 'auto';
    });
}

// Returns the element plus a promise that settles once it stops (ended, failed, or paused by stopLine).
function playLine(lineId) {
    const audio = new Audio(new URL(`${lineId}.mp3`, AUDIO_DIR).href);
    const setLevel = createVoiceVolume(audio);
    const finished = new Promise((resolve) => {
        ['ended', 'error', 'pause'].forEach((type) => audio.addEventListener(type, resolve, { once: true }));
        audio.play().catch(resolve);
    });
    return { audio, setLevel, finished };
}

function stopLine(voice) {
    voice.setLevel(0);
    voice.audio.pause();
}

// Dumbledore speaks the incantation when the guest casts Nox or Lumos: a random line, never the same one
// twice in a row. Resolves once he is done (or cut off by the next spell), so a reward can wait for him.
export function speakSpell(spell) {
    const lines = SPELL_LINES[spell] ?? [];

    if (!lines.length) {
        return Promise.resolve();
    }

    if (spellVoice) {
        stopLine(spellVoice);
    }

    const options = lines.length > 1 ? lines.filter((line) => line !== lastSpellLines[spell]) : lines;
    const lineId = options[Math.floor(Math.random() * options.length)];
    lastSpellLines[spell] = lineId;

    const restoreMusic = duckMusic();
    const voice = playLine(lineId);
    spellVoice = voice;
    void showSubtitlesFor(lineId);

    // Safety net in case the audio never reports back.
    const timeout = wait(SPELL_MAX_MS);
    return Promise.race([voice.finished, timeout]).then(() => {
        restoreMusic();
        if (spellVoice === voice) {
            spellVoice = null;
        }
    });
}

// Plays the lines one after another. The subtitle timings drive the sequence, so a follow-up still
// shows its subtitles when the audio is blocked or missing. A newer sequence cuts off the line still playing.
async function speakLines(parts, token, onLastSentence) {
    for (const [index, part] of parts.entries()) {
        if (index > 0) {
            await wait(FOLLOW_UP_PAUSE_MS);
        }

        if (token !== speechToken) {
            return;
        }

        if (lineVoice) {
            stopLine(lineVoice);
        }
        lineVoice = playLine(part.lineId);
        await showSubtitles(part.sentences, token, index < parts.length - 1 ? { lingerMs: 0, hide: false } : { onLastSentence });
    }
}

// Only the subtitles of a line, for voice clips played elsewhere (e.g. the Revelio incantation in map-sounds.js).
// A later line from speakForEgg takes over the subtitle.
export async function showSubtitlesFor(lineId) {
    const token = ++speechToken;
    const sentences = (await loadSubtitles()).get(lineId) ?? [];
    await showSubtitles(sentences, token);
}

// The Sorting Hat's points for being sorted: a welcome, then "Ten points to <house>!", with subtitles.
// onTenPoints runs as "Ten points…" appears (not when the subtitles are missing or he gets cut off).
// Resolves once he is done, or right away for an unknown house.
export async function speakTenPoints(house, { onTenPoints = null } = {}) {
    if (!HOUSES.includes(house)) {
        return;
    }

    const subtitles = await loadSubtitles();
    const parts = [SORTING_WELCOME, tenPointsLine(house)].map((lineId) => ({ lineId, sentences: subtitles.get(lineId) ?? [] }));
    const token = ++speechToken;
    const restoreMusic = duckMusic();

    try {
        await speakLines(parts, token, onTenPoints);
    } finally {
        restoreMusic();
    }
}

// Plays the right line for this find. Resolves (with how long he speaks, in ms) once it has started,
// so the caller can keep the banner up for as long as he talks. onLastSentence runs as his last sentence appears
// (for the last secret: "Mischief managed!"); not at all when the subtitles are missing or he gets cut off.
export async function speakForEgg({ eggId, foundCount, totalEggs, house }, { onLastSentence = null } = {}) {
    const lineId = pickLine(eggId, foundCount, totalEggs, house);
    const followUp = foundCount <= 1 && foundCount < totalEggs && lineId !== FIRST_FIND_FOLLOW_UP ? FIRST_FIND_FOLLOW_UP : undefined;
    // Revelio keeps its own line, so when it's the last secret, the all-found line follows it.
    const allFound = foundCount >= totalEggs && lineId !== 'all-found' ? 'all-found' : undefined;
    const subtitles = await loadSubtitles();
    const parts = [lineId, followUp, allFound].filter(Boolean).map((id) => ({ lineId: id, sentences: subtitles.get(id) ?? [] }));
    const spokenMs = parts.reduce((total, part) => total + sentencesMs(part.sentences), 0);
    // Includes the linger, so the banner stays up as long as the subtitle.
    const durationMs = spokenMs && spokenMs + LINGER_MS + FOLLOW_UP_PAUSE_MS * (parts.length - 1);
    const token = ++speechToken;

    const restoreMusic = duckMusic();
    let restored = false;
    const restore = () => {
        if (!restored) {
            restored = true;
            restoreMusic();
        }
    };

    void speakLines(parts, token, onLastSentence).finally(restore);
    // Safety net in case the subtitles are missing.
    window.setTimeout(restore, (durationMs || 5000) + 1000);
    return durationMs;
}
