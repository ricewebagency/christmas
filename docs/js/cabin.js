import { fetchDishCatalog, fetchTakenCabinDishIds, getCabinData, getGuest, isApiError, sendCabinDishSelection } from './api-client.js?v=8e67b1c2f6';
import { getNextStep, getPageUrl, guardPage, isEditMode, redirectToPage, whenDomReady } from './guest-flow.js?v=8e67b1c2f6';
import { parseRevealDelayMs } from './page-transitions.js?v=8e67b1c2f6';
import { createCustomDishPage, initCustomDishForm } from './custom-dish.js?v=8e67b1c2f6';
import { initHouseCup } from './house-cup.js?v=8e67b1c2f6';
import { playPop } from './click-pop.js?v=8e67b1c2f6';

const DEFAULT_CABIN_IMAGE = './assets/images/hogwarts-express-cabin-front-gryffindor.png';
const BACKDROP_SELECTOR = '[data-cabin-backdrop]';
const ARRIVAL_AUDIO_SELECTOR = '[data-arrival-audio]';
const TRAIN_AUDIO_SELECTOR = '[data-train-audio]';
const TROLLEY_AUDIO_SELECTOR = '[data-trolley-audio]';
const AMBIENT_AUDIO_FADE_IN_MS = 2000;
const AUDIO_GESTURE_EVENTS = ['pointerdown', 'touchstart', 'keydown'];
const TROLLEY_IMAGE_SELECTOR = '[data-trolley-witch]';
const TROLLEY_SUBTITLE_SELECTOR = '[data-trolley-subtitles]';
const PARCHMENT_SELECTOR = '[data-parchment-container]';
const SCREEN_LOADER_SELECTOR = '[data-screen-loader]';
const TRAIN_SHAKE_SELECTOR = '[data-train-shake]';
const DISH_INTRO_PANEL_SELECTOR = '[data-dish-intro-panel]';
const DISH_INTRO_SELECTOR = '[data-dish-intro]';
const DISH_PANEL_SELECTOR = '[data-dish-panel]';
const DISH_CHOICE_LIST_SELECTOR = '[data-dish-choice-list]';
const DISH_CAROUSEL_TRACK_SELECTOR = '[data-dish-carousel-track]';
const DISH_PREV_BUTTON_SELECTOR = '[data-dish-prev]';
const DISH_NEXT_BUTTON_SELECTOR = '[data-dish-next]';
const DISH_DOTS_SELECTOR = '[data-dish-dots]';
const DISH_CHOICE_SELECTOR = '[data-dish-choice]';
const DISH_CONFIRM_SELECTOR = '[data-dish-confirm]';
const DISH_BACK_SELECTOR = '[data-dish-back]';
const DISH_PANEL_FADE_MS = 1200;
const BACK_REVEAL_DELAY_OFFSET_MS = 800;
const DISH_SELECTED_SUMMARY_SELECTOR = '[data-selected-dish-summary]';
const DISH_SELECTED_SUMMARY_LABEL_SELECTOR = '[data-selected-dish-label]';
const DISH_SELECTED_SUMMARY_VALUE_SELECTOR = '[data-selected-dish-value]';
const DISH_ERROR_SELECTOR = '[data-dish-error]';
const DISH_ERROR_MESSAGES = {
    taken: 'Alas, another guest claimed one of your dishes just before you. Please choose again.',
    failed: 'The owl could not deliver your choice, please try again.'
};
const CABIN_EXIT_FADE_DURATION_MS = 1300;
const CABIN_SCREEN_LOADER_DURATION_MS = 2200;
const TROLLEY_SUBTITLE_FADE_MS = 300;
const TROLLEY_SUBTITLE_GAP_MS = 250;
const DISH_CAROUSEL_SWIPE_MIN_DISTANCE_PX = 48;
const DISH_CAROUSEL_SWIPE_AXIS_RATIO = 1.2;
const TROLLEY_SUBTITLES_URL = new URL('../assets/files/trolley-witch-subtitles.json', import.meta.url);

const trolleySubtitlesPromise = fetch(TROLLEY_SUBTITLES_URL, {
    cache: 'no-store'
})
    .then(async (response) => {
        if (!response.ok) {
            throw new Error(`Failed to load trolley subtitles: ${response.status}`);
        }

        const data = await response.json();
        const entries = Array.isArray(data) ? data : [data];

        return new Map(
            entries.flatMap((entry) => {
                const fileName = normalizeAudioSourceName(entry?.fileName);
                const sentences = Array.isArray(entry?.sentences)
                    ? entry.sentences
                        .map((sentence) => {
                            const text = typeof sentence?.text === 'string' ? sentence.text.trim() : '';
                            const durationMs = Number(sentence?.durationMs);

                            if (!text || !Number.isFinite(durationMs) || durationMs < 0) {
                                return null;
                            }

                            return { text, durationMs };
                        })
                        .filter(Boolean)
                    : [];

                if (!fileName || sentences.length === 0) {
                    return [];
                }

                return [[fileName, sentences]];
            })
        );
    })
    .catch(() => new Map());

let activeTrolleySubtitleSource = '';
let trolleySubtitleSentenceTimeoutId = null;
let trolleySubtitlePlaybackToken = 0;

