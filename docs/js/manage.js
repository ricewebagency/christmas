import { API_BASE_URL, getStoredGuestCode, setGuestCode } from './api-client.js?v=93d7544f9f';
import { redirectToPage } from './guest-flow.js?v=93d7544f9f';
import { readJsonFromLocalStorage, removeLocalStorageItem, writeJsonToLocalStorage } from './storage-utils.js?v=93d7544f9f';
import './click-pop.js?v=93d7544f9f';

const SETTINGS_STORAGE_KEY = 'christmas-at-the-great-hall.manage-settings';
const DISHES_VIEW_STORAGE_KEY = 'christmas-at-the-great-hall.manage-dishes-view';
const STATIC_DISH_CATALOG_URL = new URL('../assets/files/dishes.json', import.meta.url);
const TIME_ZONE = 'Europe/Amsterdam';

const RSVP_LABELS = { accepted: 'Aanwezig', declined: 'Afgemeld', pending: 'Open' };
const RSVP_BADGES = {
    accepted: 'text-emerald-400/80 ring-emerald-500/20',
    declined: 'text-red-400/80 ring-red-500/20',
    pending: 'text-neutral-400 ring-neutral-500/20'
};
const HOUSES = ['gryffindor', 'hufflepuff', 'ravenclaw', 'slytherin'];
const HOUSE_LABELS = { gryffindor: 'Gryffindor', hufflepuff: 'Hufflepuff', ravenclaw: 'Ravenclaw', slytherin: 'Slytherin' };
// Easter eggs op de Marauder's Map (zelfde volgorde als de API); elke eerste vondst = 10 huispunten.
const EGG_LABELS = { compass: 'Kompas', footsteps: 'Voetstappen', castle: 'Kasteel', snow: 'Sneeuw', nox: 'Nox/Lumos', revelio: 'Revelio', mischief: 'Mischief managed' };
const BADGE_BASE = 'inline-flex items-center rounded-full px-1.5 py-px text-[11px] ring-1 ring-inset';

const dateFormatter = new Intl.DateTimeFormat('nl-NL', {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
});

const state = {
    settings: { baseUrl: API_BASE_URL, key: '' },
    guests: [],
    totals: null,
    // Huispunten per huis uit de API (easter eggs) en het aantal eggs dat te vinden is.
    housePoints: {},
    totalEggs: 0,
    catalog: [],
    catalogVersion: null,
    catalogEditable: false,
    // Kopie van het menu tijdens bewerken; null = niet aan het bewerken.
    catalogDraft: null,
    catalogDirty: false,
    sort: { key: 'default', dir: 1 },
    lastCreated: [],
    // Animatie-bookkeeping.
    totalsRendered: false,
    dishesRendered: false,
    renderedCodes: new Set(),
    highlightCode: null,
    // Opengeklapte gastrijen; blijft behouden bij opnieuw renderen.
    expandedCodes: new Set(),
    expandedCourses: new Set(),
    dishesFreeOnly: false,
    // Open gangen van vóór "Alleen vrije gerechten", om bij uitzetten te herstellen.
    expandedBeforeFreeOnly: null
};

const previousCounts = new Map();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const el = (id) => document.getElementById(id);

// ---------- Animatie ----------

function restartAnimation(node, className) {
    node.classList.remove(className);
    void node.offsetWidth;
    node.classList.add(className);
}

function stagger(nodes, step = 40, max = 400) {
    [...nodes].forEach((node, index) => {
        node.style.animationDelay = `${Math.min(index * step, max)}ms`;
    });
}

function countUp(node, from, to, duration = 700) {
    if (reducedMotion.matches || from === to) {
        node.textContent = to;
        return;
    }

    const start = performance.now();
    const tick = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        node.textContent = Math.round(from + (to - from) * eased);

        if (progress < 1) {
            requestAnimationFrame(tick);
        }
    };

    requestAnimationFrame(tick);
}

function animateCounts(container) {
    container.querySelectorAll('[data-count]').forEach((node) => {
        const key = node.dataset.countKey;
        const to = Number(node.dataset.count);
        const known = previousCounts.has(key);
        const from = known ? previousCounts.get(key) : 0;

        previousCounts.set(key, to);
        countUp(node, from, to);

        if (known && from !== to) {
            restartAnimation(node.closest('[data-tile]'), 'motion-safe:animate-tilePulse');
        }
    });
}

function num(key, value) {
    const n = Number(value);
    return Number.isFinite(n)
        ? `<span data-count="${n}" data-count-key="${escapeHtml(key)}">0</span>`
        : escapeHtml(value);
}

function renderSkeleton() {
    const pulse = 'motion-safe:animate-pulse border border-neutral-800';
    el('manage-totals').innerHTML = ['min-w-64', 'min-w-40', 'min-w-32', 'min-w-48'].map((width) => `<div class="h-[52px] flex-auto rounded-md bg-neutral-900 ${width} ${pulse}"></div>`).join('');
    el('manage-guest-list').innerHTML = Array.from({ length: 8 }, () => '<div class="h-12 bg-neutral-950/40 motion-safe:animate-pulse"></div>').join('');
    el('manage-dishes').innerHTML = Array.from({ length: 3 }, () => `<div class="h-10 rounded-md bg-neutral-950 ${pulse}"></div>`).join('');
}

