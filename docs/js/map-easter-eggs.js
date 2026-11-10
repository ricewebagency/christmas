// Hidden easter eggs on the Marauder's Map. Nothing hints at them; they only show up when triggered.
// - Compass: tap the printed compass rose and it spins.
// - Footsteps: tap next to a walker and its name inks in above it.
// - Castle: tap the castle and its windows and a string of Christmas lights come on.
// - Shake the phone (or tap the map quickly a few times): snow. Until it's found, every tap lets one flake fall.
// - Lay the phone flat (or swipe across the map): Nox (the light goes out); pick it up (or swipe again): Lumos.
// - Revelio: casting the spell (map-reveal.js). Mischief managed: closing the map (map.js).
// Every first find earns the guest's house points (map-rewards.js).
// Motion eggs never ask for sensor permission: they work where the browser already sends motion
// events (Android). Where it needs a prompt first (iOS) or blocks the sensors (e.g. Samsung Internet's
// secret mode, desktops), the tap and swipe gestures do the same.
// Each egg reports itself through `onFound(eggId, { point, delayMs })` (map-rewards.js turns that into house points).
// Egg ids must match EasterEggs.All in the API.
import { fetchGuestNames } from './api-client.js?v=0d22dc9828';
import { speakSpell } from './map-dumbledore.js?v=0d22dc9828';
import { centerOf } from './map-rewards.js?v=0d22dc9828';
import { createMapSoundVoice, playMapSound } from './map-sounds.js?v=0d22dc9828';

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const random = (min, max) => min + Math.random() * (max - min);
const isMapOpen = (mapEl) => mapEl.dataset.state === 'open';

// Fades every running animation on an element out from wherever it is now.
// fill 'both' holds the current opacity during the delay; without it the element drops to its
// base opacity-0 the moment the old animations are cancelled and then pops back, which reads as a flash.
function fadeOutFromCurrent(el, { duration = 900, delay = 0 } = {}) {
    const from = Number(window.getComputedStyle(el).opacity);
    el.getAnimations().forEach((animation) => animation.cancel());
    return el.animate([{ opacity: from }, { opacity: 0 }], { duration, delay, easing: 'ease-in', fill: 'both' });
}

// Calls onRelease(down, event) when the primary pointer lifts off el; `down` is where and when it went down.
// Plain pointer events instead of click: taps on non-interactive elements don't always click on iOS.
function onPointerRelease(el, onRelease) {
    let down = null;
    el.addEventListener('pointerdown', (event) => {
        down = event.isPrimary ? { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp } : null;
    }, { passive: true });
    el.addEventListener('pointercancel', () => {
        down = null;
    }, { passive: true });
    el.addEventListener('pointerup', (event) => {
        const start = down;
        down = null;

        if (start && start.id === event.pointerId) {
            onRelease(start, event);
        }
    }, { passive: true });
}

const isTapGesture = (down, event) => Math.hypot(event.clientX - down.x, event.clientY - down.y) <= TAP_SLOP_PX
    && event.timeStamp - down.time <= TAP_MAX_MS;

// ---------------------------------------------------------------------------------------------
// Compass
// ---------------------------------------------------------------------------------------------

const COMPASS_SPIN = [
    { transform: 'rotate(0deg)', easing: 'cubic-bezier(0.3, 0, 0.2, 1)' },
    { transform: 'rotate(1080deg)' }
];
const COMPASS_WOBBLE = [
    { transform: 'rotate(0deg)' },
    { transform: 'rotate(-12deg)' },
    { transform: 'rotate(8deg)' },
    { transform: 'rotate(0deg)' }
];

function initCompass(mapEl, onFound) {
    const buttonEl = mapEl.querySelector('[data-egg-compass]');
    const discEl = mapEl.querySelector('[data-egg-compass-disc]');
    const roseEl = mapEl.querySelector('[data-egg-compass-rose]');

    if (!buttonEl || !discEl || !roseEl) {
        return;
    }

    let isSpinning = false;

    buttonEl.addEventListener('click', () => {
        if (isSpinning || !isMapOpen(mapEl)) {
            return;
        }

        isSpinning = true;
        onFound('compass', { point: centerOf(buttonEl), delayMs: reduceMotion() ? 500 : 1200 });
        discEl.classList.remove('hidden');
        // Fades out while the rose slows down (the fast part of the spin is over at ~2.3 s).
        playMapSound('spin', 0, reduceMotion() ? { fadeAfterMs: 300, fadeMs: 500 } : { fadeAfterMs: 1400, fadeMs: 1200 });

        const spin = reduceMotion()
            ? roseEl.animate(COMPASS_WOBBLE, { duration: 900, easing: 'ease-in-out' })
            : roseEl.animate(COMPASS_SPIN, { duration: 3200 });

        // Ends at a full turn, so swapping back to the print is invisible.
        spin.finished.finally(() => {
            discEl.classList.add('hidden');
            isSpinning = false;
        });
    });
}

// ---------------------------------------------------------------------------------------------
// Footstep names
// ---------------------------------------------------------------------------------------------

