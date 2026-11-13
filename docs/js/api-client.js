import { readJsonFromLocalStorage, removeLocalStorageItem, writeJsonToLocalStorage } from './storage-utils.js?v=77af242fad';

// Empty = mock mode (state in localStorage). Example: 'https://<function-app>.azurewebsites.net'.
// Local dev origins (localhost/127.0.0.1:8000) must be in the Function App's CORS list.
export const API_BASE_URL = 'https://magicalwinterbanquetapi20261108231610-btbjadbzavbybubk.westeurope-01.azurewebsites.net';

const GUEST_CODE_STORAGE_KEY = 'christmas-at-the-great-hall.guest-code';
// Read by audio-toggle.js (classic script) to show the admin button; keep the key in sync there.
const GUEST_ADMIN_STORAGE_KEY = 'christmas-at-the-great-hall.guest-is-admin';
const GUEST_ADMIN_EVENT = 'guest-admin-change';
const GUEST_CODE_PATTERN = /^[0-9]{4}$/;
const HOUSES = ['gryffindor', 'hufflepuff', 'ravenclaw', 'slytherin'];
const RSVP_STATUSES = ['pending', 'accepted', 'declined'];
// Keep in sync with EasterEggs.All in the API.
const EASTER_EGG_IDS = ['compass', 'footsteps', 'castle', 'snow', 'nox', 'revelio', 'mischief'];
const HOUSE_POINTS_PER_EGG = 10;
// Keep in sync with EasterEggs.SortingPoints in the API: once for the house when the guest is sorted.
export const SORTING_HOUSE_POINTS = 10;
// Keep in sync with EasterEggs.CompletionBonus in the API: for finding every egg (fired with the finale).
export const COMPLETION_BONUS_POINTS = 20;
export const EASTER_EGG_COUNT = EASTER_EGG_IDS.length;
const DISH_CATALOG_URL = new URL('../assets/files/dishes.json', import.meta.url);

export class ApiError extends Error {
    constructor(status, code, message, details = {}) {
        super(message || code);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.retryAfterSeconds = details.retryAfterSeconds ?? null;
        this.takenDishIds = details.takenDishIds ?? [];
    }
}

export function isApiError(error, status = null) {
    return error instanceof ApiError && (status === null || error.status === status);
}

// ---------- Guest code ----------

export function normalizeGuestCode(value) {
    const code = String(value ?? '').replace(/\s+/g, '');
    return GUEST_CODE_PATTERN.test(code) ? code : null;
}

export function getStoredGuestCode() {
    return normalizeGuestCode(readJsonFromLocalStorage(GUEST_CODE_STORAGE_KEY, null));
}

export function setGuestCode(code) {
    const normalizedCode = normalizeGuestCode(code);

    if (normalizedCode) {
        writeJsonToLocalStorage(GUEST_CODE_STORAGE_KEY, normalizedCode);
    }

    return normalizedCode;
}

export function clearGuestCode() {
    removeLocalStorageItem(GUEST_CODE_STORAGE_KEY);
    rememberGuestAdmin(false);
    guestPromise = null;
}

function rememberGuestAdmin(isAdmin) {
    if (isAdmin) {
        writeJsonToLocalStorage(GUEST_ADMIN_STORAGE_KEY, true);
    } else {
        removeLocalStorageItem(GUEST_ADMIN_STORAGE_KEY);
    }

    window.dispatchEvent(new CustomEvent(GUEST_ADMIN_EVENT, { detail: { isAdmin } }));
}

// Raw ?code value (may be invalid), or null when absent.
export function readGuestCodeFromUrl() {
    const value = new URLSearchParams(window.location.search).get('code');
    return value === null ? null : value;
}

export function removeGuestCodeFromUrl() {
    const url = new URL(window.location.href);

    if (!url.searchParams.has('code')) {
        return;
    }

    url.searchParams.delete('code');
    window.history.replaceState(window.history.state, '', url.href);
}

// ---------- Normalization ----------

function normalizeHouse(value) {
    const house = String(value ?? '').trim().toLowerCase();
    return HOUSES.includes(house) ? house : null;
}

function normalizeRsvpStatus(value) {
    const status = String(value ?? '').trim().toLowerCase();

    if (status === 'yes') {
        return 'accepted';
    }

    if (status === 'no') {
        return 'declined';
    }

    return RSVP_STATUSES.includes(status) ? status : null;
}