// ---------- Helpers ----------

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatDate(value) {
    if (!value) {
        return '<span class="text-neutral-600">—</span>';
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? escapeHtml(value) : escapeHtml(dateFormatter.format(date));
}

const timeFormatter = new Intl.DateTimeFormat('nl-NL', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' });
const dayFormatter = new Intl.DateTimeFormat('nl-NL', { timeZone: TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short' });
const shortDateFormatter = new Intl.DateTimeFormat('nl-NL', { timeZone: TIME_ZONE, day: 'numeric', month: 'short' });
// yyyy-mm-dd in de tijdzone van het feest, om regels per dag te groeperen.
const dayKeyFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

// Kort en relatief: "zojuist", "5 min", "3 u", "2 d", daarna de datum.
function formatAgo(value) {
    const date = new Date(value);
    const minutes = Math.floor((Date.now() - date.getTime()) / 60000);

    if (!Number.isFinite(minutes)) {
        return '';
    }

    if (minutes < 1) return 'zojuist';
    if (minutes < 60) return `${minutes} min`;
    if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} u`;
    if (minutes < 60 * 24 * 30) return `${Math.floor(minutes / (60 * 24))} d`;
    return shortDateFormatter.format(date);
}

function formatDayLabel(date) {
    const key = dayKeyFormatter.format(date);

    if (key === dayKeyFormatter.format(new Date())) return 'Vandaag';
    if (key === dayKeyFormatter.format(new Date(Date.now() - 24 * 60 * 60 * 1000))) return 'Gisteren';
    return dayFormatter.format(date);
}

function badge(classes, label) {
    return `<span class="${BADGE_BASE} ${classes}">${escapeHtml(label)}</span>`;
}

function houseLogo(house, size = 'h-7 w-7') {
    if (!HOUSES.includes(house)) {
        return '<span class="text-neutral-600">—</span>';
    }

    const src = new URL(`../assets/images/admin/${house}-logo.png`, import.meta.url).href;
    const label = escapeHtml(HOUSE_LABELS[house]);

    return `<img src="${src}" alt="${label}" title="${label}" class="${size} shrink-0 rounded-full object-cover transition-transform duration-300 hover:rotate-12 hover:scale-110">`;
}

const TOAST_TONES = {
    info: 'border-neutral-700 bg-neutral-900/95 text-neutral-200',
    success: 'border-emerald-700 bg-emerald-950/95 text-emerald-200',
    error: 'border-red-700 bg-red-950/95 text-red-200'
};
const TOAST_DURATION = { info: 3500, success: 3500, error: 8000 };

function dismissToast(toast) {
    if (!toast.isConnected || toast.dataset.closing) {
        return;
    }

    toast.dataset.closing = '1';
    clearTimeout(Number(toast.dataset.timer));
    toast.classList.add('opacity-0', '-translate-y-2');
    setTimeout(() => toast.remove(), 300);
}

function showMessage(text, tone = 'info') {
    const container = el('manage-message');
    const toast = document.createElement('div');
    toast.className = `pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border px-4 py-3 shadow-xl backdrop-blur transition duration-300 motion-safe:animate-fadeInDown ${TOAST_TONES[tone] ?? TOAST_TONES.info}`;
    toast.dataset.tone = tone;
    if (tone === 'error') {
        toast.setAttribute('role', 'alert');
    }

    const body = document.createElement('p');
    body.className = 'flex-1 text-sm';
    body.textContent = text;

    const close = document.createElement('button');
    close.type = 'button';
    close.dataset.pop = 'small';
    close.className = 'shrink-0 opacity-60 transition hover:opacity-100';
    close.setAttribute('aria-label', 'Sluiten');
    close.textContent = '✕';
    close.addEventListener('click', () => dismissToast(toast));

    toast.append(body, close);
    container.append(toast);

    while (container.children.length > 4) {
        container.firstElementChild.remove();
    }

    toast.dataset.timer = String(setTimeout(() => dismissToast(toast), TOAST_DURATION[tone] ?? TOAST_DURATION.info));
}

const POPOVERS = {
    settings: { panel: 'manage-settings', toggle: 'manage-settings-toggle', focus: 'manage-base-url' },
    filters: { panel: 'manage-filters', toggle: 'manage-filters-toggle', focus: 'manage-filter-rsvp' }
};

function setPopoverOpen(popover, open) {
    el(popover.panel).classList.toggle('hidden', !open);
    el(popover.toggle).setAttribute('aria-expanded', String(open));

    if (open) {
        el(popover.focus).focus();
    }
}

function togglePopover(popover) {
    setPopoverOpen(popover, el(popover.panel).classList.contains('hidden'));
}

function setSettingsOpen(open) {
    setPopoverOpen(POPOVERS.settings, open);
}

function handlePopoverDismiss(event) {
    Object.values(POPOVERS).forEach((popover) => {
        const panel = el(popover.panel);

        if (panel.classList.contains('hidden')) {
            return;
        }

        const outside = event.type === 'pointerdown'
            && !panel.contains(event.target)
            && !el(popover.toggle).contains(event.target);

        if (outside || event.key === 'Escape') {
            setPopoverOpen(popover, false);
        }
    });
}

function setSyncStatus(status) {
    const dot = el('manage-sync-dot');
    const text = el('manage-sync-text');
    const time = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    const states = {
        loading: ['bg-amber-400 motion-safe:animate-pulse', 'Bezig met laden…'],
        ok: ['bg-emerald-500', `Bijgewerkt om ${time}`],
        error: ['bg-red-500', `Laden mislukt om ${time}`]
    };
    const [dotClass, label] = states[status];

    dot.className = `h-1.5 w-1.5 rounded-full ${dotClass}`;
    text.textContent = label;
}

function hideMessage() {
    el('manage-message').querySelectorAll('[data-tone="error"]').forEach(dismissToast);
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        const area = document.createElement('textarea');
        area.value = text;
        document.body.append(area);
        area.select();
        document.execCommand('copy');
        area.remove();
    }

    showMessage('Gekopieerd naar klembord.', 'success');
}

// ---------- Settings ----------

function loadSettings() {
    const stored = readJsonFromLocalStorage(SETTINGS_STORAGE_KEY, null);

    if (stored && typeof stored === 'object') {
        state.settings.baseUrl = String(stored.baseUrl || API_BASE_URL || '');
        state.settings.key = String(stored.key || '');
    }

    el('manage-base-url').value = state.settings.baseUrl;
    el('manage-key').value = state.settings.key;
}

// Adminlink (/admin/#token=...): token overnemen en uit de URL halen.
function consumeTokenFromHash() {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');

    if (!token) {
        return;
    }

    const stored = readJsonFromLocalStorage(SETTINGS_STORAGE_KEY, null);
    const baseUrl = stored && typeof stored === 'object' && stored.baseUrl ? stored.baseUrl : state.settings.baseUrl;
    writeJsonToLocalStorage(SETTINGS_STORAGE_KEY, { baseUrl, key: token });
    history.replaceState(null, '', window.location.pathname + window.location.search);
}

function saveSettings(event) {
    event.preventDefault();
    state.settings.baseUrl = el('manage-base-url').value.trim().replace(/\/+$/, '');
    state.settings.key = el('manage-key').value.trim();
    writeJsonToLocalStorage(SETTINGS_STORAGE_KEY, state.settings);
    setSettingsOpen(false);
    loadAll();
}

function clearSettings() {
    if (!window.confirm('Instellingen wissen?\nAPI-URL en sleutel worden uit deze browser verwijderd.')) {
        return;
    }

    removeLocalStorageItem(SETTINGS_STORAGE_KEY);
    state.settings = { baseUrl: API_BASE_URL, key: '' };
    loadSettings();
    showMessage('Instellingen gewist.', 'info');
}

// ---------- HTTP ----------

async function request(method, path, body) {
    if (!state.settings.baseUrl) {
        throw new Error('Geen API base URL ingesteld (zie Instellingen).');
    }

    const headers = {};

    // Geen sleutel ingesteld: de pincode van een admin-gast werkt ook.
    const key = state.settings.key || getStoredGuestCode();

    if (key) {
        headers.Authorization = `Bearer ${key}`;
    }

    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }

    let response;

    try {
        response = await fetch(`${state.settings.baseUrl}${path}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            cache: 'no-store'
        });
    } catch {
        throw new Error('API niet bereikbaar (netwerk of CORS).');
    }

    if (response.status === 204) {
        return null;
    }

    let data = null;

    try {
        data = await response.json();
    } catch {
        data = null;
    }

    if (!response.ok) {
        if (response.status === 401) {
            redirectToPage('home');
            throw new Error('Geen toegang (401).');
        }

        if (response.status === 403) {
            throw new Error(`Geen toegang (${response.status}). Controleer de hoofdsleutel of admin-token, of vraag of je pincode adminrechten heeft.`);
        }

        throw new Error(data?.message || data?.error || `Request mislukt: ${response.status}`);
    }

    return data;
}

// { courses, version, editable }: alleen via /api/manage/dishes is het menu te bewerken.
async function loadCatalog() {
    try {
        const data = await request('GET', '/api/manage/dishes');

        if (Array.isArray(data?.courses)) {
            return { courses: data.courses, version: data.version ?? null, editable: true };
        }
    } catch {
        // Fallbacks hieronder.
    }

    try {
        const data = await request('GET', '/api/dishes');

        if (Array.isArray(data)) {
            return { courses: data, version: null, editable: false };
        }
    } catch {
        // Fallback hieronder.
    }

    try {
        const response = await fetch(STATIC_DISH_CATALOG_URL, { cache: 'no-store' });
        const data = await response.json();
        return { courses: Array.isArray(data) ? data : [], version: null, editable: false };
    } catch {
        return { courses: [], version: null, editable: false };
    }
}

// ---------- Data ----------

function normalizeGuest(guest) {
    const rsvpStatus = String(guest?.rsvpStatus ?? 'pending').toLowerCase();
    const house = guest?.house ? String(guest.house).toLowerCase() : null;
    const dishes = Array.isArray(guest?.dishes) ? guest.dishes : [];

    return {
        code: String(guest?.code ?? ''),
        guestName: String(guest?.guestName ?? ''),
        inviteUrl: String(guest?.inviteUrl ?? ''),
        rsvpStatus,
        house,
        dishes: dishes.map((dish) => ({ id: String(dish?.id ?? ''), name: String(dish?.name ?? '') })),
        // Eigen gerecht { name, course, description } of null; staat los van het menu.
        customDish: guest?.customDish?.name
            ? { name: String(guest.customDish.name), course: String(guest.customDish.course ?? ''), description: guest.customDish.description ? String(guest.customDish.description) : null }
            : null,
        dishCount: dishes.length + (guest?.customDish?.name ? 1 : 0),
        dishesChosen: Boolean(guest?.dishesChosen),
        rsvpUpdatedAt: guest?.rsvpUpdatedAt ?? null,
        sortedAt: guest?.sortedAt ?? null,
        dishesUpdatedAt: guest?.dishesUpdatedAt ?? null,
        createdAt: guest?.createdAt ?? null,
        isAdmin: Boolean(guest?.isAdmin),
        foundEggIds: Array.isArray(guest?.foundEggIds) ? guest.foundEggIds.map(String) : [],
        housePoints: Number(guest?.housePoints) || 0,
        // Laatste activiteit van de gast zelf (beheeracties tellen niet mee); null = nog nooit.
        lastActiveAt: guest?.lastActiveAt ?? null
    };
}

async function loadAll() {
    const refreshButton = el('manage-refresh');
    refreshButton.disabled = true;
    setSyncStatus('loading');

    try {
        const [overview, catalog] = await Promise.all([request('GET', '/api/manage/guests'), loadCatalog()]);
        state.guests = (overview?.guests ?? []).map(normalizeGuest);
        state.totals = overview?.totals ?? null;
        state.housePoints = overview?.housePoints ?? {};
        state.totalEggs = Number(overview?.totalEggs) || 0;
        state.catalog = catalog.courses;
        state.catalogVersion = catalog.version;
        state.catalogEditable = catalog.editable;
        hideMessage();
        setSyncStatus('ok');
    } catch (error) {
        showMessage(error.message, 'error');
        setSyncStatus('error');
    } finally {
        refreshButton.disabled = false;
        render();
    }
}

// ---------- Render ----------

// value: HTML (gebruik num() voor getallen).
function statTile(label, value, sub = '') {
    return `
        <div data-tile class="flex-1 whitespace-nowrap px-3 py-1.5 transition-colors duration-300 hover:bg-neutral-800/50">
            <p class="text-base font-semibold leading-tight tabular-nums text-neutral-100">${value}${sub ? ` <span class="text-xs font-normal text-neutral-500">${escapeHtml(sub)}</span>` : ''}</p>
            <p class="text-xs text-neutral-400">${escapeHtml(label)}</p>
        </div>`;
}

function ratio(key, part, whole) {
    return `${num(`${key}-part`, part)}/${num(`${key}-whole`, whole)}`;
}

function statGroup(title, tiles, layout = 'flex divide-x') {
    return `
        <div data-group class="${layout} flex-auto divide-neutral-800 overflow-hidden rounded-md border border-neutral-800 bg-neutral-900 transition duration-300 hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-lg hover:shadow-accent/10" role="group" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}">
            ${tiles.join('')}
        </div>`;
}