// Hogwarts folk who could turn up on the map. They fill the name list up to NAME_POOL_SIZE,
// and always mix in with the guests (at least MIN_HOGWARTS_NAMES of them).
const HOGWARTS_NAMES = [
    'Harry Potter', 'Ron Weasley', 'Hermione Granger', 'Albus Dumbledore', 'Minerva McGonagall', 'Severus Snape',
    'Rubeus Hagrid', 'Argus Filch', 'Mrs Norris', 'Peeves', 'Nearly Headless Nick', 'Moaning Myrtle',
    'The Bloody Baron', 'The Fat Friar', 'The Grey Lady', 'Dobby', 'Kreacher', 'Remus Lupin', 'Sirius Black',
    'Peter Pettigrew', 'Bartemius Crouch', 'Alastor Moody', 'Luna Lovegood', 'Neville Longbottom',
    'Ginny Weasley', 'Fred Weasley', 'George Weasley', 'Draco Malfoy', 'Cho Chang', 'Cedric Diggory',
    'Filius Flitwick', 'Pomona Sprout', 'Horace Slughorn', 'Sybill Trelawney', 'Poppy Pomfrey', 'Oliver Wood'
];
const NAME_POOL_SIZE = 25;
const MIN_HOGWARTS_NAMES = 8;
const TAP_SLOP_PX = 10;
const TAP_MAX_MS = 500;

// Banners cut from name-tags.png (fully opaque paper). Coordinates are in the cut-out file's pixels:
// `path` runs along the middle of the writable band, `band` is how tall that band is.
const NAME_TAGS = [
    { src: './assets/images/map/name-tag-1.png', width: 400, height: 107, path: 'M60 55C153 57 247 53 340 55', pathLength: 280, band: 51 },
    { src: './assets/images/map/name-tag-2.png', width: 400, height: 114, path: 'M70 49C155 30 240 29 325 50', pathLength: 257, band: 51 },
    { src: './assets/images/map/name-tag-3.png', width: 400, height: 78, path: 'M45 38C148 35 252 42 355 37', pathLength: 310, band: 56 },
    { src: './assets/images/map/name-tag-4.png', width: 400, height: 100, path: 'M80 38C163 37 247 77 330 65', pathLength: 252, band: 53 },
    { src: './assets/images/map/name-tag-5.png', width: 400, height: 87, path: 'M65 37C155 44 245 39 335 39', pathLength: 270, band: 49 }
];
const TAG_FONT_PX = 9;
const TAG_FONT_PX_SHORT = 8;
// The band is at least this many times the font size, and the name fills at most this much of the path.
const TAG_BAND_PER_FONT = 1.7;
const TAG_TEXT_FILL = 0.8;
const TAG_MAX_WIDTH_PX = 144;
const TAG_MAX_HEIGHT_PX = 72;
// A banner is only picked when the name can be written at no less than this share of the normal size.
const TAG_MIN_FONT_RATIO = 0.9;

const SVG_NS = 'http://www.w3.org/2000/svg';
let tagIdCounter = 0;
let lastTagIndex = -1;
let measureCtx = null;

function measureNameWidth(name, fontPx) {
    measureCtx ??= document.createElement('canvas').getContext('2d');
    measureCtx.font = `${fontPx}px Inkpot, serif`;
    return measureCtx.measureText(name).width;
}

function svgEl(tagName, attributes = {}) {
    const el = document.createElementNS(SVG_NS, tagName);
    Object.entries(attributes).forEach(([key, value]) => el.setAttribute(key, String(value)));
    return el;
}

// How big a banner must be drawn for a name: the band fits the letters and the name fits the band,
// within the size limits. Past those limits the letters shrink instead.
function fitNameTag(tag, textWidth, baseFontPx) {
    const maxScale = Math.min(TAG_MAX_WIDTH_PX / tag.width, TAG_MAX_HEIGHT_PX / tag.height);
    const wantedScale = Math.max(textWidth / (tag.pathLength * TAG_TEXT_FILL), (baseFontPx * TAG_BAND_PER_FONT) / tag.band);
    const scale = Math.min(wantedScale, maxScale);
    const fontPx = Math.min(
        baseFontPx,
        (tag.pathLength * TAG_TEXT_FILL * scale) / (textWidth / baseFontPx),
        (tag.band * scale) / TAG_BAND_PER_FONT
    );
    return { scale, fontPx };
}

