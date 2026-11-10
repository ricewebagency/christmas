// Smooth open/close for native <dialog> modals. The dialog itself carries the transition classes
// (transition, duration, backdrop:transition-opacity); these classes describe the hidden state.
const HIDDEN_CLASSES = ['opacity-0', 'backdrop:opacity-0', 'motion-safe:translate-y-3', 'motion-safe:scale-95'];

const closeTimers = new WeakMap();

function getTransitionMs(element) {
    const style = getComputedStyle(element);
    const durations = style.transitionDuration.split(',').map((value) => parseFloat(value) || 0);
    const delays = style.transitionDelay.split(',').map((value) => parseFloat(value) || 0);
    const longest = durations.reduce((max, duration, index) => Math.max(max, duration + (delays[index] ?? 0)), 0);
    return longest * 1000;
}

export function showDialogAnimated(dialog) {
    window.clearTimeout(closeTimers.get(dialog));
    closeTimers.delete(dialog);

    if (!dialog.open) {
        dialog.classList.add(...HIDDEN_CLASSES);
        dialog.showModal();
    }

    // Commit the hidden state first, so removing it transitions instead of jumping.
    void dialog.offsetWidth;
    dialog.classList.remove(...HIDDEN_CLASSES);
}

// Resolves once the dialog is closed.
export function closeDialogAnimated(dialog) {
    return new Promise((resolve) => {
        if (!dialog.open) {
            resolve();
            return;
        }

        dialog.classList.add(...HIDDEN_CLASSES);
        window.clearTimeout(closeTimers.get(dialog));
        closeTimers.set(dialog, window.setTimeout(() => {
            closeTimers.delete(dialog);
            dialog.close();
            resolve();
        }, getTransitionMs(dialog)));
    });
}
