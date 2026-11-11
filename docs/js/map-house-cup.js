import { EASTER_EGG_COUNT } from './api-client.js?v=30f5d85184';
import { closeDialogAnimated, showDialogAnimated } from './dialog-motion.js?v=30f5d85184';
import { playMapSound } from './map-sounds.js?v=30f5d85184';

// "House Cup" on the map: an hourglass per house, filled relative to the leading house. The button sits bottom-left
// and is shown once the guest has filled in everything, also after the change deadline. Standings come with the guest state and are refreshed after every egg find.
const HOUSE_NAMES = { gryffindor: 'Gryffindor', hufflepuff: 'Hufflepuff', ravenclaw: 'Ravenclaw', slytherin: 'Slytherin' };
// An empty-looking glass reads as "no data"; a sliver of sand reads as "nothing yet".
const MIN_FILL_PERCENT = 3;

function describeStandings(points) {
    const max = Math.max(...Object.values(points));

    if (max === 0) {
        return 'No points yet. The map is still keeping its secrets.';
    }

    const leaders = Object.keys(HOUSE_NAMES).filter((house) => points[house] === max).map((house) => HOUSE_NAMES[house]);

    if (leaders.length === 1) {
        return `${leaders[0]} is in the lead.`;
    }

    return `${leaders.slice(0, -1).join(', ')} and ${leaders.at(-1)} share the lead.`;
}

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Returns { update(points, foundCount), target(), pulse(glow) } for live updates after an egg find, or null when
// there's no House Cup. target() is the button's centre on screen (null while it isn't shown); pulse(glow) lights it
// up in a house colour as earned points land in it.
export function initMapHouseCup(guest) {
    const dialog = document.querySelector('[data-map-house-cup-dialog]');
    const openButton = document.querySelector('[data-map-house-cup-open]');

    // Only once the guest has filled in everything: accepted, sorted and dishes chosen.
    const isComplete = guest?.rsvpStatus === 'accepted' && Boolean(guest.house) && guest.dishIds?.length > 0;

    if (!(dialog instanceof HTMLDialogElement) || !(openButton instanceof HTMLElement) || !isComplete) {
        return null;
    }

    const summaryEl = dialog.querySelector('[data-house-cup-summary]');
    const foundEl = dialog.querySelector('[data-house-cup-found]');
    const columns = [...dialog.querySelectorAll('[data-house-cup-house]')].map((el) => ({
        house: el.dataset.houseCupHouse,
        el,
        fillEl: el.querySelector('[data-house-cup-fill]'),
        pointsEl: el.querySelector('[data-house-cup-points]')
    }));

    let points = { ...guest.housePoints };
    let foundCount = guest.foundEggIds?.length ?? 0;
    let pulseAnimation = null;

    const renderFill = () => {
        const max = Math.max(...Object.values(points));

        columns.forEach(({ house, fillEl }) => {
            if (fillEl instanceof HTMLElement) {
                const percent = max > 0 ? Math.max(MIN_FILL_PERCENT, (points[house] / max) * 100) : MIN_FILL_PERCENT;
                fillEl.style.height = `${percent}%`;
            }
        });
    };

    const renderText = () => {
        columns.forEach(({ house, el, pointsEl }) => {
            const own = house === guest.house;
            const value = points[house] ?? 0;

            if (pointsEl instanceof HTMLElement) {
                pointsEl.textContent = String(value);
            }

            el.querySelector('[data-house-cup-own]')?.classList.toggle('invisible', !own);
            el.setAttribute('aria-label', `${HOUSE_NAMES[house]}: ${value} points${own ? ' (your house)' : ''}`);
        });

        if (summaryEl instanceof HTMLElement) {
            summaryEl.textContent = describeStandings(points);
        }

        if (foundEl instanceof HTMLElement) {
            foundEl.textContent = foundCount >= EASTER_EGG_COUNT
                ? `You found all ${EASTER_EGG_COUNT} secrets of the map. Mischief well managed.`
                : `You found ${foundCount} of ${EASTER_EGG_COUNT} secrets on the map. Each new one earns your house 10 points.`;
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

    dialog.querySelectorAll('[data-map-house-cup-close]').forEach((button) => {
        button.addEventListener('click', close);
    });

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

    openButton.classList.remove('hidden');
    openButton.classList.add('flex');
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
            playMapSound('twinkle', 0, { volume: 0.6 });
        }
    };
}
