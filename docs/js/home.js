import {
    clearGuestCode,
    getStoredGuestCode,
    readGuestCodeFromUrl,
    removeGuestCodeFromUrl,
    verifyGuestCode
} from './api-client.js?v=eb274ee553';
import { getNextStep, redirectToPage } from './guest-flow.js?v=eb274ee553';
import { getPinErrorKind } from './pin-dialog.js?v=eb274ee553';
import { removeCookie, removeLocalStorageItem } from './storage-utils.js?v=eb274ee553';

const LEGACY_LOCAL_STORAGE_KEYS = [
    'magical-winter-banquet.cabin',
    'magical-winter-banquet.cabin-dish-selection'
];
const LEGACY_COOKIE_NAMES = ['magical-winter-banquet.cabin'];

function cleanupLegacyStorage() {
    LEGACY_LOCAL_STORAGE_KEYS.forEach((key) => removeLocalStorageItem(key));
    LEGACY_COOKIE_NAMES.forEach((name) => removeCookie(name));
}

// The home page only routes: a known code goes to its next step, everyone else to the invitation,
// where the pincode dialog asks for the password.
async function initHome() {
    cleanupLegacyStorage();

    const linkedCode = readGuestCodeFromUrl();
    removeGuestCodeFromUrl();

    const candidateCode = linkedCode ?? getStoredGuestCode();

    if (!candidateCode) {
        redirectToPage('invite');
        return;
    }

    try {
        const guest = await verifyGuestCode(candidateCode);
        redirectToPage(getNextStep(guest));
    } catch (error) {
        const kind = getPinErrorKind(error);

        if (kind === 'unknown' && linkedCode === null) {
            // The stored code no longer exists: forget it.
            clearGuestCode();
        }

        if (kind === 'network') {
            // Let the invitation try again; a linked code is passed along so it can be prefilled.
            redirectToPage('invite', linkedCode === null ? {} : { code: linkedCode });
            return;
        }

        const params = { 'pin-error': kind };
        if (kind === 'sealed' && error?.retryAfterSeconds) {
            params['retry-after'] = error.retryAfterSeconds;
        }

        redirectToPage('invite', params);
    }
}

void initHome();
