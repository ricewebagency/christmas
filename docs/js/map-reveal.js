// Revelio: the theme party details stay hidden until the guest casts the spell.
// States on [data-map-reveal-root] (data-spell): hidden -> casting -> revealed.
// Timings match the revelio* animations in tailwind.config.js.
import { playMapSound } from './map-sounds.js?v=02bc12da1f';
import { showSubtitlesFor } from './map-dumbledore.js?v=02bc12da1f';

const SPARK_DELAY_MS = 250;
const REVEAL_DELAY_MS = 1000;
const SPARK_COUNT = 18;
const SPARK_CLASSES = [
    'absolute block rounded-full bg-accent shadow-[0_0_6px_2px_rgba(198,164,90,0.8)] animate-revelioSpark',
    'absolute block rotate-45 bg-amber-200 shadow-[0_0_8px_2px_rgba(198,164,90,0.9)] animate-revelioSpark'
];

const random = (min, max) => min + Math.random() * (max - min);

function setShown(el, isShown, displayClass = 'flex') {
    if (!(el instanceof HTMLElement)) {
        return;
    }

    el.classList.toggle('hidden', !isShown);
    el.classList.toggle(displayClass, isShown);
}

// Bursts sparks from the sigil; positions are percentages so they follow the map's scale.
function burstSparks(layerEl, sigilEl) {
    if (!(layerEl instanceof HTMLElement) || !(sigilEl instanceof HTMLElement)) {
        return;
    }

    const layerRect = layerEl.getBoundingClientRect();
    const sigilRect = sigilEl.getBoundingClientRect();

    if (!layerRect.width || !layerRect.height) {
        return;
    }

    const left = ((sigilRect.left + sigilRect.width / 2 - layerRect.left) / layerRect.width) * 100;
    const top = ((sigilRect.top + sigilRect.height / 2 - layerRect.top) / layerRect.height) * 100;
    const reach = Math.max(sigilRect.width, 48);

    for (let i = 0; i < SPARK_COUNT; i += 1) {
        const sparkEl = document.createElement('span');
        const angle = (i / SPARK_COUNT) * Math.PI * 2 + random(-0.25, 0.25);
        const distance = reach * random(0.6, 1.5);
        const size = random(2, 5);

        sparkEl.className = SPARK_CLASSES[i % SPARK_CLASSES.length];
        sparkEl.style.left = `${left}%`;
        sparkEl.style.top = `${top}%`;
        sparkEl.style.width = `${size}px`;
        sparkEl.style.height = `${size}px`;
        sparkEl.style.animationDelay = `${Math.round(random(0, 180))}ms`;
        sparkEl.style.setProperty('--spark-x', `${(Math.cos(angle) * distance).toFixed(1)}px`);
        sparkEl.style.setProperty('--spark-y', `${(Math.sin(angle) * distance).toFixed(1)}px`);
        sparkEl.style.setProperty('--spark-r', `${Math.round(random(-180, 180))}deg`);
        sparkEl.addEventListener('animationend', () => sparkEl.remove(), { once: true });
        layerEl.append(sparkEl);
    }
}

// isFound(): whether the guest already found the Revelio egg (API or this visit); then the details stay revealed.
export function initMapReveal({ isFound = () => false } = {}) {
    const rootEl = document.querySelector('[data-map-reveal-root]');
    const buttonEl = document.querySelector('[data-map-reveal]');
    const contentEl = document.querySelector('[data-map-reveal-content]');
    const sparksEl = document.querySelector('[data-map-reveal-sparks]');
    const sigilEl = document.querySelector('[data-map-reveal-sigil]');
    const titleEl = document.getElementById('map-event-title');
    const timers = [];

    if (!(rootEl instanceof HTMLElement) || !(buttonEl instanceof HTMLElement) || !(contentEl instanceof HTMLElement)) {
        return { reset() {} };
    }

    const later = (callback, delay) => timers.push(window.setTimeout(callback, delay));

    // Also covers guests who can't earn points (their finds are never recorded).
    let hasCast = false;

    const showRevealed = () => {
        setShown(buttonEl, false);
        buttonEl.setAttribute('aria-expanded', 'true');
        setShown(contentEl, true);
        rootEl.dataset.spell = 'revealed';
    };

    const reveal = () => {
        showRevealed();
        titleEl?.focus({ preventScroll: true });
    };

    if (isFound()) {
        showRevealed();
    }

    buttonEl.addEventListener('click', () => {
        if (rootEl.dataset.spell !== 'hidden') {
            return;
        }

        hasCast = true;
        // The spell fades out as the twinkle (ink appearing) takes over.
        playMapSound('spell', 0, { fadeAfterMs: REVEAL_DELAY_MS - 200, fadeMs: 700 });
        playMapSound('revelioVoice');
        void showSubtitlesFor('revelio-spell-cast');

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            reveal();
            return;
        }

        playMapSound('twinkle', REVEAL_DELAY_MS);

        rootEl.dataset.spell = 'casting';
        later(() => burstSparks(sparksEl, sigilEl), SPARK_DELAY_MS);
        later(reveal, REVEAL_DELAY_MS);
    });

    // "Mischief managed" wipes the map: hide the details again for the next opening,
    // unless the guest already knows the spell.
    const reset = () => {
        timers.splice(0).forEach((timer) => window.clearTimeout(timer));
        sparksEl?.replaceChildren();

        if (hasCast || isFound()) {
            showRevealed();
            return;
        }

        setShown(contentEl, false);
        setShown(buttonEl, true);
        buttonEl.setAttribute('aria-expanded', 'false');
        rootEl.dataset.spell = 'hidden';
    };

    return { reset };
}
