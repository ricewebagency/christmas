import { fetchDishCatalog } from './api-client.js';
import { formatChangeDeadline, guardPage, leaveGreatHall, whenDomReady } from './guest-flow.js';
import { initMapChangesDialog } from './map-changes.js';
import { initMapEasterEggs } from './map-easter-eggs.js';
import { initMapFinale } from './map-finale.js';
import { initMapFootsteps } from './map-footsteps.js';
import { initHouseCup } from './house-cup.js';
import { initMapReveal } from './map-reveal.js';
import { runRevealExitSequence, setupLinkExitTransition } from './page-transitions.js';
import { createEggRewards } from './map-rewards.js';
import { playMapSound, preloadMapSounds } from './map-sounds.js';
import './click-pop.js';

const SCREEN_LOADER_SELECTOR = '[data-screen-loader]';
const SCREEN_LOADER_DURATION_MS = 2400;
// Same exit as the /invite letter: lines fade out with a random stagger.
const DECLINED_EXIT_FADE_DURATION_MS = 600;
const DECLINED_EXIT_DELAY_OPTIONS_MS = [0, 250, 500, 750];
const getDeclinedExitDelayMs = () =>
    DECLINED_EXIT_DELAY_OPTIONS_MS[Math.floor(Math.random() * DECLINED_EXIT_DELAY_OPTIONS_MS.length)];
const MAP_CLOSED_VIEWPORT_WIDTH_RATIO = 0.92;
// Peek window within the mapPeek keyframes (tailwind.config.js: 25% to 60%).
const MAP_PEEK_START = 0.25;
const MAP_PEEK_END = 0.6;
// The flap lifts twice per peek: from 25% and again from 43% (tailwind.config.js).
const MAP_PEEK_LIFTS = [MAP_PEEK_START, 0.43];
// Start the peek sound slightly before each lift so it lines up with the visible motion.
const MAP_PEEK_SOUND_LEAD_MS = 100;
// Longest closing transition: scale delay 1000ms + 1600ms duration.
const MAP_CLOSE_DURATION_MS = 2700;
// Flap delays in map/index.html (open: bottom 300ms, top 1000ms; closing: the reverse).
// Each fold gets its own pitch and loudness, with a little randomness, so they don't sound identical.
// The second fold is also shorter: a slow swell in and a quick cut-off.
const MAP_FLAP_SOUNDS = [
    { delay: 300, rate: 1.12, volume: 0.9 },
    { delay: 1000, rate: 0.78, volume: 1, fadeInMs: 350, fadeAfterMs: 550, fadeMs: 150 }
];

const playFlapSounds = (sounds = MAP_FLAP_SOUNDS) => sounds.forEach(({ delay, rate, ...options }) => {
    playMapSound('paper', delay, { ...options, rate: rate + (Math.random() - 0.5) * 0.08 });
});

function initScreenLoader(onDone) {
    const loaderEl = document.querySelector(SCREEN_LOADER_SELECTOR);

    if (!(loaderEl instanceof HTMLElement)) {
        onDone();
        return;
    }

    let isDone = false;
    const finish = () => {
        if (isDone) {
            return;
        }

        isDone = true;
        loaderEl.remove();
        onDone();
    };

    loaderEl.addEventListener('animationend', finish, { once: true });
    window.setTimeout(finish, SCREEN_LOADER_DURATION_MS + 250);
}

function updateClosedScale(mapEl, scaleEl) {
    const sheetWidth = scaleEl.offsetWidth;

    if (!sheetWidth) {
        return;
    }

    const scale = Math.min(1, (window.innerWidth * MAP_CLOSED_VIEWPORT_WIDTH_RATIO) / sheetWidth);
    mapEl.style.setProperty('--map-closed-scale', scale.toFixed(4));
}

