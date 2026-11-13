// The finale, once a guest has found every secret of the Marauder's Map. As Dumbledore says "Mischief managed!"
// (map-dumbledore.js), the background music makes way for "Fireworks" and rockets burst in the guest's house colours.
// If the guest found the last secret by closing the map, the map unfolds itself again.
// Then the Marauders' own note inks in, naming the guest an Honorary Student. From then on (also on later visits)
// the guest's name on the map is underlined and opens the note again.
// Reduced motion: no rockets, just a warm glow behind the note.
// The bonus for finding everything ("+20", the API keeps score) bursts from the crest as the note appears and flies
// into the House Cup button.
import { COMPLETION_BONUS_POINTS, EASTER_EGG_COUNT } from './api-client.js?v=77af242fad';
import { closeDialogAnimated, showDialogAnimated } from './dialog-motion.js?v=77af242fad';
import { burstHousePoints } from './map-rewards.js?v=77af242fad';
import { isAudioMuted, playMapSound, preloadMapSounds } from './map-sounds.js?v=77af242fad';

const HOUSES = {
    gryffindor: { name: 'Gryffindor', sparks: ['#ff3b2f', '#ff7a2f', '#ffb02e'] },
    hufflepuff: { name: 'Hufflepuff', sparks: ['#ffd23f', '#ffb000', '#fff3b0'] },
    ravenclaw: { name: 'Ravenclaw', sparks: ['#3f7bff', '#9fc3ff', '#d9a55b'] },
    slytherin: { name: 'Slytherin', sparks: ['#2fd36b', '#b8f5c8', '#c9d1d9'] }
};
const GOLD_SPARKS = ['#ffe29a', '#fff4d6', '#ffc94d'];
const crestUrl = (house) => new URL(`../assets/images/admin/${house}-logo.png`, import.meta.url).href;

const FINALE_MUSIC_URL = new URL('../assets/music/fireworks.mp3', import.meta.url).href;
const FINALE_MUSIC_VOLUME = 0.35;
// The level background-audio.js gives the map music; Dumbledore may still have it ducked when the finale starts.
const BACKGROUND_MUSIC_VOLUME = 0.25;
const MUSIC_OUT_MS = 900;
const MUSIC_IN_MS = 1500;
const MUSIC_BACK_MS = 2500;

// When the note inks in, after the first rockets (and after the map has unfolded, when it had to).
const NOTE_DELAY_MS = 3200;
const NOTE_DELAY_REOPENED_MS = 4400;
const INK_MS = 2200;
const NUMBER_WORDS = { 10: 'Ten', 20: 'Twenty', 50: 'Fifty' };

// Rockets: an opening salvo, a steady show, and a closing volley.
const OPENING_SALVO_MS = [0, 180, 380];
const SHOW_START_MS = 1000;
const SHOW_END_MS = 10500;
const SHOW_GAP_MS = [380, 900];
const CLOSING_VOLLEY_MS = 10900;
const CLOSING_VOLLEY_COUNT = 7;
const CLOSING_VOLLEY_GAP_MS = 120;
const VEIL_FADE_MS = 700;
// Reduced motion: how long the glow stays.
const GLOW_MS = 5000;

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const random = (min, max) => min + Math.random() * (max - min);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const wait = (ms) => new Promise((resolve) => {
    window.setTimeout(resolve, ms);
});

function rampVolume(audio, target, durationMs, onDone) {
    const from = audio.volume;
    const startTime = performance.now();
    const step = (now) => {
        const progress = durationMs > 0 ? Math.min(1, (now - startTime) / durationMs) : 1;
        audio.volume = Math.min(1, Math.max(0, from + (target - from) * progress));

        if (progress < 1) {
            requestAnimationFrame(step);
        } else {
            onDone?.();
        }
    };
    requestAnimationFrame(step);
}

