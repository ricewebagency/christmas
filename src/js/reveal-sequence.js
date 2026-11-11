function parseRevealDelayMs(element) {
    const datasetValue = element.dataset.revealDelay;
    if (datasetValue !== undefined && datasetValue !== "") {
        const parsed = Number.parseFloat(datasetValue);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }
    }

    const customProperty = getComputedStyle(element).getPropertyValue("--reveal-delay").trim();
    if (!customProperty) {
        return 0;
    }

    const parsed = Number.parseFloat(customProperty);
    return Number.isNaN(parsed) ? 0 : parsed;
}

// The continue CTA ([data-reveal-last]) waits a bit longer and fades in slightly slower than the 0.8s in main.css.
const LAST_REVEAL_GAP_MS = 500;
const LAST_REVEAL_DURATION_MS = 1000;
const RANDOM_REVEAL_SWAP_CHANCE = 0.4;
// Below half the smallest authored step (400ms), so jitter alone never reorders elements.
const RANDOM_REVEAL_JITTER_MS = 150;

// Cached because each run overwrites --reveal-delay inline; replays must start from the authored delay.
const authoredDelaysMs = new WeakMap();

function getAuthoredDelayMs(element) {
    if (!authoredDelaysMs.has(element)) {
        authoredDelaysMs.set(element, parseRevealDelayMs(element));
    }

    return authoredDelaysMs.get(element);
}

// With data-reveal-order="random" the first element keeps its delay so reading starts there,
// [data-reveal-last] (the call to action) comes strictly last, and the rest reuse the authored time slots
// with some neighbours swapped and a small jitter, so the order surprises without losing the top-down flow.
function getRevealDelaysMs(revealItems) {
    const delaysMs = revealItems.map(getAuthoredDelayMs);

    if (document.body?.dataset.revealOrder !== "random" || revealItems.length < 2) {
        return delaysMs;
    }

    const latestDelayMs = Math.max(...delaysMs);
    const middleIndexes = revealItems
        .map((element, index) => index)
        .filter((index) => index !== 0 && !revealItems[index].hasAttribute("data-reveal-last"));
    const slotsMs = middleIndexes.map((index) => delaysMs[index]).sort((a, b) => a - b);

    // Swap disjoint neighbour pairs, so an element moves at most one place.
    const shuffledIndexes = [...middleIndexes];
    for (let position = 0; position < shuffledIndexes.length - 1; position += 1) {
        if (Math.random() < RANDOM_REVEAL_SWAP_CHANCE) {
            [shuffledIndexes[position], shuffledIndexes[position + 1]] = [shuffledIndexes[position + 1], shuffledIndexes[position]];
            position += 1;
        }
    }

    const result = [...delaysMs];
    shuffledIndexes.forEach((itemIndex, position) => {
        const jitterMs = (Math.random() * 2 - 1) * RANDOM_REVEAL_JITTER_MS;
        result[itemIndex] = Math.round(slotsMs[position] + jitterMs);
    });

    revealItems.forEach((element, index) => {
        if (element.hasAttribute("data-reveal-last")) {
            result[index] = latestDelayMs + LAST_REVEAL_GAP_MS;
        }
    });

    return result;
}

// Matches the 0.8s revealFade in main.css.
const REVEAL_DURATION_MS = 800;
const REVEAL_SOUND_VOLUME = 0.45;
// Each line's sample fades out over this while the next line's sample starts.
const REVEAL_SOUND_CROSSFADE_MS = 150;
// Slower than this sounds broken; the sample loops instead to cover the rest.
const REVEAL_SOUND_MIN_RATE = 0.5;
const REVEAL_SOUND_UNLOCK_EVENTS = ["pointerdown", "touchstart", "keydown"];

let revealSoundRun = 0;
let revealSoundTimeoutIds = [];
// The sample that should be sounding now; replayed if autoplay was blocked until the first interaction.
let activeRevealSegment = null;
// Bumped per sample when it (re)starts, so an older fade-out stops touching it.
const revealSampleTokens = new WeakMap();

