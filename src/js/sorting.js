import { getGuest, getInvitationData, isApiError, sendSortingHouseResult, SORTING_HOUSE_POINTS } from './api-client.js';
import { getNextStep, getPageUrl, guardPage, redirectToPage, whenDomReady } from './guest-flow.js';
import { initHouseCup } from './house-cup.js';
import { speakTenPoints } from './map-dumbledore.js';
import { burstHousePoints } from './map-rewards.js';
import { resetLocalStorageState, writeJsonToLocalStorage } from './storage-utils.js';
import { playPop } from './click-pop.js';

// Pause between the hat announcing the house and the "+10" for it.
const SORTING_POINTS_DELAY_MS = 500;
const HAT_REVEAL_MAX_WAIT_MS = 15000;

// Set in bootstrapSortingPage; told the house once the Sorting Hat decides.
let houseCup = null;

const STORAGE_KEY = 'christmas-at-the-great-hall.sorting-hat';
const HOUSE_ORDER = ['gryffindor', 'hufflepuff', 'ravenclaw', 'slytherin'];
const QUESTIONS_URL = new URL('../assets/files/sorting-hat-questions.json', import.meta.url);
const SORTING_HAT_SUBTITLES_URL = new URL('../assets/files/sorting-hat-subtitles.json', import.meta.url);
const HOUSE_REVEAL_AUDIO = {
    gryffindor: {
        first: new URL('../assets/music/sorting-hat/gryffindor-1.mp3', import.meta.url).href,
        second: new URL('../assets/music/sorting-hat/gryffindor-2.mp3', import.meta.url).href
    },
    hufflepuff: {
        first: new URL('../assets/music/sorting-hat/hufflepuff-1.mp3', import.meta.url).href,
        second: new URL('../assets/music/sorting-hat/hufflepuff-2.mp3', import.meta.url).href
    },
    ravenclaw: {
        first: new URL('../assets/music/sorting-hat/ravenclaw-1.mp3', import.meta.url).href,
        second: new URL('../assets/music/sorting-hat/ravenclaw-2.mp3', import.meta.url).href
    },
    slytherin: {
        first: new URL('../assets/music/sorting-hat/slytherin-1.mp3', import.meta.url).href,
        second: new URL('../assets/music/sorting-hat/slytherin-2.mp3', import.meta.url).href
    }
};
const SORTING_HAT_FRAGMENT_SOURCES = [
    new URL('../assets/music/sorting-hat/thats-an-interesting-pick.mp3', import.meta.url).href,
    new URL('../assets/music/sorting-hat/ah-i-see.mp3', import.meta.url).href,
    new URL('../assets/music/sorting-hat/alright-very-well.mp3', import.meta.url).href,
    new URL('../assets/music/sorting-hat/go-on-hurry-up.mp3', import.meta.url).href,
    new URL('../assets/music/sorting-hat/ha-okay.mp3', import.meta.url).href,
    new URL('../assets/music/sorting-hat/i-would-not-have-guessed.mp3', import.meta.url).href,
    new URL('../assets/music/sorting-hat/interesting.mp3', import.meta.url).href,
    new URL('../assets/music/sorting-hat/mmm-alrighty-then.mp3', import.meta.url).href,
    new URL('../assets/music/sorting-hat/mmm-okay.mp3', import.meta.url).href,
    new URL('../assets/music/sorting-hat/pick-your-next-one-wisely.mp3', import.meta.url).href,
    new URL('../assets/music/sorting-hat/very-well-then.mp3', import.meta.url).href,
    new URL('../assets/music/sorting-hat/youre-almost-there.mp3', import.meta.url).href,
    new URL('../assets/music/sorting-hat/okay.mp3', import.meta.url).href,
    new URL('../assets/music/sorting-hat/mmm-its-becoming-clearer-now.mp3', import.meta.url).href,
    new URL('../assets/music/sorting-hat/hmm-quite-revealing.mp3', import.meta.url).href,
    new URL('../assets/music/sorting-hat/that-is-useful-to-know.mp3', import.meta.url).href,
    new URL('../assets/music/sorting-hat/ha-just-as-I-thought.mp3', import.meta.url).href,
    new URL('../assets/music/sorting-hat/mmm-unexpected.mp3', import.meta.url).href,
    new URL('../assets/music/sorting-hat/yes-yes-i-had-a-feeling.mp3', import.meta.url).href
];
const FIRST_SORTING_HAT_FRAGMENT_SOURCE = SORTING_HAT_FRAGMENT_SOURCES[0];
const ALMOST_THERE_SORTING_HAT_FRAGMENT_SOURCE =
    SORTING_HAT_FRAGMENT_SOURCES.find((source) => source.endsWith('/youre-almost-there.mp3')) ??
    FIRST_SORTING_HAT_FRAGMENT_SOURCE;
const RANDOM_SORTING_HAT_FRAGMENT_SOURCES = SORTING_HAT_FRAGMENT_SOURCES.filter(
    (source) => source !== ALMOST_THERE_SORTING_HAT_FRAGMENT_SOURCE
);
const SORTING_QUESTION_COUNT = 10;
const SORTING_HAT_FRAGMENT_HISTORY_LIMIT = SORTING_HAT_FRAGMENT_SOURCES.length;
const QUESTION_TRANSITION_MS = 720;
const SORTING_UI_DELAY_MS = 240;
const SORTING_UI_STAGGER_MS = 90;
const INITIAL_SORTING_UI_DELAY_MS = 1200;
const SORTING_HAT_SUBTITLE_FADE_MS = 300;
const AUDIO_PLAY_COOLDOWN_MS = 1000;
const SORTING_HAT_IMAGE_PULSE_MIN_MS = 100;
const SORTING_HAT_IMAGE_PULSE_MAX_MS = 400;
const ANSWER_SORTING_HAT_IMAGE_PULSE_MIN_MS = 300;
const ANSWER_SORTING_HAT_IMAGE_PULSE_MAX_MS = 800;
const HOUSE_REVEAL_SORTING_HAT_IMAGE_PULSE_DURATION_MS = 1500;
const CHAMBER_BUTTON_REVEAL_DELAY_MS = 2000;
let nextAllowedAudioPlayAt = 0;
let pendingAudioStart = Promise.resolve();