function normalizeAudioSourceName(value) {
    const rawValue = typeof value === 'string' ? value.trim() : '';

    if (!rawValue) {
        return '';
    }

    const fileName = rawValue.split('/').pop() ?? '';

    try {
        return decodeURIComponent(fileName).trim().toLowerCase();
    } catch {
        return fileName.trim().toLowerCase();
    }
}

function getAudioSourceName(source) {
    try {
        return normalizeAudioSourceName(new URL(source, window.location.href).pathname);
    } catch {
        return normalizeAudioSourceName(source);
    }
}

function cancelTrolleySubtitleSentencePlayback() {
    trolleySubtitlePlaybackToken += 1;

    if (trolleySubtitleSentenceTimeoutId !== null) {
        window.clearTimeout(trolleySubtitleSentenceTimeoutId);
        trolleySubtitleSentenceTimeoutId = null;
    }
}

function setTrolleySubtitleVisibility(subtitleEl, isVisible) {
    subtitleEl.classList.toggle('opacity-0', !isVisible);
    subtitleEl.classList.toggle('opacity-70', isVisible);
}

function showTrolleySubtitleSentence(subtitleEl, sentences, sentenceIndex, playbackToken) {
    if (playbackToken !== trolleySubtitlePlaybackToken) {
        return;
    }

    const sentence = sentences[sentenceIndex];

    if (!sentence) {
        trolleySubtitleSentenceTimeoutId = null;
        return;
    }

    subtitleEl.textContent = sentence.text;
    const isLastSentence = sentenceIndex >= sentences.length - 1;
    setTrolleySubtitleVisibility(subtitleEl, true);

    if (isLastSentence) {
        trolleySubtitleSentenceTimeoutId = window.setTimeout(() => {
            if (playbackToken !== trolleySubtitlePlaybackToken) {
                return;
            }

            setTrolleySubtitleVisibility(subtitleEl, false);
            trolleySubtitleSentenceTimeoutId = null;
        }, sentence.durationMs);
        return;
    }

    // Hide before the next sentence; the gap comes out of this sentence's duration so the next one stays in sync with the audio.
    const hideGapMs = Math.min(TROLLEY_SUBTITLE_FADE_MS + TROLLEY_SUBTITLE_GAP_MS, sentence.durationMs);

    trolleySubtitleSentenceTimeoutId = window.setTimeout(() => {
        if (playbackToken !== trolleySubtitlePlaybackToken) {
            return;
        }

        setTrolleySubtitleVisibility(subtitleEl, false);

        trolleySubtitleSentenceTimeoutId = window.setTimeout(() => {
            showTrolleySubtitleSentence(subtitleEl, sentences, sentenceIndex + 1, playbackToken);
        }, hideGapMs);
    }, sentence.durationMs - hideGapMs);
}

function getTrolleySubtitleElement() {
    const subtitleEl = document.querySelector(TROLLEY_SUBTITLE_SELECTOR);
    return subtitleEl instanceof HTMLElement ? subtitleEl : null;
}

async function showTrolleySubtitleForSource(source) {
    const subtitleMap = await trolleySubtitlesPromise;
    const sourceName = getAudioSourceName(source);
    const subtitleSentences = subtitleMap.get(sourceName);
    const subtitleEl = getTrolleySubtitleElement();

    if (!(subtitleEl instanceof HTMLElement)) {
        return;
    }

    if (!Array.isArray(subtitleSentences) || subtitleSentences.length === 0) {
        clearTrolleySubtitleForSource(source);
        return;
    }

    cancelTrolleySubtitleSentencePlayback();

    activeTrolleySubtitleSource = sourceName;
    const playbackToken = trolleySubtitlePlaybackToken;
    showTrolleySubtitleSentence(subtitleEl, subtitleSentences, 0, playbackToken);
}

function clearTrolleySubtitleForSource(source = null) {
    if (source !== null && activeTrolleySubtitleSource !== getAudioSourceName(source)) {
        return;
    }

    cancelTrolleySubtitleSentencePlayback();
    activeTrolleySubtitleSource = '';

    const subtitleEl = getTrolleySubtitleElement();

    if (!(subtitleEl instanceof HTMLElement)) {
        return;
    }

    subtitleEl.classList.remove('opacity-70');
    subtitleEl.classList.add('opacity-0');
    subtitleEl.textContent = '';
}

function getTickPauseShakeValues(cycle, intensity = 1) {
    let x = 0;
    let y = 0;

    if (cycle < 0.28) {
        const t = cycle / 0.28;
        x = 0.18 * intensity * t;
        y = -0.8 * intensity * t;
    } else if (cycle < 0.52) {
        const t = (cycle - 0.28) / (0.52 - 0.28);
        x = (-0.24 + (0.12 * t)) * intensity;
        y = (0.7 - (1.0 * t)) * intensity;
    } else if (cycle < 0.8) {
        const t = (cycle - 0.52) / (0.8 - 0.52);
        x = (0.08 * (1 - t)) * intensity;
        y = (-0.3 * (1 - t)) * intensity;
    } else if (cycle < 1.08) {
        const t = (cycle - 0.8) / (1.08 - 0.8);
        x = (-0.14 * t) * intensity;
        y = (0.55 * t) * intensity;
    } else if (cycle < 1.36) {
        const t = (cycle - 1.08) / (1.36 - 1.08);
        x = (0.05 * (1 - t)) * intensity;
        y = (-0.2 * (1 - t)) * intensity;
    } else if (cycle < 1.64) {
        const t = (cycle - 1.36) / (1.64 - 1.36);
        x = (-0.1 * t) * intensity;
        y = (0.35 * t) * intensity;
    } else {
        const t = Math.min((cycle - 1.64) / 0.76, 1);
        const eased = 1 - Math.pow(1 - t, 2);
        x = (0.05 * (1 - eased)) * intensity;
        y = (0.18 * (1 - eased)) * intensity;
    }

    return { x, y };
}