// Swaps the map music for "Fireworks"; returns a function that swaps it back.
// iOS ignores volume, so the fades fall back to a plain pause and play there.
function startFinaleMusic() {
    const background = document.getElementById('background-audio');
    const backgroundWasPlaying = background instanceof HTMLMediaElement && !background.paused;

    if (backgroundWasPlaying) {
        rampVolume(background, 0, MUSIC_OUT_MS, () => background.pause());
    }

    const music = new Audio(FINALE_MUSIC_URL);
    music.volume = 0;
    music.play().then(() => rampVolume(music, FINALE_MUSIC_VOLUME, MUSIC_IN_MS)).catch(() => {
        // Autoplay blocked or file missing: the show goes on in silence.
    });

    let restored = false;
    const restore = () => {
        if (restored) {
            return;
        }

        restored = true;
        rampVolume(music, 0, MUSIC_BACK_MS, () => music.pause());

        if (backgroundWasPlaying) {
            background.volume = 0;
            background.play().then(() => rampVolume(background, BACKGROUND_MUSIC_VOLUME, MUSIC_BACK_MS)).catch(() => {});
        }
    };
    music.addEventListener('ended', restore, { once: true });

    return restore;
}

// ---------------------------------------------------------------------------------------------
// Sound of the rockets, made with Web Audio from white noise: a soft thump at launch, a boom at the burst,
// and crackle for the glittering ones. Web Audio bypasses the mute hook in audio-toggle.js, so it checks the
// mute setting itself.
// ---------------------------------------------------------------------------------------------

let audioContext = null;
let noiseBuffer = null;

function getAudio() {
    if (isAudioMuted()) {
        return null;
    }

    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;

    if (!audioContext && AudioContextClass) {
        try {
            audioContext = new AudioContextClass();
            const length = audioContext.sampleRate * 2;
            noiseBuffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
            const data = noiseBuffer.getChannelData(0);
            for (let i = 0; i < length; i += 1) {
                data[i] = Math.random() * 2 - 1;
            }
        } catch {
            audioContext = null;
        }
    }

    if (audioContext?.state === 'suspended') {
        audioContext.resume().catch(() => {});
    }

    return audioContext?.state === 'running' ? audioContext : null;
}

// pan: -1 (left) .. 1 (right).
function playNoise({ at = 0, pan = 0, volume, attack = 0.005, decay, filter, from, to = from, q = 0.7 }) {
    const context = getAudio();

    if (!context) {
        return;
    }

    const start = context.currentTime + at;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;

    const biquad = context.createBiquadFilter();
    biquad.type = filter;
    biquad.Q.value = q;
    biquad.frequency.setValueAtTime(from, start);
    biquad.frequency.exponentialRampToValueAtTime(to, start + attack + decay);

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);

    let node = source.connect(biquad).connect(gain);
    if (typeof context.createStereoPanner === 'function') {
        const panner = context.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, pan));
        node = node.connect(panner);
    }
    node.connect(context.destination);

    // A random stretch of the 2 s of noise, so no two bursts sound alike.
    source.start(start, random(0, 0.5));
    source.stop(start + attack + decay + 0.05);
}

const playLaunch = (pan) => playNoise({ pan, volume: 0.05, attack: 0.02, decay: 0.35, filter: 'lowpass', from: 900, to: 300 });

function playBoom(pan, crackle) {
    playNoise({ pan, volume: 0.45, attack: 0.008, decay: random(0.9, 1.3), filter: 'lowpass', from: 2600, to: 120 });

    if (crackle) {
        Array.from({ length: 26 }, () => playNoise({
            at: random(0.35, 1.6), pan: pan + random(-0.3, 0.3), volume: random(0.03, 0.09), attack: 0.002, decay: random(0.02, 0.06),
            filter: 'highpass', from: random(2500, 5000)
        }));
    }
}

// ---------------------------------------------------------------------------------------------
// Fireworks on a full-screen canvas, over a darkening veil so the colours show on the parchment too.
// ---------------------------------------------------------------------------------------------

function launchTimes() {
    const times = [...OPENING_SALVO_MS];

    for (let t = SHOW_START_MS; t < SHOW_END_MS; t += random(...SHOW_GAP_MS)) {
        times.push(t);
    }

    for (let i = 0; i < CLOSING_VOLLEY_COUNT; i += 1) {
        times.push(CLOSING_VOLLEY_MS + i * CLOSING_VOLLEY_GAP_MS);
    }

    return times;
}