function getRevealSamples() {
    return Array.from(document.querySelectorAll("audio[data-reveal-sound]"));
}

// The previous page's sample order, so the next letter (e.g. /invite then /rsvp) never sounds the same.
const REVEAL_SOUND_ORDER_KEY = "reveal-sound-order";

function readPreviousRevealOrder() {
    try {
        const order = JSON.parse(window.sessionStorage.getItem(REVEAL_SOUND_ORDER_KEY) ?? "[]");
        return Array.isArray(order) ? order : [];
    } catch {
        return [];
    }
}

function writeRevealOrder(order) {
    try {
        window.sessionStorage.setItem(REVEAL_SOUND_ORDER_KEY, JSON.stringify(order));
    } catch {
        // Storage unavailable: the next page just picks freely.
    }
}

// Picks a sample index per line: never the same as the line before, and never the same as that line on the previous page.
function pickRevealOrder(sampleCount, lineCount) {
    const previousOrder = readPreviousRevealOrder();
    const order = [];

    for (let line = 0; line < lineCount; line += 1) {
        const all = Array.from({ length: sampleCount }, (_, index) => index);
        const notRepeated = all.filter((index) => index !== order[line - 1]);
        const fresh = notRepeated.filter((index) => index !== previousOrder[line]);
        const candidates = fresh.length > 0 ? fresh : notRepeated.length > 0 ? notRepeated : all;
        order.push(candidates[Math.floor(Math.random() * candidates.length)]);
    }

    writeRevealOrder(order);
    return order;
}

function fadeOutRevealSample(audio, durationMs) {
    const token = revealSampleTokens.get(audio);
    const startVolume = audio.volume;
    const startedAt = performance.now();

    const step = (now) => {
        if (revealSampleTokens.get(audio) !== token) {
            return;
        }

        const progress = durationMs > 0 ? Math.min(1, (now - startedAt) / durationMs) : 1;
        audio.volume = startVolume * (1 - progress);

        if (progress < 1) {
            window.requestAnimationFrame(step);
            return;
        }

        audio.pause();
        audio.currentTime = 0;
    };

    window.requestAnimationFrame(step);
}

function startRevealSample(audio, segmentMs) {
    revealSampleTokens.set(audio, (revealSampleTokens.get(audio) ?? 0) + 1);

    // Slow the sample down when the line takes longer than the sample itself.
    const sampleMs = Number.isFinite(audio.duration) ? audio.duration * 1000 : 0;
    const rate = sampleMs > 0 ? Math.min(1, sampleMs / segmentMs) : 1;
    audio.preservesPitch = true;
    audio.playbackRate = Math.max(REVEAL_SOUND_MIN_RATE, rate);
    audio.loop = rate < REVEAL_SOUND_MIN_RATE;

    audio.pause();
    audio.currentTime = 0;
    audio.volume = REVEAL_SOUND_VOLUME;

    return audio.play().then(() => true, () => false);
}

function cancelRevealSound() {
    revealSoundRun += 1;
    revealSoundTimeoutIds.forEach((id) => window.clearTimeout(id));
    revealSoundTimeoutIds = [];
    activeRevealSegment = null;

    getRevealSamples().forEach((audio) => {
        revealSampleTokens.set(audio, (revealSampleTokens.get(audio) ?? 0) + 1);
        audio.pause();
        audio.currentTime = 0;
    });
}

function listenForRevealSoundUnlock(run) {
    const unlock = () => {
        REVEAL_SOUND_UNLOCK_EVENTS.forEach((name) => document.removeEventListener(name, unlock, true));

        const segment = activeRevealSegment;
        if (run !== revealSoundRun || !segment) {
            return;
        }

        const remainingMs = segment.endsAt - performance.now();
        if (remainingMs > REVEAL_SOUND_CROSSFADE_MS) {
            void startRevealSample(segment.audio, remainingMs);
        }
    };

    REVEAL_SOUND_UNLOCK_EVENTS.forEach((name) => document.addEventListener(name, unlock, true));
}