function normalizeDishIds(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return Array.from(new Set(
        value
            .map((item) => String(item ?? '').trim())
            .filter((item) => item.length > 0)
    ));
}

// Keep in sync with GuestService.MaxCustomDish*Length in the API.
export const CUSTOM_DISH_NAME_MAX_LENGTH = 60;
export const CUSTOM_DISH_DESCRIPTION_MAX_LENGTH = 150;

function cleanText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

// { name, course, description } or null.
export function normalizeCustomDish(value) {
    const name = cleanText(value?.name);
    const course = cleanText(value?.course);

    if (!name || !course) {
        return null;
    }

    return { name, course, description: cleanText(value?.description) || null };
}

function normalizeCustomDishes(value) {
    return Array.isArray(value) ? value.map(normalizeCustomDish).filter(Boolean) : [];
}

function normalizeEggIds(value) {
    return Array.isArray(value)
        ? EASTER_EGG_IDS.filter((eggId) => value.includes(eggId))
        : [];
}

// Points per house; every house is present (0 when missing).
function normalizeHousePoints(value) {
    return Object.fromEntries(HOUSES.map((house) => [house, Math.max(0, Number(value?.[house]) || 0)]));
}

function normalizeGuestState(data = {}) {
    const house = normalizeHouse(data.house);

    return {
        code: normalizeGuestCode(data.code),
        guestName: String(data.guestName ?? '').trim() || 'Guest',
        eventDate: data.eventDate ?? null,
        location: data.location ?? '',
        rsvpStatus: normalizeRsvpStatus(data.rsvpStatus) ?? 'pending',
        house,
        department: house,
        dishIds: normalizeDishIds(data.dishIds),
        // null = no limit.
        maxDishesPerGuest: Number.isInteger(data.maxDishesPerGuest) && data.maxDishesPerGuest > 0 ? data.maxDishesPerGuest : null,
        customDish: normalizeCustomDish(data.customDish),
        // false when the API doesn't send it (older API version).
        customDishAllowed: data.customDishAllowed === true,
        changeDeadline: data.changeDeadline ?? null,
        canChange: Boolean(data.canChange),
        isAdmin: Boolean(data.isAdmin),
        foundEggIds: normalizeEggIds(data.foundEggIds),
        housePoints: normalizeHousePoints(data.housePoints)
    };
}

function getCabinImageForHouse(house) {
    return `./assets/images/hogwarts-express-cabin-front-${normalizeHouse(house) ?? 'gryffindor'}.png`;
}

// ---------- HTTP ----------

async function request(method, path, body) {
    let response;

    try {
        response = await fetch(`${API_BASE_URL}${path}`, {
            method,
            headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
            cache: 'no-store'
        });
    } catch {
        throw new ApiError(0, 'network_error', 'The owls could not reach the castle.');
    }

    let data = null;

    try {
        data = await response.json();
    } catch {
        data = null;
    }

    if (!response.ok) {
        const retryAfterHeader = Number(response.headers.get('Retry-After'));
        const retryAfterSeconds = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
            ? retryAfterHeader
            : Number(data?.retryAfterSeconds) || null;

        throw new ApiError(response.status, data?.error || 'http_error', data?.message || `Request failed: ${response.status}`, {
            retryAfterSeconds,
            takenDishIds: normalizeDishIds(data?.takenDishIds)
        });
    }

    return data;
}

function requireGuestCode() {
    const code = getStoredGuestCode();

    if (!code) {
        throw new ApiError(401, 'missing_guest_code', 'No guest code is known.');
    }

    return code;
}

const backend = {
    getGuest: (code) => request('GET', `/api/guests/${encodeURIComponent(code)}`),
    putRsvp: (code, rsvpStatus) => request('PUT', `/api/guests/${encodeURIComponent(code)}/rsvp`, { rsvpStatus }),
    putSorting: (code, payload) => request('PUT', `/api/guests/${encodeURIComponent(code)}/sorting`, payload),
    putDishes: (code, dishIds, customDish) => request('PUT', `/api/guests/${encodeURIComponent(code)}/dishes`, { dishIds, customDish }),
    getTakenDishes: (code) => request('GET', `/api/guests/${encodeURIComponent(code)}/dishes/taken`),
    getGuestNames: (code) => request('GET', `/api/guests/${encodeURIComponent(code)}/names`),
    putEgg: (code, eggId) => request('PUT', `/api/guests/${encodeURIComponent(code)}/eggs/${encodeURIComponent(eggId)}`),
    getDishes: () => request('GET', '/api/dishes')
};

