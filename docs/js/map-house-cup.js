import { EASTER_EGG_COUNT } from './api-client.js';
import { closeDialogAnimated, showDialogAnimated } from './dialog-motion.js';

// "House Cup" on the map: an hourglass per house, filled relative to the leading house. Shown to sorted guests,
// also after the change deadline. Standings come with the guest state and are refreshed after every egg find.
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

// Returns { update(points, foundCount) } for live updates after an egg find, or null when there's no House Cup.
export function initMapHouseCup(guest) {
    const dialog = document.querySelector('[data-map-house-cup-dialog]');
    const openButton = document.querySelector('[data-map-house-cup-open]');

    if (!(dialog instanceof HTMLDialogElement) || !(openButton instanceof HTMLElement) || !guest?.house) {
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

    openButton.addEventListener('click', () => {
        renderText();
        emptyFill();
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
    openButton.classList.add('inline-flex');

    return {
        update(nextPoints, nextFoundCount) {
            points = nextPoints ? { ...points, ...nextPoints } : points;
            foundCount = Number.isFinite(nextFoundCount) ? nextFoundCount : foundCount;

            if (dialog.open) {
                renderText();
                renderFill();
            }
        }
    };
}