// A random banner with the name written along its band. Only banners where the name stays readable
// are candidates (long names skip the narrow ones), and the same banner is not used twice in a row.
// Pass `tagIndex` to redraw a walker's earlier tag on the same banner.
function createNameTag(name, tagIndex = null) {
    const baseFontPx = window.matchMedia('(max-height: 640px)').matches ? TAG_FONT_PX_SHORT : TAG_FONT_PX;
    const textWidth = measureNameWidth(name, baseFontPx);
    const fits = NAME_TAGS.map((tag) => fitNameTag(tag, textWidth, baseFontPx));
    const readable = fits.map((_, i) => i).filter((i) => fits[i].fontPx >= baseFontPx * TAG_MIN_FONT_RATIO);
    const fresh = readable.filter((i) => i !== lastTagIndex);
    const candidates = fresh.length ? fresh : readable;
    const index = tagIndex ?? (candidates.length
        ? candidates[Math.floor(Math.random() * candidates.length)]
        : fits.reduce((best, fit, i) => (fit.fontPx > fits[best].fontPx ? i : best), 0));
    lastTagIndex = index;

    const tag = NAME_TAGS[index];
    const { scale, fontPx } = fits[index];

    const pathId = `map-name-tag-path-${++tagIdCounter}`;
    const svg = svgEl('svg', {
        viewBox: `0 0 ${tag.width} ${tag.height}`,
        width: Math.round(tag.width * scale),
        height: Math.round(tag.height * scale),
        class: 'block overflow-visible font-inkpot'
    });
    const defs = svgEl('defs');
    defs.append(svgEl('path', { id: pathId, d: tag.path }));
    const text = svgEl('text', { 'font-size': (fontPx / scale).toFixed(2), 'text-anchor': 'middle', dy: '0.35em', fill: '#2B2B2B' });
    const textPath = svgEl('textPath', { href: `#${pathId}`, startOffset: '50%' });
    textPath.textContent = name;
    text.append(textPath);
    svg.append(defs, svgEl('image', { href: tag.src, width: tag.width, height: tag.height }), text);

    return { name, tagIndex: index, el: svg };
}

function initFootstepNames(mapEl, footsteps, guestName, onFound) {
    const sheetEl = mapEl.querySelector('[data-map-sheet]');

    if (!sheetEl || !footsteps) {
        return;
    }

    // The guest themself, the other guests who are coming (API, loaded once in the background),
    // topped up with Hogwarts names. Until the API answers (or when it fails) it's mostly Hogwarts.
    const ownName = String(guestName ?? '').trim();
    const hogwartsNames = [...HOGWARTS_NAMES].sort(() => Math.random() - 0.5);
    const buildPool = (guestNames) => {
        const people = [...new Set([ownName, ...guestNames].filter(Boolean))];
        const hogwartsCount = Math.max(MIN_HOGWARTS_NAMES, NAME_POOL_SIZE - people.length);
        return [...new Set([...people, ...hogwartsNames.slice(0, hogwartsCount)])];
    };
    let pool = buildPool([]);
    fetchGuestNames().then((names) => {
        pool = buildPool(Array.isArray(names) ? names : []);
    }, () => {});
    // Measuring names needs the Inkpot font, and the first banner shouldn't pop in late.
    document.fonts?.load(`${TAG_FONT_PX}px Inkpot`).catch(() => {});
    NAME_TAGS.forEach(({ src }) => {
        new Image().src = src;
    });

    // Every name is shown once (random order) before the cycle starts over; never the same name twice in a row,
    // and never a name that is already on screen.
    const shownThisCycle = new Set();
    let lastName = null;
    const pickName = (usedNames) => {
        const isFree = (name) => !usedNames.has(name) && name !== lastName;
        let candidates = pool.filter((name) => isFree(name) && !shownThisCycle.has(name));

        if (!candidates.length && pool.every((name) => shownThisCycle.has(name))) {
            shownThisCycle.clear();
            candidates = pool.filter(isFree);
        }
        if (!candidates.length) {
            candidates = pool.filter(isFree);
        }

        const name = candidates[Math.floor(Math.random() * candidates.length)] ?? pool[0];
        shownThisCycle.add(name);
        lastName = name;
        return name;
    };

    onPointerRelease(sheetEl, (down, event) => {
        if (!isMapOpen(mapEl)) {
            return;
        }

        if (isTapGesture(down, event) && !(event.target instanceof Element && event.target.closest('a, button, [data-egg-compass], [data-egg-castle]'))) {
            // A walker keeps the name (and banner) it got the first time it was tapped.
            const labelled = footsteps.labelNearest(event.clientX, event.clientY, (usedNames, known) => (known
                ? createNameTag(known.name, known.tagIndex)
                : createNameTag(pickName(usedNames))));

            if (labelled) {
                onFound('footsteps', { point: { x: event.clientX, y: event.clientY - 40 }, delayMs: 900 });
            }
        }
    });
}

// ---------------------------------------------------------------------------------------------
// Castle lights
// ---------------------------------------------------------------------------------------------

// Pixel positions on map-flap-top-inside.png (1024 x 400).
const FLAP_WIDTH = 1024;
const FLAP_HEIGHT = 400;
const CASTLE_KEEP = [158, 150];
const CASTLE_WINDOWS = [
    [158, 143], [158, 166], [173.75, 146], [101, 131],
    [71, 180], [79.5, 177], [88.75, 176], [102.5, 172.5], [113.75, 170.5], [125, 168], [93, 190], [117.5, 186],
    [191, 185], [198.75, 186], [206.75, 189], [223, 187],
    [243.75, 212], [251, 214], [257.5, 215], [276, 215]
];
// Roof and battlement lines the lights hang along, each from one end to the other.
const CASTLE_STRANDS = [
    [[128.75, 121], [186, 121]],
    [[62.5, 165], [137.5, 150]],
    [[182.5, 161], [212.5, 172.5]],
    [[232.5, 195], [267.5, 206]]
];
const BULB_SPACING = 7;
const BULB_COLORS = ['#e2483d', '#f5c451', '#3fa652'];
const WINDOW_STAGGER_MS = 110;
const BULB_STAGGER_MS = 45;
const CASTLE_HOLD_MS = 4200;
const CASTLE_FADE_MS = 1200;
const CASTLE_WIND_DELAY_MS = 1000;