function initMap(guest, houseCup) {
    const mapEl = document.querySelector('[data-map]');
    const scaleEl = document.querySelector('[data-map-scale]');
    const openButton = document.querySelector('[data-map-open]');

    if (!(mapEl instanceof HTMLElement) || !(scaleEl instanceof HTMLElement)) {
        return;
    }

    updateClosedScale(mapEl, scaleEl);
    const footsteps = initMapFootsteps(mapEl);
    // Set up below, once openMap exists.
    let finale = null;
    const rewards = createEggRewards(guest, {
        onStandings: (points, foundCount) => houseCup?.update(points, foundCount),
        cup: houseCup,
        onAllFound: (result) => void finale?.play(result)
    });
    initMapEasterEggs(mapEl, { footsteps, onFound: rewards.found, isFound: rewards.hasFound });
    const mapReveal = initMapReveal({ isFound: () => rewards.hasFound('revelio') });
    preloadMapSounds();
    window.addEventListener('resize', () => updateClosedScale(mapEl, scaleEl));

    initScreenLoader(() => {
        if (mapEl.dataset.state === 'loading') {
            mapEl.dataset.state = 'closed';
        }
    });

    const bottomFlapEl = document.querySelector('[data-map-flap="bottom"]');
    let isOpening = false;
    let hasPeeked = false;

    // One peek sound per flap lift in each mapPeek iteration (MAP_PEEK_LIFTS).
    // Only the first peek plays at full volume; later ones at half.
    const schedulePeekSound = (event) => {
        if (event.animationName !== 'mapPeek' || event.target !== bottomFlapEl) {
            return;
        }

        const volume = hasPeeked ? 0.5 : 1;
        hasPeeked = true;
        const peekDurationMs = getPeekDurationMs(bottomFlapEl);
        MAP_PEEK_LIFTS.forEach((lift) => {
            window.setTimeout(() => {
                if (mapEl.dataset.state === 'closed' && !isOpening) {
                    playMapSound('peek', 0, { volume });
                }
            }, Math.max(0, lift * peekDurationMs - MAP_PEEK_SOUND_LEAD_MS));
        });
    };

    bottomFlapEl?.addEventListener('animationstart', schedulePeekSound);
    bottomFlapEl?.addEventListener('animationiteration', schedulePeekSound);

    const openMap = () => {
        if (isOpening || ['open', 'closing'].includes(mapEl.dataset.state)) {
            return;
        }

        isOpening = true;
        window.setTimeout(() => {
            // Stop the peek animation first; removing it in the same frame as the open
            // transform prevents the flap transition from starting.
            mapEl.dataset.state = 'ready';

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    mapEl.dataset.state = 'open';
                    playFlapSounds();
                });
            });
        }, getRemainingPeekMs(bottomFlapEl));
    };

    openButton?.addEventListener('click', openMap);
    finale = initMapFinale(guest, { mapEl, openMap, cup: houseCup, onNote: (result) => rewards.allFound(result) });

    const closeButton = document.querySelector('[data-map-close]');

    closeButton?.addEventListener('click', () => {
        if (mapEl.dataset.state !== 'open') {
            return;
        }

        // 'closing' reverses the open sequence via its own delays (see map/index.html).
        mapEl.dataset.state = 'closing';
        playFlapSounds();
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        window.setTimeout(() => {
            mapEl.dataset.state = 'closed';
            mapReveal.reset();
            isOpening = false;
            if (openButton instanceof HTMLElement) {
                openButton.focus({ preventScroll: true });
            }
        }, reduceMotion ? 0 : MAP_CLOSE_DURATION_MS);
    });
}

const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' });

