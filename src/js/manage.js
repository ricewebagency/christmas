import { API_BASE_URL } from './api-client.js';
import { readJsonFromLocalStorage, removeLocalStorageItem, writeJsonToLocalStorage } from './storage-utils.js';

const SETTINGS_STORAGE_KEY = 'magical-winter-banquet.manage-settings';
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
    catalog: [],
    catalogVersion: null,
    catalogEditable: false,
    // Kopie van het menu tijdens bewerken; null = niet aan het bewerken.
    catalogDraft: null,
    catalogDirty: false,
    sort: { key: 'guestName', dir: 1 },
    lastCreated: [],
    // Animatie-bookkeeping.
    totalsRendered: false,
    dishesRendered: false,
    renderedCodes: new Set(),
    highlightCode: null
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
    el('manage-guest-list').innerHTML = Array.from({ length: 6 }, () => `<div class="h-56 rounded-lg bg-neutral-950 ${pulse}"></div>`).join('');
    el('manage-dishes').innerHTML = Array.from({ length: 3 }, () => `<div class="h-24 rounded-md bg-neutral-950 ${pulse}"></div>`).join('');
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

function setSettingsOpen(open) {
    el('manage-settings').classList.toggle('hidden', !open);
    el('manage-settings-toggle').setAttribute('aria-expanded', String(open));

    if (open) {
        el('manage-base-url').focus();
    }
}

