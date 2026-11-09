function parseRevealDelayMs(element) {
    const datasetValue = element.dataset.revealDelay;
    if (datasetValue !== undefined && datasetValue !== "") {
        const parsed = Number.parseFloat(datasetValue);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }
    }

    const customProperty = getComputedStyle(element).getPropertyValue("--reveal-delay").trim();
    if (!customProperty) {
        return 0;
    }

    const parsed = Number.parseFloat(customProperty);
    return Number.isNaN(parsed) ? 0 : parsed;
}

// The continue CTA ([data-reveal-last]) waits longer and fades in slower (2x the 0.8s in main.css).
const LAST_REVEAL_GAP_MS = 1000;
const LAST_REVEAL_DURATION_MS = 1600;
const RANDOM_REVEAL_SWAP_CHANCE = 0.4;
// Well below half the smallest authored step (500ms), so jitter alone never reorders elements.
const RANDOM_REVEAL_JITTER_MS = 150;

// Cached because each run overwrites --reveal-delay inline; replays must start from the authored delay.
const authoredDelaysMs = new WeakMap();

function getAuthoredDelayMs(element) {
    if (!authoredDelaysMs.has(element)) {
        authoredDelaysMs.set(element, parseRevealDelayMs(element));
    }

    return authoredDelaysMs.get(element);
}

// With data-reveal-order="random" the first element keeps its delay so reading starts there,
// [data-reveal-last] (the call to action) comes strictly last, and the rest reuse the authored time slots
// with some neighbours swapped and a small jitter, so the order surprises without losing the top-down flow.
function getRevealDelaysMs(revealItems) {
    const delaysMs = revealItems.map(getAuthoredDelayMs);

    if (document.body?.dataset.revealOrder !== "random" || revealItems.length < 2) {
        return delaysMs;
    }

    const latestDelayMs = Math.max(...delaysMs);
    const middleIndexes = revealItems
        .map((element, index) => index)
        .filter((index) => index !== 0 && !revealItems[index].hasAttribute("data-reveal-last"));
    const slotsMs = middleIndexes.map((index) => delaysMs[index]).sort((a, b) => a - b);

    // Swap disjoint neighbour pairs, so an element moves at most one place.
    const shuffledIndexes = [...middleIndexes];
    for (let position = 0; position < shuffledIndexes.length - 1; position += 1) {
        if (Math.random() < RANDOM_REVEAL_SWAP_CHANCE) {
            [shuffledIndexes[position], shuffledIndexes[position + 1]] = [shuffledIndexes[position + 1], shuffledIndexes[position]];
            position += 1;
        }
    }

    const result = [...delaysMs];
    shuffledIndexes.forEach((itemIndex, position) => {
        const jitterMs = (Math.random() * 2 - 1) * RANDOM_REVEAL_JITTER_MS;
        result[itemIndex] = Math.round(slotsMs[position] + jitterMs);
    });

    revealItems.forEach((element, index) => {
        if (element.hasAttribute("data-reveal-last")) {
            result[index] = latestDelayMs + LAST_REVEAL_GAP_MS;
        }
    });

    return result;
}

function startRevealSequence(root = document) {
    const revealItems = Array.from(root.querySelectorAll("[data-reveal]"));
    const delaysMs = getRevealDelaysMs(revealItems);

    revealItems.forEach((element, index) => {
        const delayMs = delaysMs[index];
        element.style.setProperty("--reveal-delay", `${delayMs}ms`);
        if (element.hasAttribute("data-reveal-last")) {
            element.style.animationDuration = `${LAST_REVEAL_DURATION_MS}ms`;
        }
        element.classList.remove("is-ready", "opacity-0", "opacity-100");

        void element.offsetWidth;
        element.classList.add("is-ready");
    });
}

function handleRevealSequenceStart() {
    startRevealSequence();
}

function initRevealSequence() {
    window.addEventListener("reveal-sequence:start", handleRevealSequenceStart);

    const shouldWaitForEnvelope = document.body && document.body.dataset.revealMode === "after-envelope";
    if (!shouldWaitForEnvelope) {
        handleRevealSequenceStart();
    }
}

document.addEventListener("DOMContentLoaded", initRevealSequence);
