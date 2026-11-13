import { closeDialogAnimated, showDialogAnimated } from './dialog-motion.js?v=77af242fad';

// "Make changes" on the map opens a dialog with the change options (dishes, house, RSVP).
export function initMapChangesDialog({ deadline = '' } = {}) {
    const dialog = document.querySelector('[data-map-changes-dialog]');
    const openButton = document.querySelector('[data-map-changes-open]');

    if (!(dialog instanceof HTMLDialogElement) || !(openButton instanceof HTMLElement)) {
        return;
    }

    const deadlineEl = dialog.querySelector('[data-map-changes-deadline]');

    if (deadlineEl instanceof HTMLElement && deadline) {
        deadlineEl.textContent = `Changes possible until ${deadline}`;
        deadlineEl.classList.remove('hidden');
    }

    openButton.classList.remove('hidden');
    openButton.classList.add('inline-flex');

    const close = () => void closeDialogAnimated(dialog);

    openButton.addEventListener('click', () => showDialogAnimated(dialog));

    dialog.querySelectorAll('[data-map-changes-close]').forEach((button) => {
        button.addEventListener('click', close);
    });

    // Escape: fade out like the other ways to close, instead of the browser's instant close.
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
}
