import { fetchDishCatalog } from './api-client.js';
import { formatChangeDeadline, guardPage, leaveGreatHall, whenDomReady } from './guest-flow.js';
import { initMapFootsteps } from './map-footsteps.js';

const SCREEN_LOADER_SELECTOR = '[data-screen-loader]';
const SCREEN_LOADER_DURATION_MS = 2400;
const MAP_CLOSED_VIEWPORT_WIDTH_RATIO = 0.92;
// Peek window within the mapPeek keyframes (tailwind.config.js: 25% to 60%).
const MAP_PEEK_START = 0.25;
const MAP_PEEK_END = 0.6;
// Longest closing transition: scale delay 1000ms + 1600ms duration.
const MAP_CLOSE_DURATION_MS = 2700;

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

function initMap() {
    const mapEl = document.querySelector('[data-map]');
    const scaleEl = document.querySelector('[data-map-scale]');
    const openButton = document.querySelector('[data-map-open]');

    if (!(mapEl instanceof HTMLElement) || !(scaleEl instanceof HTMLElement)) {
        return;
    }

    updateClosedScale(mapEl, scaleEl);
    initMapFootsteps(mapEl);
    window.addEventListener('resize', () => updateClosedScale(mapEl, scaleEl));

    initScreenLoader(() => {
        if (mapEl.dataset.state === 'loading') {
            mapEl.dataset.state = 'closed';
        }
    });

    const bottomFlapEl = document.querySelector('[data-map-flap="bottom"]');
    let isOpening = false;

    openButton?.addEventListener('click', () => {
        if (isOpening) {
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
                });
            });
        }, getRemainingPeekMs(bottomFlapEl));
    });

    const closeButton = document.querySelector('[data-map-close]');

    closeButton?.addEventListener('click', () => {
        if (mapEl.dataset.state !== 'open') {
            return;
        }

        // 'closing' reverses the open sequence via its own delays (see map/index.html).
        mapEl.dataset.state = 'closing';
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        window.setTimeout(() => {
            mapEl.dataset.state = 'closed';
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

    setLines(whenEl, [dateLabel, `Doors open at ${TIME_FORMAT.format(eventDate)}`]);
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
    const { guestName, house, dishIds = [] } = guest ?? {};

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

function getChangeNote(guest) {
    if (!guest.canChange) {
        return guest.rsvpStatus === 'declined' ? 'Your response is sealed.' : 'Your choices are sealed.';
    }

    const deadline = formatChangeDeadline(guest);
    return deadline ? `Changes possible until ${deadline}` : '';
}

function renderChangeControls(guest) {
    const noteEl = document.querySelector('[data-map-change-note]');

    if (noteEl instanceof HTMLElement) {
        noteEl.textContent = getChangeNote(guest);
    }

    showElement(document.querySelector('[data-map-changes]'), 'flex');

    if (guest.canChange) {
        showElement(document.querySelector('[data-map-change-dishes]'), 'inline-block');
        showElement(document.querySelector('[data-map-change-response]'), 'inline-block');
    }
}

function initLeaveButtons() {
    document.querySelectorAll('[data-map-leave]').forEach((button) => {
        button.addEventListener('click', leaveGreatHall);
    });
}

// Declined guests get a thank-you letter instead of the map.
function renderDeclinedView(guest) {
    document.querySelectorAll('[data-map-view]').forEach((el) => el.classList.add('hidden'));

    const loaderEl = document.querySelector(SCREEN_LOADER_SELECTOR);
    loaderEl?.addEventListener('animationend', () => loaderEl.remove(), { once: true });

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
        showElement(document.querySelector('[data-map-declined-change]'), 'inline-flex');
    }

    showElement(document.querySelector('[data-map-declined]'), 'flex');
}

async function bootstrapMapPage() {
    const guest = await guardPage('map');

    if (!guest) {
        return;
    }

    await whenDomReady();
    initLeaveButtons();

    if (guest.rsvpStatus === 'declined') {
        renderDeclinedView(guest);
        return;
    }

    initMap();
    renderEventDetails(guest);
    renderChangeControls(guest);
    renderGuestFeast(guest).catch((error) => console.warn('Could not render the guest feast.', error));
}

void bootstrapMapPage();
