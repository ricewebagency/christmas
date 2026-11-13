import { clearGuestCode, getGuest, getStoredGuestCode, isApiError } from './api-client.js?v=929999881f';

// Relative to the site root; every built page has <base href> pointing there.
const PAGE_PATHS = {
    home: './',
    invite: './invite/',
    rsvp: './rsvp/',
    sorting: './sorting/',
    cabin: './cabin/',
    chamber: './chamber/',
    map: './map/'
};

const PAGE_NAMES = {
    home: 'the Great Hall',
    invite: 'the Invitation',
    rsvp: 'the RSVP',
    sorting: 'the Sorting Hat',
    cabin: 'the Hogwarts Express',
    chamber: 'the Chamber of Secrets',
    map: "the Marauder's Map"
};

export function getPageName(page) {
    return PAGE_NAMES[page] ?? PAGE_NAMES.home;
}

export function getPageUrl(page, params = {}) {
    const url = new URL(PAGE_PATHS[page] ?? PAGE_PATHS.home, document.baseURI);

    Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, String(value));
    });

    return url.href;
}

export function redirectToPage(page, params = {}) {
    window.location.replace(getPageUrl(page, params));
}

export function isEditMode() {
    return new URLSearchParams(window.location.search).get('edit') === '1';
}

function hasHouse(guest) {
    return Boolean(guest?.house);
}

function hasDishes(guest) {
    return (Array.isArray(guest?.dishIds) && guest.dishIds.length > 0) || Boolean(guest?.customDish);
}

export function getNextStep(guest) {
    if (!guest) {
        return 'home';
    }

    switch (guest.rsvpStatus) {
        case 'declined':
            return 'map';
        case 'accepted':
            if (!hasHouse(guest)) {
                return 'sorting';
            }

            return hasDishes(guest) ? 'map' : 'cabin';
        default:
            return 'invite';
    }
}

export function isPageAllowed(page, guest) {
    if (!guest) {
        return page === 'home';
    }

    const isAccepted = guest.rsvpStatus === 'accepted';

    switch (page) {
        case 'home':
        case 'invite':
            return true;
        case 'rsvp':
            return guest.rsvpStatus === 'pending' || guest.canChange;
        case 'sorting':
            // Re-sorting is allowed until the change deadline.
            return isAccepted && (!hasHouse(guest) || guest.canChange);
        case 'cabin':
            return isAccepted && hasHouse(guest) && (!hasDishes(guest) || guest.canChange);
        case 'chamber':
            return isAccepted && hasHouse(guest) && hasDishes(guest);
        case 'map':
            return (isAccepted && hasHouse(guest) && hasDishes(guest)) || guest.rsvpStatus === 'declined';
        default:
            return false;
    }
}

// Resolves with the guest when the page may be shown; otherwise redirects and resolves with null.
export async function guardPage(page) {
    if (!getStoredGuestCode()) {
        redirectToPage('home');
        return null;
    }

    let guest;

    try {
        guest = await getGuest();
    } catch (error) {
        if (isApiError(error, 404)) {
            clearGuestCode();
        }

        // The home page shows the right message (unknown code, sealed doors or unreachable castle).
        redirectToPage('home');
        return null;
    }

    if (!isPageAllowed(page, guest)) {
        redirectToPage(getNextStep(guest));
        return null;
    }

    return guest;
}

export function leaveGreatHall() {
    clearGuestCode();
    redirectToPage('home');
}

export function whenDomReady() {
    if (document.readyState !== 'loading') {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
    });
}

const DEADLINE_FORMAT = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Amsterdam'
});

export function formatChangeDeadline(guest) {
    const deadline = new Date(guest?.changeDeadline ?? '');
    return Number.isNaN(deadline.getTime()) ? '' : DEADLINE_FORMAT.format(deadline);
}