function getBackend() {
    return API_BASE_URL ? backend : mockBackend;
}

// ---------- Activity log (shown to the organizer in /admin) ----------

// Keep in sync with ActivityTypes.Pages in the API. The home page only routes, so it gets no page_view.
const TRACKED_PAGES = ['home', 'invite', 'rsvp', 'sorting', 'map', 'cabin', 'chamber'];
let pageViewSent = false;

// Folder of the current page relative to the site root (<base href>): 'map', 'home', … or null when not tracked.
function getCurrentPage() {
    const basePath = new URL(document.baseURI).pathname;
    const path = window.location.pathname;

    if (!path.startsWith(basePath)) {
        return null;
    }

    const segment = path.slice(basePath.length).split('/')[0];
    const page = segment === '' || segment === 'index.html' ? 'home' : segment;
    return TRACKED_PAGES.includes(page) ? page : null;
}

// Fire-and-forget: never throws, never delays the page. Sent as text/plain so no CORS preflight is needed.
function sendGuestEvent(code, type, page = null) {
    if (!API_BASE_URL || !code) {
        return;
    }

    const url = `${API_BASE_URL}/api/guests/${encodeURIComponent(code)}/events`;
    const body = JSON.stringify(page ? { type, page } : { type });

    try {
        if (navigator.sendBeacon?.(url, body)) {
            return;
        }
    } catch {
        // Fall through to fetch.
    }

    fetch(url, { method: 'POST', body, keepalive: true, mode: 'no-cors' }).catch(() => {});
}

// Once per page load, as soon as the guest is known.
function trackPageView(code) {
    const page = getCurrentPage();

    if (pageViewSent || !page || page === 'home') {
        return;
    }

    pageViewSent = true;
    sendGuestEvent(code, 'page_view', page);
}

// ---------- Guest state (cached per page load) ----------

let guestPromise = null;

function cacheGuest(data) {
    const guest = normalizeGuestState(data);
    rememberGuestAdmin(guest.isAdmin);
    guestPromise = Promise.resolve(guest);
    return guest;
}

export async function verifyGuestCode(code) {
    const normalizedCode = String(code ?? '').replace(/\s+/g, '');
    const data = await getBackend().getGuest(normalizedCode);
    setGuestCode(normalizedCode);
    const guest = cacheGuest(data);
    sendGuestEvent(normalizedCode, 'sign_in', getCurrentPage());
    trackPageView(normalizedCode);
    return guest;
}

export function getGuest({ refresh = false } = {}) {
    if (!guestPromise || refresh) {
        const pending = (async () => {
            const code = requireGuestCode();
            const guest = normalizeGuestState(await getBackend().getGuest(code));
            rememberGuestAdmin(guest.isAdmin);
            trackPageView(code);
            return guest;
        })();

        guestPromise = pending;
        pending.catch(() => {
            if (guestPromise === pending) {
                guestPromise = null;
            }
        });
    }

    return guestPromise;
}

export async function sendAttendanceResponse(attendanceResponse) {
    const rsvpStatus = normalizeRsvpStatus(attendanceResponse);

    if (rsvpStatus !== 'accepted' && rsvpStatus !== 'declined') {
        throw new Error('Attendance response must be accepted or declined.');
    }

    return cacheGuest(await getBackend().putRsvp(requireGuestCode(), rsvpStatus));
}

export async function sendSortingHouseResult(result) {
    const house = normalizeHouse(result?.house);

    if (!house) {
        throw new Error('Sorting house is required.');
    }

    return cacheGuest(await getBackend().putSorting(requireGuestCode(), {
        house,
        scores: { ...(result?.scores ?? {}) },
        questionsAnswered: Number(result?.questionsAnswered ?? 0)
    }));
}