function renderTotals() {
    const guests = state.guests;
    const totals = state.totals ?? {};
    const accepted = guests.filter((guest) => guest.rsvpStatus === 'accepted');
    const sorted = accepted.filter((guest) => guest.house).length;
    const chosen = accepted.filter((guest) => guest.dishesChosen).length;
    const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');

    const container = el('manage-totals');
    container.innerHTML = [
        statGroup('RSVP', [
            statTile('Uitgenodigd',num('guests', totals.guests ?? guests.length)),
            statTile('Aanwezig', num('accepted', totals.accepted ?? accepted.length), pct(totals.accepted ?? accepted.length, totals.guests ?? guests.length)),
            statTile('Afgemeld', num('declined', totals.declined ?? 0)),
            statTile('Open', num('pending', totals.pending ?? 0))
        ]),
        statGroup('Voortgang', [
            statTile('Gesorteerd', ratio('sorted', sorted, accepted.length)),
            statTile('Gerecht gekozen', ratio('chosen', chosen, accepted.length))
        ]),
        statGroup('Gerechten', [
            statTile('Geclaimd', ratio('claimed', totals.dishesClaimed ?? 0, totals.dishesTotal ?? 0)),
            statTile('Vrij', num('free', totals.dishesFree ?? 0)),
            statTile('Eigen', num('custom', totals.customDishes ?? getCustomDishes().length))
        ]),
        renderHouses()
    ].join('');

    if (!state.totalsRendered) {
        state.totalsRendered = true;
        const groups = container.querySelectorAll('[data-group]');
        groups.forEach((group) => group.classList.add('motion-safe:animate-popIn'));
        stagger(groups, 80);
    }

    animateCounts(container);
}

// Huizen: punten (uit de easter eggs) en aantal leden per huis. Het huis aan kop krijgt de accentkleur.
function renderHouses() {
    const points = Object.fromEntries(HOUSES.map((house) => [house, Number(state.housePoints?.[house]) || 0]));
    const top = Math.max(...Object.values(points));
    const eggsFound = state.guests.reduce((sum, guest) => sum + guest.foundEggIds.length, 0);

    return statGroup(`Huizen (${eggsFound} easter eggs gevonden)`, HOUSES.map((house) => {
        const isLeader = top > 0 && points[house] === top;
        const members = state.guests.filter((guest) => guest.house === house).length;
        return `
            <div data-tile class="flex flex-1 items-center justify-center gap-2 bg-neutral-900 px-3 py-1.5 transition-colors duration-300 hover:bg-neutral-800/50" title="${escapeHtml(HOUSE_LABELS[house])}: ${points[house]} punten, ${members} leden${isLeader ? ' (aan kop)' : ''}">
                ${houseLogo(house, 'h-6 w-6')}
                <div class="leading-tight">
                    <p class="whitespace-nowrap text-base font-semibold tabular-nums ${isLeader ? 'text-accent' : 'text-neutral-100'}">${num(`points-${house}`, points[house])} <span class="text-xs font-normal text-neutral-500">pt</span></p>
                    <p class="whitespace-nowrap text-xs tabular-nums text-neutral-400">${num(`house-${house}`, members)} leden</p>
                </div>
            </div>`;
    }), 'grid grid-cols-2 gap-px !bg-neutral-800 sm:flex sm:gap-0 sm:divide-x sm:!bg-neutral-900');
}

function getFilteredGuests() {
    const query = el('manage-search').value.trim().toLowerCase();
    const rsvp = el('manage-filter-rsvp').value;
    const house = el('manage-filter-house').value;
    const dishes = el('manage-filter-dishes').value;
    const { key, dir } = state.sort;

    return state.guests
        .filter((guest) => !rsvp || guest.rsvpStatus === rsvp)
        .filter((guest) => !house || (house === 'none' ? !guest.house : guest.house === house))
        .filter((guest) => !dishes || (dishes === 'chosen' ? guest.dishesChosen : !guest.dishesChosen))
        .filter((guest) => !query
            || guest.guestName.toLowerCase().includes(query)
            || guest.code.includes(query)
            || guest.dishes.some((dish) => dish.name.toLowerCase().includes(query))
            || Boolean(guest.customDish?.name.toLowerCase().includes(query)))
        // Bij gelijke waarden altijd op naam (oplopend).
        .sort((a, b) => compareGuests(a, b, key, dir) || compareText(a.guestName, b.guestName));
}

function compareText(left, right) {
    return String(left).localeCompare(String(right), 'nl', { sensitivity: 'base' });
}

const RSVP_RANK = { accepted: 0, declined: 1, pending: 2 };

function rsvpRank(guest) {
    return RSVP_RANK[guest.rsvpStatus] ?? RSVP_RANK.pending;
}

// Zonder RSVP altijd onderaan, ongeacht sorteerrichting.
function comparePending(a, b) {
    return Number(rsvpRank(a) === RSVP_RANK.pending) - Number(rsvpRank(b) === RSVP_RANK.pending);
}

function compareGuests(a, b, key, dir) {
    // Standaard: JA, dan NEE, dan geen RSVP; daarbinnen eerst gesorteerd (huis),
    // dan admins, meeste easter eggs, meeste gerechten.
    if (key === 'default') {
        return (rsvpRank(a) - rsvpRank(b))
            || (Number(Boolean(b.house)) - Number(Boolean(a.house)))
            || ((Number(b.isAdmin) - Number(a.isAdmin))
            || (b.foundEggIds.length - a.foundEggIds.length)
            || (b.dishCount - a.dishCount)) * dir;
    }

    if (key === 'rsvpStatus') {
        return comparePending(a, b) || (rsvpRank(a) - rsvpRank(b)) * dir;
    }

    const left = a[key] ?? '';
    const right = b[key] ?? '';

    if (typeof left === 'number' && typeof right === 'number') {
        return (left - right) * dir;
    }

    // Lege waarden altijd onderaan.
    if (left === '' && right !== '') return 1;
    if (right === '' && left !== '') return -1;

    return compareText(left, right) * dir;
}

function guestDate(label, value) {
    return `
        <div class="flex justify-between gap-2">
            <dt class="text-neutral-500">${label}</dt>
            <dd class="text-right text-neutral-300">${formatDate(value)}</dd>
        </div>`;
}

const ICONS = {
    chevron: '<path d="m9 18 6-6-6-6" />',
    dish: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" /><path d="M7 2v20" /><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />',
    reset: '<path d="M3 12a9 9 0 1 0 2.64-6.36L3 8" /><path d="M3 3v5h5" />',
    delete: '<path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />',
    check: '<path d="M20 6 9 17l-5-5" />',
    activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />',
    edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" />',
    sparkle: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />'
};