function handleSettingsDismiss(event) {
    const panel = el('manage-settings');

    if (panel.classList.contains('hidden')) {
        return;
    }

    const outside = event.type === 'pointerdown'
        && !panel.contains(event.target)
        && !el('manage-settings-toggle').contains(event.target);

    if (outside || event.key === 'Escape') {
        setSettingsOpen(false);
    }
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

function saveSettings(event) {
    event.preventDefault();
    state.settings.baseUrl = el('manage-base-url').value.trim().replace(/\/+$/, '');
    state.settings.key = el('manage-key').value.trim();
    writeJsonToLocalStorage(SETTINGS_STORAGE_KEY, state.settings);
    setSettingsOpen(false);
    loadAll();
}

function clearSettings() {
    if (!window.confirm('Instellingen wissen?\nAPI-URL en function key worden uit deze browser verwijderd.')) {
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

    if (state.settings.key) {
        headers['x-functions-key'] = state.settings.key;
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
        if (response.status === 401 || response.status === 403) {
            throw new Error(`Geen toegang (${response.status}). Controleer de function key.`);
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
        dishCount: dishes.length,
        dishesChosen: Boolean(guest?.dishesChosen),
        rsvpUpdatedAt: guest?.rsvpUpdatedAt ?? null,
        sortedAt: guest?.sortedAt ?? null,
        dishesUpdatedAt: guest?.dishesUpdatedAt ?? null,
        createdAt: guest?.createdAt ?? null
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

function statGroup(title, tiles) {
    return `
        <div data-group class="flex flex-auto divide-x divide-neutral-800 overflow-hidden rounded-md border border-neutral-800 bg-neutral-900 transition duration-300 hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-lg hover:shadow-accent/10" role="group" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}">
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
            statTile('Gasten', num('guests', totals.guests ?? guests.length)),
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
            statTile('Vrij', num('free', totals.dishesFree ?? 0))
        ]),
        statGroup('Huizen', HOUSES.map((house) => {
            const members = guests.filter((guest) => guest.house === house).length;
            return `
            <div data-tile class="flex flex-1 items-center justify-center gap-2 px-3 py-1.5 transition-colors duration-300 hover:bg-neutral-800/50" title="${escapeHtml(HOUSE_LABELS[house])}: ${members}">
                ${houseLogo(house, 'h-6 w-6')}
                <span class="text-base font-semibold tabular-nums text-neutral-100">${num(`house-${house}`, members)}</span>
            </div>`;
        }))
    ].join('');

    if (!state.totalsRendered) {
        state.totalsRendered = true;
        const groups = container.querySelectorAll('[data-group]');
        groups.forEach((group) => group.classList.add('motion-safe:animate-popIn'));
        stagger(groups, 80);
    }

    animateCounts(container);
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
            || guest.dishes.some((dish) => dish.name.toLowerCase().includes(query)))
        .sort((a, b) => {
            const left = a[key] ?? '';
            const right = b[key] ?? '';

            if (typeof left === 'number' && typeof right === 'number') {
                return (left - right) * dir;
            }

            // Lege waarden altijd onderaan.
            if (left === '' && right !== '') return 1;
            if (right === '' && left !== '') return -1;

            return String(left).localeCompare(String(right), 'nl', { sensitivity: 'base' }) * dir;
        });
}

function guestDate(label, value) {
    return `
        <div class="flex justify-between gap-2">
            <dt class="text-neutral-500">${label}</dt>
            <dd class="text-right text-neutral-300">${formatDate(value)}</dd>
        </div>`;
}

function renderGuestCard(guest) {
    const dishes = guest.dishes.length
        ? `<ul class="space-y-0.5">${guest.dishes.map((dish) => `<li><span class="text-neutral-500">#${escapeHtml(dish.id)}</span> ${escapeHtml(dish.name)}</li>`).join('')}</ul>`
        : '<p class="text-neutral-600">Nog geen gerechten gekozen.</p>';
    const code = escapeHtml(guest.code);
    const action = 'rounded border border-neutral-700 px-2 py-1 text-center text-xs transition active:scale-90';

    return `
        <article data-guest="${code}" class="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-950 p-3 transition duration-300 hover:-translate-y-1 hover:border-accent/40 hover:shadow-xl hover:shadow-accent/5">
            <header class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <h3 class="truncate font-semibold text-neutral-100">${escapeHtml(guest.guestName)}</h3>
                    <div class="mt-1 flex items-center gap-2">
                        <span class="inline-flex items-center gap-1 font-mono text-accent" title="Pincode">
                            <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <rect x="4" y="11" width="16" height="10" rx="2" />
                                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                            </svg>${code}
                        </span>
                        ${badge(RSVP_BADGES[guest.rsvpStatus] ?? RSVP_BADGES.pending, RSVP_LABELS[guest.rsvpStatus] ?? guest.rsvpStatus)}
                    </div>
                </div>
                <div class="shrink-0" title="${escapeHtml(HOUSE_LABELS[guest.house] ?? 'Niet gesorteerd')}">${houseLogo(guest.house, 'h-9 w-9')}</div>
            </header>
            <div class="text-xs">${dishes}</div>
            <dl class="grid grid-cols-1 gap-x-4 gap-y-0.5 border-t border-neutral-800 pt-2 text-xs min-[420px]:grid-cols-2">
                ${guestDate('RSVP', guest.rsvpUpdatedAt)}
                ${guestDate('Gesorteerd', guest.sortedAt)}
                ${guestDate('Gerechten', guest.dishesUpdatedAt)}
                ${guestDate('Aangemaakt', guest.createdAt)}
            </dl>
            <div class="mt-auto grid grid-cols-4 gap-1">
                <button type="button" data-action="copy-link" data-code="${code}" title="${escapeHtml(guest.inviteUrl)}"
                    class="${action} hover:border-accent hover:text-accent">Link</button>
                <a href="${escapeHtml(guest.inviteUrl)}" target="_blank" rel="noopener"
                    class="${action} hover:border-accent hover:text-accent">Open</a>
                <button type="button" data-action="reset" data-code="${code}"
                    class="${action} hover:border-amber-500 hover:text-amber-400">Reset</button>
                <button type="button" data-action="delete" data-code="${code}"
                    class="${action} hover:border-red-500 hover:text-red-400">Verwijder</button>
            </div>
        </article>`;
}

// animateAll: false = alleen nieuwe kaarten animeren (na een refresh).
function renderGuests({ animateAll = true } = {}) {
    const guests = getFilteredGuests();
    const list = el('manage-guest-list');

    el('manage-guest-count').textContent = `(${guests.length} van ${state.guests.length})`;
    list.innerHTML = guests.length
        ? guests.map(renderGuestCard).join('')
        : '<p class="col-span-full py-6 text-center text-neutral-500 motion-safe:animate-fadeInUpFast">Geen gasten gevonden.</p>';

    const entering = [...list.querySelectorAll('[data-guest]')]
        .filter((card) => animateAll || !state.renderedCodes.has(card.dataset.guest));
    entering.forEach((card) => card.classList.add('motion-safe:animate-fadeInUpFast'));
    stagger(entering);

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

function renderDishes() {
    const claimedBy = getClaimedBy();
    const editButton = el('manage-dishes-edit');

    editButton.classList.toggle('hidden', !state.catalogEditable || state.catalogDraft !== null);

    if (state.catalogDraft) {
        renderCatalogEditor(claimedBy);
        return;
    }

    if (!state.catalog.length) {
        el('manage-dishes').innerHTML = '<p class="text-neutral-500">Geen catalogus geladen.</p>';
        return;
    }

    const container = el('manage-dishes');
    container.innerHTML = state.catalog.map((course) => {
        const dishes = Array.isArray(course?.dishes) ? course.dishes : [];
        const claimed = dishes.filter((dish) => claimedBy.has(String(dish.id))).length;

        return `
            <div>
                <h3 class="mb-1 flex justify-between text-xs uppercase tracking-wide text-neutral-400">
                    <span>${escapeHtml(course?.course_nl || course?.course)}</span>
                    <span>${claimed}/${dishes.length} geclaimd</span>
                </h3>
                <ul class="divide-y divide-neutral-800 rounded-md border border-neutral-800">
                    ${dishes.map((dish) => {
                        const guest = claimedBy.get(String(dish.id));
                        const owner = guest
                            ? `<span class="inline-flex items-center gap-2 text-neutral-100">${escapeHtml(guest.guestName)}${guest.house ? houseLogo(guest.house, 'h-5 w-5') : ''}</span>`
                            : '<span class="text-emerald-400">vrij</span>';

                        return `
                            <li class="flex items-center justify-between gap-3 px-3 py-1.5 transition-colors hover:bg-neutral-800/40">
                                <span><span class="text-neutral-500">#${escapeHtml(dish.id)}</span> ${escapeHtml(dish.name_nl || dish.name)}</span>
                                <span class="text-right text-xs">${owner}</span>
                            </li>`;
                    }).join('')}
                </ul>
            </div>`;
    }).join('');

    if (!state.dishesRendered) {
        state.dishesRendered = true;
        const items = container.querySelectorAll('li');
        items.forEach((item) => item.classList.add('motion-safe:animate-fadeInUpFast'));
        stagger(items, 25, 600);
    }
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
                        <button type="button" data-edit="remove-course" ${courseClaimed ? 'disabled' : ''}
                            title="${courseClaimed ? 'Bevat gekozen gerechten' : 'Gang verwijderen'}" aria-label="Gang verwijderen" class="${EDIT_REMOVE_CLASS}">✕</button>
                    </div>
                    ${course.dishes.map((dish, di) => {
                        const guest = dish.id ? claimedBy.get(dish.id) : null;

                        return `
                            <div data-dish="${di}" class="space-y-1.5 rounded-md bg-neutral-950/60 p-2">
                                <div class="flex items-center justify-between gap-2 text-xs">
                                    <span class="text-neutral-500">${dish.id ? `#${escapeHtml(dish.id)}` : 'nieuw'}${guest ? ` · gekozen door <span class="text-neutral-300">${escapeHtml(guest.guestName)}</span>` : ''}</span>
                                    <button type="button" data-edit="remove-dish" ${guest ? 'disabled' : ''}
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
            <button type="button" data-edit="cancel" class="rounded-md border border-neutral-700 px-3 py-2 hover:border-neutral-500">Annuleren</button>
            <button type="button" data-edit="save" class="rounded-md bg-accent px-3 py-2 font-semibold text-neutral-950 hover:bg-amber-300 disabled:opacity-50">Menu opslaan</button>
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

    if (button.dataset.action === 'copy-link') {
        copyText(guest.inviteUrl);
        button.textContent = '✓';
        button.classList.add('border-emerald-500', 'text-emerald-400');
        restartAnimation(button, 'motion-safe:animate-popIn');
        setTimeout(() => {
            button.textContent = 'Link';
            button.classList.remove('border-emerald-500', 'text-emerald-400');
        }, 1200);
        return;
    }

    if (button.dataset.action === 'reset') {
        if (!window.confirm(`Reset ${guest.guestName} (${guest.code})?\nRSVP, huis en gerechten worden gewist.`)) {
            return;
        }

        state.highlightCode = guest.code;
        await runAction(() => request('POST', `/api/manage/guests/${encodeURIComponent(guest.code)}/reset`), `${guest.guestName} is gereset.`);
        return;
    }

    if (button.dataset.action === 'delete') {
        if (!window.confirm(`${guest.guestName} (${guest.code}) definitief verwijderen?\nGeclaimde gerechten komen vrij.`)) {
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
        <button type="button" data-remove-row aria-label="Rij verwijderen" class="rounded-md text-neutral-500 transition hover:rotate-90 hover:text-red-400">✕</button>`;
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

// ---------- Init ----------

function init() {
    loadSettings();

    el('manage-refresh').addEventListener('click', loadAll);
    el('manage-settings-toggle').addEventListener('click', () => setSettingsOpen(el('manage-settings').classList.contains('hidden')));
    el('manage-settings').addEventListener('submit', saveSettings);
    document.addEventListener('pointerdown', handleSettingsDismiss);
    document.addEventListener('keydown', handleSettingsDismiss);
    el('manage-settings-clear').addEventListener('click', clearSettings);
    el('manage-guest-list').addEventListener('click', handleTableClick);
    el('manage-create').addEventListener('submit', handleCreate);
    el('manage-dishes-edit').addEventListener('click', startCatalogEdit);
    el('manage-dishes').addEventListener('input', handleCatalogInput);
    el('manage-dishes').addEventListener('click', handleCatalogClick);
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
