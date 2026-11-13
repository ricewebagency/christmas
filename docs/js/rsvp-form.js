import { getGuest, isApiError, sendAttendanceResponse } from './api-client.js?v=eb274ee553';
import { getNextStep, guardPage, isEditMode, redirectToPage, whenDomReady } from './guest-flow.js?v=eb274ee553';
import { getRandomExitDelayMs } from './page-transitions.js?v=eb274ee553';
import './click-pop.js?v=eb274ee553';

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

// The owl may hoot a little past the letter fading out, but never holds up the next page longer than this.
const OWL_HOOT_MAX_WAIT_MS = 4000;
const OWL_HOOT_VOLUME = 0.5;

// Resolves when the hoot has ended, failed, or OWL_HOOT_MAX_WAIT_MS has passed since sending.
function playOwlHoot() {
    const audio = document.querySelector('audio[data-owl-hoot]');
    if (!(audio instanceof HTMLAudioElement)) {
        return Promise.resolve();
    }

    audio.pause();
    audio.currentTime = 0;
    audio.volume = OWL_HOOT_VOLUME;

    const ended = new Promise((resolve) => {
        audio.addEventListener('ended', resolve, { once: true });
        audio.play().catch(resolve);
    });

    return Promise.race([ended, wait(OWL_HOOT_MAX_WAIT_MS)]);
}

function populateGuestName(guest) {
    const guestNameEl = document.getElementById('guest-name');

    if (guestNameEl && guest?.guestName) {
        guestNameEl.textContent = guest.guestName;
    }
}

// A guest who sent their regrets earlier writes to change that answer.
const CHANGE_FROM_DECLINED_TEXTS = {
    intro: 'Earlier I sent my regrets for Christmas at the Great Hall on 24 December at 18:00, but I would like to change my answer.',
    answerLabel: 'My new answer is:'
};

function applyChangeTexts(guest) {
    if (guest?.rsvpStatus !== 'declined') {
        return;
    }

    const introEl = document.querySelector('[data-rsvp-intro]');
    const answerLabelEl = document.querySelector('[data-rsvp-answer-label]');

    if (introEl) {
        introEl.textContent = CHANGE_FROM_DECLINED_TEXTS.intro;
    }

    if (answerLabelEl) {
        answerLabelEl.textContent = CHANGE_FROM_DECLINED_TEXTS.answerLabel;
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
        // Selected styling is driven by aria-pressed variants in the markup.
        choiceButtons.forEach((button) => {
            button.setAttribute('aria-pressed', String(button === activeChoice));
        });

        // Submit button stays dimmed until a choice has been made.
        if (submitButton instanceof HTMLButtonElement) {
            submitButton.classList.toggle('opacity-50', !(activeChoice instanceof HTMLButtonElement));
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

        const owlHootDone = playOwlHoot();

        try {
            await playRevealExitSequence(rsvpRoot);
            const updatedGuest = await sendAttendanceResponse(attendanceResponse);
            await owlHootDone;
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
    applyChangeTexts(guest);
    initDishSelectionLimit();
    initRsvpFormSubmission(guest);
}

void bootstrapRsvpPage();