function icon(name, size = 'h-4 w-4') {
    return `<svg class="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

const ICON_BUTTON = 'inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-800 active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

function renderGuestRow(guest) {
    const code = escapeHtml(guest.code);
    const name = escapeHtml(guest.guestName);
    const expanded = state.expandedCodes.has(guest.code);
    const dishCount = guest.dishCount;
    const custom = guest.customDish;
    const dishTitle = dishCount
        ? [...guest.dishes.map((dish) => `#${dish.id} ${dish.name}`), ...(custom ? [`eigen: ${custom.name} (${custom.course})`] : [])].join('\n')
        : 'Nog geen gerechten gekozen';
    const customItem = custom
        ? `<li><span class="text-accent">eigen</span> ${escapeHtml(custom.name)} <span class="text-neutral-500">· ${escapeHtml(custom.course)}${custom.description ? ` · ${escapeHtml(custom.description)}` : ''}</span></li>`
        : '';
    const dishes = dishCount
        ? `<ul class="space-y-0.5">${guest.dishes.map((dish) => `<li><span class="text-neutral-500">#${escapeHtml(dish.id)}</span> ${escapeHtml(dish.name)}</li>`).join('')}${customItem}</ul>`
        : '<p class="text-neutral-600">Nog geen gerechten gekozen.</p>';
    const eggCount = guest.foundEggIds.length;
    const eggNames = guest.foundEggIds.map((eggId) => EGG_LABELS[eggId] ?? eggId);
    const eggTitle = eggCount
        ? `${eggCount}/${state.totalEggs || eggCount} easter eggs: ${eggNames.join(', ')}\n${guest.housePoints} huispunten${guest.housePoints ? '' : ' (telt nu niet mee)'}`
        : 'Nog geen easter eggs gevonden';
    const eggs = eggCount
        ? `<p class="mt-2 text-neutral-300"><span class="text-accent">${guest.housePoints} huispunten</span> · ${escapeHtml(eggNames.join(', '))}
            <button type="button" data-action="clear-eggs" data-code="${code}" aria-label="Huispunten van ${name} wissen"
                class="ml-1 rounded text-neutral-500 underline underline-offset-2 transition hover:text-red-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">wissen</button></p>`
        : '';
    const eggCounter = eggCount
        ? `<button type="button" data-action="clear-eggs" data-code="${code}" title="${escapeHtml(`${eggTitle}\nKlik om de huispunten te wissen`)}" aria-label="Huispunten van ${name} wissen"
            class="inline-flex w-9 items-center gap-1 rounded text-xs text-accent transition hover:text-red-400 active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">${icon('sparkle', 'h-3.5 w-3.5')}${eggCount}</button>`
        : `<span class="inline-flex w-9 items-center gap-1 text-xs text-neutral-600" title="${escapeHtml(eggTitle)}">${icon('sparkle', 'h-3.5 w-3.5')}0</span>`;
    const lastActive = guest.lastActiveAt ? new Date(guest.lastActiveAt) : null;
    const recentlyActive = lastActive && Date.now() - lastActive.getTime() < 24 * 60 * 60 * 1000;
    const lastActiveLabel = lastActive
        ? `<span class="w-12 truncate text-xs ${recentlyActive ? 'text-emerald-400/80' : 'text-neutral-400'}" title="Laatst actief: ${escapeHtml(dateFormatter.format(lastActive))}">${escapeHtml(formatAgo(guest.lastActiveAt))}</span>`
        : '<span class="w-12 text-xs text-neutral-600" title="Nog geen activiteit">—</span>';

    return `
        <article data-guest="${code}" class="transition-colors hover:bg-neutral-800/30">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 sm:flex-nowrap">
                <button type="button" data-action="toggle-details" data-code="${code}" aria-expanded="${expanded}" aria-controls="guest-details-${code}"
                    class="group flex min-w-0 flex-1 items-center gap-2 rounded py-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                    <span class="text-neutral-600 transition-transform group-hover:text-neutral-300 group-aria-expanded:rotate-90">${icon('chevron', 'h-3.5 w-3.5')}</span>
                    <span class="flex h-7 w-7 shrink-0 items-center justify-center">${houseLogo(guest.house)}</span>
                    <span class="truncate font-medium text-neutral-100">${name}</span>
                </button>
                <div class="order-last flex w-full items-center gap-2 sm:order-none sm:w-auto">
                    <span class="w-10 font-mono text-xs text-accent" title="Pincode">${code}</span>
                    <span class="w-[4.5rem]">${badge(RSVP_BADGES[guest.rsvpStatus] ?? RSVP_BADGES.pending, RSVP_LABELS[guest.rsvpStatus] ?? guest.rsvpStatus)}</span>
                    <span class="w-14">
                        <button type="button" data-action="toggle-admin" data-code="${code}" aria-pressed="${guest.isAdmin}"
                            title="${guest.isAdmin ? 'Admin – klik om in te trekken' : 'Geen admin – klik om admin te maken'}"
                            class="${BADGE_BASE} whitespace-nowrap transition active:scale-90 ${guest.isAdmin ? 'text-accent ring-accent/40 hover:ring-red-500/40 hover:text-red-400' : 'text-neutral-600 ring-neutral-700 hover:text-accent hover:ring-accent/40'}">${guest.isAdmin ? 'Admin' : '+ Admin'}</button>
                    </span>
                    <span class="inline-flex w-9 items-center gap-1 text-xs ${dishCount ? 'text-neutral-300' : 'text-neutral-600'}" title="${escapeHtml(dishTitle)}">${icon('dish', 'h-3.5 w-3.5')}${dishCount}</span>
                    ${eggCounter}
                    ${lastActiveLabel}
                </div>
                <div class="flex shrink-0 items-center">
                    <button type="button" data-action="activity" data-code="${code}" title="Activiteit" aria-label="Activiteit van ${name}"
                        class="${ICON_BUTTON} hover:text-accent">${icon('activity')}</button>
                    <button type="button" data-action="edit" data-code="${code}" title="Aanpassen" aria-label="${name} aanpassen"
                        class="${ICON_BUTTON} hover:text-accent">${icon('edit')}</button>
                    <button type="button" data-action="copy-link" data-code="${code}" title="Link kopiëren" aria-label="Link van ${name} kopiëren"
                        class="${ICON_BUTTON} hover:text-accent">${icon('link')}</button>
                    <button type="button" data-action="reset" data-code="${code}" title="Resetten" aria-label="${name} resetten"
                        class="${ICON_BUTTON} hover:text-amber-400">${icon('reset')}</button>
                    <button type="button" data-action="delete" data-code="${code}" title="Verwijderen" aria-label="${name} verwijderen"
                        class="${ICON_BUTTON} hover:text-red-400">${icon('delete')}</button>
                </div>
            </div>
            <div id="guest-details-${code}" data-details class="${collapseClass(expanded)}" ${expanded ? '' : 'inert'}>
                <div class="min-h-0 overflow-hidden">
                    <div class="grid gap-3 px-3 pb-3 text-xs sm:grid-cols-2 sm:pl-[4.375rem]">
                        <div>${dishes}${eggs}</div>
                        <dl class="max-w-xs space-y-0.5">
                            ${guestDate('RSVP', guest.rsvpUpdatedAt)}
                            ${guestDate('Gesorteerd', guest.sortedAt)}
                            ${guestDate('Gerechten', guest.dishesUpdatedAt)}
                            ${guestDate('Laatst actief', guest.lastActiveAt)}
                        </dl>
                    </div>
                </div>
            </div>
        </article>`;
}

// Uitklapblok: animeert hoogte via grid-rows 0fr <-> 1fr (inhoud in een min-h-0 overflow-hidden wrapper).
const COLLAPSE_BASE = 'grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none';

function collapseClass(open) {
    return `${COLLAPSE_BASE} ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`;
}

function setCollapsed(node, open) {
    node.classList.toggle('grid-rows-[1fr]', open);
    node.classList.toggle('grid-rows-[0fr]', !open);
    // Dichtgeklapte inhoud niet focusbaar / niet voorgelezen.
    node.inert = !open;
}

function toggleDetails(button, code) {
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    setCollapsed(button.closest('[data-guest]').querySelector('[data-details]'), open);
    state.expandedCodes[open ? 'add' : 'delete'](code);
}

function updateFilterCount() {
    const active = ['manage-filter-rsvp', 'manage-filter-house', 'manage-filter-dishes'].filter((id) => el(id).value).length;
    const badgeEl = el('manage-filter-count');
    badgeEl.textContent = String(active);
    badgeEl.classList.toggle('hidden', active === 0);
}

function clearFilters() {
    ['manage-filter-rsvp', 'manage-filter-house', 'manage-filter-dishes'].forEach((id) => {
        el(id).value = '';
    });
    renderGuests();
}

function openCreateDialog() {
    const dialog = el('manage-create-dialog');
    // Toasts in de dialog plaatsen, anders vallen ze achter de modal (top layer).
    dialog.append(el('manage-message'));
    dialog.showModal();
    el('manage-create-rows').querySelector('[data-field="name"]')?.focus();
}

function handleCreateDialogClose() {
    document.querySelector('main').prepend(el('manage-message'));
}

// animateAll: false = alleen nieuwe rijen animeren (na een refresh).
function renderGuests({ animateAll = true } = {}) {
    const guests = getFilteredGuests();
    const list = el('manage-guest-list');

    el('manage-guest-count').textContent = `(${guests.length} van ${state.guests.length})`;
    updateFilterCount();
    list.innerHTML = guests.length
        ? guests.map(renderGuestRow).join('')
        : '<p class="py-6 text-center text-neutral-500 motion-safe:animate-fadeInUpFast">Geen gasten gevonden.</p>';

    const entering = [...list.querySelectorAll('[data-guest]')]
        .filter((row) => animateAll || !state.renderedCodes.has(row.dataset.guest));
    entering.forEach((row) => row.classList.add('motion-safe:animate-fadeInUpFast'));
    stagger(entering, 20);

    if (state.highlightCode) {
        const card = list.querySelector(`[data-guest="${CSS.escape(state.highlightCode)}"]`);
        card?.classList.add('motion-safe:animate-tilePulse');
        state.highlightCode = null;
    }

    state.renderedCodes = new Set(state.guests.map((guest) => guest.code));

    el('manage-sort-key').value = state.sort.key;
    el('manage-sort-dir').textContent = state.sort.dir === 1 ? '▲' : '▼';
}

function getClaimedBy() {
    const claimedBy = new Map();

    state.guests.forEach((guest) => {
        guest.dishes.forEach((dish) => claimedBy.set(dish.id, guest));
    });

    return claimedBy;
}

function courseKey(course, index) {
    return String(course?.course || course?.course_nl || index);
}

function renderDishItem(dish, guest) {
    const owner = guest
        ? `<span class="inline-flex items-center gap-2 text-neutral-100">${escapeHtml(guest.guestName)}${guest.house ? houseLogo(guest.house, 'h-5 w-5') : ''}</span>`
        : '<span class="text-emerald-400">vrij</span>';

    return `
        <li class="flex items-center justify-between gap-3 py-1.5 pl-9 pr-3 transition-colors hover:bg-neutral-800/40">
            <span><span class="text-neutral-500">#${escapeHtml(dish.id)}</span> ${escapeHtml(dish.name_nl || dish.name)}</span>
            <span class="text-right text-xs">${owner}</span>
        </li>`;
}

// Eigen gerechten van gasten die komen, met de gast erbij.
function getCustomDishes() {
    return state.guests
        .filter((guest) => guest.customDish && guest.rsvpStatus === 'accepted')
        .map((guest) => ({ ...guest.customDish, guest }));
}

function customDishMatchesCourse(customDish, course) {
    const name = customDish.course.toLowerCase();
    return [course?.course, course?.course_nl].some((value) => String(value ?? '').toLowerCase() === name);
}

function renderCustomDishItem(customDish) {
    const { guest } = customDish;
    const title = customDish.description ? ` title="${escapeHtml(customDish.description)}"` : '';

    return `
        <li class="flex items-center justify-between gap-3 py-1.5 pl-9 pr-3 transition-colors hover:bg-neutral-800/40"${title}>
            <span><span class="text-accent">eigen</span> ${escapeHtml(customDish.name)}${customDish.description ? ` <span class="text-neutral-500">· ${escapeHtml(customDish.description)}</span>` : ''}</span>
            <span class="text-right text-xs"><span class="inline-flex items-center gap-2 text-neutral-100">${escapeHtml(guest.guestName)}${guest.house ? houseLogo(guest.house, 'h-5 w-5') : ''}</span></span>
        </li>`;
}

