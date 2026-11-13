import { COMPLETION_BONUS_POINTS, EASTER_EGG_COUNT } from './api-client.js?v=93d7544f9f';
import { closeDialogAnimated, showDialogAnimated } from './dialog-motion.js?v=93d7544f9f';
import { playMapSound, preloadMapSounds } from './map-sounds.js?v=93d7544f9f';

// "House Cup": an hourglass per house, filled relative to the leading house. The button sits bottom-left on every
// page from the Sorting Hat onwards, for every guest. Guests without a house get a notice in the dialog (and a dot
// on the button). Standings come with the guest state and are refreshed after every egg find on the map.
// Points other guests earned since this browser last opened the dialog show as a quiet dot and a one-time pulse on
// page load; in the dialog only those glasses pour, from where the guest last saw them, with a brief "+N".
// Otherwise all glasses pour from empty, one after the other, the leader last, and its crest lights up.
const HOUSES = {
    // glow: same colours as in map-rewards.js.
    gryffindor: { name: 'Gryffindor', fill: 'from-[#5c0707] to-[#ae2a1f]', glow: 'rgba(255, 197, 0, 0.55)' },
    hufflepuff: { name: 'Hufflepuff', fill: 'from-[#a8770f] to-[#ecb939]', glow: 'rgba(236, 185, 57, 0.6)' },
    ravenclaw: { name: 'Ravenclaw', fill: 'from-[#0e1a40] to-[#2d4a8a]', glow: 'rgba(148, 107, 45, 0.6)' },
    slytherin: { name: 'Slytherin', fill: 'from-[#10301c] to-[#2a6b40]', glow: 'rgba(170, 170, 170, 0.6)' }
};
// Fill = (points / leader's points) ^ FILL_EXPONENT. Below 1 it pulls the glasses together, so trailing houses don't
// look hopeless: at 1/3, a quarter of the leader's points fills 63% of the glass, half fills 79%. 1 = linear.
const FILL_EXPONENT = 1 / 3;
// Pouring starts while the dialog fades in; each next glass a little later.
const POUR_START_MS = 200;
const POUR_STAGGER_MS = 120;
const POUR_MS = 1400;
// easeOutCubic, for the sand and for the counters, so they arrive together.
const POUR_EASING = 'cubic-bezier(0.33, 1, 0.68, 1)';
const easeOutCubic = (t) => 1 - (1 - t) ** 3;const GAIN_MS = 3000;const SEEN_STORAGE_PREFIX = 'house-cup-seen:';
// After the page has settled, so the pulse isn't lost in the page's own entrance.
const NEWS_PULSE_DELAY_MS = 1200;
const PARCHMENT_URL = new URL('../assets/images/parchment-cropped.png', import.meta.url).href;
const crestUrl = (house) => new URL(`../assets/images/admin/${house}-logo.png`, import.meta.url).href;