// payload: { dishIds, customDish? }. Leaving customDish out removes an earlier own dish.
export async function sendCabinDishSelection(payload) {
    const dishIds = normalizeDishIds(payload?.dishIds ?? payload?.dishSelection ?? []);
    const customDish = normalizeCustomDish(payload?.customDish);

    if (dishIds.length === 0 && !customDish) {
        throw new Error('At least one dish selection is required.');
    }

    return cacheGuest(await getBackend().putDishes(requireGuestCode(), dishIds, customDish));
}

// data: { dishIds, customDishes } — what other guests already bring.
export async function fetchTakenCabinDishIds() {
    const data = await getBackend().getTakenDishes(requireGuestCode());

    return {
        ok: true,
        status: 200,
        data: { dishIds: normalizeDishIds(data?.dishIds), customDishes: normalizeCustomDishes(data?.customDishes) }
    };
}

// Names of the other guests who are coming (footsteps on the map). Empty on any failure.
export async function fetchGuestNames() {
    try {
        const data = await getBackend().getGuestNames(requireGuestCode());
        return Array.isArray(data?.names)
            ? data.names.map((name) => String(name ?? '').trim()).filter(Boolean)
            : [];
    } catch {
        return [];
    }
}

// Reports a found easter egg. Resolves to { eggId, firstFind, pointsAwarded, bonusAwarded, house, housePoints, foundCount, totalEggs, allHousePoints }.
// bonusAwarded: the bonus for finding every egg, only on the first find of the last one (already in housePoints).
export async function sendEasterEggFound(eggId) {
    if (!EASTER_EGG_IDS.includes(eggId)) {
        throw new Error(`Unknown easter egg: ${eggId}`);
    }

    const data = await getBackend().putEgg(requireGuestCode(), eggId);
    return {
        eggId,
        firstFind: Boolean(data?.firstFind),
        pointsAwarded: Number(data?.pointsAwarded) || 0,
        bonusAwarded: Number(data?.bonusAwarded) || 0,
        house: normalizeHouse(data?.house),
        housePoints: Number(data?.housePoints) || 0,
        foundCount: Number(data?.foundCount) || 0,
        totalEggs: Number(data?.totalEggs) || EASTER_EGG_IDS.length,
        // null when the API doesn't send it (older API version).
        allHousePoints: data?.allHousePoints ? normalizeHousePoints(data.allHousePoints) : null
    };
}