function initShakeAnimation(element, intensity = 1, delaySeconds = 0) {
    if (!(element instanceof HTMLElement)) {
        return;
    }

    let start = performance.now();

    const animate = (timestamp) => {
        const elapsed = (timestamp - start) / 1000 - delaySeconds;
        const cycle = elapsed < 0 ? 0 : elapsed % 2.4;
        const { x, y } = getTickPauseShakeValues(cycle, intensity);

        element.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
        window.requestAnimationFrame(animate);
    };

    window.requestAnimationFrame(animate);
}

function initTrainShake() {
    const trainShakeEl = document.querySelector(TRAIN_SHAKE_SELECTOR);
    initShakeAnimation(trainShakeEl, 1);
}

function initCabinFrontShake() {
    const cabinFrontEl = document.querySelector(BACKDROP_SELECTOR);
    initShakeAnimation(cabinFrontEl, 0.5, 0.2);
}

function getCabinBackdropElement() {
    const backdropEl = document.querySelector(BACKDROP_SELECTOR);
    return backdropEl instanceof HTMLElement ? backdropEl : null;
}

function getParchmentElement() {
    const parchmentEl = document.querySelector(PARCHMENT_SELECTOR);
    return parchmentEl instanceof HTMLElement ? parchmentEl : null;
}

function fadeInAudio(audio, targetVolume, durationMs = AMBIENT_AUDIO_FADE_IN_MS) {
    const startedAt = performance.now();

    const step = (timestamp) => {
        const progress = Math.min((timestamp - startedAt) / durationMs, 1);
        audio.volume = targetVolume * progress * progress;

        if (progress < 1 && !audio.paused) {
            window.requestAnimationFrame(step);
        }
    };

    window.requestAnimationFrame(step);
}

// Starts at volume 0 and fades in; if autoplay is blocked, retries on the first user gesture.
function playAmbientAudio(audio, targetVolume) {
    if (!(audio instanceof HTMLAudioElement)) {
        return;
    }

    audio.muted = false;
    audio.volume = 0;

    const attemptPlay = () => audio.play().then(() => {
        fadeInAudio(audio, targetVolume);
    }).catch((error) => {
        if (error?.name !== 'NotAllowedError' || audio.dataset.retryOnGesturePending === '1') {
            return;
        }

        audio.dataset.retryOnGesturePending = '1';

        const retryOnGesture = () => {
            if (audio.dataset.retryOnGesturePending !== '1') {
                return;
            }

            audio.dataset.retryOnGesturePending = '0';
            AUDIO_GESTURE_EVENTS.forEach((eventName) => document.removeEventListener(eventName, retryOnGesture, true));
            void attemptPlay();
        };

        AUDIO_GESTURE_EVENTS.forEach((eventName) => document.addEventListener(eventName, retryOnGesture, true));
    });

    void attemptPlay();
}

function initArrivalAudio() {
    playAmbientAudio(document.querySelector(ARRIVAL_AUDIO_SELECTOR), 0.5);
}

function initScreenLoader() {
    const loaderEl = document.querySelector(SCREEN_LOADER_SELECTOR);

    if (!(loaderEl instanceof HTMLElement)) {
        return;
    }

    loaderEl.addEventListener('animationend', () => {
        loaderEl.remove();
    }, { once: true });

    window.setTimeout(() => {
        loaderEl.remove();
    }, CABIN_SCREEN_LOADER_DURATION_MS + 250);
}

function initTrainAudio() {
    playAmbientAudio(document.querySelector(TRAIN_AUDIO_SELECTOR), 0.05);
}

function revealParchment() {
    const parchmentEl = getParchmentElement();

    if (!(parchmentEl instanceof HTMLElement)) {
        return;
    }

    // Remove hidden to allow rendering
    parchmentEl.classList.remove('hidden');
    parchmentEl.classList.add('flex', 'opacity-0');
    
    // Force reflow so browser registers the opacity-0 state
    void parchmentEl.offsetHeight;
    
    // Now remove opacity-0 and add animation
    parchmentEl.classList.remove('opacity-0');
    parchmentEl.classList.add('animate-fadeIn1800');

    window.dispatchEvent(new Event('reveal-sequence:start'));
}

function fadeOutBodyAndNavigate(destination, durationMs = CABIN_EXIT_FADE_DURATION_MS) {
    if (typeof window === 'undefined' || !destination) {
        return;
    }

    const body = document.body;

    if (!(body instanceof HTMLElement)) {
        window.location.assign(destination);
        return;
    }

    body.style.transitionProperty = 'opacity';
    body.style.transitionDuration = `${durationMs}ms`;
    body.style.transitionTimingFunction = 'ease';
    body.style.opacity = '1';

    window.requestAnimationFrame(() => {
        body.style.opacity = '0';
    });

    window.setTimeout(() => {
        window.location.assign(destination);
    }, durationMs);
}