const BUTTON_HTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
        <path d="M8 21h8M12 17v4" />
        <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" />
        <path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
    </svg>
    <span data-house-cup-badge aria-hidden="true" class="absolute -right-0.5 -top-0.5 hidden h-2.5 w-2.5 rounded-full bg-amber-300 ring-1 ring-neutral-950/60 motion-safe:animate-pulse"></span>
    <span data-house-cup-news aria-hidden="true" class="absolute -right-0.5 -top-0.5 hidden h-2 w-2 rounded-full bg-amber-100 ring-1 ring-neutral-950/60"></span>`;

const houseColumnHtml = (house) => `
    <li data-house-cup-house="${house}" class="flex min-w-0 flex-1 flex-col items-center gap-1.5">
        <img data-house-cup-crest src="${crestUrl(house)}" alt="" class="h-10 w-10 rounded-lg object-contain short:h-8 short:w-8 short:rounded-md">
        <div aria-hidden="true" class="relative h-36 w-7 overflow-hidden rounded-full border border-charcoal/40 bg-charcoal/[0.06] shadow-[inset_0_2px_4px_rgba(0,0,0,0.15)] short:h-24 short:w-6">
            <div data-house-cup-fill class="absolute inset-x-0 bottom-0 h-0 rounded-full bg-gradient-to-t ${HOUSES[house].fill}"></div>
        </div>
        <span class="relative text-lg leading-none short:text-base">
            <span data-house-cup-points>0</span>
            <span data-house-cup-gain aria-hidden="true" class="absolute left-full top-0 ml-1 whitespace-nowrap text-xs leading-none text-charcoal/80 opacity-0"></span>
        </span>
        <span class="max-w-full truncate text-[11px] italic leading-none text-charcoal/75">${HOUSES[house].name}</span>
        <span data-house-cup-own class="invisible text-[10px] italic leading-none text-charcoal/60">your house</span>
    </li>`;

const DIALOG_HTML = `
    <div class="relative">
        <img src="${PARCHMENT_URL}" alt="" class="pointer-events-none absolute inset-0 h-full w-full select-none object-fill">
        <div class="relative px-6 pb-10 pt-12 text-center short:px-5 short:pb-7 short:pt-9">
            <h2 id="house-cup-title" class="text-xl leading-tight short:text-lg">The House Cup</h2>
            <svg aria-hidden="true" viewBox="0 0 40 12" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" class="mx-auto mt-2 h-3 w-10 opacity-60">
                <path d="M38 6C30 6 26 9 20 8 13 7 11 2 6 3 2 4 2 9 6 9 9 9 9 5 6 6" />
            </svg>
            <p id="house-cup-summary" data-house-cup-summary aria-live="polite" class="mt-2 text-sm italic leading-snug"></p>

            <div data-house-cup-unsorted role="note" class="mt-4 hidden rounded-sm border border-dashed border-charcoal/40 bg-charcoal/[0.05] px-3 py-2.5 short:mt-3 short:py-2">
                <p class="text-sm leading-snug">You haven't been sorted into a house yet.</p>
                <p data-house-cup-unsorted-hint class="mt-1 text-xs italic leading-snug text-charcoal/75"></p>
            </div>

            <ul aria-label="Points per house" class="mt-5 flex items-end justify-between gap-2 short:mt-3">
                ${Object.keys(HOUSES).map(houseColumnHtml).join('')}
            </ul>

            <p data-house-cup-found class="mt-5 text-xs italic leading-snug text-charcoal/75 short:mt-3"></p>
        </div>
        <!-- Last in DOM order, so opening the dialog doesn't put focus on the close button first. -->
        <button data-house-cup-close data-pop="small" type="button" aria-label="Close"
            class="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full text-charcoal/60 transition-colors duration-200 hover:text-charcoal focus:outline-none focus-visible:text-charcoal focus-visible:outline-dashed focus-visible:outline-1 focus-visible:outline-charcoal/50">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" class="h-4 w-4">
                <path d="M6 6l12 12M18 6 6 18" />
            </svg>
        </button>
    </div>`;

function describeStandings(points) {
    const max = Math.max(...Object.values(points));

    if (max === 0) {
        return 'No points yet. The map is still keeping its secrets.';
    }

    const leaders = Object.keys(HOUSES).filter((house) => points[house] === max).map((house) => HOUSES[house].name);

    if (leaders.length === 1) {
        return `${leaders[0]} is in the lead.`;
    }

    return `${leaders.slice(0, -1).join(', ')} and ${leaders.at(-1)} share the lead.`;
}

function unsortedHint(guest) {
    if (guest?.rsvpStatus === 'declined') {
        return 'Only guests at the banquet are sorted, but you can still follow the race.';
    }

    return 'Let the Sorting Hat decide and your house earns 10 points the moment you are sorted.';
}

// Per browser: the standings as they were when this guest last opened the dialog.
function readSeen(code) {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(SEEN_STORAGE_PREFIX + code) ?? 'null');
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function writeSeen(code, seen) {
    try {
        window.localStorage.setItem(SEEN_STORAGE_PREFIX + code, JSON.stringify(seen));
    } catch {
        // Without storage the news just isn't remembered.
    }
}

const currentPoints = (points) => Object.fromEntries(Object.keys(HOUSES).map((house) => [house, points[house] ?? 0]));

// Button and dialog live bottom-left (volume button below, admin button above; audio-toggle.js).
function mount() {
    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.dataset.houseCupOpen = '';
    openButton.setAttribute('aria-haspopup', 'dialog');
    openButton.setAttribute('aria-controls', 'house-cup-dialog');
    openButton.className = 'fixed bottom-[3.25rem] left-3 z-[1000] flex h-8 w-8 items-center justify-center rounded-full bg-neutral-950/30 text-amber-50 opacity-50 backdrop-blur-sm transition hover:bg-neutral-950/60 hover:opacity-100 focus:outline-none focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-amber-200/60 sm:bottom-14 sm:left-4';
    openButton.innerHTML = BUTTON_HTML;

    const dialog = document.createElement('dialog');
    dialog.id = 'house-cup-dialog';
    dialog.lang = 'en';
    dialog.setAttribute('aria-labelledby', 'house-cup-title');
    dialog.setAttribute('aria-describedby', 'house-cup-summary');
    dialog.className = 'max-h-[calc(100dvh-2rem)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain bg-transparent p-0 font-inkpot text-charcoal [scrollbar-width:none] transition duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] backdrop:bg-black/70 backdrop:backdrop-blur-[2px] backdrop:transition-opacity backdrop:duration-300';
    dialog.innerHTML = DIALOG_HTML;

    document.body.append(openButton, dialog);
    return { openButton, dialog };
}

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Returns { update(points, foundCount), setHouse(house), target(), pulse(glow) }, or null without a guest.
// update() refreshes the standings after an egg find; setHouse() after the Sorting Hat decides. target() is the
// button's centre on screen; pulse(glow) lights it up in a house colour as earned points land in it.
export function initHouseCup(guest) {
    if (!guest) {
        return null;
    }

    const { openButton, dialog } = mount();
    const summaryEl = dialog.querySelector('[data-house-cup-summary]');
    const foundEl = dialog.querySelector('[data-house-cup-found]');
    const unsortedEl = dialog.querySelector('[data-house-cup-unsorted]');
    const unsortedHintEl = dialog.querySelector('[data-house-cup-unsorted-hint]');
    const badgeEl = openButton.querySelector('[data-house-cup-badge]');
    const newsEl = openButton.querySelector('[data-house-cup-news]');
    const columns = [...dialog.querySelectorAll('[data-house-cup-house]')].map((el) => ({
        house: el.dataset.houseCupHouse,
        el,
        crestEl: el.querySelector('[data-house-cup-crest]'),
        fillEl: el.querySelector('[data-house-cup-fill]'),
        pointsEl: el.querySelector('[data-house-cup-points]'),
        gainEl: el.querySelector('[data-house-cup-gain]')
    }));

    let house = HOUSES[guest.house] ? guest.house : null;
    let points = { ...guest.housePoints };
    let foundCount = guest.foundEggIds?.length ?? 0;
    let pulseAnimation = null;

    // null when there's nothing to compare against (no guest code). A first visit stores the current standings, so
    // nothing reads as new; a score that went down (admin reset) lowers the mark, so later gains still show.
    const code = guest.code || null;
    let seen = null;

    if (code) {
        const stored = readSeen(code);
        const now = currentPoints(points);
        seen = stored
            ? Object.fromEntries(Object.entries(now).map(([column, value]) => {
                const mark = Number(stored[column]);
                return [column, Number.isFinite(mark) ? Math.min(mark, value) : value];
            }))
            : now;
        writeSeen(code, seen);
    }

    // The gains shown in the open dialog; fixed when it opens, so they stay put while the guest reads them.
    let shownGains = {};

    const gainsSinceSeen = () => (seen
        ? Object.fromEntries(Object.keys(HOUSES).map((column) => [column, Math.max(0, (points[column] ?? 0) - seen[column])]))
        : {});
    const hasNews = () => Object.values(gainsSinceSeen()).some((gain) => gain > 0);

    const markSeen = () => {
        if (code) {
            seen = currentPoints(points);
            writeSeen(code, seen);
        }
    };

    const renderButton = () => {
        // The "not sorted" dot wins: that one asks for something.
        const news = Boolean(house) && hasNews();
        const label = !house ? 'House Cup (not sorted into a house yet)' : news ? 'House Cup (new points)' : 'House Cup';
        openButton.setAttribute('aria-label', label);
        openButton.title = label;
        badgeEl?.classList.toggle('hidden', Boolean(house));
        newsEl?.classList.toggle('hidden', !news);
    };

    let pourAnimations = [];
    let counterFrame = 0;

    const fillPercent = (value, max) => (max > 0 ? Math.max(0, value / max) ** FILL_EXPONENT * 100 : 0);

    const stopPour = () => {
        pourAnimations.forEach((animation) => animation.cancel());
        pourAnimations = [];
        window.cancelAnimationFrame(counterFrame);
        counterFrame = 0;
    };

    // The end state at once: after a live update while the dialog is open.
    const showStandings = () => {
        stopPour();
        const max = Math.max(...Object.values(points));

        columns.forEach(({ house: column, fillEl, pointsEl }) => {
            fillEl.style.height = `${fillPercent(points[column] ?? 0, max)}%`;
            pointsEl.textContent = String(points[column] ?? 0);
        });
    };

    const pour = () => {
        stopPour();
        const max = Math.max(...Object.values(points));
        const motion = !reduceMotion();
        const withNews = Object.values(shownGains).some((gain) => gain > 0);
        // With news only the glasses that gained pour, from where the guest last saw them; otherwise all, from empty.
        // Leader last, so the pour ends on the house in the lead.
        const pouring = columns
            .filter(({ house: column }) => !withNews || shownGains[column] > 0)
            .sort((a, b) => (points[a.house] ?? 0) - (points[b.house] ?? 0))
            .map((column, index) => {
                const to = points[column.house] ?? 0;
                const from = withNews ? to - shownGains[column.house] : 0;
                return {
                    ...column,
                    from,
                    to,
                    fromPercent: withNews ? fillPercent(from, max) : 0,
                    delay: POUR_START_MS + (motion ? index * POUR_STAGGER_MS : 0)
                };
            });

        const run = (el, keyframes, options) => pourAnimations.push(el.animate(keyframes, options));

        columns.forEach(({ house: column, fillEl, pointsEl }) => {
            fillEl.style.height = `${fillPercent(points[column] ?? 0, max)}%`;
            pointsEl.textContent = String(points[column] ?? 0);
        });

        pouring.forEach(({ house: column, fillEl, pointsEl, gainEl, from, fromPercent, delay }) => {
            const toHeight = fillEl.style.height;
            pointsEl.textContent = String(from);

            if (motion) {
                run(fillEl, [{ height: `${fromPercent}%` }, { height: toHeight }], { duration: POUR_MS, delay, easing: POUR_EASING, fill: 'backwards' });
            }

            const gain = shownGains[column] ?? 0;

            if (gain > 0) {
                gainEl.textContent = `+${gain}`;
                run(gainEl, motion
                    ? [
                        { opacity: 0, transform: 'translateY(4px) scale(0.6)' },
                        { opacity: 1, transform: 'translateY(0) scale(1.15)', offset: 0.08 },
                        { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.16 },
                        { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.7 },
                        { opacity: 0, transform: 'translateY(-10px) scale(0.95)' }
                    ]
                    : [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }],
                { duration: GAIN_MS, delay: delay + POUR_MS * 0.35, easing: 'ease-out' });
            }
        });

        // The counters follow the sand.
        const startedAt = document.timeline.currentTime ?? performance.now();
        const tick = (now) => {
            let running = false;

            pouring.forEach(({ pointsEl, from, to, delay }) => {
                const t = Math.min(1, Math.max(0, (now - startedAt - delay) / POUR_MS));
                pointsEl.textContent = String(Math.round(from + (to - from) * easeOutCubic(t)));
                running ||= t < 1;
            });

            counterFrame = running ? window.requestAnimationFrame(tick) : 0;
        };
        counterFrame = window.requestAnimationFrame(tick);

        // The leader's crest lights up as its glass fills up.
        const last = pouring.at(-1);

        if (motion && max > 0 && last) {
            columns
                .filter(({ house: column }) => points[column] === max)
                .forEach(({ house: column, crestEl }) => run(crestEl, [
                    { transform: 'scale(1)', filter: 'drop-shadow(0 0 0 rgba(0, 0, 0, 0))' },
                    { transform: 'scale(1.12)', filter: `drop-shadow(0 0 8px ${HOUSES[column].glow})`, offset: 0.35 },
                    { transform: 'scale(1)', filter: 'drop-shadow(0 0 0 rgba(0, 0, 0, 0))' }
                ], { duration: 1200, delay: last.delay + POUR_MS * 0.7, easing: 'ease-in-out' }));
        }
    };

    const renderText = () => {
        columns.forEach(({ house: column, el }) => {
            const own = column === house;
            const value = points[column] ?? 0;
            const gain = shownGains[column] ?? 0;

            el.querySelector('[data-house-cup-own]')?.classList.toggle('invisible', !own);
            el.setAttribute('aria-label', `${HOUSES[column].name}: ${value} points${gain > 0 ? `, ${gain} since your last look` : ''}${own ? ' (your house)' : ''}`);
        });

        if (summaryEl instanceof HTMLElement) {
            summaryEl.textContent = describeStandings(points);
        }

        unsortedEl?.classList.toggle('hidden', Boolean(house));

        if (unsortedHintEl instanceof HTMLElement) {
            unsortedHintEl.textContent = house ? '' : unsortedHint(guest);
        }

        if (foundEl instanceof HTMLElement) {
            foundEl.classList.toggle('hidden', !house);
            foundEl.textContent = foundCount >= EASTER_EGG_COUNT
                ? `You found all ${EASTER_EGG_COUNT} secrets of the map, and ${COMPLETION_BONUS_POINTS} bonus points. Mischief well managed.`
                : `You found ${foundCount} of ${EASTER_EGG_COUNT} secrets on the map. Each new one earns your house 10 points, and finding them all ${COMPLETION_BONUS_POINTS} more.`;
        }
    };

    const close = () => void closeDialogAnimated(dialog).then(stopPour);

    preloadMapSounds(['popup', 'cupPoints']);

    // Like the volume and admin buttons: keep taps away from page-level handlers (easter eggs, audio unlock).
    openButton.addEventListener('pointerdown', (event) => event.stopPropagation());
    openButton.addEventListener('click', (event) => {
        event.stopPropagation();
        shownGains = gainsSinceSeen();
        markSeen();
        renderButton();
        renderText();
        pour();
        playMapSound('popup');
        showDialogAnimated(dialog);
    });

    dialog.querySelector('[data-house-cup-close]')?.addEventListener('click', close);

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

    renderButton();
    // audio-toggle.js moves the admin button up one slot while this is set; the event covers an admin button that's already there.
    document.body.dataset.houseCupVisible = '';
    window.dispatchEvent(new CustomEvent('house-cup-visible'));

    const api = {
        update(nextPoints, nextFoundCount) {
            const previous = points;
            points = nextPoints ? { ...points, ...nextPoints } : points;
            foundCount = Number.isFinite(nextFoundCount) ? nextFoundCount : foundCount;

            if (dialog.open) {
                // Watching the standings as they change: all of it counts as seen.
                markSeen();
                renderText();
                showStandings();
            } else if (seen && house) {
                // The guest's own points just flew into the cup, so they aren't news.
                seen = { ...seen, [house]: seen[house] + Math.max(0, (points[house] ?? 0) - (previous[house] ?? 0)) };
                writeSeen(code, seen);
            }

            renderButton();
        },

        setHouse(nextHouse) {
            house = HOUSES[nextHouse] ? nextHouse : null;
            renderButton();

            if (dialog.open) {
                renderText();
            }
        },

        target() {
            const rect = openButton.getBoundingClientRect();
            return rect.width > 0 ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
        },

        pulse(glow) {
            // Back to whatever the button shows right now (dimmed, or full while hovered or focused).
            pulseAnimation?.cancel();
            const rest = getComputedStyle(openButton).opacity;
            const noGlow = '0 0 0 0 rgba(0, 0, 0, 0)';

            pulseAnimation = openButton.animate(reduceMotion()
                ? [{ opacity: rest }, { opacity: 1, offset: 0.3 }, { opacity: rest }]
                : [
                    { transform: 'scale(1)', opacity: rest, boxShadow: noGlow, easing: 'ease-out' },
                    { transform: 'scale(1.18)', opacity: 1, boxShadow: `0 0 16px 4px ${glow}`, offset: 0.2, easing: 'ease-in-out' },
                    { transform: 'scale(1)', opacity: 1, boxShadow: `0 0 10px 2px ${glow}`, offset: 0.5, easing: 'ease-in' },
                    { transform: 'scale(1)', opacity: rest, boxShadow: noGlow }
                ], { duration: 1400 });
            playMapSound('cupPoints');
            playMapSound('twinkle', 0, { volume: 0.6 });
        }
    };

    // Points came in while the guest was away: light the button once, in the colour of the house that gained most.
    const gains = gainsSinceSeen();
    const topGainer = Object.keys(gains).reduce((best, column) => (gains[column] > (gains[best] ?? 0) ? column : best), null);

    if (topGainer) {
        window.setTimeout(() => api.pulse(HOUSES[topGainer].glow), NEWS_PULSE_DELAY_MS);
    }

    return api;
}
