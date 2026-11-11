import { COMPLETION_BONUS_POINTS, EASTER_EGG_COUNT } from './api-client.js';
import { closeDialogAnimated, showDialogAnimated } from './dialog-motion.js';
import { playMapSound, preloadMapSounds } from './map-sounds.js';

// "House Cup": an hourglass per house, filled relative to the leading house. The button sits bottom-left on every
// page from the Sorting Hat onwards, for every guest. Guests without a house get a notice in the dialog (and a dot
// on the button). Standings come with the guest state and are refreshed after every egg find on the map.
const HOUSES = {
    gryffindor: { name: 'Gryffindor', fill: 'from-[#5c0707] to-[#ae2a1f]' },
    hufflepuff: { name: 'Hufflepuff', fill: 'from-[#a8770f] to-[#ecb939]' },
    ravenclaw: { name: 'Ravenclaw', fill: 'from-[#0e1a40] to-[#2d4a8a]' },
    slytherin: { name: 'Slytherin', fill: 'from-[#10301c] to-[#2a6b40]' }
};
// An empty-looking glass reads as "no data"; a sliver of sand reads as "nothing yet".
const MIN_FILL_PERCENT = 3;
const PARCHMENT_URL = new URL('../assets/images/parchment-cropped.png', import.meta.url).href;
const crestUrl = (house) => new URL(`../assets/images/admin/${house}-logo.png`, import.meta.url).href;

const BUTTON_HTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
        <path d="M8 21h8M12 17v4" />
        <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" />
        <path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
    </svg>
    <span data-house-cup-badge aria-hidden="true" class="absolute -right-0.5 -top-0.5 hidden h-2.5 w-2.5 rounded-full bg-amber-300 ring-1 ring-neutral-950/60 motion-safe:animate-pulse"></span>`;

const houseColumnHtml = (house) => `
    <li data-house-cup-house="${house}" class="flex min-w-0 flex-1 flex-col items-center gap-1.5">
        <img src="${crestUrl(house)}" alt="" class="h-10 w-10 rounded-lg object-contain short:h-8 short:w-8 short:rounded-md">
        <div aria-hidden="true" class="relative h-36 w-7 overflow-hidden rounded-full border border-charcoal/40 bg-charcoal/[0.06] shadow-[inset_0_2px_4px_rgba(0,0,0,0.15)] short:h-24 short:w-6">
            <div data-house-cup-fill class="absolute inset-x-0 bottom-0 h-0 rounded-full bg-gradient-to-t ${HOUSES[house].fill} transition-[height] duration-[1400ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"></div>
        </div>
        <span data-house-cup-points class="text-lg leading-none short:text-base">0</span>
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
    const columns = [...dialog.querySelectorAll('[data-house-cup-house]')].map((el) => ({
        house: el.dataset.houseCupHouse,
        el,
        fillEl: el.querySelector('[data-house-cup-fill]'),
        pointsEl: el.querySelector('[data-house-cup-points]')
    }));

    let house = HOUSES[guest.house] ? guest.house : null;
    let points = { ...guest.housePoints };
    let foundCount = guest.foundEggIds?.length ?? 0;
    let pulseAnimation = null;

    const renderButton = () => {
        const label = house ? 'House Cup' : 'House Cup (not sorted into a house yet)';
        openButton.setAttribute('aria-label', label);
        openButton.title = label;
        badgeEl?.classList.toggle('hidden', Boolean(house));
    };

    const renderFill = () => {
        const max = Math.max(...Object.values(points));

        columns.forEach(({ house: column, fillEl }) => {
            if (fillEl instanceof HTMLElement) {
                const percent = max > 0 ? Math.max(MIN_FILL_PERCENT, (points[column] / max) * 100) : MIN_FILL_PERCENT;
                fillEl.style.height = `${percent}%`;
            }
        });
    };

    const renderText = () => {
        columns.forEach(({ house: column, el, pointsEl }) => {
            const own = column === house;
            const value = points[column] ?? 0;

            if (pointsEl instanceof HTMLElement) {
                pointsEl.textContent = String(value);
            }

            el.querySelector('[data-house-cup-own]')?.classList.toggle('invisible', !own);
            el.setAttribute('aria-label', `${HOUSES[column].name}: ${value} points${own ? ' (your house)' : ''}`);
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

    const emptyFill = () => {
        columns.forEach(({ fillEl }) => {
            if (fillEl instanceof HTMLElement) {
                fillEl.style.height = '0%';
            }
        });
    };

    const close = () => void closeDialogAnimated(dialog).then(emptyFill);

    preloadMapSounds(['popup', 'cupPoints']);

    // Like the volume and admin buttons: keep taps away from page-level handlers (easter eggs, audio unlock).
    openButton.addEventListener('pointerdown', (event) => event.stopPropagation());
    openButton.addEventListener('click', (event) => {
        event.stopPropagation();
        renderText();
        emptyFill();
        playMapSound('popup');
        showDialogAnimated(dialog);
        // Commit the empty glasses first, so the sand pours in.
        void dialog.offsetWidth;
        window.requestAnimationFrame(renderFill);
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

    return {
        update(nextPoints, nextFoundCount) {
            points = nextPoints ? { ...points, ...nextPoints } : points;
            foundCount = Number.isFinite(nextFoundCount) ? nextFoundCount : foundCount;

            if (dialog.open) {
                renderText();
                renderFill();
            }
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
}