function createRoot() {
    const rootEl = document.createElement('div');
    rootEl.setAttribute('aria-hidden', 'true');
    rootEl.className = 'pointer-events-none fixed inset-0 z-[70]';
    const veilEl = document.createElement('div');
    veilEl.className = 'absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,rgba(12,10,30,0.45),rgba(0,0,0,0.75))] opacity-0';
    rootEl.append(veilEl);
    document.body.append(rootEl);
    veilEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: VEIL_FADE_MS, fill: 'forwards' });

    const remove = () => veilEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: VEIL_FADE_MS * 2, fill: 'forwards' })
        .finished.catch(() => {}).then(() => rootEl.remove());

    return { rootEl, remove };
}

// Reduced motion: a warm glow instead of rockets.
function showGlow(colors) {
    const { rootEl, remove } = createRoot();
    const glowEl = document.createElement('div');
    glowEl.className = 'absolute inset-0 opacity-0';
    glowEl.style.background = `radial-gradient(circle at 50% 40%, ${colors[0]}55, transparent 60%)`;
    rootEl.append(glowEl);
    glowEl.animate([{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: GLOW_MS, fill: 'forwards' });
    return wait(GLOW_MS).then(remove);
}

// Resolves once the last spark has faded.
function showFireworks(house) {
    if (reduceMotion()) {
        return showGlow(HOUSES[house]?.sparks ?? GOLD_SPARKS);
    }

    const palette = HOUSES[house]?.sparks ?? GOLD_SPARKS;
    const { rootEl, remove } = createRoot();
    const canvas = document.createElement('canvas');
    canvas.className = 'absolute inset-0 h-full w-full';
    rootEl.append(canvas);
    const ctx = canvas.getContext('2d');

    if (!ctx) {
        return wait(SHOW_END_MS).then(remove);
    }

    let width = 0;
    let height = 0;
    const resize = () => {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const launches = launchTimes();
    const rockets = [];
    const sparks = [];
    const panOf = (x) => (x / width) * 2 - 1;

    const launch = () => {
        const targetX = width * random(0.15, 0.85);
        const targetY = height * random(0.12, 0.42);
        const x = targetX + width * random(-0.08, 0.08);
        const distance = height + 10 - targetY;
        const lift = height * 1.2;
        const flightS = Math.sqrt((2 * distance) / lift);
        rockets.push({ x, y: height + 10, vx: (targetX - x) / flightS, vy: -lift * flightS, lift });
        playLaunch(panOf(x));
    };

    const spark = (x, y, angle, speed, options) => sparks.push({
        x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, age: 0, ...options
    });

    const explode = ({ x, y }) => {
        const scale = Math.min(width, height);
        const type = pick(['peony', 'peony', 'ring', 'willow', 'double']);
        const color = pick(palette);
        const speed = scale * random(0.5, 0.7);

        if (type === 'willow') {
            Array.from({ length: 80 }, () => spark(x, y, random(0, Math.PI * 2), speed * random(0.4, 0.8), {
                color: pick(GOLD_SPARKS), size: random(1, 1.8), life: random(2.2, 3), drag: 0.95, gravity: 45, glitter: true
            }));
        } else if (type === 'ring') {
            const count = 56;
            const tilt = random(0.45, 1);
            const turn = random(0, Math.PI);
            Array.from({ length: count }, (_, i) => {
                const a = (i / count) * Math.PI * 2;
                // A tilted circle: squash, then rotate.
                const rx = Math.cos(a);
                const ry = Math.sin(a) * tilt;
                const angle = Math.atan2(rx * Math.sin(turn) + ry * Math.cos(turn), rx * Math.cos(turn) - ry * Math.sin(turn));
                spark(x, y, angle, speed * 0.8 * Math.hypot(rx, ry), { color, size: random(1.4, 2.2), life: random(1.3, 1.7), drag: 0.965, gravity: 55 });
            });
        } else {
            Array.from({ length: 95 }, () => spark(x, y, random(0, Math.PI * 2), speed * Math.sqrt(random(0.15, 1)), {
                color: Math.random() < 0.8 ? color : pick(palette), size: random(1.3, 2.3), life: random(1.2, 1.9), drag: 0.965, gravity: 60,
                glitter: Math.random() < 0.15
            }));
        }

        if (type === 'double') {
            Array.from({ length: 40 }, () => spark(x, y, random(0, Math.PI * 2), speed * random(0.25, 0.4), {
                color: pick(GOLD_SPARKS), size: random(1, 1.6), life: random(1.4, 2), drag: 0.96, gravity: 50, glitter: true
            }));
        }

        // A flash at the burst; the trails fade it out.
        const flash = ctx.createRadialGradient(x, y, 0, x, y, scale * 0.12);
        flash.addColorStop(0, 'rgba(255, 245, 220, 0.55)');
        flash.addColorStop(1, 'rgba(255, 245, 220, 0)');
        ctx.fillStyle = flash;
        ctx.fillRect(x - scale * 0.12, y - scale * 0.12, scale * 0.24, scale * 0.24);

        playBoom(panOf(x), type === 'willow' || type === 'double');
    };

    return new Promise((resolve) => {
        const startTime = performance.now();
        let lastTime = startTime;

        const frame = (now) => {
            const dt = Math.min(0.033, (now - lastTime) / 1000);
            lastTime = now;
            const elapsed = now - startTime;

            while (launches.length && launches[0] <= elapsed) {
                launches.shift();
                launch();
            }

            // Fade what was drawn before into trails, keeping the canvas transparent.
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
            ctx.fillRect(0, 0, width, height);
            ctx.globalCompositeOperation = 'lighter';

            for (let i = rockets.length - 1; i >= 0; i -= 1) {
                const rocket = rockets[i];
                rocket.vy += rocket.lift * dt;
                rocket.x += rocket.vx * dt;
                rocket.y += rocket.vy * dt;
                spark(rocket.x, rocket.y, random(0, Math.PI * 2), random(5, 25), {
                    color: '#ffd9a0', size: random(0.6, 1.2), life: random(0.25, 0.45), drag: 0.9, gravity: 30
                });

                ctx.globalAlpha = 1;
                ctx.fillStyle = '#fff6e0';
                ctx.beginPath();
                ctx.arc(rocket.x, rocket.y, 1.8, 0, Math.PI * 2);
                ctx.fill();

                if (rocket.vy >= 0) {
                    rockets.splice(i, 1);
                    explode(rocket);
                }
            }

            const dragStep = dt * 60;
            for (let i = sparks.length - 1; i >= 0; i -= 1) {
                const s = sparks[i];
                s.age += dt;

                if (s.age >= s.life) {
                    sparks.splice(i, 1);
                    continue;
                }

                const drag = s.drag ** dragStep;
                s.vx *= drag;
                s.vy = s.vy * drag + s.gravity * dt;
                s.x += s.vx * dt;
                s.y += s.vy * dt;

                if (s.glitter && Math.random() < 0.35) {
                    continue;
                }

                ctx.globalAlpha = 1 - (s.age / s.life) ** 2;
                ctx.fillStyle = s.color;
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;

            if (!launches.length && !rockets.length && !sparks.length) {
                window.removeEventListener('resize', resize);
                remove().then(resolve);
                return;
            }

            requestAnimationFrame(frame);
        };

        requestAnimationFrame(frame);
    });
}

// ---------------------------------------------------------------------------------------------
// The Marauders' note.
// ---------------------------------------------------------------------------------------------

function whenMapSettled(mapEl) {
    return new Promise((resolve) => {
        if (mapEl.dataset.state !== 'closing') {
            resolve();
            return;
        }

        const observer = new MutationObserver(() => {
            if (mapEl.dataset.state !== 'closing') {
                observer.disconnect();
                resolve();
            }
        });
        observer.observe(mapEl, { attributes: true, attributeFilter: ['data-state'] });
    });
}

// openMap(): unfolds the map (map.js). cup: the House Cup from initHouseCup, or null.
// onNote(result): runs as the note first appears (the all-found ribbon in map-rewards.js).
// Returns { play(result) }, or null for guests who can't earn house points.
export function initMapFinale(guest, { mapEl, openMap, cup = null, onNote = () => {} }) {
    const house = HOUSES[guest?.house] ? guest.house : null;
    const dialog = document.querySelector('[data-map-finale-dialog]');

    if (guest?.rsvpStatus !== 'accepted' || !house || !(dialog instanceof HTMLDialogElement) || !(mapEl instanceof HTMLElement)) {
        return null;
    }

    const inkEl = dialog.querySelector('[data-map-finale-ink]');
    const crestEl = dialog.querySelector('[data-map-finale-crest]');
    const nameEl = dialog.querySelector('[data-map-finale-name]');
    const houseEl = dialog.querySelector('[data-map-finale-house]');
    const foundEl = dialog.querySelector('[data-map-finale-found]');

    if (crestEl instanceof HTMLImageElement) {
        crestEl.src = crestUrl(house);
    }
    if (nameEl) {
        nameEl.textContent = guest.guestName || 'Guest';
    }
    if (houseEl) {
        houseEl.textContent = `of House ${HOUSES[house].name}`;
    }
    if (foundEl) {
        const bonus = NUMBER_WORDS[COMPLETION_BONUS_POINTS] ?? COMPLETION_BONUS_POINTS;
        foundEl.textContent = `You found all ${EASTER_EGG_COUNT} secrets of the Marauder's Map! ${bonus} bonus points to ${HOUSES[house].name}.`;
    }

    // Up front, so the pop starts together with the note (also when it opens without a tap, in the finale).
    preloadMapSounds(['popup']);

    let onClosed = null;
    let closing = false;
    const close = () => {
        if (!dialog.open || closing) {
            return;
        }

        closing = true;
        playMapSound('popup');
        void closeDialogAnimated(dialog).then(() => {
            closing = false;
            onClosed?.();
            onClosed = null;
        });
    };

    // "Mischief managed" and the cross in the corner.
    dialog.querySelectorAll('[data-map-finale-close]').forEach((button) => button.addEventListener('click', close));
    dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        close();
    });
    // The dialog has no padding, so a click whose target is the dialog itself landed on the backdrop.
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog) {
            close();
        }
    });

    // Where the bonus bursts from: the crest on the note (the middle of the screen if it has no size yet).
    const bonusPoint = () => {
        const rect = (crestEl ?? dialog).getBoundingClientRect();
        return rect.width > 0
            ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
            : null;
    };

    // Resolves once the guest closes the note. bonus: house points to burst from it as it appears (0 for none).
    const showNote = (bonus = 0) => new Promise((resolve) => {
        onClosed = resolve;
        // Reopened while it was still closing: showDialogAnimated cancels that close.
        closing = false;
        playMapSound('popup');
        showDialogAnimated(dialog);

        if (bonus > 0) {
            burstHousePoints(house, bonus, { point: bonusPoint(), cup });
        }

        if (inkEl instanceof HTMLElement && !reduceMotion()) {
            // Inked in from the top, like the map writing itself.
            inkEl.animate([
                { clipPath: 'inset(0 0 100% 0)', filter: 'blur(3px)', opacity: 0.4 },
                { clipPath: 'inset(0 0 0% 0)', filter: 'blur(0px)', opacity: 1 }
            ], { duration: INK_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'backwards' });
        }
    });

    // The guest's name on the map becomes a link to the note, underlined like the map's other links.
    let nameLinked = false;
    const linkName = () => {
        const guestNameEl = document.querySelector('[data-map-guest-name]');

        if (nameLinked || !(guestNameEl instanceof HTMLElement)) {
            return;
        }

        nameLinked = true;
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-controls', dialog.id);
        button.className = 'underline decoration-charcoal/30 underline-offset-4 transition-colors duration-200 hover:decoration-charcoal/60 focus:outline-none focus-visible:decoration-charcoal';
        guestNameEl.replaceWith(button);
        button.append(guestNameEl);
        // Like the House Cup button: keep taps away from the easter eggs on the map.
        button.addEventListener('pointerdown', (event) => event.stopPropagation());
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            void showNote();
        });
    };

    if ((guest.foundEggIds?.length ?? 0) >= EASTER_EGG_COUNT) {
        linkName();
    }

    let played = false;

    return {
        // result: the API's answer for the last secret; its bonusAwarded (0 from an older API) flies in as "+20".
        async play(result = null) {
            if (played) {
                return;
            }

            played = true;
            const restoreMusic = startFinaleMusic();
            const fireworksDone = showFireworks(house);

            // Found the last secret by closing the map: the map isn't done with them yet.
            await whenMapSettled(mapEl);
            const reopened = mapEl.dataset.state !== 'open';

            if (reopened) {
                openMap();
            }

            await wait(reopened ? NOTE_DELAY_REOPENED_MS : NOTE_DELAY_MS);
            const noteClosed = showNote(Number(result?.bonusAwarded) || 0);
            onNote(result);
            await noteClosed;
            linkName();
            await fireworksDone;
            restoreMusic();
        }
    };
}
