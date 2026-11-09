import {
    getStoredGuestCode,
    isApiError,
    readGuestCodeFromUrl,
    removeGuestCodeFromUrl,
    verifyGuestCode,
    clearGuestCode
} from './api-client.js';
import { getNextStep, redirectToPage, whenDomReady } from './guest-flow.js';
import { removeCookie, removeLocalStorageItem } from './storage-utils.js';

const CODE_LENGTH = 4;
const LEGACY_LOCAL_STORAGE_KEYS = [
    'magical-winter-banquet.cabin',
    'magical-winter-banquet.cabin-dish-selection'
];
const LEGACY_COOKIE_NAMES = ['magical-winter-banquet.cabin'];

const MESSAGES = {
    unknown: 'That password is not known to the castle.',
    network: 'The owls could not reach the castle, try again.'
};

function cleanupLegacyStorage() {
    LEGACY_LOCAL_STORAGE_KEYS.forEach((key) => removeLocalStorageItem(key));
    LEGACY_COOKIE_NAMES.forEach((name) => removeCookie(name));
}

function getSealedMessage(retryAfterSeconds) {
    const minutes = Math.max(1, Math.ceil(Number(retryAfterSeconds || 60) / 60));
    return `The castle doors are sealed for a moment, try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}

function getErrorMessage(error) {
    if (isApiError(error, 404)) {
        return MESSAGES.unknown;
    }

    if (isApiError(error, 429)) {
        return getSealedMessage(error.retryAfterSeconds);
    }

    return MESSAGES.network;
}

function digitsOnly(value) {
    return String(value ?? '').replace(/\D/g, '').slice(0, CODE_LENGTH);
}

function initEntryForm({ message = '', prefill = '' } = {}) {
    const loadingEl = document.querySelector('[data-home-loading]');
    const form = document.querySelector('[data-home-form]');
    const input = document.getElementById('guest-code');
    const messageEl = document.querySelector('[data-home-message]');
    const submitButton = document.querySelector('[data-home-submit]');
    const boxes = Array.from(document.querySelectorAll('[data-home-code-box]'));

    if (!(form instanceof HTMLFormElement) || !(input instanceof HTMLInputElement)) {
        return;
    }

    let isSubmitting = false;

    const setMessage = (text) => {
        if (messageEl instanceof HTMLElement) {
            messageEl.textContent = text;
        }
    };

    const syncBoxes = () => {
        const value = input.value;
        const isFocused = document.activeElement === input;

        boxes.forEach((box, index) => {
            const isActive = isFocused && index === Math.min(value.length, CODE_LENGTH - 1);
            box.textContent = value[index] ?? '';
            box.classList.toggle('border-charcoal', isActive);
            box.classList.toggle('border-charcoal/40', !isActive);
        });

        if (submitButton instanceof HTMLButtonElement) {
            submitButton.disabled = isSubmitting || value.length !== CODE_LENGTH;
        }
    };

    const resetInput = () => {
        input.value = '';
        syncBoxes();
        input.focus();
    };

    const submit = async () => {
        const code = digitsOnly(input.value);

        if (isSubmitting || code.length !== CODE_LENGTH) {
            return;
        }

        isSubmitting = true;
        input.readOnly = true;
        setMessage('');
        syncBoxes();

        try {
            const guest = await verifyGuestCode(code);
            redirectToPage(getNextStep(guest));
        } catch (error) {
            isSubmitting = false;
            input.readOnly = false;
            setMessage(getErrorMessage(error));
            resetInput();
        }
    };

    input.addEventListener('input', () => {
        const cleaned = digitsOnly(input.value);

        if (cleaned !== input.value) {
            input.value = cleaned;
        }

        syncBoxes();

        if (cleaned.length === CODE_LENGTH) {
            void submit();
        }
    });

    input.addEventListener('focus', syncBoxes);
    input.addEventListener('blur', syncBoxes);

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        void submit();
    });

    loadingEl?.remove();
    form.classList.remove('hidden');
    form.classList.add('flex');

    // Code check is over: bring the burnt paper back (set by home-preflight.js).
    document.documentElement.removeAttribute('data-home-checking');

    input.value = digitsOnly(prefill);
    setMessage(message);
    syncBoxes();
    input.focus();
}

async function initHome() {
    cleanupLegacyStorage();

    const linkedCode = readGuestCodeFromUrl();
    removeGuestCodeFromUrl();

    const storedCode = getStoredGuestCode();
    const candidateCode = linkedCode ?? storedCode;

    await whenDomReady();

    if (!candidateCode) {
        initEntryForm();
        return;
    }

    try {
        const guest = await verifyGuestCode(candidateCode);
        redirectToPage(getNextStep(guest));
    } catch (error) {
        if (isApiError(error, 404)) {
            if (linkedCode === null) {
                // The stored code no longer exists: forget it and ask again.
                clearGuestCode();
                initEntryForm();
                return;
            }

            initEntryForm({ message: MESSAGES.unknown });
            return;
        }

        if (isApiError(error, 429)) {
            initEntryForm({ message: getErrorMessage(error) });
            return;
        }

        // Network or server error: keep the stored code so the guest can simply retry.
        initEntryForm({ message: MESSAGES.network, prefill: candidateCode });
    }
}

void initHome();
