import { readJsonFromLocalStorage, removeLocalStorageItem, writeJsonToLocalStorage } from './storage-utils.js';

// Empty = mock mode (state in localStorage). Example: 'https://<function-app>.azurewebsites.net'.
export const API_BASE_URL = 'https://magicalwinterbanquetapi20261108231610-btbjadbzavbybubk.westeurope-01.azurewebsites.net';

const GUEST_CODE_STORAGE_KEY = 'magical-winter-banquet.guest-code';
const GUEST_CODE_PATTERN = /^[0-9]{4}$/;
const HOUSES = ['gryffindor', 'hufflepuff', 'ravenclaw', 'slytherin'];
const RSVP_STATUSES = ['pending', 'accepted', 'declined'];
const DISH_SELECTION_LIMIT = 4;
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
    guestPromise = null;
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
        changeDeadline: data.changeDeadline ?? null,
        canChange: Boolean(data.canChange)
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
    putDishes: (code, dishIds) => request('PUT', `/api/guests/${encodeURIComponent(code)}/dishes`, { dishIds }),
    getTakenDishes: (code) => request('GET', `/api/guests/${encodeURIComponent(code)}/dishes/taken`),
    getDishes: () => request('GET', '/api/dishes')
};

function getBackend() {
    return API_BASE_URL ? backend : mockBackend;
}

// ---------- Guest state (cached per page load) ----------

let guestPromise = null;

function cacheGuest(data) {
    const guest = normalizeGuestState(data);
    guestPromise = Promise.resolve(guest);
    return guest;
}

export async function verifyGuestCode(code) {
    const normalizedCode = String(code ?? '').replace(/\s+/g, '');
    const data = await getBackend().getGuest(normalizedCode);
    setGuestCode(normalizedCode);
    return cacheGuest(data);
}

export function getGuest({ refresh = false } = {}) {
    if (!guestPromise || refresh) {
        const pending = (async () => {
            const code = requireGuestCode();
            return normalizeGuestState(await getBackend().getGuest(code));
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

export async function sendCabinDishSelection(payload) {
    const dishIds = normalizeDishIds(payload?.dishIds ?? payload?.dishSelection ?? []).slice(0, DISH_SELECTION_LIMIT);

    if (dishIds.length === 0) {
        throw new Error('At least one dish selection is required.');
    }

    return cacheGuest(await getBackend().putDishes(requireGuestCode(), dishIds));
}

export async function fetchTakenCabinDishIds() {
    const data = await getBackend().getTakenDishes(requireGuestCode());

    return {
        ok: true,
        status: 200,
        data: { dishIds: normalizeDishIds(data?.dishIds) }
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

const MOCK_GUEST_STORAGE_KEY = 'magical-winter-banquet.mock-guest';
const MOCK_ACCESS_STORAGE_KEY = 'magical-winter-banquet.mock-access-attempts';
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
        changeDeadline: MOCK_EVENT.changeDeadline,
        canChange: mockCanChange()
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
        throw new ApiError(404, 'guest_not_found', 'That password is not known to the castle.');
    }

    return readMockGuest();
}

function assertMockChangeAllowed() {
    if (!mockCanChange()) {
        throw new ApiError(403, 'changes_locked', 'Your choices are sealed.');
    }
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
            throw new ApiError(409, 'house_already_set', 'The Sorting Hat has already spoken.');
        }

        if (!guest.house) {
            guest.house = payload.house;
            guest.sortingScores = payload.scores;
            writeMockGuest(guest);
        }

        return toMockGuestState(guest);
    },

    async putDishes(code, dishIds) {
        const guest = await loadMockGuestForCode(code);

        if (guest.rsvpStatus !== 'accepted') {
            throw new ApiError(409, 'rsvp_not_accepted', 'Only accepted guests can choose dishes.');
        }

        if (!guest.house) {
            throw new ApiError(409, 'not_sorted', 'The Sorting Hat has not spoken yet.');
        }

        if (dishIds.length === 0 || dishIds.length > DISH_SELECTION_LIMIT) {
            throw new ApiError(400, 'invalid_dishes', 'Choose between one and four dishes.');
        }

        if (guest.dishIds.length > 0) {
            assertMockChangeAllowed();
        }

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
        return { dishIds: guest.takenByOthers.filter((dishId) => !guest.dishIds.includes(dishId)) };
    },

    async getDishes() {
        return loadStaticDishCatalog();
    }
};
