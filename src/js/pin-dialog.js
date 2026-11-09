import { isApiError, verifyGuestCode } from './api-client.js';

const CODE_LENGTH = 4;

const MESSAGES = {
    unknown: 'That password is not invited to Christmas at the Great Hall.',
    network: 'The owls could not reach the castle, try again.'
};

function getSealedMessage(retryAfterSeconds) {
    const minutes = Math.max(1, Math.ceil(Number(retryAfterSeconds || 60) / 60));
    return `The castle doors are sealed for a moment, try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}

// Short name for a failed code check, so the home page can hand it to the invite page in the URL.
export function getPinErrorKind(error) {
    if (isApiError(error, 404)) {
        return 'unknown';
    }

    if (isApiError(error, 429)) {
        return 'sealed';
    }

    return 'network';
}

export function getPinErrorMessage(kind, retryAfterSeconds = null) {
    if (kind === 'unknown') {
        return MESSAGES.unknown;
    }

    if (kind === 'sealed') {
        return getSealedMessage(retryAfterSeconds);
    }

    return kind === 'network' ? MESSAGES.network : '';
}

function digitsOnly(value) {
    return String(value ?? '').replace(/\D/g, '').slice(0, CODE_LENGTH);
}

// Shows the modal pincode dialog (native <dialog>, so the rest of the page is inert) and resolves with the
// guest once a code is accepted. The dialog cannot be dismissed without a valid code.
export function openPinDialog({ message = '', prefill = '', canRetry = false } = {}) {
    const dialog = document.querySelector('[data-pin-dialog]');
    const form = dialog?.querySelector('[data-pin-form]');
    const boxesEl = dialog?.querySelector('[data-pin-code-boxes]');
    const digitInputs = Array.from(dialog?.querySelectorAll('[data-pin-code-digit]') ?? []);
    const messageEl = dialog?.querySelector('[data-pin-message]');
    const retryButton = dialog?.querySelector('[data-pin-retry]');

    if (!(dialog instanceof HTMLDialogElement) || !(form instanceof HTMLFormElement) || digitInputs.length !== CODE_LENGTH) {
        return new Promise(() => {});
    }

    return new Promise((resolve) => {
        let isSubmitting = false;
        let isDone = false;

        const getCode = () => digitInputs.map((input) => input.value).join('');

        const setCode = (value) => {
            const digits = digitsOnly(value);
            digitInputs.forEach((input, index) => {
                input.value = digits[index] ?? '';
            });
        };

        const firstEmptyIndex = () => {
            const index = digitInputs.findIndex((input) => input.value === '');
            return index === -1 ? CODE_LENGTH - 1 : index;
        };

        const focusDigit = (index) => {
            digitInputs[Math.max(0, Math.min(index, CODE_LENGTH - 1))].focus();
        };

        const setMessage = (text) => {
            if (messageEl instanceof HTMLElement) {
                messageEl.textContent = text;
            }
        };

        const setRetryVisible = (visible) => {
            retryButton?.classList.toggle('hidden', !visible);
        };

        const setError = (hasError) => {
            digitInputs.forEach((input) => {
                input.classList.toggle('border-red-900', hasError);
                input.classList.toggle('text-red-900', hasError);
                input.classList.toggle('border-charcoal/40', !hasError);
                input.classList.toggle('text-charcoal', !hasError);
            });
        };

        const shake = () => {
            if (!(boxesEl instanceof HTMLElement)) {
                return;
            }

            // Restart the animation, also when the previous shake has not finished yet.
            boxesEl.classList.remove('motion-safe:animate-shake');
            void boxesEl.offsetWidth;
            boxesEl.classList.add('motion-safe:animate-shake');
        };

        const setBusy = (busy) => {
            isSubmitting = busy;
            digitInputs.forEach((input) => {
                input.disabled = busy;
            });
            boxesEl?.classList.toggle('animate-pulse', busy);
        };

        const finish = (guest) => {
            isDone = true;
            dialog.classList.add('opacity-0', 'backdrop:opacity-0');

            window.setTimeout(() => {
                dialog.close();
                resolve(guest);
            }, 500);
        };

        const submit = async () => {
            const code = getCode();

            if (isSubmitting || isDone || code.length !== CODE_LENGTH) {
                return;
            }

            setMessage('');
            setRetryVisible(false);
            setError(false);
            setBusy(true);

            try {
                const guest = await verifyGuestCode(code);
                setBusy(false);
                finish(guest);
            } catch (error) {
                const kind = getPinErrorKind(error);

                setBusy(false);
                setMessage(getPinErrorMessage(kind, error?.retryAfterSeconds));

                if (kind !== 'network') {
                    setError(true);
                    shake();
                    setCode('');
                    focusDigit(0);
                    return;
                }

                // Network or server error: keep the code so one tap on "Try again" is enough.
                setRetryVisible(true);
                if (retryButton instanceof HTMLElement) {
                    retryButton.focus();
                }
            }
        };

        digitInputs.forEach((input, index) => {
            input.addEventListener('input', () => {
                const digits = input.value.replace(/\D/g, '');

                setError(false);
                setMessage('');
                setRetryVisible(false);

                if (digits === '') {
                    input.value = '';
                    return;
                }

                // Typing gives one digit; pasting can give several. Spread them over this box and the next ones.
                let target = index;
                for (const digit of digits) {
                    if (target >= CODE_LENGTH) {
                        break;
                    }
                    digitInputs[target].value = digit;
                    target += 1;
                }

                if (getCode().length === CODE_LENGTH) {
                    void submit();
                    return;
                }

                focusDigit(firstEmptyIndex());
            });

            input.addEventListener('keydown', (event) => {
                if (event.key === 'Backspace' && input.value === '' && index > 0) {
                    event.preventDefault();
                    digitInputs[index - 1].value = '';
                    focusDigit(index - 1);
                } else if (event.key === 'ArrowLeft' && index > 0) {
                    event.preventDefault();
                    focusDigit(index - 1);
                } else if (event.key === 'ArrowRight' && index < CODE_LENGTH - 1 && input.value !== '') {
                    event.preventDefault();
                    focusDigit(index + 1);
                } else if (event.key === 'Enter') {
                    event.preventDefault();
                    void submit();
                }
            });

            input.addEventListener('focus', () => {
                // Never leave a gap: clicking a later box jumps back to the first empty one.
                const firstEmpty = digitInputs.findIndex((digitInput) => digitInput.value === '');
                if (firstEmpty !== -1 && firstEmpty < index) {
                    focusDigit(firstEmpty);
                    return;
                }

                // Select the digit so typing replaces it instead of adding a second one.
                requestAnimationFrame(() => input.select());
            });
        });

        retryButton?.addEventListener('click', () => {
            void submit();
        });

        form.addEventListener('submit', (event) => {
            event.preventDefault();
            void submit();
        });

        // Escape must not close it; if the browser closes it anyway, open it again.
        dialog.addEventListener('cancel', (event) => event.preventDefault());
        dialog.addEventListener('close', () => {
            if (!isDone) {
                dialog.showModal();
                focusDigit(firstEmptyIndex());
            }
        });

        setCode(prefill);
        setMessage(message);
        setRetryVisible(canRetry && getCode().length === CODE_LENGTH);

        dialog.showModal();
        focusDigit(firstEmptyIndex());
    });
}