function slugifyDishChoiceId(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function getDishChoiceId(dish, fallbackText = '') {
    const rawDishId = dish?.id;

    if (rawDishId !== undefined && rawDishId !== null && rawDishId !== '') {
        return String(rawDishId).trim();
    }

    return slugifyDishChoiceId(fallbackText || dish?.name || dish?.name_nl || '');
}

// Via de API (het menu is in het beheer aan te passen), met dishes.json als fallback.
async function loadDishCatalog() {
    const { data } = await fetchDishCatalog();
    return Array.isArray(data) ? data : [];
}

// includeCustomDishPage: adds "Your own dish" as the last page.
function renderDishChoiceGroups(courseGroups, { includeCustomDishPage = false } = {}) {
    const carouselTrack = document.querySelector(DISH_CAROUSEL_TRACK_SELECTOR);
    const dotsContainer = document.querySelector(DISH_DOTS_SELECTOR);

    if (!(carouselTrack instanceof HTMLElement) || !(dotsContainer instanceof HTMLElement)) {
        return;
    }

    carouselTrack.innerHTML = '';
    dotsContainer.innerHTML = '';

    const groups = Array.isArray(courseGroups) ? courseGroups : [];
    const visibleGroupPages = [];

    for (let index = 0; index < groups.length; index += 1) {
        visibleGroupPages.push(groups.slice(index, index + 1));
    }

    if (visibleGroupPages.length === 0) {
        return;
    }

    visibleGroupPages.forEach((pageGroups, pageIndex) => {
        const page = document.createElement('div');
        page.className = 'w-full shrink-0 basis-full';

        const pageContent = document.createElement('div');
        pageContent.className = 'space-y-4';

        pageGroups.forEach((courseGroup, courseIndex) => {
            const dishes = Array.isArray(courseGroup?.dishes) ? courseGroup.dishes : [];

            if (!dishes.length) {
                return;
            }

            const courseContainer = document.createElement('div');
            courseContainer.className = 'space-y-2';

            const courseHeading = document.createElement('p');
            courseHeading.className = 'text-sm leading-none text-[#1f1d1a] sm:text-base';
            courseHeading.textContent = courseGroup?.course || courseGroup?.course_nl || `Course ${pageIndex + 1}`;
            courseHeading.dataset.reveal = 'true';
            courseHeading.style.setProperty('--reveal-delay', `${(pageIndex + 1) * 450}ms`);

            const dishGrid = document.createElement('div');
            dishGrid.className = 'grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2';

            dishes.forEach((dish, dishIndex) => {
                const dishButton = document.createElement('button');
                const dishId = getDishChoiceId(dish, `${pageIndex + 1}-${courseIndex + 1}-${dishIndex + 1}`);
                const dishNameText = typeof dish?.name === 'string' ? dish.name.trim() : '';
                const dishNameNl = typeof dish?.name_nl === 'string' ? dish.name_nl.trim() : '';
                const dishLabel = dishNameText || dishNameNl || `Dish ${dishIndex + 1}`;
                const dishDescription = dish?.description || '';

                dishButton.type = 'button';
                dishButton.dataset.dishChoice = dishId;
                dishButton.dataset.pop = 'medium';
                dishButton.dataset.dishLabel = dishLabel;
                dishButton.dataset.reveal = 'true';
                dishButton.style.setProperty('--reveal-delay', `${(pageIndex + 1) * 450 + 150 + dishIndex * 100}ms`);
                dishButton.className = 'group inline-flex flex-col items-start gap-1 text-left text-[#1f1d1a]/90 transition-colors duration-200 hover:text-[#1f1d1a] focus:outline-none focus-visible:outline-none';

                const dishContent = document.createElement('div');
                dishContent.className = 'flex items-start gap-2';

                const dishNumber = document.createElement('span');
                dishNumber.className = 'transition-opacity duration-200 group-aria-pressed:opacity-100';
                dishNumber.textContent = `${dishIndex + 1}.`;

                const dishNameElement = document.createElement('span');
                dishNameElement.className = 'transition-[text-decoration-color] duration-200 group-aria-pressed:underline group-aria-pressed:decoration-[#1f1d1a]/70 group-aria-pressed:underline-offset-4';
                dishNameElement.dataset.dishChoiceName = 'true';
                dishNameElement.textContent = dishLabel;

                dishContent.append(dishNumber, dishNameElement);

                dishButton.append(dishContent);

                if (dishDescription) {
                    const description = document.createElement('span');
                    description.className = 'text-xs text-[#1f1d1a]/40';
                    description.dataset.dishChoiceDescription = 'true';
                    description.textContent = dishDescription;
                    dishButton.append(description);
                }

                dishGrid.append(dishButton);
            });

            courseContainer.append(courseHeading, dishGrid);
            pageContent.append(courseContainer);
        });

        page.append(pageContent);
        carouselTrack.append(page);
    });

    let pageCount = visibleGroupPages.length;

    if (includeCustomDishPage) {
        carouselTrack.append(createCustomDishPage(groups, (pageCount + 1) * 450));
        pageCount += 1;
    }

    Array.from({ length: pageCount }).forEach((_, dotIndex) => {
        const dotButton = document.createElement('button');
        dotButton.type = 'button';
        dotButton.dataset.pop = 'small';
        dotButton.className = 'h-1.5 w-1.5 rounded-full bg-[#1f1d1a]/35 opacity-70 transition-all duration-200';
        dotButton.setAttribute('aria-label', `Go to dishes page ${dotIndex + 1}`);
        dotButton.dataset.dishPageDot = String(dotIndex);
        dotsContainer.append(dotButton);
    });
}

async function initDishSelection(guest, { skipIntro = false, editMode = false } = {}) {
    const introPanel = document.querySelector(DISH_INTRO_PANEL_SELECTOR);
    const introButton = document.querySelector(DISH_INTRO_SELECTOR);
    const dishPanel = document.querySelector(DISH_PANEL_SELECTOR);
    const dishConfirmButton = document.querySelector(DISH_CONFIRM_SELECTOR);
    const dishChoiceList = document.querySelector(DISH_CHOICE_LIST_SELECTOR);
    const prevButton = document.querySelector(DISH_PREV_BUTTON_SELECTOR);
    const nextButton = document.querySelector(DISH_NEXT_BUTTON_SELECTOR);
    const carouselTrack = document.querySelector(DISH_CAROUSEL_TRACK_SELECTOR);
    const selectedDishSummary = document.querySelector(DISH_SELECTED_SUMMARY_SELECTOR);
    const dishErrorEl = document.querySelector(DISH_ERROR_SELECTOR);

    const selectedDishSummaryLabel = selectedDishSummary instanceof HTMLElement
        ? selectedDishSummary.querySelector(DISH_SELECTED_SUMMARY_LABEL_SELECTOR)
        : null;
    const selectedDishSummaryValue = selectedDishSummary instanceof HTMLElement
        ? selectedDishSummary.querySelector(DISH_SELECTED_SUMMARY_VALUE_SELECTOR)
        : null;

    if (
        !(introPanel instanceof HTMLElement) ||
        !(introButton instanceof HTMLButtonElement) ||
        !(dishPanel instanceof HTMLElement) ||
        !(dishChoiceList instanceof HTMLElement) ||
        !(dishConfirmButton instanceof HTMLButtonElement) ||
        !(prevButton instanceof HTMLButtonElement) ||
        !(nextButton instanceof HTMLButtonElement) ||
        !(carouselTrack instanceof HTMLElement)
    ) {
        return;
    }

    let dishGroups = [];
    document.querySelector('[data-custom-dish-intro]')?.classList.toggle('hidden', !guest?.customDishAllowed);

    try {
        dishGroups = await loadDishCatalog();
        renderDishChoiceGroups(dishGroups, { includeCustomDishPage: Boolean(guest?.customDishAllowed) });
    } catch (error) {
        console.warn('Could not load dish catalog.', error);
    }

    const dishButtons = Array.from(document.querySelectorAll(DISH_CHOICE_SELECTOR));
    const dots = Array.from(document.querySelectorAll('[data-dish-page-dot]'));
    let currentDishPageIndex = 0;

    carouselTrack.style.touchAction = 'pan-y';

    const syncDishCarousel = () => {
        const resolvedPageCount = Math.max(1, dots.length || 1);
        const offset = -currentDishPageIndex * 100;

        carouselTrack.style.transform = `translateX(${offset}%)`;
        prevButton.disabled = currentDishPageIndex === 0;
        nextButton.disabled = currentDishPageIndex >= resolvedPageCount - 1;

        dots.forEach((dot, index) => {
            const isActive = index === currentDishPageIndex;
            dot.classList.toggle('bg-[#1f1d1a]', isActive);
            dot.classList.toggle('bg-[#1f1d1a]/35', !isActive);
            dot.classList.toggle('opacity-100', isActive);
            dot.classList.toggle('opacity-70', !isActive);
            dot.classList.toggle('h-2', isActive);
            dot.classList.toggle('w-2', isActive);
            dot.classList.toggle('h-1.5', !isActive);
            dot.classList.toggle('w-1.5', !isActive);
            dot.setAttribute('aria-current', isActive ? 'true' : 'false');
        });
    };

    const goToDishPage = (targetIndex) => {
        const maxIndex = Math.max(0, dots.length - 1);
        const clampedIndex = Math.min(Math.max(targetIndex, 0), maxIndex);

        if (clampedIndex === currentDishPageIndex) {
            return false;
        }

        currentDishPageIndex = clampedIndex;
        syncDishCarousel();
        return true;
    };

    prevButton.addEventListener('click', () => {
        if (currentDishPageIndex > 0) {
            goToDishPage(currentDishPageIndex - 1);
        }
    });

    nextButton.addEventListener('click', () => {
        const maxIndex = Math.max(0, (document.querySelectorAll('[data-dish-page-dot]').length || 1) - 1);
        if (currentDishPageIndex < maxIndex) {
            goToDishPage(currentDishPageIndex + 1);
        }
    });

    dots.forEach((dot) => {
        dot.addEventListener('click', () => {
            const targetIndex = Number(dot.dataset.dishPageDot ?? '0');
            goToDishPage(Number.isFinite(targetIndex) ? targetIndex : 0);
        });
    });

    let activePointerId = null;
    let swipeStartX = 0;
    let swipeStartY = 0;

    const resetSwipeState = () => {
        activePointerId = null;
        swipeStartX = 0;
        swipeStartY = 0;
    };

    carouselTrack.addEventListener('pointerdown', (event) => {
        if (!event.isPrimary || (event.pointerType !== 'touch' && event.pointerType !== 'pen')) {
            return;
        }

        // Selecting text in the own-dish fields is not a swipe.
        if (event.target instanceof Element && event.target.closest('input, select')) {
            return;
        }

        activePointerId = event.pointerId;
        swipeStartX = event.clientX;
        swipeStartY = event.clientY;
    });

    carouselTrack.addEventListener('pointerup', (event) => {
        if (activePointerId === null || event.pointerId !== activePointerId) {
            return;
        }

        const deltaX = event.clientX - swipeStartX;
        const deltaY = event.clientY - swipeStartY;
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        if (absX >= DISH_CAROUSEL_SWIPE_MIN_DISTANCE_PX && absX > absY * DISH_CAROUSEL_SWIPE_AXIS_RATIO) {
            const moved = goToDishPage(currentDishPageIndex + (deltaX < 0 ? 1 : -1));

            if (moved) {
                playPop('small');
            }
        }

        resetSwipeState();
    });

    carouselTrack.addEventListener('pointercancel', resetSwipeState);

    if (!dishButtons.length) {
        return;
    }

    syncDishCarousel();

    // null/undefined from the API = no limit.
    const dishSelectionLimit = guest?.maxDishesPerGuest ?? Infinity;
    const selectedDishIds = new Set((guest?.dishIds ?? []).slice(0, dishSelectionLimit));
    const occupiedDishIds = new Set();
    let isSubmittingSelection = false;
    const dishLabelById = new Map();
    // Assigned below; its callbacks only run after that.
    let syncDishState = () => {};

    const customDishPage = document.querySelector('[data-custom-dish]');
    const customDishForm = customDishPage instanceof HTMLElement
        ? initCustomDishForm(customDishPage, {
            courseGroups: dishGroups,
            initial: guest?.customDish ?? null,
            onChange: () => {
                setDishError('');
                syncDishState();
            },
            onSelectMenuDish: (dishId) => {
                if (occupiedDishIds.has(dishId) || selectedDishIds.has(dishId) || selectedDishIds.size >= dishSelectionLimit) {
                    return false;
                }

                selectedDishIds.add(dishId);
                return true;
            }
        })
        : null;

    // An own dish takes a slot as soon as something is typed.
    const selectionCount = () => selectedDishIds.size + (customDishForm?.hasName() ? 1 : 0);
    const canConfirm = () => (selectedDishIds.size > 0 || Boolean(customDishForm?.getDish()))
        && !customDishForm?.isBlocking();

    dishButtons.forEach((button) => {
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }

        const dishId = button.dataset.dishChoice || '';
        const dishLabel = button.dataset.dishLabel || '';

        if (dishId && dishLabel) {
            dishLabelById.set(dishId, dishLabel);
        }
    });

    const normalizeDishIds = (value) => {
        if (!Array.isArray(value)) {
            return [];
        }

        return Array.from(new Set(
            value
                .map((item) => String(item ?? '').trim())
                .filter((item) => item.length > 0)
        ));
    };

    const syncOccupiedDishIds = (dishIds) => {
        occupiedDishIds.clear();
        normalizeDishIds(dishIds).forEach((dishId) => {
            occupiedDishIds.add(dishId);
        });

        Array.from(selectedDishIds).forEach((dishId) => {
            if (occupiedDishIds.has(dishId)) {
                selectedDishIds.delete(dishId);
            }
        });
    };

    const syncDishButtonState = (button) => {
        const dishId = button.dataset.dishChoice || '';
        const isSelected = selectedDishIds.has(dishId);
        const isOccupied = occupiedDishIds.has(dishId);
        const shouldDisable = isOccupied || (!isSelected && selectionCount() >= dishSelectionLimit);
        const shouldDim = !isSelected && selectionCount() >= dishSelectionLimit;
        const dishNameElement = button.querySelector('[data-dish-choice-name]');
        const dishDescriptionElement = button.querySelector('[data-dish-choice-description]');

        button.setAttribute('aria-pressed', String(isSelected));
        button.toggleAttribute('disabled', shouldDisable);
        button.classList.toggle('text-[#1f1d1a]', isSelected);
        button.classList.toggle('text-[#1f1d1a]/90', !isSelected && !shouldDim);
        button.classList.toggle('text-[#1f1d1a]/45', shouldDim || shouldDisable);
        button.classList.toggle('hover:text-[#1f1d1a]', !shouldDim && !shouldDisable);
        button.classList.toggle('pointer-events-none', shouldDisable);

        if (dishNameElement instanceof HTMLElement) {
            dishNameElement.classList.toggle('line-through', isOccupied);
            dishNameElement.classList.toggle('decoration-[#1f1d1a]/45', isOccupied);
            dishNameElement.classList.toggle('decoration-2', isOccupied);
        }

        if (dishDescriptionElement instanceof HTMLElement) {
            dishDescriptionElement.classList.toggle('line-through', isOccupied);
            dishDescriptionElement.classList.toggle('decoration-[#1f1d1a]/45', isOccupied);
            dishDescriptionElement.classList.toggle('decoration-2', isOccupied);
        }
    };

    syncDishState = () => {
        dishButtons.forEach((button) => {
            if (button instanceof HTMLButtonElement) {
                syncDishButtonState(button);
            }
        });

        customDishForm?.setMenuState({
            occupied: occupiedDishIds,
            selected: selectedDishIds,
            isLocked: !customDishForm.hasName() && selectedDishIds.size >= dishSelectionLimit
        });

        if (selectedDishSummaryLabel instanceof HTMLElement && selectedDishSummaryValue instanceof HTMLElement) {
            const selectedDishLabels = Array.from(selectedDishIds)
                .map((dishId) => dishLabelById.get(dishId) || '')
                .filter((dishLabel) => dishLabel.length > 0);
            const customDish = customDishForm?.getDish();

            if (customDish) {
                selectedDishLabels.push(`${customDish.name} (your own)`);
            }

            selectedDishSummaryLabel.textContent = 'Selected dishes:';
            selectedDishSummaryValue.textContent = selectedDishLabels.length > 0 ? selectedDishLabels.join(', ') : '-';
        }

        const confirmable = canConfirm();
        dishConfirmButton.disabled = !confirmable;
        dishConfirmButton.classList.toggle('opacity-35', !confirmable);
        dishConfirmButton.classList.toggle('pointer-events-none', !confirmable);
    };

    const revealDishPanel = () => {
        if (dishPanel.classList.contains('opacity-100')) {
            return;
        }

        introPanel.classList.add('opacity-0');
        introPanel.classList.add('pointer-events-none');

        introPanel.addEventListener('transitionend', () => {
            introPanel.classList.add('hidden');

            dishPanel.classList.remove('hidden');
            dishPanel.classList.add('flex');
            window.requestAnimationFrame(() => {
                dishPanel.classList.remove('translate-y-1');
                dishPanel.classList.add('opacity-100', 'pointer-events-auto');
            });
        }, { once: true });

        dishPanel.classList.remove('pointer-events-none');
    };

    // Unhiding the intro panel restarts its reveal animations; on "Go back" they should start sooner.
    let introDelaysShortened = false;
    const shortenIntroRevealDelays = () => {
        if (introDelaysShortened) {
            return;
        }
        introDelaysShortened = true;

        introPanel.querySelectorAll('[data-reveal]').forEach((element) => {
            const delayMs = parseRevealDelayMs(element);
            element.style.setProperty('--reveal-delay', `${Math.max(0, delayMs - BACK_REVEAL_DELAY_OFFSET_MS)}ms`);
        });

        const buttonDelayMs = Number.parseFloat(introButton.style.animationDelay) || 0;
        introButton.style.animationDelay = `${Math.max(0, buttonDelayMs - BACK_REVEAL_DELAY_OFFSET_MS)}ms`;
    };

    const revealIntroPanel = () => {
        if (!dishPanel.classList.contains('opacity-100')) {
            return;
        }

        shortenIntroRevealDelays();

        dishPanel.classList.remove('opacity-100', 'pointer-events-auto');
        dishPanel.classList.add('pointer-events-none', 'translate-y-1');

        window.setTimeout(() => {
            dishPanel.classList.remove('flex');
            dishPanel.classList.add('hidden');

            introPanel.classList.remove('hidden');
            introButton.classList.remove('pointer-events-none', 'opacity-0');
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                    introPanel.classList.remove('opacity-0', 'pointer-events-none');
                });
            });
        }, DISH_PANEL_FADE_MS);
    };

    const showDishPanelImmediately = () => {
        introPanel.classList.add('hidden', 'opacity-0', 'pointer-events-none');
        dishPanel.classList.remove('hidden', 'pointer-events-none', 'translate-y-1');
        dishPanel.classList.add('flex', 'opacity-100', 'pointer-events-auto');
    };

    const setDishError = (message) => {
        if (dishErrorEl instanceof HTMLElement) {
            dishErrorEl.textContent = message;
            dishErrorEl.classList.toggle('hidden', !message);
        }
    };

    const refreshTakenDishIds = () => fetchTakenCabinDishIds()
        .then((response) => {
            syncOccupiedDishIds(response?.data?.dishIds);
            customDishForm?.setOthers(response?.data?.customDishes);
            syncDishState();
        })
        .catch((error) => {
            console.warn('Could not load already selected dishes.', error);
        });

    if (skipIntro) {
        showDishPanelImmediately();
    }

    introButton.addEventListener('click', () => {
        introButton.classList.add('pointer-events-none', 'opacity-0');
        revealDishPanel();
    });

    const backButton = document.querySelector(DISH_BACK_SELECTOR);
    if (backButton instanceof HTMLButtonElement) {
        backButton.addEventListener('click', () => {
            backButton.blur();
            revealIntroPanel();
        });
    }

    dishButtons.forEach((button) => {
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }

        button.addEventListener('click', () => {
            const dishId = button.dataset.dishChoice || '';

            if (!dishId || occupiedDishIds.has(dishId)) {
                return;
            }

            if (selectedDishIds.has(dishId)) {
                selectedDishIds.delete(dishId);
                syncDishState();
                button.blur();
                return;
            }

            if (selectionCount() >= dishSelectionLimit) {
                return;
            }

            selectedDishIds.add(dishId);
            setDishError('');
            syncDishState();
        });
    });

    void refreshTakenDishIds();

    dishConfirmButton.addEventListener('click', async () => {
        if (!canConfirm() || isSubmittingSelection) {
            return;
        }

        isSubmittingSelection = true;
        const dishIds = Array.from(selectedDishIds);
        const customDish = customDishForm?.getDish() ?? null;

        setDishError('');
        dishConfirmButton.disabled = true;
        dishConfirmButton.classList.add('opacity-35', 'pointer-events-none');

        try {
            await sendCabinDishSelection({ dishIds, customDish });
        } catch (error) {
            isSubmittingSelection = false;

            if (isApiError(error, 409) && error.code === 'dishes_taken') {
                error.takenDishIds.forEach((dishId) => occupiedDishIds.add(dishId));
                syncOccupiedDishIds([...occupiedDishIds]);
                syncDishState();
                setDishError(DISH_ERROR_MESSAGES.taken);
                void refreshTakenDishIds();
                return;
            }

            if (isApiError(error, 403) || isApiError(error, 404) || isApiError(error, 409)) {
                // Sealed, unknown guest or no longer accepted: continue from the actual state.
                const latestGuest = await getGuest({ refresh: true }).catch(() => null);
                redirectToPage(getNextStep(latestGuest));
                return;
            }

            if (isApiError(error, 400) && (error.code === 'custom_dish_on_menu' || error.code === 'invalid_dishes')) {
                // The API explains what is wrong (e.g. own dish already on the menu after a menu change).
                setDishError(error.message || DISH_ERROR_MESSAGES.failed);
                syncDishState();
                return;
            }

            console.warn('Could not save the dish selection.', error);
            setDishError(DISH_ERROR_MESSAGES.failed);
            syncDishState();
            return;
        }

        dishConfirmButton.blur();
        // Changing dishes skips the chamber and returns straight to the map.
        fadeOutBodyAndNavigate(getPageUrl(editMode ? 'map' : 'chamber'));
    });

    syncDishState();
}