function renderCourse(course, index, claimedBy, customDishes = []) {
    const key = courseKey(course, index);
    const dishes = Array.isArray(course?.dishes) ? course.dishes : [];
    const claimed = dishes.filter((dish) => claimedBy.has(String(dish.id))).length;
    const full = dishes.length > 0 && claimed === dishes.length;
    const percent = dishes.length ? Math.round((claimed / dishes.length) * 100) : 0;
    const expanded = state.expandedCourses.has(key);
    const visible = state.dishesFreeOnly ? dishes.filter((dish) => !claimedBy.has(String(dish.id))) : dishes;
    // Eigen gerechten zijn nooit "vrij": niet tonen met het vrij-filter aan.
    const visibleCustom = state.dishesFreeOnly ? [] : customDishes;
    const list = visible.length || visibleCustom.length
        ? visible.map((dish) => renderDishItem(dish, claimedBy.get(String(dish.id)))).join('') + visibleCustom.map(renderCustomDishItem).join('')
        : '<li class="py-1.5 pl-9 pr-3 text-neutral-500">Alles geclaimd.</li>';
    const customCount = customDishes.length ? ` <span class="text-accent">+${customDishes.length} eigen</span>` : '';

    return `
        <div data-course-key="${escapeHtml(key)}" class="overflow-hidden rounded-md border border-neutral-800">
            <button type="button" data-course-toggle aria-expanded="${expanded}"
                class="group flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-neutral-800/40 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
                <span class="text-neutral-600 transition-transform group-hover:text-neutral-300 group-aria-expanded:rotate-90">${icon('chevron', 'h-3.5 w-3.5')}</span>
                <span class="mr-auto min-w-0 truncate text-xs font-medium uppercase tracking-wide text-neutral-300">${escapeHtml(course?.course_nl || course?.course)}</span>
                <span aria-hidden="true" class="hidden h-1.5 w-24 overflow-hidden rounded-full bg-neutral-800 sm:block">
                    <span class="block h-full rounded-full transition-all duration-700 ${full ? 'bg-emerald-500' : 'bg-accent'}" style="width: ${percent}%"></span>
                </span>
                <span class="min-w-24 text-right text-xs ${full ? 'text-emerald-400' : 'text-neutral-400'}">${claimed}/${dishes.length} geclaimd${customCount}</span>
            </button>
            <div data-course-dishes class="${collapseClass(expanded)}" ${expanded ? '' : 'inert'}>
                <div class="min-h-0 overflow-hidden">
                    <ul class="divide-y divide-neutral-800 border-t border-neutral-800">${list}</ul>
                </div>
            </div>
        </div>`;
}

// Weergavevoorkeur (open gangen, filter) per browser onthouden.
function saveDishesView() {
    writeJsonToLocalStorage(DISHES_VIEW_STORAGE_KEY, {
        expanded: [...state.expandedCourses],
        freeOnly: state.dishesFreeOnly,
        before: state.expandedBeforeFreeOnly ? [...state.expandedBeforeFreeOnly] : null
    });
}

function loadDishesView() {
    const stored = readJsonFromLocalStorage(DISHES_VIEW_STORAGE_KEY, null);

    if (!stored) {
        return;
    }

    state.expandedCourses = new Set(Array.isArray(stored.expanded) ? stored.expanded.map(String) : []);
    state.dishesFreeOnly = stored.freeOnly === true;
    state.expandedBeforeFreeOnly = state.dishesFreeOnly && Array.isArray(stored.before) ? new Set(stored.before.map(String)) : null;
}

// Gangen waar "alles uit/inklappen" op werkt: met filter aan alleen gangen die nog vrije gerechten hebben.
function relevantCourseKeys(claimedBy = getClaimedBy()) {
    return state.catalog
        .map((course, index) => ({ key: courseKey(course, index), dishes: Array.isArray(course?.dishes) ? course.dishes : [] }))
        .filter(({ dishes }) => !state.dishesFreeOnly || dishes.some((dish) => !claimedBy.has(String(dish.id))))
        .map(({ key }) => key);
}

function updateExpandAllButton(claimedBy) {
    const button = el('manage-dishes-expand');
    const keys = relevantCourseKeys(claimedBy);
    const openCount = keys.filter((key) => state.expandedCourses.has(key)).length;
    const allOpen = keys.length > 0 && openCount === keys.length;

    button.disabled = keys.length === 0;
    button.setAttribute('aria-expanded', String(allOpen));
    el('manage-dishes-expand-label').textContent = allOpen ? 'Alles inklappen' : 'Alles uitklappen';
    button.title = keys.length
        ? `${openCount} van ${keys.length} gangen open · Tip: Alt+klik op een gang klapt alles in of uit`
        : 'Geen gangen met vrije gerechten';
}

function animateOpenedCourses(keys) {
    keys.forEach((key) => {
        const items = el('manage-dishes').querySelectorAll(`[data-course-key="${CSS.escape(key)}"] li`);
        items.forEach((item) => restartAnimation(item, 'motion-safe:animate-fadeInUpFast'));
        stagger(items, 20, 300);
    });
}

// open = true: alle relevante gangen open; false: alles dicht.
function setAllCourses(open) {
    const keys = relevantCourseKeys();
    const opened = open ? keys.filter((key) => !state.expandedCourses.has(key)) : [];

    if (open) {
        keys.forEach((key) => state.expandedCourses.add(key));
    } else {
        state.expandedCourses.clear();
    }

    saveDishesView();

    // In-place bijwerken (geen re-render), zodat de in/uitklap-animatie zichtbaar is.
    el('manage-dishes').querySelectorAll('[data-course-key]').forEach((course) => {
        const isOpen = state.expandedCourses.has(course.dataset.courseKey);
        course.querySelector('[data-course-toggle]').setAttribute('aria-expanded', String(isOpen));
        setCollapsed(course.querySelector('[data-course-dishes]'), isOpen);
    });

    updateExpandAllButton();
    animateOpenedCourses(opened);
}

function renderDishes() {
    const claimedBy = getClaimedBy();
    const editButton = el('manage-dishes-edit');

    editButton.classList.toggle('hidden', !state.catalogEditable || state.catalogDraft !== null);
    el('manage-dishes-controls').classList.toggle('hidden', state.catalogDraft !== null || !state.catalog.length);
    el('manage-dishes-free').setAttribute('aria-pressed', String(state.dishesFreeOnly));

    if (state.catalogDraft) {
        renderCatalogEditor(claimedBy);
        return;
    }

    if (!state.catalog.length) {
        el('manage-dishes').innerHTML = '<p class="text-neutral-500">Geen catalogus geladen.</p>';
        return;
    }

    const container = el('manage-dishes');
    const customDishes = getCustomDishes();
    const courseHtml = state.catalog.map((course, index) =>
        renderCourse(course, index, claimedBy, customDishes.filter((dish) => customDishMatchesCourse(dish, course))));
    // Gang van een eigen gerecht bestaat niet meer (menu aangepast): apart tonen.
    const orphaned = customDishes.filter((dish) => !state.catalog.some((course) => customDishMatchesCourse(dish, course)));

    if (orphaned.length) {
        courseHtml.push(renderCourse({ course_nl: 'Eigen gerechten (gang niet meer op menu)', dishes: [] }, state.catalog.length, claimedBy, orphaned));
    }

    container.innerHTML = courseHtml.join('');
    updateExpandAllButton(claimedBy);

    if (!state.dishesRendered) {
        state.dishesRendered = true;
        const courses = container.querySelectorAll('[data-course-key]');
        courses.forEach((course) => course.classList.add('motion-safe:animate-fadeInUpFast'));
        stagger(courses, 60);
    }
}

function toggleCourse(button) {
    const course = button.closest('[data-course-key]');
    const key = course.dataset.courseKey;
    const open = button.getAttribute('aria-expanded') !== 'true';
    const list = course.querySelector('[data-course-dishes]');

    button.setAttribute('aria-expanded', String(open));
    setCollapsed(list, open);
    state.expandedCourses[open ? 'add' : 'delete'](key);
    saveDishesView();
    updateExpandAllButton();

    if (open) {
        animateOpenedCourses([key]);
    }
}

function handleDishesClick(event) {
    const button = event.target.closest('[data-course-toggle]');

    if (!button || state.catalogDraft) {
        return;
    }

    // Alt+klik: alle gangen volgen de nieuwe stand van deze gang.
    if (event.altKey) {
        setAllCourses(button.getAttribute('aria-expanded') !== 'true');
        return;
    }

    toggleCourse(button);
}

function toggleAllCourses() {
    const keys = relevantCourseKeys();
    setAllCourses(!keys.every((key) => state.expandedCourses.has(key)));
}

function toggleFreeOnly() {
    if (state.dishesFreeOnly) {
        // Uitzetten: terug naar de open/dicht-stand van vóór het filter.
        state.dishesFreeOnly = false;
        state.expandedCourses = state.expandedBeforeFreeOnly ?? state.expandedCourses;
        state.expandedBeforeFreeOnly = null;
        saveDishesView();
        renderDishes();
        return;
    }

    // Aanzetten: alleen gangen met vrije gerechten openklappen.
    state.expandedBeforeFreeOnly = new Set(state.expandedCourses);
    state.dishesFreeOnly = true;
    const keys = relevantCourseKeys();
    state.expandedCourses = new Set(keys);
    saveDishesView();
    renderDishes();
    animateOpenedCourses(keys);
}

// ---------- Menu bewerken ----------

const EDIT_INPUT_CLASS = 'w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 focus:border-accent focus:outline-none';
const EDIT_REMOVE_CLASS = 'shrink-0 rounded-md px-2 py-1 text-neutral-500 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-neutral-500';

function toDraftCourse(course) {
    return {
        course: String(course?.course ?? ''),
        course_nl: String(course?.course_nl ?? ''),
        dishes: (Array.isArray(course?.dishes) ? course.dishes : []).map((dish) => ({
            id: dish?.id === undefined || dish?.id === null ? null : String(dish.id),
            name: String(dish?.name ?? ''),
            name_nl: String(dish?.name_nl ?? ''),
            description: String(dish?.description ?? '')
        }))
    };
}