function placeOnFlap(el, [x, y]) {
    el.style.left = `${(x / FLAP_WIDTH) * 100}%`;
    el.style.top = `${(y / FLAP_HEIGHT) * 100}%`;
}

function createCastleLights(layerEl) {
    const byDistanceToKeep = ([x, y]) => Math.hypot(x - CASTLE_KEEP[0], y - CASTLE_KEEP[1]);
    const windows = [...CASTLE_WINDOWS]
        .sort((a, b) => byDistanceToKeep(a) - byDistanceToKeep(b))
        .map((point) => {
            const el = document.createElement('span');
            el.className = 'absolute aspect-square w-[1.8%] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 bg-[radial-gradient(circle,rgba(255,240,190,1)_0%,rgba(255,194,84,0.9)_28%,rgba(255,150,40,0.3)_55%,transparent_72%)]';
            placeOnFlap(el, point);
            return el;
        });

    let colorIndex = 0;
    const bulbs = CASTLE_STRANDS.flatMap(([[x1, y1], [x2, y2]]) => {
        const length = Math.hypot(x2 - x1, y2 - y1);
        const count = Math.max(3, Math.round(length / BULB_SPACING));
        const sag = length * 0.06;

        return Array.from({ length: count + 1 }, (_, i) => {
            const t = i / count;
            const color = BULB_COLORS[colorIndex++ % BULB_COLORS.length];
            const el = document.createElement('span');
            el.className = 'absolute aspect-square w-[0.9%] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0';
            el.style.backgroundImage = `radial-gradient(circle, #fff 0%, ${color} 40%, transparent 72%)`;
            placeOnFlap(el, [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t + sag * Math.sin(Math.PI * t)]);
            return el;
        });
    });

    layerEl.append(...windows, ...bulbs);
    return { windows, bulbs };
}

function initCastle(mapEl, onFound) {
    const buttonEl = mapEl.querySelector('[data-egg-castle]');
    const layerEl = mapEl.querySelector('[data-egg-castle-lights]');

    if (!buttonEl || !layerEl) {
        return;
    }

    // Created up front so the file is loaded before the first tap (a cold start made it late).
    const wind = createMapSoundVoice('woosh');
    let isLit = false;

    buttonEl.addEventListener('click', () => {
        if (isLit || !isMapOpen(mapEl)) {
            return;
        }

        isLit = true;
        onFound('castle', { point: centerOf(buttonEl), delayMs: reduceMotion() ? 600 : 2600 });
        // Fresh lights every time; the previous ones are removed once they have gone out.
        const { windows, bulbs } = createCastleLights(layerEl);
        const calm = reduceMotion();
        playMapSound('twinkle', 0, { rate: 0.9 });

        windows.forEach((el, i) => {
            el.animate(
                calm
                    ? [{ opacity: 0 }, { opacity: 1 }]
                    : [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0.5, offset: 0.5 }, { opacity: 1 }],
                { duration: calm ? 800 : 600, delay: calm ? 0 : i * WINDOW_STAGGER_MS, easing: 'ease-out', fill: 'forwards' }
            );
        });

        const bulbsStartMs = calm ? 400 : windows.length * WINDOW_STAGGER_MS + 300;
        bulbs.forEach((el, i) => {
            const onDelay = bulbsStartMs + (calm ? 0 : i * BULB_STAGGER_MS);
            el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: onDelay, fill: 'forwards' });

            if (!calm) {
                el.animate(
                    [{ opacity: 1 }, { opacity: 0.3 }, { opacity: 1 }],
                    { duration: random(900, 1600), delay: onDelay + 300 + random(0, 800), iterations: Infinity, easing: 'ease-in-out' }
                );
            }
        });

        const allOnMs = bulbsStartMs + (calm ? 300 : bulbs.length * BULB_STAGGER_MS + 300);

        // Wind from CASTLE_WIND_DELAY_MS after the tap until the last light has gone out (fade delay up to 500 + 1200 ms).
        const lightsOutMs = allOnMs + CASTLE_HOLD_MS + 500 + CASTLE_FADE_MS;
        window.setTimeout(
            () => wind.play(lightsOutMs - CASTLE_WIND_DELAY_MS, { fadeMs: CASTLE_FADE_MS, fadeInMs: 400 }),
            CASTLE_WIND_DELAY_MS
        );

        window.setTimeout(() => {
            const fades = [...bulbs, ...windows].map((el) => fadeOutFromCurrent(el, { duration: CASTLE_FADE_MS, delay: random(0, 500) }));
            // Removing the lights (instead of cancelling their animations) guarantees nothing can bring them back,
            // e.g. a twinkle or fill-forwards animation that getAnimations() didn't return.
            Promise.allSettled(fades.map((fade) => fade.finished)).then(() => {
                [...bulbs, ...windows].forEach((el) => el.remove());
                isLit = false;
            });
        }, allOnMs + CASTLE_HOLD_MS);
    });
}