function initTrolleyArrival() {
    const trolleyAudio = document.querySelector(TROLLEY_AUDIO_SELECTOR);
    const trolleyImage = document.querySelector(TROLLEY_IMAGE_SELECTOR);

    if (!(trolleyAudio instanceof HTMLAudioElement) || !(trolleyImage instanceof HTMLElement)) {
        return;
    }

    trolleyAudio.muted = false;
    trolleyAudio.volume = 1;

    const trolleySource = trolleyAudio.currentSrc || trolleyAudio.querySelector('source')?.getAttribute('src') || '';

    trolleyAudio.addEventListener('ended', () => {
        clearTrolleySubtitleForSource(trolleySource);
    }, { once: true });

    window.setTimeout(() => {
        void showTrolleySubtitleForSource(trolleySource);

        void trolleyAudio.play().catch(() => {
            // Browsers may block playback until interaction; keep visual timing intact.
            clearTrolleySubtitleForSource(trolleySource);
        });
    }, 2000);

    window.setTimeout(() => {
        trolleyImage.classList.remove('translate-x-full');
        trolleyImage.classList.add('translate-x-[50px]');

        trolleyImage.addEventListener('transitionend', () => {
            window.setTimeout(() => {
                revealParchment();
            }, 1000);
        }, { once: true });
    }, 3000);
}