const sortingHatSubtitlesPromise = fetch(SORTING_HAT_SUBTITLES_URL, {
    cache: 'no-store'
})
    .then(async (response) => {
        if (!response.ok) {
            throw new Error(`Failed to load sorting subtitles: ${response.status}`);
        }

        const data = await response.json();

        if (data === null || typeof data !== 'object') {
            throw new Error('Sorting subtitles are missing.');
        }

        if (!Array.isArray(data)) {
            throw new Error('Sorting subtitles are missing.');
        }

        return new Map(
            data.flatMap((entry) => {
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
let activeSortingHatSubtitleSource = '';
let sortingHatSubtitleSentenceTimeoutId = null;
let sortingHatSubtitlePlaybackToken = 0;

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

function cancelSortingHatSubtitleSentencePlayback() {
    sortingHatSubtitlePlaybackToken += 1;

    if (sortingHatSubtitleSentenceTimeoutId !== null) {
        window.clearTimeout(sortingHatSubtitleSentenceTimeoutId);
        sortingHatSubtitleSentenceTimeoutId = null;
    }
}

function setSortingHatSubtitleVisibility(subtitleEl, isVisible) {
    subtitleEl.classList.toggle('opacity-0', !isVisible);
    subtitleEl.classList.toggle('opacity-70', isVisible);
}

function showSortingHatSubtitleSentence(subtitleEl, sentences, sentenceIndex, playbackToken) {
    if (playbackToken !== sortingHatSubtitlePlaybackToken) {
        return;
    }

    const sentence = sentences[sentenceIndex];

    if (!sentence) {
        sortingHatSubtitleSentenceTimeoutId = null;
        return;
    }

    subtitleEl.textContent = sentence.text;
    const isLastSentence = sentenceIndex >= sentences.length - 1;
    setSortingHatSubtitleVisibility(subtitleEl, true);

    sortingHatSubtitleSentenceTimeoutId = window.setTimeout(() => {
        if (playbackToken !== sortingHatSubtitlePlaybackToken) {
            return;
        }

        if (!isLastSentence) {
            showSortingHatSubtitleSentence(subtitleEl, sentences, sentenceIndex + 1, playbackToken);
            return;
        }

        setSortingHatSubtitleVisibility(subtitleEl, false);

        window.setTimeout(() => {
            sortingHatSubtitleSentenceTimeoutId = null;
        }, SORTING_HAT_SUBTITLE_FADE_MS);
    }, sentence.durationMs);
}

function createEmptyScores() {
    return Object.fromEntries(HOUSE_ORDER.map((house) => [house, 0]));
}

function getAudioSourceName(source) {
    try {
        return normalizeAudioSourceName(new URL(source, window.location.href).pathname);
    } catch {
        return normalizeAudioSourceName(source);
    }
}

async function showSortingHatSubtitleForSource(source) {
    const subtitleMap = await sortingHatSubtitlesPromise;
    const sourceName = getAudioSourceName(source);
    const subtitleSentences = subtitleMap.get(sourceName);
    const subtitleEl = document.getElementById('sorting-subtitles');

    if (!(subtitleEl instanceof HTMLElement)) {
        return;
    }

    if (!Array.isArray(subtitleSentences) || subtitleSentences.length === 0) {
        clearSortingHatSubtitleForSource(source);
        return;
    }

    cancelSortingHatSubtitleSentencePlayback();

    activeSortingHatSubtitleSource = sourceName;
    const playbackToken = sortingHatSubtitlePlaybackToken;
    const startSubtitleSequence = () => {
        showSortingHatSubtitleSentence(subtitleEl, subtitleSentences, 0, playbackToken);
    };

    startSubtitleSequence();
}

function clearSortingHatSubtitleForSource(source = null) {
    if (source !== null && activeSortingHatSubtitleSource !== getAudioSourceName(source)) {
        return;
    }

    cancelSortingHatSubtitleSentencePlayback();
    activeSortingHatSubtitleSource = '';

    const subtitleEl = document.getElementById('sorting-subtitles');

    if (!(subtitleEl instanceof HTMLElement)) {
        return;
    }

    subtitleEl.classList.remove('opacity-70');
    subtitleEl.classList.add('opacity-0');
}

function formatHouseName(house) {
    return house.charAt(0).toUpperCase() + house.slice(1);
}

function getWinningHouse(scores) {
    const bestScore = Math.max(...HOUSE_ORDER.map((house) => scores[house] ?? 0));
    const tiedHouses = HOUSE_ORDER.filter((house) => (scores[house] ?? 0) === bestScore);

    // Break ties randomly so no house is favoured by its position in HOUSE_ORDER.
    return tiedHouses[Math.floor(Math.random() * tiedHouses.length)];
}

function setEnterState(element) {
    element.classList.add('transition-all', 'duration-700', 'ease-out');
    element.classList.add('opacity-0');
    element.classList.remove('opacity-100');
}

function playEnterAnimation(elements) {
    window.requestAnimationFrame(() => {
        elements.forEach((element) => {
            element.classList.remove('opacity-0');
            element.classList.add('opacity-100');
        });
    });
}

function playExitAnimation(elements) {
    elements.forEach((element) => {
        element.style.transitionDelay = '0ms';
        element.classList.remove('opacity-100');
        element.classList.add('opacity-0');
    });
}

function createAnswerCarousel(answers, onSubmitAnswer) {
    let selectedAnswerIndex = 0;
    let touchStartX = null;

    const container = document.createElement('div');
    container.className = 'flex h-full flex-col gap-y-3';

    const viewport = document.createElement('div');
    viewport.className = 'relative min-h-0 flex-1 overflow-hidden';
    viewport.setAttribute('aria-live', 'polite');

    const track = document.createElement('div');
    track.className = 'flex h-full items-center transition-transform duration-300 ease-out';

    const navRow = document.createElement('div');
    navRow.className = 'flex items-center justify-center';

    const dotRow = document.createElement('div');
    dotRow.className = 'flex items-center justify-center gap-x-1.5';
    dotRow.setAttribute('aria-label', 'Answer slides');

    const createChevronIcon = (direction) => {
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('aria-hidden', 'true');
        icon.setAttribute('viewBox', '0 0 20 20');
        icon.setAttribute('fill', 'none');
        icon.setAttribute('stroke', 'currentColor');
        icon.setAttribute('stroke-width', '1.8');
        icon.setAttribute('stroke-linecap', 'round');
        icon.setAttribute('stroke-linejoin', 'round');
        icon.classList.add('h-5', 'w-5');

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', direction === 'left' ? 'M12.5 4.5L7 10l5.5 5.5' : 'M7.5 4.5L13 10l-5.5 5.5');
        icon.appendChild(path);

        return icon;
    };

    const prevButton = document.createElement('button');
    prevButton.type = 'button';
    prevButton.dataset.pop = 'small';
    prevButton.className = 'pointer-events-auto inline-flex h-9 w-9 items-center justify-center text-amber-100/90 transition-colors duration-200 hover:text-amber-50 disabled:cursor-not-allowed disabled:opacity-35';
    prevButton.style.position = 'relative';
    prevButton.style.right = '12px';
    prevButton.setAttribute('aria-label', 'Previous answer');
    prevButton.appendChild(createChevronIcon('left'));

    const nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.dataset.pop = 'small';
    nextButton.className = 'pointer-events-auto inline-flex h-9 w-9 items-center justify-center text-amber-100/90 transition-colors duration-200 hover:text-amber-50 disabled:cursor-not-allowed disabled:opacity-35';
    nextButton.style.position = 'relative';
    nextButton.style.left = '12px';
    nextButton.setAttribute('aria-label', 'Next answer');
    nextButton.appendChild(createChevronIcon('right'));

    const chooseButton = document.createElement('button');
    chooseButton.type = 'button';
    chooseButton.dataset.pop = 'high';
    chooseButton.className = 'group flex w-full max-w-full box-border items-center justify-center gap-x-3 rounded-none px-4 py-3 text-left text-base font-inkpot text-amber-50 transition-colors duration-200 hover:text-amber-100 focus:outline-none focus-visible:outline-none sm:text-base';

    const chooseButtonLabel = document.createElement('span');
    chooseButtonLabel.textContent = 'Choose answer';

    const chooseButtonArrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chooseButtonArrow.setAttribute('aria-hidden', 'true');
    chooseButtonArrow.setAttribute('viewBox', '0 0 24 24');
    chooseButtonArrow.setAttribute('fill', 'currentColor');
    chooseButtonArrow.classList.add(
        'h-5',
        'w-5',
        'text-yellow-300',
        'drop-shadow-[0_0_6px_rgba(253,224,71,0.55)]'
    );

    const lightningPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    lightningPath.setAttribute('d', 'M13 2L4 14h6l-1 8 9-12h-6l1-8z');
    chooseButtonArrow.appendChild(lightningPath);
    const chooseButtonArrowRight = chooseButtonArrow.cloneNode(true);

    chooseButton.append(chooseButtonArrow, chooseButtonLabel, chooseButtonArrowRight);

    const dots = answers.map((_, index) => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.dataset.pop = 'small';
        dot.className = 'h-1.5 w-1.5 rounded-full bg-amber-100/45 transition-all duration-200';
        dot.setAttribute('aria-label', `Go to answer ${index + 1}`);
        dot.addEventListener('click', () => {
            selectedAnswerIndex = index;
            updateCarouselUI();
        });
        dotRow.appendChild(dot);
        return dot;
    });

    const updateCarouselUI = () => {
        const offsetPercent = selectedAnswerIndex * 100;
        track.style.transform = `translateX(-${offsetPercent}%)`;
        prevButton.disabled = selectedAnswerIndex === 0;
        nextButton.disabled = selectedAnswerIndex >= answers.length - 1;

        dots.forEach((dot, index) => {
            const isActive = index === selectedAnswerIndex;
            dot.classList.toggle('bg-amber-100', isActive);
            dot.classList.toggle('bg-amber-100/45', !isActive);
            dot.classList.toggle('h-2', isActive);
            dot.classList.toggle('w-2', isActive);
            dot.classList.toggle('h-1.5', !isActive);
            dot.classList.toggle('w-1.5', !isActive);
            dot.setAttribute('aria-current', isActive ? 'true' : 'false');
        });
    };

    const goToPrevious = () => {
        if (selectedAnswerIndex <= 0) {
            return;
        }

        selectedAnswerIndex -= 1;
        updateCarouselUI();
    };

    const goToNext = () => {
        if (selectedAnswerIndex >= answers.length - 1) {
            return;
        }

        selectedAnswerIndex += 1;
        updateCarouselUI();
    };

    answers.forEach((answer, index) => {
        const slide = document.createElement('button');
        slide.type = 'button';
        slide.dataset.pop = 'medium';
        slide.className = 'group h-full w-full shrink-0 text-left';

        const copy = document.createElement('div');
        copy.className = 'flex h-full items-center justify-center py-4 px-4 text-center font-inkpot text-lg leading-relaxed text-amber-50/92 transition-colors duration-200 group-hover:text-amber-50 sm:px-8 sm:text-xl';
        copy.textContent = answer.text;

        slide.appendChild(copy);
        slide.addEventListener('click', () => {
            selectedAnswerIndex = index;
            updateCarouselUI();
        });

        track.appendChild(slide);
    });

    prevButton.addEventListener('click', goToPrevious);

    nextButton.addEventListener('click', goToNext);

    viewport.addEventListener('touchstart', (event) => {
        touchStartX = event.touches[0]?.clientX ?? null;
    });

    viewport.addEventListener('touchend', (event) => {
        if (touchStartX === null) {
            return;
        }

        const touchEndX = event.changedTouches[0]?.clientX;

        if (typeof touchEndX !== 'number') {
            touchStartX = null;
            return;
        }

        const deltaX = touchEndX - touchStartX;
        touchStartX = null;

        if (Math.abs(deltaX) < 36) {
            return;
        }

        const previousIndex = selectedAnswerIndex;

        if (deltaX < 0) {
            goToNext();
        } else {
            goToPrevious();
        }

        if (selectedAnswerIndex !== previousIndex) {
            playPop('small');
        }
    });

    chooseButton.addEventListener('click', () => {
        const selectedAnswer = answers[selectedAnswerIndex];

        if (!selectedAnswer) {
            return;
        }

        onSubmitAnswer(selectedAnswer);
    });

    const chevronOverlay = document.createElement('div');
    chevronOverlay.className = 'pointer-events-none absolute inset-y-0 left-0 right-0 z-10 flex items-center justify-between px-1 sm:px-2';
    chevronOverlay.append(prevButton, nextButton);

    viewport.append(track, chevronOverlay);
    navRow.append(dotRow);
    container.append(viewport, navRow, chooseButton);
    updateCarouselUI();

    return {
        container,
        controls: [prevButton, nextButton, chooseButton]
    };
}

function pickRandomQuestions(questions, count) {
    const pool = [...questions];
    const selectedQuestions = [];
    const targetCount = Math.min(count, pool.length);

    while (selectedQuestions.length < targetCount && pool.length > 0) {
        const randomIndex = Math.floor(Math.random() * pool.length);
        const [nextQuestion] = pool.splice(randomIndex, 1);
        selectedQuestions.push(nextQuestion);
    }

    return selectedQuestions;
}

function getRandomSortingHatFragmentSource(recentSources) {
    const recentSourceSet = new Set(recentSources);
    const sourcePool =
        RANDOM_SORTING_HAT_FRAGMENT_SOURCES.length > 0
            ? RANDOM_SORTING_HAT_FRAGMENT_SOURCES
            : [FIRST_SORTING_HAT_FRAGMENT_SOURCE];
    const availableSources = sourcePool.filter((source) => !recentSourceSet.has(source));

    if (recentSourceSet.size === 0) {
        return FIRST_SORTING_HAT_FRAGMENT_SOURCE;
    }

    if (availableSources.length === 0) {
        const fallbackPool = sourcePool.length > 0 ? sourcePool : [FIRST_SORTING_HAT_FRAGMENT_SOURCE];
        const randomIndex = Math.floor(Math.random() * fallbackPool.length);
        return fallbackPool[randomIndex] ?? FIRST_SORTING_HAT_FRAGMENT_SOURCE;
    }

    const randomIndex = Math.floor(Math.random() * availableSources.length);

    return availableSources[randomIndex];
}

function createAudio(source, volume = 0.95) {
    const audio = new Audio(source);

    audio.preload = 'auto';
    audio.volume = volume;

    return audio;
}

function reserveAudioStartSlot() {
    pendingAudioStart = pendingAudioStart.then(
        () =>
            new Promise((resolve) => {
                const waitMs = Math.max(0, nextAllowedAudioPlayAt - Date.now());

                window.setTimeout(() => {
                    nextAllowedAudioPlayAt = Date.now() + AUDIO_PLAY_COOLDOWN_MS;
                    resolve();
                }, waitMs);
            })
    );

    return pendingAudioStart;
}

function releaseAudioStartSlot() {
    nextAllowedAudioPlayAt = Date.now();
}

function createAudioPlaybackError(error) {
    if (error instanceof Error) {
        return error;
    }

    return new Error('Audio playback failed.');
}

function playHogwartsMarchBackgroundAudio() {
    const audio = document.getElementById('background-audio');

    if (!(audio instanceof HTMLAudioElement)) {
        return;
    }

    const hogwartsMarchSource = './assets/music/hogwarts-march.mp3';
    const currentSource = audio.currentSrc || audio.getAttribute('src') || '';
    const sourceElement = audio.querySelector('source[src]');
    const isAlreadyPlayingHogwartsMarch = currentSource.includes('/hogwarts-march.mp3');

    audio.pause();

    if (sourceElement instanceof HTMLSourceElement) {
        sourceElement.src = hogwartsMarchSource;
    } else {
        audio.src = hogwartsMarchSource;
    }

    if (!isAlreadyPlayingHogwartsMarch) {
        audio.currentTime = 0;
    }

    audio.muted = false;
    audio.load();

    void audio.play().then(() => {
        window.audioIsEnabled = true;
    }).catch((error) => {
        console.info('Hogwarts March autoplay was blocked by the browser.', error);
    });
}

function playAudioAndWait(audio) {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            audio.removeEventListener('ended', handleEnded);
            audio.removeEventListener('error', handleError);
        };

        const handleEnded = () => {
            cleanup();
            resolve();
        };

        const handleError = () => {
            cleanup();
            reject(new Error('Audio playback failed.'));
        };

        audio.addEventListener('ended', handleEnded, { once: true });
        audio.addEventListener('error', handleError, { once: true });

        reserveAudioStartSlot()
            .then(() => audio.play())
            .catch((error) => {
                cleanup();
                releaseAudioStartSlot();
                reject(createAudioPlaybackError(error));
            });
    });
}

function safeStoreState(state) {
    writeJsonToLocalStorage(STORAGE_KEY, state);
}

function resetStoredState() {
    return resetLocalStorageState(STORAGE_KEY, {
        currentQuestionIndex: 0,
        scores: createEmptyScores()
    });
}

async function loadQuestions() {
    const response = await fetch(QUESTIONS_URL, {
        cache: 'no-store'
    });

    if (!response.ok) {
        throw new Error(`Failed to load sorting questions: ${response.status}`);
    }

    const data = await response.json();

    if (!Array.isArray(data?.questions) || data.questions.length === 0) {
        throw new Error('Sorting questions are missing.');
    }

    return data;
}

function initSortingQuiz(guest) {
    // Guests who already chose dishes are re-sorting; send them back to the map afterwards.
    const isResorting = Array.isArray(guest?.dishIds) && guest.dishIds.length > 0;
    const nextPage = isResorting ? 'map' : 'cabin';

    const progressEl = document.getElementById('sorting-progress');
    const questionEl = document.getElementById('sorting-question');
    const questionContainerEl = questionEl?.parentElement;
    const optionsEl = document.getElementById('sorting-options');
    const optionsContainerEl = document.getElementById('sorting-options-panel');
    const resultEl = document.getElementById('sorting-result');
    const resultHouseEl = document.getElementById('sorting-house-name');
    const resultCopyEl = document.getElementById('sorting-result-copy');
    const restartButton = document.getElementById('sorting-restart');
    const sortingMainEl = document.getElementById('sorting-main');
    const audioGateEl = document.getElementById('audio-gate');
    const audioEnableButton = document.getElementById('audio-enable-button');

    if (
        !(progressEl instanceof HTMLElement) ||
        !(questionEl instanceof HTMLElement) ||
        !(questionContainerEl instanceof HTMLElement) ||
        !(optionsEl instanceof HTMLElement) ||
        !(optionsContainerEl instanceof HTMLElement) ||
        !(resultEl instanceof HTMLElement) ||
        !(resultHouseEl instanceof HTMLElement) ||
        !(resultCopyEl instanceof HTMLElement) ||
        !(restartButton instanceof HTMLButtonElement) ||
        !(sortingMainEl instanceof HTMLElement) ||
        !(audioGateEl instanceof HTMLElement) ||
        !(audioEnableButton instanceof HTMLButtonElement)
    ) {
        return;
    }

    let currentQuestionIndex = 0;
    let scores = createEmptyScores();
    let questions = [];
    let hasSentResult = false;
    let sortingResultPromise = Promise.resolve();
    // Points for being sorted come once: not when re-sorting (they move along with the house).
    let hasCelebratedSortingPoints = Boolean(guest?.house);
    let isTransitioning = false;
    let hasStarted = false;
    let currentGuestName = '';
    let playedSortingHatFragments = [];
    let activeSortingHatFragments = new Set();
    let sortingHatFragmentPlaybackToken = 0;
    let revealHouseButton = null;
    let chamberButton = null;
    let pendingRevealHouse = null;
    let houseRevealAudio = null;
    let houseRevealLocked = false;
    let chamberNavigationLocked = false;
    let chamberButtonRevealTimer = null;
    let houseRevealHatImagePulseTimer = null;
    let houseRevealFinalizationTimer = null;
    let houseBackdropRevealFrameId = null;

    function startSortingFlow() {
        if (hasStarted) {
            return;
        }

        hasStarted = true;
        document.body.classList.remove('audio-gate-visible');
        audioGateEl.classList.add('hidden');
        sortingMainEl.classList.remove('hidden');
        sortingMainEl.classList.add('flex');

        void window.unlockBackgroundAudio?.().then((didUnlock) => {
            if (!didUnlock) {
                return;
            }

            if (typeof window.playSortingHatWelcomeAudio === 'function') {
                window.setTimeout(() => {
                    window.playSortingHatWelcomeAudio();
                }, 2400);
            }
        });

        void loadQuestions()
            .then((data) => {
                questions = pickRandomQuestions(data.questions, SORTING_QUESTION_COUNT);
                const state = resetStoredState();
                currentQuestionIndex = state.currentQuestionIndex;
                scores = state.scores;
                hasSentResult = false;
                isTransitioning = false;
                resetSortingHatFragments();
                resetHouseRevealState();
                renderQuestion();
            })
            .catch(() => {
                progressEl.textContent = 'Sorting unavailable';
                questionContainerEl.classList.remove('hidden');
                questionEl.classList.remove('hidden');
                questionEl.textContent = 'The Sorting Hat questions could not be loaded.';
                optionsEl.innerHTML = '';
                resultEl.classList.add('hidden');
            });
    }

    function showAudioGate() {
        audioGateEl.classList.remove('hidden');
        audioGateEl.classList.add('flex');
    }

    function attemptAutoStartSortingFlow() {
        if (window.audioIsEnabled) {
            startSortingFlow();
            return;
        }

        if (typeof window.unlockBackgroundAudio !== 'function') {
            showAudioGate();
            return;
        }

        void window.unlockBackgroundAudio().then((didUnlock) => {
            if (didUnlock) {
                startSortingFlow();
                return;
            }

            showAudioGate();
        });
    }

    function setQuizPromptVisibility(isVisible) {
        const method = isVisible ? 'remove' : 'add';

        progressEl.classList[method]('hidden');
        questionContainerEl.classList[method]('hidden');
        optionsContainerEl.classList[method]('hidden');
    }

    function persistState() {
        safeStoreState({
            currentQuestionIndex,
            scores
        });
    }

    async function hydrateCurrentGuestName() {
        try {
            const invitationData = await getInvitationData();
            currentGuestName = typeof invitationData?.guestName === 'string' ? invitationData.guestName.trim() : '';
        } catch {
            currentGuestName = '';
        }
    }

    function resetSortingHatFragments() {
        sortingHatFragmentPlaybackToken += 1;

        activeSortingHatFragments.forEach((audio) => {
            audio.pause();
            audio.currentTime = 0;
        });

        activeSortingHatFragments.clear();
        playedSortingHatFragments = [];
    }

    function stopHouseRevealHatImagePulse() {
        if (houseRevealHatImagePulseTimer !== null) {
            window.clearTimeout(houseRevealHatImagePulseTimer);
            houseRevealHatImagePulseTimer = null;
        }
    }

    function stopHouseRevealFinalizationTimer() {
        if (houseRevealFinalizationTimer !== null) {
            window.clearTimeout(houseRevealFinalizationTimer);
            houseRevealFinalizationTimer = null;
        }
    }

    function stopHouseBackdropRevealFrame() {
        if (houseBackdropRevealFrameId !== null) {
            window.cancelAnimationFrame(houseBackdropRevealFrameId);
            houseBackdropRevealFrameId = null;
        }
    }

    function triggerSortingHatImagePulse(
        durationMs = 2000,
        minDelayMs = SORTING_HAT_IMAGE_PULSE_MIN_MS,
        maxDelayMs = SORTING_HAT_IMAGE_PULSE_MAX_MS
    ) {
        stopHouseRevealHatImagePulse();

        const startedAt = Date.now();

        const tick = () => {
            if (Date.now() - startedAt >= durationMs) {
                stopHouseRevealHatImagePulse();
                return;
            }

            if (typeof window.switchSortingHatImageNow === 'function') {
                window.switchSortingHatImageNow();
            }

            houseRevealHatImagePulseTimer = window.setTimeout(
                tick,
                minDelayMs + Math.random() * (maxDelayMs - minDelayMs)
            );
        };

        tick();
    }

    function clearHouseResultBackdrop() {
        const houseBackdropEl = document.getElementById('sorting-backdrop-house');

        if (!(houseBackdropEl instanceof HTMLElement)) {
            return;
        }

        stopHouseBackdropRevealFrame();

        houseBackdropEl.style.opacity = '';
        houseBackdropEl.classList.remove('opacity-50', 'opacity-100');
        houseBackdropEl.classList.add('opacity-0');
        houseBackdropEl.style.backgroundImage = 'none';
    }

    function setSortingOverlayHalfVisible() {
        const sortingOverlayEl = document.getElementById('sorting-overlay');

        if (!(sortingOverlayEl instanceof HTMLElement)) {
            return;
        }

        // Freeze current visual opacity first, then tween smoothly to 50%.
        const currentOpacity = window.getComputedStyle(sortingOverlayEl).opacity || '1';
        sortingOverlayEl.style.opacity = currentOpacity;
        sortingOverlayEl.style.animationName = 'none';
        sortingOverlayEl.style.animationDuration = '700ms';
        sortingOverlayEl.style.animationTimingFunction = 'ease-out';
        sortingOverlayEl.style.animationFillMode = 'forwards';
        sortingOverlayEl.style.transitionProperty = 'opacity';
        sortingOverlayEl.style.transitionDuration = '700ms';
        sortingOverlayEl.style.transitionTimingFunction = 'ease-out';
        sortingOverlayEl.classList.remove('opacity-0', 'opacity-100');
        sortingOverlayEl.classList.add('opacity-50');

        // Force a layout flush so the next opacity update transitions instead of snapping.
        void sortingOverlayEl.offsetWidth;

        window.requestAnimationFrame(() => {
            sortingOverlayEl.style.opacity = '0.5';
        });
    }

    function setHouseResultBackdropHalfVisible() {
        const houseBackdropEl = document.getElementById('sorting-backdrop-house');

        if (!(houseBackdropEl instanceof HTMLElement)) {
            return;
        }

        stopHouseBackdropRevealFrame();

        houseBackdropEl.classList.remove('opacity-0', 'opacity-50');
        houseBackdropEl.classList.add('opacity-100');
        houseBackdropEl.style.opacity = '1';
    }

    function setHouseResultBackdrop(house) {
        const houseBackdropEl = document.getElementById('sorting-backdrop-house');

        if (!(houseBackdropEl instanceof HTMLElement)) {
            return;
        }

        stopHouseBackdropRevealFrame();

        const houseBackgroundSource = `./assets/images/the-great-hall-${house}.png`;
        houseBackdropEl.style.backgroundImage = `url("${houseBackgroundSource}")`;
        houseBackdropEl.style.opacity = '';
        houseBackdropEl.classList.remove('opacity-50', 'opacity-100');
        houseBackdropEl.classList.add('opacity-0');

        houseBackdropRevealFrameId = window.requestAnimationFrame(() => {
            houseBackdropEl.classList.remove('opacity-0');
            houseBackdropEl.classList.add('opacity-100');
            houseBackdropRevealFrameId = null;
        });
    }

    // The next page's guard needs the saved house, so wait for the save before leaving.
    async function navigateToCabinAfterSave() {
        await sortingResultPromise;
        window.location.href = getPageUrl(nextPage);
    }

    // Resolves with the saved guest state, or null when it couldn't be saved.
    async function saveSortingResult(payload) {
        try {
            return await sendSortingHouseResult(payload);
        } catch (error) {
            if (isApiError(error, 409) || isApiError(error, 404) || isApiError(error, 403)) {
                // Not accepted, deadline passed or unknown guest: continue from the actual state.
                const latestGuest = await getGuest({ refresh: true }).catch(() => null);
                redirectToPage(getNextStep(latestGuest));
                return new Promise(() => {});
            }

            // One retry for flaky connections.
            await new Promise((resolve) => window.setTimeout(resolve, 1000));
            return sendSortingHouseResult(payload).catch((retryError) => {
                console.warn('Could not save the sorting result.', retryError);
                return null;
            });
        }
    }

    // Once the hat has spoken and the house is saved: "+10" flies from the house name into the House Cup button
    // and Dumbledore awards the points.
    async function celebrateSortingPoints(house, savePromise, hatDone) {
        const [state] = await Promise.all([savePromise, hatDone]);

        if (state?.house !== house) {
            showChamberButton();
            return;
        }

        await new Promise((resolve) => window.setTimeout(resolve, SORTING_POINTS_DELAY_MS));

        // The "+10" flies as he says "Ten points…", after his welcome; still once if he can't speak.
        // The continue button fades in with it, so it's there as he finishes.
        let awarded = false;
        const awardPoints = () => {
            if (awarded) {
                return;
            }
            awarded = true;
            showChamberButton();
            houseCup?.update(state.housePoints);
            const rect = resultHouseEl.getBoundingClientRect();
            const point = rect.width > 0 ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
            burstHousePoints(house, SORTING_HOUSE_POINTS, { point, cup: houseCup });
        };

        await speakTenPoints(house, { onTenPoints: awardPoints }).catch((error) => {
            console.warn('Dumbledore could not speak.', error);
        });
        awardPoints();
    }

    function handleChamberButtonClick() {
        if (chamberNavigationLocked) {
            return;
        }

        chamberNavigationLocked = true;

        const bodyEl = document.querySelector('body');

        if (!(bodyEl instanceof HTMLElement)) {
            void navigateToCabinAfterSave();
            return;
        }

        const currentOpacity = window.getComputedStyle(bodyEl).opacity || '1';
        bodyEl.style.opacity = currentOpacity;
        bodyEl.style.transitionProperty = 'opacity';
        bodyEl.style.transitionDuration = '1000ms';
        bodyEl.style.transitionTimingFunction = 'ease-out';

        void bodyEl.offsetWidth;

        window.requestAnimationFrame(() => {
            bodyEl.style.opacity = '0';
        });

        window.setTimeout(() => {
            void navigateToCabinAfterSave();
        }, 1050);
    }

    function showChamberButton() {
        if (chamberButton) {
            chamberButton.remove();
        }

        chamberButton = document.createElement('button');
        chamberButton.type = 'button';
        chamberButton.dataset.pop = 'high';
        chamberButton.className = 'mx-auto !mt-16 inline-flex w-auto max-w-full cursor-pointer appearance-none border-0 bg-transparent p-0 text-center font-inkpot text-base text-amber-50/80 transition-colors duration-200 hover:opacity-80 focus:outline-none focus-visible:outline-none sm:text-lg';
        chamberButton.textContent = isResorting ? 'Back to the Marauder\u2019s Map \u2192' : 'Go to the Hogwarts Express \u2192';
        chamberButton.addEventListener('click', handleChamberButtonClick);
        chamberButton.style.opacity = '0';
        chamberButton.style.transition = 'opacity 1400ms ease-out';

        const insertionParent = resultHouseEl.parentElement;

        if (insertionParent) {
            insertionParent.insertBefore(chamberButton, resultHouseEl.nextSibling);
        } else {
            resultEl.appendChild(chamberButton);
        }

        const nextChamberButton = chamberButton;
        window.requestAnimationFrame(() => {
            if (chamberButton !== nextChamberButton) {
                return;
            }

            chamberButton.style.opacity = '1';
        });
    }

    function scheduleChamberButtonReveal() {
        if (chamberButtonRevealTimer !== null) {
            window.clearTimeout(chamberButtonRevealTimer);
        }

        chamberButtonRevealTimer = window.setTimeout(() => {
            showChamberButton();
            chamberButtonRevealTimer = null;
        }, CHAMBER_BUTTON_REVEAL_DELAY_MS);
    }

    function resetChamberButton() {
        chamberNavigationLocked = false;

        if (chamberButtonRevealTimer !== null) {
            window.clearTimeout(chamberButtonRevealTimer);
            chamberButtonRevealTimer = null;
        }

        if (!chamberButton) {
            return;
        }

        chamberButton.remove();
        chamberButton = null;
    }

    function resetHouseRevealState() {
        if (houseRevealAudio) {
            houseRevealAudio.pause();
            houseRevealAudio.currentTime = 0;
        }

        stopHouseRevealHatImagePulse();
        stopHouseRevealFinalizationTimer();
        clearHouseResultBackdrop();
        houseRevealAudio = null;
        houseRevealLocked = false;
        pendingRevealHouse = null;
        resetChamberButton();

        if (revealHouseButton) {
            revealHouseButton.remove();
            revealHouseButton = null;
        }
    }

    function getRevealHouseAudio(house, stage) {
        return HOUSE_REVEAL_AUDIO[house]?.[stage] ?? null;
    }

    async function playHouseRevealIntro(house) {
        const source = getRevealHouseAudio(house, 'first');

        if (!source) {
            pendingRevealHouse = house;
            showRevealHouseButton();
            return;
        }

        houseRevealAudio = createAudio(source, 0.95);
        triggerSortingHatImagePulse(7000);

        try {
            await showSortingHatSubtitleForSource(source);
            await playAudioAndWait(houseRevealAudio);
            pendingRevealHouse = house;
            showRevealHouseButton();
        } catch (error) {
            console.info('Sorting Hat reveal intro was blocked by the browser.', error);
            pendingRevealHouse = house;
            showRevealHouseButton();
        } finally {
            clearSortingHatSubtitleForSource(source);
            stopHouseRevealHatImagePulse();
        }
    }

    function revealHouseResult(house) {
        const source = getRevealHouseAudio(house, 'second');

        playHogwartsMarchBackgroundAudio();
        triggerSortingHatImagePulse(HOUSE_REVEAL_SORTING_HAT_IMAGE_PULSE_DURATION_MS);
        setHouseResultBackdrop(house);

        // Settles once the hat has finished announcing the house (or couldn't), so Dumbledore doesn't talk over him.
        let hatDone = Promise.resolve();

        const finalizeReveal = () => {
            setHouseResultBackdropHalfVisible();
            setSortingOverlayHalfVisible();
            resultEl.style.animation = 'none';
            resultEl.classList.remove('hidden', 'opacity-0');
            resultEl.classList.add('opacity-100');
            optionsEl.innerHTML = '';
            resultHouseEl.textContent = `${formatHouseName(house)}!`;
            resultHouseEl.classList.add('text-center');
            resultCopyEl.classList.add('hidden');
            resultCopyEl.textContent = '';
            restartButton.classList.add('hidden');

            if (!hasSentResult) {
                hasSentResult = true;
                houseCup?.setHouse(house);

                sortingResultPromise = saveSortingResult({
                    guestName: currentGuestName,
                    house,
                    scores: { ...scores },
                    questionsAnswered: questions.length
                });

                if (!hasCelebratedSortingPoints) {
                    hasCelebratedSortingPoints = true;
                    // Shows the continue button itself, once Dumbledore awards the points.
                    void celebrateSortingPoints(house, sortingResultPromise, hatDone);
                    return;
                }
            }

            scheduleChamberButtonReveal();
        };

        stopHouseRevealFinalizationTimer();
        houseRevealFinalizationTimer = window.setTimeout(() => {
            finalizeReveal();
            houseRevealFinalizationTimer = null;
        }, 650);

        if (!source) {
            return;
        }

        if (houseRevealLocked) {
            return;
        }

        houseRevealLocked = true;
        houseRevealAudio = createAudio(source, 0.95);

        const revealPlayback = playAudioAndWait(houseRevealAudio)
            .catch((error) => {
                console.info('Sorting Hat reveal audio was blocked by the browser.', error);
            })
            .finally(() => {
                clearSortingHatSubtitleForSource(source);
                houseRevealLocked = false;
            });
        // Capped, in case the audio never reports back.
        hatDone = Promise.race([revealPlayback, new Promise((resolve) => window.setTimeout(resolve, HAT_REVEAL_MAX_WAIT_MS))]);
    }

    function showRevealHouseButton() {
        if (!pendingRevealHouse) {
            return;
        }

        if (revealHouseButton) {
            revealHouseButton.remove();
        }

        revealHouseButton = document.createElement('button');
        revealHouseButton.type = 'button';
        revealHouseButton.dataset.pop = 'high';
        revealHouseButton.className = 'mx-auto mt-2 inline-flex w-auto max-w-full cursor-pointer appearance-none border-0 bg-transparent p-0 text-center font-inkpot text-3xl text-amber-50 transition-colors duration-200 hover:text-amber-200 focus:outline-none focus-visible:outline-none sm:text-4xl';
        revealHouseButton.textContent = 'Reveal house';

        revealHouseButton.addEventListener('click', () => {
            if (!pendingRevealHouse) {
                return;
            }

            const house = pendingRevealHouse;
            pendingRevealHouse = null;
            revealHouseButton?.remove();
            revealHouseButton = null;
            revealHouseResult(house);
        });

        resultEl.classList.remove('hidden', 'opacity-0');
        resultEl.classList.add('opacity-100');
        resultCopyEl.classList.add('hidden');
        restartButton.classList.add('hidden');

        const insertionParent = resultCopyEl.parentElement;

        if (insertionParent) {
            insertionParent.insertBefore(revealHouseButton, resultCopyEl);
        } else {
            resultEl.appendChild(revealHouseButton);
        }
    }

    function playSortingHatFragment(forcedSource = null) {
        sortingHatFragmentPlaybackToken += 1;
        const playbackToken = sortingHatFragmentPlaybackToken;

        activeSortingHatFragments.forEach((activeAudio) => {
            activeAudio.pause();
            activeAudio.currentTime = 0;
        });

        activeSortingHatFragments.clear();

        const source = forcedSource ?? getRandomSortingHatFragmentSource(playedSortingHatFragments);
        const audio = createAudio(source);
        activeSortingHatFragments.add(audio);

        const removeAudio = () => {
            activeSortingHatFragments.delete(audio);
            clearSortingHatSubtitleForSource(source);
        };

        audio.addEventListener('ended', removeAudio, { once: true });
        audio.addEventListener('error', removeAudio, { once: true });

        playedSortingHatFragments = [...playedSortingHatFragments, source].slice(-SORTING_HAT_FRAGMENT_HISTORY_LIMIT);

        reserveAudioStartSlot()
            .then(() => sortingHatSubtitlesPromise)
            .then(async () => {
                if (playbackToken !== sortingHatFragmentPlaybackToken) {
                    activeSortingHatFragments.delete(audio);
                    const staleSourceIndex = playedSortingHatFragments.lastIndexOf(source);

                    if (staleSourceIndex !== -1) {
                        playedSortingHatFragments.splice(staleSourceIndex, 1);
                    }

                    return;
                }

                await showSortingHatSubtitleForSource(source);
                return audio.play();
            })
            .catch((error) => {
                releaseAudioStartSlot();
                activeSortingHatFragments.delete(audio);
                const failedSourceIndex = playedSortingHatFragments.lastIndexOf(source);

                if (failedSourceIndex !== -1) {
                    playedSortingHatFragments.splice(failedSourceIndex, 1);
                }

                clearSortingHatSubtitleForSource(source);
                console.info('Sorting Hat fragment autoplay was blocked by the browser.', error);
            });
    }

    function applyAnswer(answer) {
        if (isTransitioning) {
            return;
        }

        if (typeof window.cancelSortingHatWelcomeAudio === 'function') {
            window.cancelSortingHatWelcomeAudio();
        }

        if (typeof window.cancelSortingHatImageCycle === 'function') {
            window.cancelSortingHatImageCycle();
        }

        triggerSortingHatImagePulse(
            2000,
            ANSWER_SORTING_HAT_IMAGE_PULSE_MIN_MS,
            ANSWER_SORTING_HAT_IMAGE_PULSE_MAX_MS
        );

        HOUSE_ORDER.forEach((house) => {
            scores[house] += Number(answer?.scores?.[house] ?? 0);
        });

        currentQuestionIndex += 1;
        persistState();

        if (currentQuestionIndex < questions.length) {
            const shouldForceAlmostThere = currentQuestionIndex === questions.length - 2;
            const forcedSource = shouldForceAlmostThere ? ALMOST_THERE_SORTING_HAT_FRAGMENT_SOURCE : null;
            playSortingHatFragment(forcedSource);
        }

        void renderQuestion();
    }

    async function renderResult() {
        const winningHouse = getWinningHouse(scores);

        optionsEl.classList.add('pointer-events-none');
        playExitAnimation([progressEl, questionEl, ...Array.from(optionsEl.children)]);

        await new Promise((resolve) => {
            window.setTimeout(resolve, QUESTION_TRANSITION_MS);
        });

        optionsEl.classList.remove('pointer-events-none');

        setQuizPromptVisibility(false);
        optionsEl.innerHTML = '';
        resultEl.classList.add('hidden');
        resultEl.classList.remove('opacity-100');
        resultCopyEl.classList.add('hidden');
        restartButton.classList.add('hidden');
        resetHouseRevealState();
        void playHouseRevealIntro(winningHouse);
    }

    async function renderQuestion() {
        const question = questions[currentQuestionIndex];

        if (!question) {
            void renderResult();
            return;
        }

        if (optionsEl.children.length > 0) {
            isTransitioning = true;
            optionsEl.classList.add('pointer-events-none');

            const existingViews = Array.from(optionsEl.children);
            const exitingOptionElements = existingViews.flatMap((view) => {
                if (!(view instanceof HTMLElement)) {
                    return [];
                }

                return Array.from(view.children);
            });

            playExitAnimation([progressEl, questionEl, ...exitingOptionElements]);

            await new Promise((resolve) => {
                window.setTimeout(resolve, QUESTION_TRANSITION_MS);
            });

            optionsEl.innerHTML = '';
            optionsEl.classList.remove('pointer-events-none');
        }

        setQuizPromptVisibility(true);
        resultEl.classList.add('hidden');
        resultEl.classList.remove('opacity-100');
        questionEl.textContent = `Question ${currentQuestionIndex + 1} of ${questions.length}`;
        questionContainerEl.classList.remove('hidden');
        questionEl.classList.remove('hidden');
        progressEl.textContent = question.question;
        optionsEl.innerHTML = '';

        const answers = Array.isArray(question.answers) ? question.answers : [];

        if (answers.length === 0) {
            const noAnswersMessage = document.createElement('p');
            noAnswersMessage.className = 'font-inkpot text-sm text-amber-100/70 sm:text-base';
            noAnswersMessage.textContent = 'No answers available for this question.';
            optionsEl.appendChild(noAnswersMessage);
            setEnterState(noAnswersMessage);
            playEnterAnimation([progressEl, questionEl, noAnswersMessage]);
            isTransitioning = false;
            return;
        }

        const { container, controls } = createAnswerCarousel(answers, applyAnswer);
        optionsEl.appendChild(container);

        const revealItems = [progressEl, questionEl, container, ...controls];
        const revealDelayMs = currentQuestionIndex === 0 ? INITIAL_SORTING_UI_DELAY_MS : SORTING_UI_DELAY_MS;
        const revealStaggerMs = currentQuestionIndex === 0 ? 0 : SORTING_UI_STAGGER_MS;

        revealItems.forEach((element, index) => {
            setEnterState(element);
            element.style.transitionDelay = `${revealDelayMs + index * revealStaggerMs}ms`;
        });

        window.setTimeout(() => {
            revealItems.forEach((element) => {
                element.classList.remove('opacity-0');
                element.classList.add('opacity-100');
            });
        }, 40);

        isTransitioning = false;
    }

    restartButton.addEventListener('click', () => {
        const state = resetStoredState();
        currentQuestionIndex = state.currentQuestionIndex;
        scores = state.scores;
        hasSentResult = false;
        isTransitioning = false;
        resetSortingHatFragments();
        resetHouseRevealState();
        renderQuestion();
    });

    audioEnableButton.addEventListener('click', startSortingFlow);
    void hydrateCurrentGuestName();
    attemptAutoStartSortingFlow();
}

async function bootstrapSortingPage() {
    const guest = await guardPage('sorting');

    if (!guest) {
        return;
    }

    await whenDomReady();
    houseCup = initHouseCup(guest);
    initSortingQuiz(guest);
}

void bootstrapSortingPage();

window.showSortingHatSubtitleForSource = showSortingHatSubtitleForSource;
window.clearSortingHatSubtitle = clearSortingHatSubtitleForSource;