function capitalize(value) {
    const text = String(value ?? '');
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function setLines(el, lines) {
    el.replaceChildren(...lines.flatMap((line, index) => (index ? [document.createElement('br'), line] : [line])));
}

function renderEventDetails(guest) {
    const whenEl = document.querySelector('[data-map-when]');

    if (!(whenEl instanceof HTMLElement)) {
        return;
    }

    const eventDate = new Date(guest?.eventDate ?? '');

    if (Number.isNaN(eventDate.getTime())) {
        return;
    }

    const dateLabel = eventDate.getMonth() === 11 && eventDate.getDate() === 24
        ? `Christmas Eve, ${DATE_FORMAT.format(eventDate)}`
        : DATE_FORMAT.format(eventDate);

    const timeEl = document.createElement('span');
    timeEl.className = 'text-xs text-charcoal/70 short:text-[10px]';
    timeEl.textContent = `(from ${TIME_FORMAT.format(eventDate)})`;

    setLines(whenEl, [dateLabel, timeEl]);
}

// Maps dish id -> { name, course } in catalog order.
function indexDishCatalog(courses) {
    const dishIndex = new Map();

    courses.forEach((course) => {
        const dishes = Array.isArray(course?.dishes) ? course.dishes : [];
        dishes.forEach((dish) => {
            dishIndex.set(String(dish?.id ?? '').trim(), {
                name: dish?.name || dish?.name_nl || '',
                course: course?.course || course?.course_nl || ''
            });
        });
    });

    return dishIndex;
}

function appendDishRow(listEl, course, name) {
    const rowEl = document.createElement('div');

    const termEl = document.createElement('dt');
    termEl.className = 'text-[10px] italic text-charcoal/70';
    termEl.textContent = course;

    const detailEl = document.createElement('dd');
    detailEl.textContent = name;

    rowEl.append(termEl, detailEl);
    listEl.append(rowEl);
}

async function renderGuestFeast(guest) {
    const guestNameEl = document.querySelector('[data-map-guest-name]');
    const guestHouseEl = document.querySelector('[data-map-guest-house]');
    const dishesEl = document.querySelector('[data-map-dishes]');
    const { guestName, house, dishIds = [], customDish = null } = guest ?? {};

    if (guestNameEl instanceof HTMLElement) {
        guestNameEl.textContent = guestName || 'Guest';
    }

    if (guestHouseEl instanceof HTMLElement && house) {
        guestHouseEl.textContent = `of House ${capitalize(house)}`;
    }

    const catalogResponse = await fetchDishCatalog().catch((error) => {
        console.warn('Could not load the dishes catalog for the map.', error);
        return { data: [] };
    });

    if (!(dishesEl instanceof HTMLElement)) {
        return;
    }

    const dishIndex = indexDishCatalog(catalogResponse?.data ?? []);
    const catalogOrder = [...dishIndex.keys()];
    const selectedDishes = dishIds
        .filter((dishId) => dishIndex.has(dishId))
        .sort((a, b) => catalogOrder.indexOf(a) - catalogOrder.indexOf(b))
        .map((dishId) => dishIndex.get(dishId));

    if (customDish) {
        selectedDishes.push({ course: customDish.course, name: customDish.name });
    }

    dishesEl.replaceChildren();

    if (selectedDishes.length === 0) {
        const emptyEl = document.createElement('dd');
        emptyEl.className = 'italic text-charcoal/70';
        emptyEl.textContent = 'No dishes chosen yet';
        dishesEl.append(emptyEl);
        return;
    }

    selectedDishes.forEach((dish) => appendDishRow(dishesEl, dish.course, dish.name));
}

function getPeekDurationMs(flapEl) {
    const duration = parseFloat(window.getComputedStyle(flapEl).animationDuration);
    return Number.isFinite(duration) && duration > 0 ? duration * 1000 : 3600;
}

// Opening mid-peek skips the flap transition, so wait until the peek is back at rest.
function getRemainingPeekMs(flapEl) {
    if (!(flapEl instanceof HTMLElement) || typeof flapEl.getAnimations !== 'function') {
        return 0;
    }

    const peekAnimation = flapEl.getAnimations().find((animation) => animation.animationName === 'mapPeek');
    const timing = peekAnimation?.effect?.getComputedTiming();

    if (!timing || timing.progress === null) {
        return 0;
    }

    const isPeeking = timing.progress > MAP_PEEK_START && timing.progress < MAP_PEEK_END;
    return isPeeking ? Math.ceil((MAP_PEEK_END - timing.progress) * timing.duration) + 50 : 0;
}

function showElement(el, displayClass = 'block') {
    if (el instanceof HTMLElement) {
        el.classList.remove('hidden');
        el.classList.add(displayClass);
    }
}

// Before the deadline: "Make changes" opens the dialog (which shows the deadline). After: a sealed note.
function renderChangeControls(guest) {
    if (guest.canChange) {
        initMapChangesDialog({ deadline: formatChangeDeadline(guest) });
        return;
    }

    const noteEl = document.querySelector('[data-map-change-note]');

    if (noteEl instanceof HTMLElement) {
        noteEl.textContent = 'Your choices are sealed.';
    }

    showElement(document.querySelector('[data-map-changes]'), 'flex');
}

function initLeaveButtons() {
    document.querySelectorAll('[data-map-leave]').forEach((button) => {
        button.addEventListener('click', leaveGreatHall);
    });
}

// Declined guests get a thank-you letter instead of the map.
function renderDeclinedView(guest) {
    document.querySelectorAll('[data-map-view]').forEach((el) => el.classList.add('hidden'));

    const nameEl = document.querySelector('[data-map-declined-name]');
    const noteEl = document.querySelector('[data-map-declined-note]');

    if (nameEl instanceof HTMLElement) {
        nameEl.textContent = guest.guestName || 'Guest';
    }

    if (noteEl instanceof HTMLElement) {
        const deadline = formatChangeDeadline(guest);
        noteEl.textContent = guest.canChange
            ? `Should your plans change, you may send a new owl${deadline ? ` until ${deadline}` : ''}.`
            : 'Your response is sealed.';
    }

    if (guest.canChange) {
        showElement(document.querySelector('[data-map-declined-change]'), 'flex');
    }

    showElement(document.querySelector('[data-map-declined]'), 'flex');

    // The letter writes itself once the loader has swiped away, like /invite after the envelope.
    initScreenLoader(() => window.dispatchEvent(new CustomEvent('reveal-sequence:start')));

    setupLinkExitTransition({
        linkSelector: '[data-map-declined-change-link]',
        getDelayMs: () => runRevealExitSequence({
            fadeDurationMs: DECLINED_EXIT_FADE_DURATION_MS,
            getDelayMs: getDeclinedExitDelayMs
        })
    });
}

const BACKGROUND_HOUSES = ['gryffindor', 'hufflepuff', 'ravenclaw', 'slytherin'];

// Swaps the desk background for the guest's house (Tailwind data-[house=...] variants in map/index.html).
function renderHouseBackground(house) {
    const backgroundEl = document.querySelector('[data-map-background]');
    const key = String(house ?? '').toLowerCase();

    if (backgroundEl instanceof HTMLElement) {
        backgroundEl.dataset.house = BACKGROUND_HOUSES.includes(key) ? key : 'default';
    }
}

async function bootstrapMapPage() {
    const guest = await guardPage('map');

    if (!guest) {
        return;
    }

    await whenDomReady();
    initLeaveButtons();
    // For every guest, also declined ones (they get a notice instead of a house).
    const houseCup = initHouseCup(guest);

    if (guest.rsvpStatus === 'declined') {
        renderDeclinedView(guest);
        return;
    }

    renderHouseBackground(guest.house);
    initMap(guest, houseCup);
    renderEventDetails(guest);
    renderChangeControls(guest);
    renderGuestFeast(guest).catch((error) => console.warn('Could not render the guest feast.', error));
}

void bootstrapMapPage();
