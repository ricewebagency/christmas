import { getGuest, isApiError, sendAttendanceResponse } from './api-client.js';
import { getNextStep, guardPage, isEditMode, redirectToPage, whenDomReady } from './guest-flow.js';
import { getRandomExitDelayMs } from './page-transitions.js';

const ATTENDANCE_CHOICE_MAP = {
    yes: 'accepted',
    no: 'declined',
    accepted: 'accepted',
    declined: 'declined'
};

const RSVP_ERROR_MESSAGE = 'The owl could not deliver your letter, please try again.';

function wait(ms) {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

async function playRevealExitSequence(root = document) {
    const revealItems = Array.from(root.querySelectorAll('[data-reveal]'));
    if (!revealItems.length) {
        return;
    }

    const animationDurationMs = 800;
    let maxDelayMs = 0;

    revealItems.forEach((element) => {
        const delayMs = getRandomExitDelayMs();
        maxDelayMs = Math.max(maxDelayMs, delayMs);

        element.style.animation = 'none';
        void element.offsetWidth;

        element.style.animation = `revealFade ${animationDurationMs}ms ease-in forwards`;
        element.style.animationDelay = `${delayMs}ms`;
        element.style.animationDirection = 'reverse';
        element.style.animationFillMode = 'both';
    });

    await wait(maxDelayMs + animationDurationMs);
}

function populateGuestName(guest) {
    const guestNameEl = document.getElementById('guest-name');

    if (guestNameEl && guest?.guestName) {
        guestNameEl.textContent = guest.guestName;
    }
}

function toAttendanceStatus(value) {
    return ATTENDANCE_CHOICE_MAP[String(value ?? '').trim().toLowerCase()] ?? null;
}

function initDishSelectionLimit() {
    const dishCheckboxes = Array.from(document.querySelectorAll('.rsvp-checkbox'));

    if (!dishCheckboxes.length) {
        return;
    }

    const limit = 2;

    const updateCheckboxState = () => {
        const checkedCount = dishCheckboxes.filter((checkbox) => checkbox.checked).length;

        dishCheckboxes.forEach((checkbox) => {
            const shouldDisable = checkedCount >= limit && !checkbox.checked;
            checkbox.disabled = shouldDisable;
        });
    };

    dishCheckboxes.forEach((checkbox) => {
        checkbox.addEventListener('change', () => {
            const checkedCount = dishCheckboxes.filter((item) => item.checked).length;

            if (checkedCount > limit) {
                checkbox.checked = false;
            }

            updateCheckboxState();
        });
    });

    updateCheckboxState();
}

function initRsvpFormSubmission(guest) {
    const form = document.querySelector('form');
    if (!form) {
        return;
    }

    const choiceButtons = Array.from(form.querySelectorAll('.attendance-choice'));
    const responseInput = form.querySelector('#attendance-response');
    const submitButton = form.querySelector('button[type="submit"]');
    const rsvpRoot = document.getElementById('rsvp-root') || document;
    const burntPaper = document.querySelector('.burnt-paper-fade-out');
    const errorEl = document.querySelector('[data-rsvp-error]');
    let isSubmitting = false;

    const setError = (message) => {
        if (errorEl instanceof HTMLElement) {
            errorEl.textContent = message;
            errorEl.classList.toggle('hidden', !message);
        }
    };

    const setChoiceSubmittingState = () => {
        // Keep the selected and unselected choice states unchanged while submitting.
    };

    const setActiveChoice = (activeChoice) => {
        choiceButtons.forEach((button) => {
            button.classList.add('opacity-45');
            button.classList.remove('opacity-100');
            button.classList.remove('text-black');
            button.classList.add('text-charcoal/85');
        });

        if (activeChoice instanceof HTMLButtonElement) {
            activeChoice.classList.remove('opacity-45');
            activeChoice.classList.add('opacity-100');
            activeChoice.classList.remove('text-charcoal/85');
            activeChoice.classList.add('text-black');
        }
    };

    // When changing an earlier answer, start from the current choice.
    if (isEditMode() && guest.rsvpStatus !== 'pending') {
        const currentChoice = choiceButtons.find((button) => toAttendanceStatus(button.dataset.attendanceChoice) === guest.rsvpStatus);

        if (currentChoice && responseInput instanceof HTMLInputElement) {
            responseInput.value = currentChoice.dataset.attendanceChoice || '';
            setActiveChoice(currentChoice);
        }
    }

    choiceButtons.forEach((button) => {
        button.addEventListener('click', () => {
            if (!isSubmitting) {
                if (responseInput instanceof HTMLInputElement) {
                    responseInput.value = button.dataset.attendanceChoice || '';
                }
                setActiveChoice(button);
            }
        });
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        if (isSubmitting) {
            return;
        }

        if (!(responseInput instanceof HTMLInputElement)) {
            return;
        }

        const attendanceResponse = toAttendanceStatus(responseInput.value);
        if (!attendanceResponse) {
            if (choiceButtons[0] instanceof HTMLButtonElement) {
                choiceButtons[0].focus();
            }
            return;
        }

        if (burntPaper) {
            burntPaper.classList.remove('burnt-paper-fade-out');
            void burntPaper.offsetWidth;
            burntPaper.classList.add('burnt-paper-fade-out');
        }

        isSubmitting = true;
        setChoiceSubmittingState();
        setError('');

        choiceButtons.forEach((button) => {
            button.disabled = true;
            button.classList.add('pointer-events-none');
        });
        if (submitButton instanceof HTMLButtonElement) {
            submitButton.disabled = true;
            submitButton.classList.add('opacity-60', 'pointer-events-none');
        }

        try {
            await playRevealExitSequence(rsvpRoot);
            const updatedGuest = await sendAttendanceResponse(attendanceResponse);
            redirectToPage(getNextStep(updatedGuest));
        } catch (error) {
            if (isApiError(error, 403) || isApiError(error, 404)) {
                // Sealed after the deadline (or unknown guest): continue from the actual state.
                const latestGuest = await getGuest({ refresh: true }).catch(() => null);
                redirectToPage(getNextStep(latestGuest));
                return;
            }

            setError(RSVP_ERROR_MESSAGE);
            isSubmitting = false;
            setChoiceSubmittingState();
            if (burntPaper) {
                burntPaper.classList.remove('burnt-paper-fade-out');
            }
            window.dispatchEvent(new Event('reveal-sequence:start'));
            choiceButtons.forEach((button) => {
                button.disabled = false;
                button.classList.remove('pointer-events-none');
            });
            if (submitButton instanceof HTMLButtonElement) {
                submitButton.disabled = false;
                submitButton.classList.remove('opacity-60', 'pointer-events-none');
            }
        }
    });
}

async function bootstrapRsvpPage() {
    const guest = await guardPage('rsvp');

    if (!guest) {
        return;
    }

    await whenDomReady();
    populateGuestName(guest);
    initDishSelectionLimit();
    initRsvpFormSubmission(guest);
}

void bootstrapRsvpPage();