async function loadStaticDishCatalog() {
    const response = await fetch(DISH_CATALOG_URL, { cache: 'no-store' });

    if (!response.ok) {
        throw new Error(`Failed to load dishes catalog: ${response.status}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
}

export async function fetchDishCatalog() {
    if (API_BASE_URL) {
        try {
            const data = await backend.getDishes();

            if (Array.isArray(data)) {
                return { ok: true, status: 200, data };
            }
        } catch (error) {
            console.warn('Falling back to the static dishes catalog.', error);
        }
    }

    return { ok: true, status: 200, data: await loadStaticDishCatalog() };
}

// ---------- Wrappers kept for existing pages ----------

export async function getInvitationData() {
    return getGuest();
}

export async function getCabinData() {
    const guest = await getGuest();

    return {
        guestName: guest.guestName,
        department: guest.house,
        cabinFrontImage: getCabinImageForHouse(guest.house),
        dishSelection: guest.dishIds
    };
}

export async function fetchCabinDishSelection() {
    const guest = await getGuest();

    return {
        ok: true,
        status: 200,
        data: {
            guestName: guest.guestName,
            department: guest.house,
            dishIds: guest.dishIds
        }
    };
}

// ---------- Mock backend (API_BASE_URL empty) ----------
// Only pin 2412 exists. 5 wrong codes within an hour block for an hour (clear localStorage to reset).

const MOCK_GUEST_STORAGE_KEY = 'christmas-at-the-great-hall.mock-guest';
const MOCK_ACCESS_STORAGE_KEY = 'christmas-at-the-great-hall.mock-access-attempts';
const MOCK_GUEST_CODE = '2412';
const MOCK_EVENT = {
    guestName: 'Maurice van Dorst',
    eventDate: '2026-12-24T18:00:00+01:00',
    location: 'Assendelft',
    changeDeadline: '2026-12-17T23:59:59+01:00'
};
const MOCK_RATE_LIMIT = { maxFailedAttempts: 5, windowMs: 60 * 60 * 1000, blockMs: 60 * 60 * 1000 };
const MOCK_LATENCY_MS = 150;

function mockDelay() {
    return new Promise((resolve) => {
        window.setTimeout(resolve, MOCK_LATENCY_MS);
    });
}

async function pickRandomCatalogDishIds(count) {
    try {
        const ids = (await loadStaticDishCatalog())
            .flatMap((course) => (Array.isArray(course?.dishes) ? course.dishes : []))
            .map((dish) => String(dish?.id ?? '').trim())
            .filter((id) => id.length > 0);

        for (let index = ids.length - 1; index > 0; index -= 1) {
            const randomIndex = Math.floor(Math.random() * (index + 1));
            [ids[index], ids[randomIndex]] = [ids[randomIndex], ids[index]];
        }

        return ids.slice(0, count);
    } catch {
        return ['1'];
    }
}

async function readMockGuest() {
    const stored = readJsonFromLocalStorage(MOCK_GUEST_STORAGE_KEY, null);

    if (stored && typeof stored === 'object') {
        return stored;
    }

    const initial = {
        code: MOCK_GUEST_CODE,
        guestName: MOCK_EVENT.guestName,
        rsvpStatus: 'pending',
        house: null,
        sortingScores: null,
        dishIds: [],
        // Dishes claimed by other (imaginary) guests.
        takenByOthers: await pickRandomCatalogDishIds(3)
    };

    writeJsonToLocalStorage(MOCK_GUEST_STORAGE_KEY, initial);
    return initial;
}

function writeMockGuest(guest) {
    writeJsonToLocalStorage(MOCK_GUEST_STORAGE_KEY, guest);
}

function mockCanChange() {
    return Date.now() < new Date(MOCK_EVENT.changeDeadline).getTime();
}

function toMockGuestState(guest) {
    return {
        code: guest.code,
        guestName: guest.guestName,
        eventDate: MOCK_EVENT.eventDate,
        location: MOCK_EVENT.location,
        rsvpStatus: guest.rsvpStatus,
        house: guest.house,
        dishIds: [...guest.dishIds],
        customDish: guest.customDish ?? null,
        customDishAllowed: true,
        changeDeadline: MOCK_EVENT.changeDeadline,
        canChange: mockCanChange(),
        isAdmin: false,
        foundEggIds: [...(guest.foundEggIds ?? [])],
        housePoints: mockHousePoints(guest)
    };
}

function readMockAccess() {
    const stored = readJsonFromLocalStorage(MOCK_ACCESS_STORAGE_KEY, null);
    return stored && typeof stored === 'object'
        ? stored
        : { failedCount: 0, windowStartedAt: 0, blockedUntil: 0 };
}

function assertMockNotBlocked() {
    const access = readMockAccess();
    const remainingMs = access.blockedUntil - Date.now();

    if (remainingMs > 0) {
        throw new ApiError(429, 'too_many_attempts', 'Too many failed attempts.', {
            retryAfterSeconds: Math.ceil(remainingMs / 1000)
        });
    }
}

function registerMockFailedAttempt() {
    const now = Date.now();
    const access = readMockAccess();

    if (now - access.windowStartedAt > MOCK_RATE_LIMIT.windowMs) {
        access.failedCount = 0;
        access.windowStartedAt = now;
    }

    access.failedCount += 1;

    if (access.failedCount >= MOCK_RATE_LIMIT.maxFailedAttempts) {
        access.blockedUntil = now + MOCK_RATE_LIMIT.blockMs;
        access.failedCount = 0;
        access.windowStartedAt = now;
    }

    writeJsonToLocalStorage(MOCK_ACCESS_STORAGE_KEY, access);
}

async function loadMockGuestForCode(code) {
    await mockDelay();
    assertMockNotBlocked();

    if (String(code ?? '').replace(/\s+/g, '') !== MOCK_GUEST_CODE) {
        registerMockFailedAttempt();
        throw new ApiError(404, 'guest_not_found', 'That password is not invited to Christmas at the Great Hall.');
    }

    return readMockGuest();
}

function assertMockChangeAllowed() {
    if (!mockCanChange()) {
        throw new ApiError(403, 'changes_locked', 'Your choices are sealed.');
    }
}

// Mock House Cup: fixed scores for the other houses, plus the mock guest's sorting points and finds.
function mockHousePoints(guest) {
    const points = { gryffindor: 30, hufflepuff: 20, ravenclaw: 40, slytherin: 10 };

    if (guest.house && guest.rsvpStatus === 'accepted') {
        const foundCount = (guest.foundEggIds ?? []).length;
        points[guest.house] += SORTING_HOUSE_POINTS + foundCount * HOUSE_POINTS_PER_EGG
            + (foundCount >= EASTER_EGG_IDS.length ? COMPLETION_BONUS_POINTS : 0);
    }

    return points;
}

const mockBackend = {
    async getGuest(code) {
        return toMockGuestState(await loadMockGuestForCode(code));
    },

    async putRsvp(code, rsvpStatus) {
        const guest = await loadMockGuestForCode(code);
        assertMockChangeAllowed();

        guest.rsvpStatus = rsvpStatus;

        if (rsvpStatus === 'declined') {
            guest.dishIds = [];
            guest.customDish = null;
        }

        writeMockGuest(guest);
        return toMockGuestState(guest);
    },

    async putSorting(code, payload) {
        const guest = await loadMockGuestForCode(code);

        if (guest.rsvpStatus !== 'accepted') {
            throw new ApiError(409, 'rsvp_not_accepted', 'Only accepted guests can be sorted.');
        }

        if (guest.house && guest.house !== payload.house) {
            assertMockChangeAllowed();
        }

        if (guest.house !== payload.house) {
            guest.house = payload.house;
            guest.sortingScores = payload.scores;
            writeMockGuest(guest);
        }

        return toMockGuestState(guest);
    },

    async putDishes(code, dishIds, customDish = null) {
        const guest = await loadMockGuestForCode(code);

        if (guest.rsvpStatus !== 'accepted') {
            throw new ApiError(409, 'rsvp_not_accepted', 'Only accepted guests can choose dishes.');
        }

        if (!guest.house) {
            throw new ApiError(409, 'not_sorted', 'The Sorting Hat has not spoken yet.');
        }

        if (dishIds.length === 0 && !customDish) {
            throw new ApiError(400, 'invalid_dishes', 'Choose at least one dish.');
        }

        if (guest.dishIds.length > 0 || guest.customDish) {
            assertMockChangeAllowed();
        }

        guest.customDish = customDish;

        const takenDishIds = dishIds.filter((dishId) => guest.takenByOthers.includes(dishId));

        if (takenDishIds.length > 0) {
            throw new ApiError(409, 'dishes_taken', 'Some dishes were claimed by another guest.', { takenDishIds });
        }

        guest.dishIds = [...dishIds];
        writeMockGuest(guest);
        return toMockGuestState(guest);
    },

    async getTakenDishes(code) {
        const guest = await loadMockGuestForCode(code);
        return {
            dishIds: guest.takenByOthers.filter((dishId) => !guest.dishIds.includes(dishId)),
            customDishes: [{ name: 'Butterbeer trifle', course: 'Dessert', description: null }]
        };
    },

    async getGuestNames() {
        await mockDelay();
        return { names: ['Anna', 'Bram', 'Charlotte', 'Daan'] };
    },

    async putEgg(code, eggId) {
        const guest = await loadMockGuestForCode(code);

        if (guest.rsvpStatus !== 'accepted') {
            throw new ApiError(409, 'rsvp_not_accepted', 'Only accepted guests can earn house points.');
        }

        if (!guest.house) {
            throw new ApiError(409, 'not_sorted', 'The Sorting Hat has not spoken yet.');
        }

        const found = new Set(guest.foundEggIds ?? []);
        const firstFind = !found.has(eggId);
        found.add(eggId);
        guest.foundEggIds = normalizeEggIds([...found]);
        writeMockGuest(guest);

        return {
            eggId,
            firstFind,
            pointsAwarded: firstFind ? HOUSE_POINTS_PER_EGG : 0,
            bonusAwarded: firstFind && guest.foundEggIds.length >= EASTER_EGG_IDS.length ? COMPLETION_BONUS_POINTS : 0,
            house: guest.house,
            housePoints: mockHousePoints(guest)[guest.house],
            foundCount: guest.foundEggIds.length,
            totalEggs: EASTER_EGG_IDS.length,
            allHousePoints: mockHousePoints(guest)
        };
    },

    async getDishes() {
        return loadStaticDishCatalog();
    }
};