// Plays a random writing sample per line, from the moment it starts to appear until the next line starts
// (the last line until it has fully appeared), crossfading into the next line's sample.
function playRevealSound(segments) {
    cancelRevealSound();

    const samples = getRevealSamples();
    if (samples.length === 0 || segments.length === 0) {
        return;
    }

    const run = revealSoundRun;
    const sequenceStartedAt = performance.now();
    const order = pickRevealOrder(samples.length, segments.length);
    let isListeningForUnlock = false;

    segments.forEach((segment, index) => {
        const isLast = index === segments.length - 1;
        const segmentMs = Math.max(1, segment.endMs - segment.startMs);

        revealSoundTimeoutIds.push(window.setTimeout(() => {
            if (run !== revealSoundRun) {
                return;
            }

            const audio = samples[order[index]];
            activeRevealSegment = { audio, endsAt: sequenceStartedAt + segment.endMs };

            void startRevealSample(audio, segmentMs).then((played) => {
                if (!played && !isListeningForUnlock && run === revealSoundRun) {
                    isListeningForUnlock = true;
                    listenForRevealSoundUnlock(run);
                }
            });

            // The last sample fades out so it is silent exactly when the text is done.
            const fadeDelayMs = isLast ? Math.max(0, segmentMs - REVEAL_SOUND_CROSSFADE_MS) : segmentMs;
            revealSoundTimeoutIds.push(window.setTimeout(() => {
                if (run === revealSoundRun) {
                    fadeOutRevealSample(audio, REVEAL_SOUND_CROSSFADE_MS);
                }
            }, fadeDelayMs));
        }, segment.startMs));
    });
}

function startRevealSequence(root = document) {
    const revealItems = Array.from(root.querySelectorAll("[data-reveal]"));
    const delaysMs = getRevealDelaysMs(revealItems);

    // Hidden items (e.g. the invite follow-up after replying) never appear, so they get no sound.
    const visibleTimings = revealItems
        .map((element, index) => ({ element, delayMs: delaysMs[index] }))
        .filter(({ element }) => element.getClientRects().length > 0)
        .map(({ element, delayMs }) => ({
            startMs: delayMs,
            endMs: delayMs + (element.hasAttribute("data-reveal-last") ? LAST_REVEAL_DURATION_MS : REVEAL_DURATION_MS)
        }))
        .sort((a, b) => a.startMs - b.startMs);

    // Each line sounds until the next one starts; the last one until the final line has fully appeared.
    const finalEndMs = Math.max(0, ...visibleTimings.map((timing) => timing.endMs));
    const segments = visibleTimings.map((timing, index) => ({
        startMs: timing.startMs,
        endMs: index < visibleTimings.length - 1 ? visibleTimings[index + 1].startMs : finalEndMs
    }));

    playRevealSound(segments);

    revealItems.forEach((element, index) => {
        const delayMs = delaysMs[index];
        element.style.setProperty("--reveal-delay", `${delayMs}ms`);
        if (element.hasAttribute("data-reveal-last")) {
            element.style.animationDuration = `${LAST_REVEAL_DURATION_MS}ms`;
        }
        element.classList.remove("is-ready", "opacity-0", "opacity-100");

        void element.offsetWidth;
        element.classList.add("is-ready");
    });
}

function handleRevealSequenceStart() {
    startRevealSequence();
}

function initRevealSequence() {
    window.addEventListener("reveal-sequence:start", handleRevealSequenceStart);

    // "after-envelope" (invite) and "manual" (map) start on the reveal-sequence:start event instead.
    const revealMode = document.body?.dataset.revealMode;
    const shouldWaitForStart = revealMode === "after-envelope" || revealMode === "manual";
    if (!shouldWaitForStart) {
        handleRevealSequenceStart();
    }
}

document.addEventListener("DOMContentLoaded", initRevealSequence);