function applyCabinBackdrop(imageUrl) {
    const backdropEl = getCabinBackdropElement();

    if (!(backdropEl instanceof HTMLElement)) {
        return;
    }

    backdropEl.style.backgroundImage = `url("${imageUrl}")`;
}

async function initCabinBackdrop() {
    const fallbackImage = DEFAULT_CABIN_IMAGE;

    try {
        const cabinData = await getCabinData();
        const imagePath = cabinData?.cabinFrontImage || fallbackImage;

        applyCabinBackdrop(imagePath);
    } catch (error) {
        console.warn('Falling back to the default cabin front image.', error);
        applyCabinBackdrop(fallbackImage);
    }
}

// In edit mode the trolley scene is skipped: the parchment opens right after the loader.
function revealParchmentForEdit() {
    window.setTimeout(revealParchment, CABIN_SCREEN_LOADER_DURATION_MS);
}

async function bootstrapCabinPage() {
    const guest = await guardPage('cabin');

    if (!guest) {
        return;
    }

    await whenDomReady();
    initHouseCup(guest);

    const editMode = isEditMode();

    initArrivalAudio();
    initTrainAudio();
    initScreenLoader();
    initTrainShake();
    initCabinFrontShake();
    void initCabinBackdrop();
    void initDishSelection(guest, { skipIntro: editMode, editMode });

    if (editMode) {
        revealParchmentForEdit();
    } else if (document.readyState === 'complete') {
        initTrolleyArrival();
    } else {
        window.addEventListener('load', initTrolleyArrival, { once: true });
    }
}

void bootstrapCabinPage();