function emptyDish() {
    return { id: null, name: '', name_nl: '', description: '' };
}

function renderCatalogEditor(claimedBy) {
    const courses = state.catalogDraft;

    el('manage-dishes').innerHTML = `
        ${courses.map((course, ci) => {
            const courseClaimed = course.dishes.some((dish) => dish.id && claimedBy.has(dish.id));

            return `
                <div data-course="${ci}" class="space-y-2 rounded-md border border-neutral-800 p-3">
                    <div class="flex items-start gap-2">
                        <div class="grid flex-1 gap-2 sm:grid-cols-2">
                            <input data-field="course_nl" value="${escapeHtml(course.course_nl)}" placeholder="Gang (NL)" aria-label="Gang (NL)" class="${EDIT_INPUT_CLASS} font-semibold">
                            <input data-field="course" value="${escapeHtml(course.course)}" placeholder="Course (EN)" aria-label="Gang (EN)" class="${EDIT_INPUT_CLASS}">
                        </div>
                        <button type="button" data-edit="remove-course" data-pop="small"${courseClaimed ? 'disabled' : ''}
                            title="${courseClaimed ? 'Bevat gekozen gerechten' : 'Gang verwijderen'}" aria-label="Gang verwijderen" class="${EDIT_REMOVE_CLASS}">✕</button>
                    </div>
                    ${course.dishes.map((dish, di) => {
                        const guest = dish.id ? claimedBy.get(dish.id) : null;

                        return `
                            <div data-dish="${di}" class="space-y-1.5 rounded-md bg-neutral-950/60 p-2">
                                <div class="flex items-center justify-between gap-2 text-xs">
                                    <span class="text-neutral-500">${dish.id ? `#${escapeHtml(dish.id)}` : 'nieuw'}${guest ? ` · gekozen door <span class="text-neutral-300">${escapeHtml(guest.guestName)}</span>` : ''}</span>
                                    <button type="button" data-edit="remove-dish" data-pop="small"${guest ? 'disabled' : ''}
                                        title="${guest ? 'Gekozen door een gast' : 'Gerecht verwijderen'}" aria-label="Gerecht verwijderen" class="${EDIT_REMOVE_CLASS}">✕</button>
                                </div>
                                <div class="grid gap-1.5 sm:grid-cols-2">
                                    <input data-field="name_nl" value="${escapeHtml(dish.name_nl)}" placeholder="Naam (NL)" aria-label="Naam (NL)" class="${EDIT_INPUT_CLASS}">
                                    <input data-field="name" value="${escapeHtml(dish.name)}" placeholder="Name (EN) *" aria-label="Naam (EN)" class="${EDIT_INPUT_CLASS}">
                                </div>
                                <textarea data-field="description" rows="2" placeholder="Omschrijving (EN)" aria-label="Omschrijving" class="${EDIT_INPUT_CLASS} text-xs">${escapeHtml(dish.description)}</textarea>
                            </div>`;
                    }).join('')}
                    <button type="button" data-edit="add-dish" class="rounded-md border border-dashed border-neutral-700 px-3 py-1.5 text-xs hover:border-accent hover:text-accent">+ Gerecht</button>
                </div>`;
        }).join('')}
        <button type="button" data-edit="add-course" class="w-full rounded-md border border-dashed border-neutral-700 px-3 py-2 hover:border-accent hover:text-accent">+ Gang</button>
        <div class="sticky bottom-0 flex justify-end gap-2 border-t border-neutral-800 bg-neutral-900 py-3">
            <button type="button" data-edit="cancel" data-pop="small" class="rounded-md border border-neutral-700 px-3 py-2 hover:border-neutral-500">Annuleren</button>
            <button type="button" data-edit="save" data-pop="high" class="rounded-md bg-accent px-3 py-2 font-semibold text-neutral-950 hover:bg-amber-300 disabled:opacity-50">Menu opslaan</button>
        </div>`;
}

function startCatalogEdit() {
    state.catalogDraft = state.catalog.map(toDraftCourse);
    state.catalogDirty = false;
    renderDishes();
    restartAnimation(el('manage-dishes'), 'motion-safe:animate-fadeInUpFast');
}

function stopCatalogEdit() {
    state.catalogDraft = null;
    state.catalogDirty = false;
    renderDishes();
    restartAnimation(el('manage-dishes'), 'motion-safe:animate-fadeInUpFast');
}

function handleCatalogInput(event) {
    const field = event.target.dataset?.field;
    const courseEl = event.target.closest('[data-course]');

    if (!state.catalogDraft || !field || !courseEl) {
        return;
    }

    const course = state.catalogDraft[Number(courseEl.dataset.course)];
    const dishEl = event.target.closest('[data-dish]');
    const target = dishEl ? course.dishes[Number(dishEl.dataset.dish)] : course;
    target[field] = event.target.value;
    state.catalogDirty = true;
}

function findRemovedDishes() {
    const kept = new Set(state.catalogDraft.flatMap((course) => course.dishes.map((dish) => dish.id)).filter(Boolean));

    return state.catalog
        .flatMap((course) => (Array.isArray(course?.dishes) ? course.dishes : []))
        .filter((dish) => !kept.has(String(dish.id)));
}

async function saveCatalog(button) {
    const removed = findRemovedDishes();

    if (removed.length && !window.confirm(`Deze gerechten worden verwijderd:\n${removed.map((dish) => `• ${dish.name_nl || dish.name}`).join('\n')}\n\nDoorgaan?`)) {
        return;
    }

    button.disabled = true;

    try {
        const data = await request('PUT', '/api/manage/dishes', {
            version: state.catalogVersion,
            courses: state.catalogDraft.map((course) => ({
                course: course.course,
                course_nl: course.course_nl,
                dishes: course.dishes.map((dish) => ({ ...dish }))
            }))
        });

        state.catalog = Array.isArray(data?.courses) ? data.courses : state.catalog;
        state.catalogVersion = data?.version ?? null;
        stopCatalogEdit();
        await loadAll();
        showMessage('Menu opgeslagen.', 'success');
    } catch (error) {
        showMessage(error.message, 'error');
        button.disabled = false;
    }
}

function handleCatalogClick(event) {
    const button = event.target.closest('[data-edit]');

    if (!button || !state.catalogDraft) {
        return;
    }

    const action = button.dataset.edit;
    const courseEl = button.closest('[data-course]');
    const course = courseEl ? state.catalogDraft[Number(courseEl.dataset.course)] : null;

    if (action === 'save') {
        saveCatalog(button);
        return;
    }

    if (action === 'cancel') {
        if (!state.catalogDirty || window.confirm('Wijzigingen aan het menu weggooien?')) {
            stopCatalogEdit();
        }

        return;
    }

    if (action === 'add-course') {
        state.catalogDraft.push({ course: '', course_nl: '', dishes: [emptyDish()] });
    } else if (action === 'remove-course' && course) {
        state.catalogDraft.splice(Number(courseEl.dataset.course), 1);
    } else if (action === 'add-dish' && course) {
        course.dishes.push(emptyDish());
    } else if (action === 'remove-dish' && course) {
        course.dishes.splice(Number(button.closest('[data-dish]').dataset.dish), 1);
    } else {
        return;
    }

    state.catalogDirty = true;
    renderDishes();

    if (action === 'add-dish' || action === 'add-course') {
        const inputs = el('manage-dishes').querySelectorAll(action === 'add-dish'
            ? `[data-course="${courseEl.dataset.course}"] [data-dish] [data-field="name_nl"]`
            : '[data-course] [data-field="course_nl"]');
        const input = inputs[inputs.length - 1];
        input?.closest(action === 'add-dish' ? '[data-dish]' : '[data-course]')?.classList.add('motion-safe:animate-popIn');
        input?.focus();
    }
}

function render() {
    renderTotals();
    renderGuests({ animateAll: false });
    renderDishes();
}

// ---------- Actions ----------

function findGuest(code) {
    return state.guests.find((guest) => guest.code === code);
}

async function handleTableClick(event) {
    const button = event.target.closest('button[data-action]');

    if (!button) {
        return;
    }

    const guest = findGuest(button.dataset.code);

    if (!guest) {
        return;
    }

    if (button.dataset.action === 'toggle-details') {
        toggleDetails(button, guest.code);
        return;
    }

    if (button.dataset.action === 'edit') {
        openEditDialog(guest);
        return;
    }

    if (button.dataset.action === 'activity') {
        openActivityDialog(guest);
        return;
    }

    if (button.dataset.action === 'copy-link') {
        copyText(guest.inviteUrl);
        button.innerHTML = icon('check');
        button.classList.add('text-emerald-400');
        restartAnimation(button, 'motion-safe:animate-popIn');
        setTimeout(() => {
            button.innerHTML = icon('link');
            button.classList.remove('text-emerald-400');
        }, 1200);
        return;
    }

    if (button.dataset.action === 'toggle-admin') {
        const path = `/api/manage/guests/${encodeURIComponent(guest.code)}/admin`;
        state.highlightCode = guest.code;

        if (guest.isAdmin) {
            if (!window.confirm(`Adminrechten van ${guest.guestName} (${guest.code}) intrekken?`)) {
                return;
            }

            await runAction(() => request('DELETE', path), `${guest.guestName} is geen admin meer.`);
            return;
        }

        if (!window.confirm(`${guest.guestName} (${guest.code}) admin maken?
Met de pincode krijgt deze gast toegang tot het beheerscherm.`)) {
            return;
        }

        await runAction(() => request('POST', path), `${guest.guestName} is nu admin.`);
        return;
    }

    if (button.dataset.action === 'reset') {
        if (!window.confirm(`Reset ${guest.guestName} (${guest.code})?\nRSVP, huis, gerechten en gevonden easter eggs (huispunten) worden gewist.`)) {
            return;
        }

        state.highlightCode = guest.code;
        await runAction(() => request('POST', `/api/manage/guests/${encodeURIComponent(guest.code)}/reset`), `${guest.guestName} is gereset.`);
        return;
    }

    if (button.dataset.action === 'clear-eggs') {
        if (!window.confirm(`Huispunten van ${guest.guestName} (${guest.code}) wissen?\nDe ${guest.foundEggIds.length} gevonden easter egg(s) worden gewist; RSVP, huis en gerechten blijven staan.`)) {
            return;
        }

        state.highlightCode = guest.code;
        await runAction(() => request('DELETE', `/api/manage/guests/${encodeURIComponent(guest.code)}/eggs`), `Huispunten van ${guest.guestName} zijn gewist.`);
        return;
    }

    if (button.dataset.action === 'delete') {
        if (!window.confirm(`${guest.guestName} (${guest.code}) definitief verwijderen?\nGeclaimde gerechten komen vrij en de huispunten vervallen.`)) {
            return;
        }

        button.closest('[data-guest]')?.classList.add('motion-safe:animate-cardOut');
        const ok = await runAction(() => request('DELETE', `/api/manage/guests/${encodeURIComponent(guest.code)}`), `${guest.guestName} is verwijderd.`);

        if (!ok) {
            renderGuests({ animateAll: false });
        }
    }
}

async function runAction(action, successMessage) {
    try {
        await action();
        await loadAll();
        showMessage(successMessage, 'success');
        return true;
    } catch (error) {
        state.highlightCode = null;
        showMessage(error.message, 'error');
        return false;
    }
}

const CREATE_INPUT_CLASS = 'w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 focus:border-accent focus:outline-none';

function addCreateRow({ focus = false } = {}) {
    const row = document.createElement('div');
    row.className = 'grid grid-cols-[1fr_6rem_2rem] gap-2 motion-safe:animate-popIn';
    row.dataset.createRow = '';
    row.innerHTML = `
        <input type="text" data-field="name" placeholder="Harry Potter" autocomplete="off" class="${CREATE_INPUT_CLASS}">
        <input type="text" data-field="code" placeholder="1234" inputmode="numeric" maxlength="4" autocomplete="off" class="${CREATE_INPUT_CLASS} font-mono">
        <button type="button" data-remove-row data-pop="small" aria-label="Rij verwijderen" class="rounded-md text-neutral-500 transition hover:rotate-90 hover:text-red-400">✕</button>`;
    el('manage-create-rows').append(row);

    if (focus) {
        row.querySelector('[data-field="name"]').focus();
    }
}

function resetCreateRows() {
    el('manage-create-rows').innerHTML = '';
    addCreateRow();
}

function readCreateRows() {
    const requests = [];
    const errors = [];

    el('manage-create-rows').querySelectorAll('[data-create-row]').forEach((row, index) => {
        const guestName = row.querySelector('[data-field="name"]').value.trim();
        const code = row.querySelector('[data-field="code"]').value.trim();

        if (!guestName && !code) {
            return;
        }

        if (!guestName) {
            errors.push(`Rij ${index + 1}: naam ontbreekt.`);
        } else if (code && !/^[0-9]{4}$/.test(code)) {
            errors.push(`Rij ${index + 1}: pincode moet 4 cijfers zijn.`);
        } else {
            requests.push(code ? { guestName, code } : { guestName });
        }
    });

    return { requests, errors };
}

function handleCreateRowsInput(event) {
    if (event.target.dataset.field === 'code') {
        event.target.value = event.target.value.replace(/\D/g, '').slice(0, 4);
    }
}

function handleCreateRowsKeydown(event) {
    if (event.key !== 'Enter' || event.target.dataset.field !== 'code') {
        return;
    }

    event.preventDefault();
    const rows = [...el('manage-create-rows').querySelectorAll('[data-create-row]')];
    const next = rows[rows.indexOf(event.target.closest('[data-create-row]')) + 1];

    if (next) {
        next.querySelector('[data-field="name"]').focus();
    } else {
        addCreateRow({ focus: true });
    }
}

function handleCreateRowsClick(event) {
    const button = event.target.closest('[data-remove-row]');

    if (!button) {
        return;
    }

    const row = button.closest('[data-create-row]');
    const remove = () => {
        row.remove();

        if (!el('manage-create-rows').children.length) {
            addCreateRow();
        }
    };

    if (reducedMotion.matches) {
        remove();
        return;
    }

    row.classList.remove('motion-safe:animate-popIn');
    row.classList.add('motion-safe:animate-cardOut', 'pointer-events-none');
    row.addEventListener('animationend', remove, { once: true });
}

async function handleCreate(event) {
    event.preventDefault();
    const { requests, errors } = readCreateRows();

    if (errors.length) {
        showMessage(errors.join(' '), 'error');
        return;
    }

    if (!requests.length) {
        showMessage('Vul minimaal één naam in.', 'error');
        return;
    }

    const submit = event.submitter;
    submit.disabled = true;

    try {
        const data = await request('POST', '/api/manage/guests', requests);
        state.lastCreated = Array.isArray(data?.guests) ? data.guests : [];
        resetCreateRows();
        renderCreated();
        await loadAll();
        showMessage(`${state.lastCreated.length} gast(en) aangemaakt.`, 'success');
    } catch (error) {
        showMessage(error.message, 'error');
    } finally {
        submit.disabled = false;
    }
}

function renderCreated() {
    el('manage-create-result').classList.toggle('hidden', state.lastCreated.length === 0);
    el('manage-create-list').innerHTML = state.lastCreated.map((guest) => `
        <li class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 motion-safe:animate-fadeInUpFast">
            <span><span class="font-medium text-neutral-100">${escapeHtml(guest.guestName)}</span> <span class="font-mono text-accent">${escapeHtml(guest.code)}</span></span>
            <span class="break-all text-xs text-neutral-400">${escapeHtml(guest.inviteUrl)}</span>
        </li>`).join('');
    stagger(el('manage-create-list').children, 60);
}

// ---------- Gast aanpassen ----------

function openEditDialog(guest) {
    const dialog = el('manage-edit-dialog');
    dialog.dataset.code = guest.code;
    el('manage-edit-name').value = guest.guestName;
    el('manage-edit-code').value = guest.code;
    updateEditHint();
    // Toasts in de dialog plaatsen, anders vallen ze achter de modal (top layer).
    dialog.append(el('manage-message'));
    dialog.showModal();
    el('manage-edit-name').select();
}

function updateEditHint() {
    el('manage-edit-hint').classList.toggle('hidden', el('manage-edit-code').value === el('manage-edit-dialog').dataset.code);
}

function handleEditCodeInput(event) {
    event.target.value = event.target.value.replace(/\D/g, '').slice(0, 4);
    updateEditHint();
}

async function handleEdit(event) {
    event.preventDefault();
    const dialog = el('manage-edit-dialog');
    const guest = findGuest(dialog.dataset.code);
    const guestName = el('manage-edit-name').value.trim();
    const code = el('manage-edit-code').value.trim();

    if (!guest) {
        dialog.close();
        return;
    }

    if (!guestName) {
        showMessage('Naam ontbreekt.', 'error');
        return;
    }

    if (!/^[0-9]{4}$/.test(code)) {
        showMessage('Pincode moet 4 cijfers zijn.', 'error');
        return;
    }

    const body = {};

    if (guestName !== guest.guestName) {
        body.guestName = guestName;
    }

    if (code !== guest.code) {
        body.code = code;
    }

    if (!Object.keys(body).length) {
        dialog.close();
        return;
    }

    const submit = event.submitter;
    submit.disabled = true;

    try {
        const updated = await request('PATCH', `/api/manage/guests/${encodeURIComponent(guest.code)}`, body);
        const newCode = updated?.code ?? code;

        if (newCode !== guest.code) {
            moveLocalCode(guest.code, newCode);
        }

        state.highlightCode = newCode;
        dialog.close();
        await loadAll();
        showMessage(body.code
            ? `${guestName} heeft nu pincode ${newCode}. Stuur de nieuwe link.`
            : `${guestName} is aangepast.`, 'success');
    } catch (error) {
        showMessage(error.message, 'error');
    } finally {
        submit.disabled = false;
    }
}

// Na een nieuwe pincode: open rij en eigen inlog (pincode als sleutel) meeverhuizen, anders volgt een 401.
function moveLocalCode(oldCode, newCode) {
    if (state.expandedCodes.delete(oldCode)) {
        state.expandedCodes.add(newCode);
    }

    if (state.settings.key === oldCode) {
        state.settings.key = newCode;
        el('manage-key').value = newCode;
        writeJsonToLocalStorage(SETTINGS_STORAGE_KEY, state.settings);
    }

    if (getStoredGuestCode() === oldCode) {
        setGuestCode(newCode);
    }
}

// ---------- Activiteit ----------

const PAGE_LABELS = {
    home: 'Start',
    invite: 'Uitnodiging',
    rsvp: 'RSVP',
    sorting: 'Sorting Hat',
    map: "Marauder's Map",
    cabin: 'Hogwarts Express',
    chamber: 'Chamber of Secrets'
};

// by: 'browser' (bezoek), 'guest' (actie van de gast) of 'admin' (beheeractie).
const ACTIVITY_TYPES = {
    page_view: { label: 'Pagina bekeken', by: 'browser' },
    sign_in: { label: 'Ingelogd', by: 'browser' },
    rsvp: { label: 'RSVP', by: 'guest' },
    sorted: { label: 'Gesorteerd', by: 'guest' },
    dishes: { label: 'Gerechten gekozen', by: 'guest' },
    egg: { label: 'Easter egg gevonden', by: 'guest' },
    created: { label: 'Aangemaakt', by: 'admin' },
    reset: { label: 'Gereset', by: 'admin' },
    renamed: { label: 'Naam gewijzigd', by: 'admin' },
    code_changed: { label: 'Pincode gewijzigd', by: 'admin' },
    eggs_cleared: { label: 'Huispunten gewist', by: 'admin' },
    admin_granted: { label: 'Admin gemaakt', by: 'admin' },
    admin_revoked: { label: 'Admin ingetrokken', by: 'admin' }
};

const ACTIVITY_TONES = {
    browser: 'text-neutral-300',
    guest: 'text-emerald-400/90',
    admin: 'text-neutral-500'
};

function describeActivity(entry) {
    const detail = entry.detail ?? '';

    switch (entry.type) {
        case 'page_view':
            return PAGE_LABELS[entry.page] ?? entry.page ?? '';
        case 'sign_in':
            return entry.page ? `via ${PAGE_LABELS[entry.page] ?? entry.page}` : '';
        case 'rsvp':
            return RSVP_LABELS[detail] ?? detail;
        case 'sorted':
            return detail.split(' → ').map((house) => HOUSE_LABELS[house] ?? house).join(' → ');
        case 'egg':
            return EGG_LABELS[detail] ?? detail;
        default:
            return detail;
    }
}

function renderActivityRow(entry) {
    const type = ACTIVITY_TYPES[entry.type] ?? { label: entry.type, by: 'browser' };
    const at = new Date(entry.at);
    const adminBadge = type.by === 'admin'
        ? ` ${badge('text-neutral-500 ring-neutral-700', 'beheer')}`
        : '';

    return `
        <tr class="align-top">
            <td class="whitespace-nowrap py-1.5 pl-4 pr-3 font-mono text-xs text-neutral-500" title="${escapeHtml(`${dateFormatter.format(at)} (${formatAgo(entry.at)})`)}">${escapeHtml(timeFormatter.format(at))}</td>
            <td class="whitespace-nowrap py-1.5 pr-3 ${ACTIVITY_TONES[type.by]}">${escapeHtml(type.label)}${adminBadge}</td>
            <td class="py-1.5 pr-4 text-neutral-400 sm:pr-3">${escapeHtml(describeActivity(entry))}</td>
            <td class="hidden whitespace-nowrap py-1.5 pr-4 text-xs text-neutral-500 sm:table-cell">${escapeHtml(entry.device ?? '')}</td>
        </tr>`;
}

function renderActivity(data) {
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    const total = Number(data?.totalCount) || entries.length;
    const guestActions = entries.filter((entry) => ACTIVITY_TYPES[entry.type]?.by !== 'admin').length;

    el('manage-activity-summary').textContent = entries.length
        ? `${guestActions} door de gast · ${entries.length - guestActions} beheeracties${total > entries.length ? ` · laatste ${entries.length} van ${total}` : ''}`
        : '';

    if (!entries.length) {
        el('manage-activity-body').innerHTML = '<p class="px-4 py-8 text-center text-neutral-500">Nog geen activiteit.</p>';
        return;
    }

    let currentDay = null;
    const rows = entries.map((entry) => {
        const day = formatDayLabel(new Date(entry.at));
        const header = day === currentDay
            ? ''
            : `<tr><th colspan="4" scope="colgroup" class="sticky top-0 bg-neutral-900/95 px-4 pb-1 pt-3 text-left text-[11px] font-medium uppercase tracking-wide text-neutral-500 backdrop-blur-sm">${escapeHtml(day)}</th></tr>`;
        currentDay = day;
        return header + renderActivityRow(entry);
    });

    el('manage-activity-body').innerHTML = `
        <table class="w-full text-sm motion-safe:animate-fadeInUpFast">
            <thead class="sr-only">
                <tr><th scope="col">Tijd</th><th scope="col">Activiteit</th><th scope="col">Details</th><th scope="col">Apparaat</th></tr>
            </thead>
            <tbody>${rows.join('')}</tbody>
        </table>`;
}

async function openActivityDialog(guest) {
    const dialog = el('manage-activity-dialog');
    dialog.dataset.code = guest.code;
    el('manage-activity-title').textContent = guest.guestName;
    el('manage-activity-code').textContent = guest.code;
    el('manage-activity-summary').textContent = '';
    el('manage-activity-body').innerHTML = `<div class="space-y-2 p-4">${Array.from({ length: 6 }, () => '<div class="h-6 rounded bg-neutral-800/60 motion-safe:animate-pulse"></div>').join('')}</div>`;
    dialog.showModal();

    try {
        const data = await request('GET', `/api/manage/guests/${encodeURIComponent(guest.code)}/activity`);

        // Intussen een andere gast geopend of gesloten: dit antwoord niet meer tonen.
        if (dialog.open && dialog.dataset.code === guest.code) {
            renderActivity(data);
        }
    } catch (error) {
        if (dialog.dataset.code === guest.code) {
            el('manage-activity-body').innerHTML = `<p class="px-4 py-8 text-center text-red-400">${escapeHtml(error.message)}</p>`;
        }
    }
}

// ---------- Init ----------

function init() {
    consumeTokenFromHash();
    loadSettings();
    loadDishesView();

    el('manage-refresh').addEventListener('click', loadAll);
    el('manage-settings-toggle').addEventListener('click', () => togglePopover(POPOVERS.settings));
    el('manage-filters-toggle').addEventListener('click', () => togglePopover(POPOVERS.filters));
    el('manage-filters-clear').addEventListener('click', clearFilters);
    el('manage-settings').addEventListener('submit', saveSettings);
    document.addEventListener('pointerdown', handlePopoverDismiss);
    document.addEventListener('keydown', handlePopoverDismiss);
    el('manage-create-open').addEventListener('click', openCreateDialog);
    el('manage-create-close').addEventListener('click', () => el('manage-create-dialog').close());
    el('manage-create-cancel').addEventListener('click', () => {
        // Annuleren = ingevulde rijen weggooien en sluiten.
        resetCreateRows();
        el('manage-create-dialog').close();
    });
    el('manage-create-dialog').addEventListener('close', handleCreateDialogClose);
    el('manage-create-dialog').addEventListener('click', (event) => {
        // Klik op de backdrop sluit de dialog.
        if (event.target === event.currentTarget) {
            event.currentTarget.close();
        }
    });
    el('manage-edit').addEventListener('submit', handleEdit);
    el('manage-edit-code').addEventListener('input', handleEditCodeInput);
    el('manage-edit-close').addEventListener('click', () => el('manage-edit-dialog').close());
    el('manage-edit-cancel').addEventListener('click', () => el('manage-edit-dialog').close());
    el('manage-edit-dialog').addEventListener('close', handleCreateDialogClose);
    el('manage-edit-dialog').addEventListener('click', (event) => {
        if (event.target === event.currentTarget) {
            event.currentTarget.close();
        }
    });
    el('manage-activity-close').addEventListener('click', () => el('manage-activity-dialog').close());
    el('manage-activity-dialog').addEventListener('click', (event) => {
        if (event.target === event.currentTarget) {
            event.currentTarget.close();
        }
    });
    el('manage-settings-clear').addEventListener('click', clearSettings);
    el('manage-guest-list').addEventListener('click', handleTableClick);
    el('manage-create').addEventListener('submit', handleCreate);
    el('manage-dishes-edit').addEventListener('click', startCatalogEdit);
    el('manage-dishes').addEventListener('input', handleCatalogInput);
    el('manage-dishes').addEventListener('click', handleCatalogClick);
    el('manage-dishes').addEventListener('click', handleDishesClick);
    el('manage-dishes-free').addEventListener('click', toggleFreeOnly);
    el('manage-dishes-expand').addEventListener('click', toggleAllCourses);
    window.addEventListener('beforeunload', (event) => {
        if (state.catalogDraft && state.catalogDirty) {
            event.preventDefault();
        }
    });
    el('manage-create-add').addEventListener('click', () => addCreateRow({ focus: true }));
    el('manage-create-rows').addEventListener('input', handleCreateRowsInput);
    el('manage-create-rows').addEventListener('keydown', handleCreateRowsKeydown);
    el('manage-create-rows').addEventListener('click', handleCreateRowsClick);
    resetCreateRows();
    el('manage-create-copy').addEventListener('click', () => {
        copyText(state.lastCreated.map((guest) => `${guest.guestName}\t${guest.code}\t${guest.inviteUrl}`).join('\n'));
    });

    ['manage-search', 'manage-filter-rsvp', 'manage-filter-house', 'manage-filter-dishes'].forEach((id) => {
        el(id).addEventListener('input', () => renderGuests());
    });

    el('manage-sort-key').addEventListener('input', (event) => {
        state.sort = { key: event.target.value, dir: 1 };
        renderGuests();
    });
    el('manage-sort-dir').addEventListener('click', () => {
        state.sort.dir = -state.sort.dir;
        renderGuests();
    });

    if (!state.settings.baseUrl) {
        setSettingsOpen(true);
    }

    renderSkeleton();
    loadAll();
}

init();