// ---------------------------------------------------------------------------------------------
// Shake: snow
// ---------------------------------------------------------------------------------------------

const SHAKE_ACCEL = 13;
const SHAKE_PEAKS = 3;
const SHAKE_WINDOW_MS = 1000;
const SHAKE_PEAK_GAP_MS = 120;
const SNOW_SPAWN_MS = 6500;
// Returns { spawn } to add flakes while it's still running (after onDone it's gone).
function letItSnow(onDone, { spawnMs = SNOW_SPAWN_MS, flakesPerSecond: rate = null, flakes: initialFlakes = 0 } = {}) {
    const calm = reduceMotion();
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.className = 'pointer-events-none fixed inset-0 z-[70] h-full w-full';
    document.body.append(canvas);

    const ctx = canvas.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
        canvas.width = Math.round(window.innerWidth * dpr);
        canvas.height = Math.round(window.innerHeight * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const flakesPerSecond = rate ?? (calm ? 10 : 34);
    const flakes = [];
    const startTime = performance.now();
    let lastTime = startTime;
    let spawnDebt = 0;

    const spawn = () => {
        const radius = random(1, 3.4);
        flakes.push({
            x: random(-20, window.innerWidth + 20),
            y: -10,
            radius,
            speed: (calm ? 22 : 34) + radius * random(10, 18),
            sway: calm ? 0 : random(8, 28),
            swaySpeed: random(0.6, 1.6),
            phase: random(0, Math.PI * 2),
            alpha: random(0.55, 0.95)
        });
    };

    for (let i = 0; i < initialFlakes; i += 1) {
        spawn();
    }

    const frame = (now) => {
        const dt = Math.min(0.05, (now - lastTime) / 1000);
        const elapsed = (now - startTime) / 1000;
        lastTime = now;

        if (now - startTime < spawnMs) {
            spawnDebt += dt * flakesPerSecond;
            for (; spawnDebt >= 1; spawnDebt -= 1) {
                spawn();
            }
        }

        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        ctx.fillStyle = '#fff';
        ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';

        for (let i = flakes.length - 1; i >= 0; i -= 1) {
            const flake = flakes[i];
            flake.y += flake.speed * dt;

            if (flake.y > window.innerHeight + 10) {
                flakes.splice(i, 1);
                continue;
            }

            ctx.globalAlpha = flake.alpha;
            ctx.shadowBlur = flake.radius * 2;
            ctx.beginPath();
            ctx.arc(flake.x + Math.sin(flake.phase + elapsed * flake.swaySpeed) * flake.sway, flake.y, flake.radius, 0, Math.PI * 2);
            ctx.fill();
        }

        if (flakes.length || now - startTime < spawnMs) {
            requestAnimationFrame(frame);
            return;
        }

        window.removeEventListener('resize', resize);
        canvas.remove();
        onDone();
    };

    requestAnimationFrame(frame);
    return { spawn };
}

const SNOW_TAPS = 8;
const SNOW_TAP_GAP_MS = 400;

function initSnow(mapEl, onFound, isFound) {
    let isSnowing = false;
    // Also covers guests who can't earn points (their finds are never recorded).
    let hasSnowed = false;

    const snow = () => {
        isSnowing = true;
        hasSnowed = true;
        onFound('snow', { delayMs: 1500 });
        playMapSound('twinkle', 0, { rate: 0.8, volume: 0.6 });
        letItSnow(() => {
            isSnowing = false;
        });
    };

    // Tapping quickly: for browsers without motion events. Eggs and buttons break the streak.
    const sheetEl = mapEl.querySelector('[data-map-sheet]');
    let taps = [];
    // Teaser until the egg is found: every tap lets one flake fall. Taps share one canvas while flakes are falling.
    let teaser = null;
    const teaseFlake = () => {
        if (teaser) {
            teaser.spawn();
            return;
        }

        teaser = letItSnow(() => {
            teaser = null;
        }, { spawnMs: 0, flakes: 1 });
    };

    if (sheetEl) {
        onPointerRelease(sheetEl, (down, event) => {
            const onControl = event.target instanceof Element && event.target.closest('a, button, [data-egg-compass], [data-egg-castle]');

            if (isSnowing || !isMapOpen(mapEl) || !isTapGesture(down, event) || onControl) {
                taps = [];
                return;
            }

            const now = event.timeStamp;
            taps = taps.length && now - taps[taps.length - 1] > SNOW_TAP_GAP_MS ? [now] : [...taps, now];

            if (taps.length >= SNOW_TAPS) {
                taps = [];
                snow();
            } else if (!hasSnowed && !isFound('snow')) {
                teaseFlake();
            }
        });
    }

    if (typeof window.DeviceMotionEvent === 'undefined') {
        return;
    }

    let peaks = [];

    window.addEventListener('devicemotion', (event) => {
        if (isSnowing || document.hidden) {
            return;
        }

        const linear = event.acceleration;
        const withGravity = event.accelerationIncludingGravity;
        let magnitude;

        if (linear && linear.x !== null) {
            magnitude = Math.hypot(linear.x, linear.y, linear.z);
        } else if (withGravity && withGravity.x !== null) {
            magnitude = Math.abs(Math.hypot(withGravity.x, withGravity.y, withGravity.z) - 9.81);
        } else {
            return;
        }

        const now = event.timeStamp;
        if (magnitude < SHAKE_ACCEL || (peaks.length && now - peaks[peaks.length - 1] < SHAKE_PEAK_GAP_MS)) {
            return;
        }

        peaks = [...peaks.filter((time) => now - time < SHAKE_WINDOW_MS), now];

        if (peaks.length >= SHAKE_PEAKS) {
            peaks = [];
            snow();
        }
    });
}

// ---------------------------------------------------------------------------------------------
// Flat: Nox / Lumos
// ---------------------------------------------------------------------------------------------

const FLAT_DEG = 10;
const LIFT_DEG = 22;
const FLAT_HOLD_MS = 1200;
const LIFT_HOLD_MS = 250;
// A swipe goes any direction (the sheet takes no pan, so no pull-to-refresh) and crosses at least
// this share of the visible map width. Vertical drags in the scrollable text scroll it instead.
const SWIPE_MIN_SHARE = 0.4;
const SWIPE_MAX_MS = 800;
const DARK_ALPHA = 0.92;
const IRIS_FEATHER_PX = 170;
const SMOKE_PATHS = [
    'M20 118C14 104 27 96 21 82S12 60 20 48 28 26 19 10',
    'M20 118C25 106 15 94 21 80S29 58 21 44 13 22 22 4'
];

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOut = (t) => 1 - (1 - t) ** 2;

function createNoxOverlay() {
    const rootEl = document.createElement('div');
    rootEl.setAttribute('aria-hidden', 'true');
    rootEl.className = 'pointer-events-none fixed inset-0 z-[60] hidden overflow-hidden';
    rootEl.innerHTML = `
        <div data-nox-iris class="absolute inset-0"></div>
        <div class="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2">
            <div data-nox-ember class="h-full w-full rounded-full opacity-0 bg-[radial-gradient(circle,rgba(255,246,220,1)_0%,rgba(255,196,92,0.85)_22%,rgba(255,140,40,0.3)_48%,transparent_70%)]"></div>
        </div>
        <div class="absolute left-1/2 top-1/2 h-36 w-12 -translate-x-1/2 -translate-y-full">
            <svg data-nox-smoke viewBox="0 0 40 120" fill="none" stroke="rgba(225,225,225,0.7)" stroke-width="1.6" stroke-linecap="round"
                class="h-full w-full opacity-0 blur-[1.5px]">
                ${SMOKE_PATHS.map((d) => `<path d="${d}" />`).join('')}
            </svg>
        </div>
        <div class="absolute inset-x-0 top-[56%] flex justify-center">
            <p data-nox-word class="font-inkpot text-4xl text-amber-100 opacity-0 [text-shadow:0_0_18px_rgba(255,196,92,0.8)]"></p>
        </div>
        <div class="absolute inset-x-0 bottom-[max(3rem,env(safe-area-inset-bottom))] flex justify-center px-6">
            <p data-nox-hint lang="en" class="max-w-xs text-center font-inkpot text-xl text-amber-100/80 opacity-0 [text-shadow:0_0_12px_rgba(255,196,92,0.6)]"></p>
        </div>`;
    document.body.append(rootEl);

    return {
        rootEl,
        irisEl: rootEl.querySelector('[data-nox-iris]'),
        emberEl: rootEl.querySelector('[data-nox-ember]'),
        smokeEl: rootEl.querySelector('[data-nox-smoke]'),
        smokePathEls: [...rootEl.querySelectorAll('[data-nox-smoke] path')],
        wordEl: rootEl.querySelector('[data-nox-word]'),
        hintEl: rootEl.querySelector('[data-nox-hint]')
    };
}

function initNoxLumos(mapEl, onFound) {
    let overlay = null;
    let state = 'lit'; // lit | dousing | dark | lighting
    let irisRadius = 0;
    let irisToken = 0;
    let effects = [];
    let flatTimer = null;
    let liftTimer = null;
    // Swiped dark: only a swipe (or closing the map) lights it again, not holding the phone up.
    let swipedDark = false;
    // Swiped light while the phone lay flat: it has to be picked up before laying it flat counts again.
    let needsLift = false;

    const fullRadius = () => Math.hypot(window.innerWidth, window.innerHeight) / 2 + IRIS_FEATHER_PX;

    // The light is a hole in the darkness; radius 0 means fully dark.
    const setIris = (radius) => {
        irisRadius = Math.max(0, radius);
        overlay.irisEl.style.background = `radial-gradient(circle at 50% 50%, rgba(0,0,0,0) ${irisRadius}px, rgba(0,0,0,${DARK_ALPHA}) ${irisRadius + IRIS_FEATHER_PX}px)`;
    };

    // Moves the iris through [progress, radius] stops; resolves false when interrupted.
    const tweenIris = (duration, stops, ease = easeInOut) => {
        const token = ++irisToken;
        const startTime = performance.now();

        return new Promise((resolve) => {
            const frame = (now) => {
                if (token !== irisToken) {
                    resolve(false);
                    return;
                }

                const t = Math.min(1, (now - startTime) / duration);
                const next = stops.findIndex(([at]) => at >= t);
                const [fromAt, fromRadius] = stops[Math.max(0, next - 1)];
                const [toAt, toRadius] = stops[next];
                const local = toAt === fromAt ? 1 : (t - fromAt) / (toAt - fromAt);
                setIris(fromRadius + (toRadius - fromRadius) * ease(local));

                if (t < 1) {
                    requestAnimationFrame(frame);
                } else {
                    resolve(true);
                }
            };
            requestAnimationFrame(frame);
        });
    };

    const play = (el, keyframes, options) => {
        const animation = el.animate(keyframes, { fill: 'forwards', ...options });
        effects.push(animation);
        return animation;
    };

    const clearEffects = () => {
        effects.forEach((animation) => animation.cancel());
        effects = [];
    };

    const showWord = (text, delay) => {
        overlay.wordEl.textContent = text;
        play(overlay.wordEl, [
            { opacity: 0, filter: 'blur(6px)', letterSpacing: '0.45em' },
            { opacity: 0.85, filter: 'blur(0px)', letterSpacing: '0.1em', offset: 0.3 },
            { opacity: 0.85, filter: 'blur(0px)', letterSpacing: '0.12em', offset: 0.6 },
            { opacity: 0, filter: 'blur(8px)', letterSpacing: '0.25em' }
        ], { duration: 1900, delay, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
    };

    // In the dark, tell the guest how to get the light back: the same gesture that put it out.
    const showHint = () => {
        overlay.hintEl.textContent = swipedDark ? 'Swipe again to cast Lumos' : 'Pick up your phone or swipe to cast Lumos';
        const fadeIn = { opacity: 0.85, offset: 0.25 };
        play(overlay.hintEl, reduceMotion()
            ? [{ opacity: 0 }, fadeIn, { opacity: 0.85 }]
            : [{ opacity: 0 }, fadeIn, { opacity: 0.45, offset: 0.6 }, { opacity: 0.85 }],
        { duration: 2400, delay: reduceMotion() ? 0 : 2400, easing: 'ease-in-out' });
    };

    const nox = async () => {
        overlay ??= createNoxOverlay();
        state = 'dousing';
        clearEffects();
        overlay.rootEl.classList.remove('hidden');
        void speakSpell('nox');
        const full = fullRadius();
        // Start where the darkness just touches the corners, so it is visible from the first frame.
        const start = full - IRIS_FEATHER_PX;
        setIris(start);

        if (reduceMotion()) {
            await tweenIris(700, [[0, start], [1, 0]], easeOut);
        } else {
            // The light shrinks smoothly to a single ember.
            const shrink = tweenIris(2400, [[0, start], [1, 0]], easeOut);
            play(overlay.emberEl, [
                { opacity: 0, transform: 'scale(0.6)' },
                { opacity: 0.9, transform: 'scale(1)', offset: 0.3 },
                { opacity: 0, transform: 'scale(0.2)' }
            ], { duration: 1300, delay: 1600, easing: 'ease-in-out' });
            overlay.smokePathEls.forEach((pathEl, i) => {
                const length = pathEl.getTotalLength();
                pathEl.style.strokeDasharray = `${length}px`;
                play(pathEl, [{ strokeDashoffset: `${length}px` }, { strokeDashoffset: '0px' }], { duration: 2400, delay: 2300 + i * 260, easing: 'ease-out' });
            });
            play(overlay.smokeEl, [
                { opacity: 0, transform: 'translateY(0) scaleX(1)' },
                { opacity: 0.6, transform: 'translateY(-10%) scaleX(1.1)', offset: 0.3 },
                { opacity: 0, transform: 'translateY(-35%) scaleX(1.6)' }
            ], { duration: 3000, delay: 2300, easing: 'ease-out' });
            showWord('Nox', 2700);

            if (!(await shrink)) {
                return;
            }
        }

        if (state === 'dousing') {
            state = 'dark';
            showHint();
        }
    };

    const lumos = async () => {
        if (!overlay || state === 'lit' || state === 'lighting') {
            return;
        }

        state = 'lighting';
        swipedDark = false;
        // Read the hint's opacity before clearEffects drops it, so it fades instead of blinking out.
        const hintFade = fadeOutFromCurrent(overlay.hintEl, { duration: 400 });
        clearEffects();
        effects.push(hintFade);
        const from = irisRadius;
        const full = fullRadius();
        playMapSound('twinkle', 0, { rate: 1.05 });
        const voiceDone = speakSpell('lumos');

        let done;
        if (reduceMotion()) {
            done = await tweenIris(700, [[0, from], [1, full]]);
        } else {
            // A spark at the wand tip, then the light flickers back out to the edges.
            play(overlay.emberEl, [
                { opacity: 0, transform: 'scale(0.2)' },
                { opacity: 1, transform: 'scale(1.5)', offset: 0.35 },
                { opacity: 0, transform: 'scale(2.4)' }
            ], { duration: 700, easing: 'ease-out' });
            showWord('Lumos', 150);
            done = await tweenIris(1600, [[0, from], [0.2, full * 0.25], [0.3, full * 0.18], [0.55, full * 0.62], [0.65, full * 0.55], [1, full]]);
        }

        if (done && state === 'lighting') {
            state = 'lit';
            // Rewarded once the light is back (otherwise nobody sees it) and Dumbledore has finished
            // the incantation, so his reward line doesn't talk over it. Dark again by then: the next Lumos rewards.
            void voiceDone.then(() => {
                if (state === 'lit') {
                    onFound('nox', { delayMs: 0 });
                }
            });
            window.setTimeout(() => {
                if (state === 'lit') {
                    clearEffects();
                    overlay.rootEl.classList.add('hidden');
                }
            }, 1800);
        }
    };

    const clearTimers = () => {
        window.clearTimeout(flatTimer);
        window.clearTimeout(liftTimer);
        flatTimer = null;
        liftTimer = null;
    };

    const sheetEl = mapEl.querySelector('[data-map-sheet]');

    if (sheetEl) {
        onPointerRelease(sheetEl, (down, event) => {
            const distance = Math.hypot(event.clientX - down.x, event.clientY - down.y);
            const minDistance = Math.min(window.innerWidth, sheetEl.getBoundingClientRect().width) * SWIPE_MIN_SHARE;
            // Dragging with the mouse to select text is not a swipe.
            const isSelecting = Boolean(window.getSelection()?.toString());

            if (distance < minDistance || event.timeStamp - down.time > SWIPE_MAX_MS || isSelecting || !isMapOpen(mapEl)) {
                return;
            }

            clearTimers();

            if (state === 'lit') {
                swipedDark = true;
                void nox();
            } else if (state === 'dousing' || state === 'dark') {
                needsLift = true;
                void lumos();
            }
        });
    }

    window.addEventListener('deviceorientation', (event) => {
        if (event.beta === null || event.gamma === null) {
            return;
        }

        const tilt = Math.max(Math.abs(event.beta), Math.abs(event.gamma));

        if (needsLift) {
            needsLift = tilt <= LIFT_DEG;
            return;
        }

        if (state === 'lit') {
            if (tilt < FLAT_DEG && isMapOpen(mapEl) && !document.hidden) {
                flatTimer ??= window.setTimeout(() => {
                    flatTimer = null;
                    if (state === 'lit' && isMapOpen(mapEl)) {
                        void nox();
                    }
                }, FLAT_HOLD_MS);
            } else {
                clearTimers();
            }
            return;
        }

        if ((state === 'dousing' || state === 'dark') && !swipedDark) {
            if (tilt > LIFT_DEG) {
                liftTimer ??= window.setTimeout(() => {
                    liftTimer = null;
                    void lumos();
                }, LIFT_HOLD_MS);
            } else {
                window.clearTimeout(liftTimer);
                liftTimer = null;
            }
        }
    });

    // Closing the map always brings the light back.
    new MutationObserver(() => {
        if (!isMapOpen(mapEl)) {
            clearTimers();
            void lumos();
        }
    }).observe(mapEl, { attributes: true, attributeFilter: ['data-state'] });
}

// ---------------------------------------------------------------------------------------------
// Revelio & Mischief managed: the spells themselves count as secrets too.
// ---------------------------------------------------------------------------------------------

// Delays let the spell's own effect play first (REVEAL_DELAY_MS in map-reveal.js, the folding map in map.js).
const REVELIO_REWARD_DELAY_MS = 1800;
const MISCHIEF_REWARD_DELAY_MS = 1400;

function initSpells(mapEl, onFound) {
    const revealRootEl = document.querySelector('[data-map-reveal-root]');
    const revealButtonEl = document.querySelector('[data-map-reveal]');
    const closeButtonEl = document.querySelector('[data-map-close]');

    // Capture phase: read the state before map-reveal.js / map.js change it.
    revealButtonEl?.addEventListener('click', () => {
        if (revealRootEl instanceof HTMLElement && revealRootEl.dataset.spell === 'hidden') {
            onFound('revelio', { point: centerOf(revealButtonEl), delayMs: REVELIO_REWARD_DELAY_MS });
        }
    }, true);

    closeButtonEl?.addEventListener('click', () => {
        if (isMapOpen(mapEl)) {
            onFound('mischief', { point: centerOf(closeButtonEl), delayMs: MISCHIEF_REWARD_DELAY_MS });
        }
    }, true);
}

export function initMapEasterEggs(mapEl, { footsteps, guestName, onFound = () => {}, isFound = () => false } = {}) {
    initCompass(mapEl, onFound);
    initFootstepNames(mapEl, footsteps, guestName, onFound);
    initCastle(mapEl, onFound);
    initSnow(mapEl, onFound, isFound);
    initNoxLumos(mapEl, onFound);
    initSpells(mapEl, onFound);
}
