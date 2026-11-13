import { getPageUrl, guardPage, whenDomReady } from './guest-flow.js?v=02bc12da1f';
import { initHouseCup } from './house-cup.js?v=02bc12da1f';
import './click-pop.js?v=02bc12da1f';

const BASILISK_FRAME_SOURCES = [
    './assets/images/chamber/basilisk-stale-1.png',
    './assets/images/chamber/basilisk-stale-2.png',
    './assets/images/chamber/basilisk-taunt-1.png',
    './assets/images/chamber/basilisk-stale-1.png'
];

const BASILISK_HISS_AUDIO_SOURCE = './assets/music/chamber/snake-hiss-1.mp3';
const BASILISK_SECOND_HISS_AUDIO_SOURCE = './assets/music/chamber/snake-hiss-2.mp3';
const BASILISK_TAUNT_FRAME_SOURCE = './assets/images/chamber/basilisk-taunt-1.png';
const BASILISK_ENCHANTED_FRAME_SOURCE = './assets/images/chamber/basilisk-enchanted-1.png';
const BASILISK_ENCHANTED_SECOND_FRAME_SOURCE = './assets/images/chamber/basilisk-enchanted-2.png';
const BASILISK_ENCHANTED_FINAL_FRAME_SOURCE = './assets/images/chamber/basilisk-enchanted-3.png';
const CHAMBER_BASILISK_DEFEATED_AUDIO_SOURCE = './assets/music/fireworks.mp3';
const BASILISK_SPELL_AUDIO_SOURCE_BY_DEPARTMENT = {
    hufflepuff: './assets/music/chamber/cedric-sectum.mp3',
    ravenclaw: './assets/music/chamber/luna-sectum.mp3',
    gryffindor: './assets/music/chamber/harry-sectum.mp3',
    slytherin: './assets/music/chamber/voldemort-avada.mp3'
};

const BASILISK_APPEAR_DELAY_MS = 2000;
const BASILISK_FRAME_STEP_MS = 320;
const BASILISK_FADE_IN_MS = 420;
const BASILISK_HISS_DELAY_MS = 200;
const BASILISK_BACKDROP_DELAY_MS = BASILISK_FRAME_STEP_MS * 3 + 50;
const BASILISK_BACKDROP_FADE_MS = 1800;
const BASILISK_CHATBOX_DELAY_MS = BASILISK_BACKDROP_FADE_MS;
const BASILISK_CONTINUE_DELAY_MS = 600;
const BASILISK_CONTINUE_BUTTON_REVEAL_DELAY_MS = 250;
const BASILISK_DIALOGUE_GROUP_REENTRY_DELAY_MS = BASILISK_FADE_IN_MS + 320;
const CHAMBER_MAP_REDIRECT_FADE_DURATION_MS = 1000;
const CHAMBER_MAP_REDIRECT_DELAY_MS = 1050;
const BASILISK_STAFF_FADE_IN_MS = 800;
const BASILISK_STAFF_SPELL_CAST_MS = 2400;
const BASILISK_SPELL_PARTICLE_COUNT = 96;
const BASILISK_DARK_SPELL_PARTICLE_COUNT = 168;
const BASILISK_SPELL_PARTICLE_DELAY_MS = 420;
const BASILISK_CAST_HISS_DELAY_MS = 200;
const BASILISK_SLASH_FRAME_STEP_MS = 120;
const BASILISK_SLASH_FRAME_HOLD_MS = 180;
const BASILISK_TAUNT_DELAY_MS = 300;
const BASILISK_ENCHANTED_TRANSITION_LEAD_MS = 4000;
const BASILISK_FINAL_BACKDROP_FADE_IN_MS = 3000;
const BASILISK_FINAL_BASILISK_FADE_TOTAL_DELAY_MS = 1500;
const PHOENIX_FLIGHT_START_DELAY_MS = 2500;
const PHOENIX_FLIGHT_DURATION_MS = 4000;
const PHOENIX_FRAME_SWITCH_MS = 200;
const PHOENIX_SCREECH_AUDIO_SOURCE = './assets/music/chamber/phoenix-screech.mp3';
const PHOENIX_WINGS_AUDIO_SOURCE = './assets/music/chamber/phoenix-wings.mp3';
const PHOENIX_PAPER_FALLING_AUDIO_SOURCE = './assets/music/chamber/paper-falling.mp3';
const PHOENIX_PAPER_THUD_AUDIO_SOURCE = './assets/music/chamber/paper-thud.mp3';
const CHAMBER_AUDIO_GESTURE_EVENTS = ['pointerdown', 'touchstart', 'click', 'keydown'];
const PHOENIX_SCROLL_SOURCE = './assets/images/chamber/scroll-1.png';
const PHOENIX_SCROLL_DROP_TRIGGER_RATIO = 0.5;
const PHOENIX_SCROLL_DROP_DURATION_MS = 3600;
const PHOENIX_SCROLL_THUD_LEAD_MS = 1050;
const PHOENIX_SCROLL_TARGET_TOP_RATIO = 0.65;
const PHOENIX_SCROLL_TARGET_LEFT_DRIFT_RATIO = 0.11;
const PHOENIX_SCROLL_TARGET_LEFT_DRIFT_MAX_PX = 200;
const PHOENIX_SCROLL_LANDING_OVERSHOOT_MAX_PX = 5;
const PHOENIX_SCROLL_LANDING_BOUNCE_UP_MAX_PX = 18;
const PHOENIX_SCROLL_FINAL_ROTATION_DEG = 34;
const PHOENIX_SCROLL_IMPACT_PARTICLE_COUNT = 16;
const PHOENIX_SCROLL_IMPACT_PARTICLE_DURATION_MS = 850;
const PHOENIX_SCROLL_IMPACT_PARTICLE_SPREAD_PX = 110;
const PHOENIX_SCROLL_IMPACT_ADVANCE_MS = 2000;
const PHOENIX_FRAME_SOURCES = [
    './assets/images/chamber/phoenix-1.png',
    './assets/images/chamber/phoenix-2.png',
    './assets/images/chamber/phoenix-3.png',
    './assets/images/chamber/phoenix-4.png'
];
const CABIN_DEPARTMENTS = ['gryffindor', 'hufflepuff', 'ravenclaw', 'slytherin'];
const CABIN_DEFAULT_DEPARTMENT = 'ravenclaw';
const STAFF_SOURCE_BY_DEPARTMENT = {
    gryffindor: './assets/images/chamber/staff-gryffindor.png',
    hufflepuff: './assets/images/chamber/staff-hufflepuff.png',
    ravenclaw: './assets/images/chamber/staff-ravenclaw.png',
    slytherin: './assets/images/chamber/staff-slytherin.png'
};
const BASILISK_PRELOADS = [
    ...BASILISK_FRAME_SOURCES.map(preloadImage),
    preloadImage(BASILISK_ENCHANTED_FRAME_SOURCE),
    preloadImage(BASILISK_ENCHANTED_SECOND_FRAME_SOURCE),
    preloadImage(BASILISK_ENCHANTED_FINAL_FRAME_SOURCE),
    preloadImage('./assets/images/chatbox.png'),
    ...PHOENIX_FRAME_SOURCES.map(preloadImage),
    preloadImage(PHOENIX_SCROLL_SOURCE)
];

async function loadBasiliskDialogue() {
    try {
        const response = await fetch('./assets/files/chamber-dialogues.json', { cache: 'no-cache' });

        if (!response.ok) {
            throw new Error(`Failed to load chamber dialogues: ${response.status}`);
        }

        const data = await response.json();
        const groups = data?.groups;

        if (!Array.isArray(groups)) {
            throw new Error('Invalid chamber dialogues payload: expected groups array.');
        }

        const encounterGroup = groups.find((group) => Number(group?.groupId) === 1);
        const thirdGroup = groups.find((group) => Number(group?.groupId) === 3);
        const fourthGroup = groups.find((group) => Number(group?.groupId) === 4);
        const fifthGroup = groups.find((group) => Number(group?.groupId) === 5);
        const sixthGroup = groups.find((group) => Number(group?.groupId) === 6);
        const seventhGroup = groups.find((group) => Number(group?.groupId) === 7);

        return {
            encounterDialogues: Array.isArray(encounterGroup?.dialogues) ? encounterGroup.dialogues : [],
            thirdGroupDialogues: Array.isArray(thirdGroup?.dialogues) ? thirdGroup.dialogues : [],
            fourthGroupDialogues: Array.isArray(fourthGroup?.dialogues) ? fourthGroup.dialogues : [],
            fifthGroupDialogues: Array.isArray(fifthGroup?.dialogues) ? fifthGroup.dialogues : [],
            sixthGroupDialogues: Array.isArray(sixthGroup?.dialogues) ? sixthGroup.dialogues : [],
            seventhGroupDialogues: Array.isArray(seventhGroup?.dialogues) ? seventhGroup.dialogues : []
        };
    } catch {
        return {
            encounterDialogues: [],
            thirdGroupDialogues: [],
            fourthGroupDialogues: [],
            fifthGroupDialogues: [],
            sixthGroupDialogues: [],
            seventhGroupDialogues: []
        };
    }
}

function getDialogueEntry(dialogues, index) {
    return dialogues[index] ?? dialogues[dialogues.length - 1] ?? null;
}

const basiliskHissAudioBySource = Object.create(null);
let basiliskSpellAudio = null;
let basiliskSpellAudioSource = '';
let phoenixFlightAudio = null;
let phoenixWingsAudio = null;
let phoenixPaperFallingAudio = null;
let phoenixPaperThudAudio = null;

function normalizeDepartment(value) {
    const normalizedDepartment = String(value ?? '').trim().toLowerCase();

    if (CABIN_DEPARTMENTS.includes(normalizedDepartment)) {
        return normalizedDepartment;
    }

    return null;
}

function preloadImage(source) {
    return new Promise((resolve) => {
        const image = new Image();

        image.addEventListener('load', () => resolve(image), { once: true });
        image.addEventListener('error', () => resolve(image), { once: true });
        image.src = source;
    });
}

function getBasiliskHissAudio(source = BASILISK_HISS_AUDIO_SOURCE) {
    if (basiliskHissAudioBySource[source] instanceof HTMLAudioElement) {
        return basiliskHissAudioBySource[source];
    }

    basiliskHissAudioBySource[source] = new Audio(source);
    basiliskHissAudioBySource[source].src = source;
    basiliskHissAudioBySource[source].preload = 'auto';

    return basiliskHissAudioBySource[source];
}

function playBasiliskHissAudio(source = BASILISK_HISS_AUDIO_SOURCE) {
    const audio = getBasiliskHissAudio(source);

    if (!(audio instanceof HTMLAudioElement)) {
        return;
    }

    audio.volume = source === BASILISK_HISS_AUDIO_SOURCE ? 0.25 : 1;
    audio.currentTime = 0;

    void audio.play().catch(() => {});
}

function getBasiliskSpellAudio(department) {
    const source = BASILISK_SPELL_AUDIO_SOURCE_BY_DEPARTMENT[department];

    if (!source) {
        return null;
    }

    if (basiliskSpellAudio instanceof HTMLAudioElement && basiliskSpellAudioSource === source) {
        return basiliskSpellAudio;
    }

    basiliskSpellAudio = new Audio(source);
    basiliskSpellAudio.src = source;
    basiliskSpellAudio.preload = 'auto';
    basiliskSpellAudioSource = source;

    return basiliskSpellAudio;
}

function playBasiliskSpellAudio(department) {
    const audio = getBasiliskSpellAudio(department);

    if (!(audio instanceof HTMLAudioElement)) {
        return;
    }

    switch (department) {
        case 'gryffindor':
            audio.volume = 0.15;
            break;
        case 'hufflepuff':
            audio.volume = 0.15;
            break;
        case 'ravenclaw':
            audio.volume = 0.45;
            break;
        case 'slytherin':
            audio.volume = 0.5;
            break;
        default:
            audio.volume = 0.15;
            break;
    }

    audio.currentTime = 0;

    void audio.play().catch(() => {});
}

function getPhoenixFlightAudio() {
    if (phoenixFlightAudio instanceof HTMLAudioElement) {
        return phoenixFlightAudio;
    }

    phoenixFlightAudio = new Audio(PHOENIX_SCREECH_AUDIO_SOURCE);
    phoenixFlightAudio.src = PHOENIX_SCREECH_AUDIO_SOURCE;
    phoenixFlightAudio.preload = 'auto';

    return phoenixFlightAudio;
}

function getPhoenixWingsAudio() {
    if (phoenixWingsAudio instanceof HTMLAudioElement) {
        return phoenixWingsAudio;
    }

    phoenixWingsAudio = new Audio(PHOENIX_WINGS_AUDIO_SOURCE);
    phoenixWingsAudio.src = PHOENIX_WINGS_AUDIO_SOURCE;
    phoenixWingsAudio.preload = 'auto';

    return phoenixWingsAudio;
}

function getPhoenixPaperFallingAudio() {
    if (phoenixPaperFallingAudio instanceof HTMLAudioElement) {
        return phoenixPaperFallingAudio;
    }

    phoenixPaperFallingAudio = new Audio(PHOENIX_PAPER_FALLING_AUDIO_SOURCE);
    phoenixPaperFallingAudio.src = PHOENIX_PAPER_FALLING_AUDIO_SOURCE;
    phoenixPaperFallingAudio.preload = 'auto';

    return phoenixPaperFallingAudio;
}

function getPhoenixPaperThudAudio() {
    if (phoenixPaperThudAudio instanceof HTMLAudioElement) {
        return phoenixPaperThudAudio;
    }

    phoenixPaperThudAudio = new Audio(PHOENIX_PAPER_THUD_AUDIO_SOURCE);
    phoenixPaperThudAudio.src = PHOENIX_PAPER_THUD_AUDIO_SOURCE;
    phoenixPaperThudAudio.preload = 'auto';

    return phoenixPaperThudAudio;
}

function playPhoenixPaperFallingAudio() {
    const paperFallingAudio = getPhoenixPaperFallingAudio();

    if (!(paperFallingAudio instanceof HTMLAudioElement)) {
        return;
    }

    if (paperFallingAudio.readyState === HTMLMediaElement.HAVE_NOTHING) {
        paperFallingAudio.load();
    }

    paperFallingAudio.volume = 1;
    paperFallingAudio.muted = false;
    paperFallingAudio.currentTime = 0;
    void playAudioWithGestureRetry(paperFallingAudio, 'phoenix-paper-falling');
}

function playPhoenixPaperThudAudio() {
    const paperThudAudio = getPhoenixPaperThudAudio();

    if (!(paperThudAudio instanceof HTMLAudioElement)) {
        return;
    }

    if (paperThudAudio.readyState === HTMLMediaElement.HAVE_NOTHING) {
        paperThudAudio.load();
    }

    paperThudAudio.volume = 1;
    paperThudAudio.muted = false;
    paperThudAudio.currentTime = 0;
    void playAudioWithGestureRetry(paperThudAudio, 'phoenix-paper-thud');
}

function playPhoenixFlightAudio() {
    const screechAudio = getPhoenixFlightAudio();
    const wingsAudio = getPhoenixWingsAudio();

    if (screechAudio instanceof HTMLAudioElement) {
        screechAudio.volume = 0.10;
        screechAudio.muted = false;
        screechAudio.currentTime = 0;
        void playAudioWithGestureRetry(screechAudio, 'phoenix-screech');
    }

    if (wingsAudio instanceof HTMLAudioElement) {
        if (wingsAudio.readyState === HTMLMediaElement.HAVE_NOTHING) {
            wingsAudio.load();
        }

        wingsAudio.volume = 0.5;
        wingsAudio.muted = false;
        wingsAudio.currentTime = 0;

        window.setTimeout(() => {
            void playAudioWithGestureRetry(wingsAudio, 'phoenix-wings');
        }, 200);
    }
}

function playAudioWithGestureRetry(audio, label) {
    if (!(audio instanceof HTMLAudioElement)) {
        return Promise.resolve(false);
    }

    const attemptPlay = () => audio.play().then(() => true).catch((error) => {
        const isGestureRequired = error?.name === 'NotAllowedError';

        if (!isGestureRequired) {
            return false;
        }

        if (audio.dataset.retryOnGesturePending === '1') {
            return false;
        }

        const retryOnGesture = () => {
            audio.dataset.retryOnGesturePending = '0';
            void attemptPlay();
        };

        audio.dataset.retryOnGesturePending = '1';

        for (const eventName of CHAMBER_AUDIO_GESTURE_EVENTS) {
            document.addEventListener(eventName, retryOnGesture, { once: true, capture: true });
        }

        return false;
    });

    return attemptPlay();
}

function stopPhoenixFlightAudio() {
    const screechAudio = getPhoenixFlightAudio();
    const wingsAudio = getPhoenixWingsAudio();
    const paperFallingAudio = getPhoenixPaperFallingAudio();
    const paperThudAudio = getPhoenixPaperThudAudio();

    if (screechAudio instanceof HTMLAudioElement) {
        screechAudio.pause();
        screechAudio.currentTime = 0;
    }

    if (wingsAudio instanceof HTMLAudioElement) {
        wingsAudio.pause();
        wingsAudio.currentTime = 0;
    }

    if (paperFallingAudio instanceof HTMLAudioElement) {
        paperFallingAudio.pause();
        paperFallingAudio.currentTime = 0;
    }

    if (paperThudAudio instanceof HTMLAudioElement) {
        paperThudAudio.pause();
        paperThudAudio.currentTime = 0;
    }
}

function createBasiliskLayer() {
    const layer = document.createElement('div');

    layer.setAttribute('aria-hidden', 'true');
    layer.className = 'pointer-events-none fixed left-1/2 top-[100px] z-[3] aspect-[4/5] w-[min(62vw,34rem)] -translate-x-1/2 bg-contain bg-top bg-no-repeat opacity-0 transition-opacity ease-out';
    layer.style.transitionDuration = `${BASILISK_FADE_IN_MS}ms`;

    return layer;
}

function createBasiliskBackdrop() {
    const backdrop = document.createElement('div');

    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.className = 'pointer-events-none fixed inset-0 z-[4] bg-gradient-to-b from-transparent via-black/40 to-black opacity-0';

    return backdrop;
}

function createBasiliskStaffLayer() {
    const staffLayer = document.createElement('div');

    staffLayer.className ='pointer-events-none fixed bottom-[212px] left-[154px] z-[7] aspect-[16/9] w-[min(64vw,44rem)] bg-contain bg-center bg-no-repeat opacity-0 transition-opacity ease-out';
    staffLayer.style.transitionDuration = `${BASILISK_STAFF_FADE_IN_MS}ms`;
    staffLayer.style.transform = 'rotate(-130deg)';
    staffLayer.style.transformOrigin = 'bottom center';

    return staffLayer;
}

// Diagonal strip over the wand in the staff image (contained 16:9 layer, ~25deg slope).
function createBasiliskWandHitbox() {
    const hitbox = document.createElement('button');

    hitbox.type = 'button';
    hitbox.disabled = true;
    hitbox.tabIndex = -1;
    hitbox.setAttribute('aria-label', 'Cast your spell with your wand');
    hitbox.className = 'pointer-events-none absolute left-[52%] top-[53%] h-[18%] w-[104%] -translate-x-1/2 -translate-y-1/2 rotate-[25deg] cursor-pointer rounded-full bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-amber-200/70';

    return hitbox;
}

function armBasiliskWand(staffLayer, hitbox, prefersReducedMotion = false) {
    const glowFrames = [
        { filter: 'drop-shadow(0 0 2px rgba(255, 214, 140, 0.25))' },
        { filter: 'drop-shadow(0 0 18px rgba(255, 214, 140, 0.95))' },
        { filter: 'drop-shadow(0 0 2px rgba(255, 214, 140, 0.25))' }
    ];

    if (prefersReducedMotion) {
        staffLayer.style.filter = 'drop-shadow(0 0 14px rgba(255, 214, 140, 0.85))';
    } else {
        staffLayer.animate(glowFrames, {
            duration: 1600,
            iterations: Infinity,
            easing: 'ease-in-out'
        }).id = 'wand-glow';
    }

    hitbox.disabled = false;
    hitbox.tabIndex = 0;
    hitbox.style.pointerEvents = 'auto';
    hitbox.focus({ preventScroll: true });
}

function disarmBasiliskWand(staffLayer, hitbox) {
    staffLayer.getAnimations()
        .filter((animation) => animation.id === 'wand-glow')
        .forEach((animation) => animation.cancel());
    staffLayer.style.filter = '';

    hitbox.blur();
    hitbox.disabled = true;
    hitbox.tabIndex = -1;
    hitbox.style.pointerEvents = 'none';
}

function createBasiliskSpellParticlesLayer() {
    const particlesLayer = document.createElement('div');

    particlesLayer.setAttribute('aria-hidden', 'true');
    particlesLayer.className = 'pointer-events-none fixed inset-0 z-[7] overflow-hidden';

    return particlesLayer;
}

function createBasiliskChatbox(continueLabel, textContent = '') {
    const chatbox = document.createElement('div');
    const text = document.createElement('p');

    chatbox.setAttribute('aria-hidden', 'true');
    chatbox.className = "pointer-events-none fixed bottom-8 left-1/2 z-[8] flex aspect-[2157/524] min-h-[7.5rem] w-[min(92vw,54rem)] -translate-x-1/2 items-start justify-start bg-[url('../assets/images/chatbox.png')] bg-[length:100%_100%] bg-center bg-no-repeat px-[max(5.5cqw,1.125rem)] pt-[max(6cqw,1.25rem)] [container-type:inline-size] opacity-0 transition-opacity ease-out";
    chatbox.style.transitionDuration = `${BASILISK_FADE_IN_MS}ms`;
    chatbox.style.pointerEvents = 'auto';

    text.className = 'max-w-[72ch] self-start text-left font-inkpot text-[length:clamp(0.9375rem,2.6cqw,1.125rem)] leading-snug tracking-wide text-[#3a2413] drop-shadow-[0_1px_0_rgba(255,244,223,0.35)]';
    text.textContent = textContent;
    chatbox.appendChild(text);
    chatbox.appendChild(continueLabel);

    return chatbox;
}

function createBasiliskContinueLabel(labelText = '') {
    const label = document.createElement('button');

    label.type = 'button';
    label.dataset.pop = 'small';
    label.setAttribute('aria-label', 'Continue basilisk dialogue');
    label.className = 'pointer-events-none absolute bottom-[max(4.5cqw,0.875rem)] right-[max(5.5cqw,1.125rem)] z-[6] opacity-0 transition-opacity ease-out';
    label.style.transitionDuration = `${BASILISK_FADE_IN_MS}ms`;
    label.style.pointerEvents = 'none';
    label.textContent = labelText;
    label.classList.add('font-inkpot', 'text-[length:clamp(0.8125rem,2.2cqw,1rem)]', 'leading-tight', 'tracking-wide', 'text-black/85', 'drop-shadow-[0_1px_0_rgba(255,255,255,0.18)]');

    return label;
}

function showBasiliskBackdrop(backdrop) {
    backdrop.classList.add('animate-fadeIn1800');
    backdrop.style.opacity = '1';
}

function showBasiliskChatbox(chatbox) {
    chatbox.setAttribute('aria-hidden', 'false');
    chatbox.style.pointerEvents = 'auto';
    chatbox.style.opacity = '1';
}

function hideBasiliskChatbox(chatbox) {
    const focusedElement = document.activeElement;

    if (focusedElement instanceof HTMLElement && chatbox.contains(focusedElement)) {
        focusedElement.blur();
    }

    chatbox.setAttribute('aria-hidden', 'true');
    chatbox.style.opacity = '0';
    chatbox.style.pointerEvents = 'none';
}

function showBasiliskStaffLayer(staffLayer, department) {
    const source = STAFF_SOURCE_BY_DEPARTMENT[department];

    if (!source) {
        return;
    }

    staffLayer.style.backgroundImage = `url('${source}')`;
    staffLayer.style.transform = 'rotate(-130deg)';
    staffLayer.style.opacity = '1';
}

function startBasiliskStaffIdleSway(staffLayer, prefersReducedMotion = false) {
    if (!(staffLayer instanceof HTMLElement)) {
        return;
    }

    staffLayer.getAnimations().forEach((animation) => animation.cancel());

    if (prefersReducedMotion) {
        staffLayer.style.transform = 'rotate(-130deg)';
        return;
    }

    staffLayer.animate([
        { transform: 'translate3d(0, 0, 0) rotate(-130deg)' },
        { transform: 'translate3d(9px, -10px, 0) rotate(-130deg)' },
        { transform: 'translate3d(18px, 0, 0) rotate(-130deg)' },
        { transform: 'translate3d(9px, 12px, 0) rotate(-130deg)' },
        { transform: 'translate3d(-8px, 14px, 0) rotate(-130deg)' },
        { transform: 'translate3d(-18px, 0, 0) rotate(-130deg)' },
        { transform: 'translate3d(-8px, -12px, 0) rotate(-130deg)' },
        { transform: 'translate3d(0, 0, 0) rotate(-130deg)' }
    ], {
        duration: 2200,
        iterations: Infinity,
        easing: 'linear'
    });
}

function emitBasiliskSpellParticles(particlesLayer, originX, originY, department, onComplete) {
    const isDarkSpell = department === 'slytherin';
    const particleCount = isDarkSpell ? BASILISK_DARK_SPELL_PARTICLE_COUNT : BASILISK_SPELL_PARTICLE_COUNT;
    const shapes = isDarkSpell
        ? ['circle', 'square', 'diamond', 'spark']
        : ['circle', 'circle', 'diamond', 'spark', 'pill'];

    for (let index = 0; index < particleCount; index += 1) {
        const particle = document.createElement('span');
        const angle = Math.random() * Math.PI * 2;
        const distance = isDarkSpell ? 110 + Math.random() * 260 : 70 + Math.random() * 165;
        const deltaX = Math.cos(angle) * distance;
        const deltaY = Math.sin(angle) * distance - (isDarkSpell ? 40 : 20);
        const size = isDarkSpell ? 2.5 + Math.random() * 7.5 : 1.5 + Math.random() * 5.5;
        const duration = isDarkSpell ? 3400 + Math.random() * 2600 : 3000 + Math.random() * 2200;
        const useBlackParticle = isDarkSpell && Math.random() < 0.33;
        const hue = isDarkSpell ? 2 + Math.random() * 14 : 34 + Math.random() * 22;
        const saturation = useBlackParticle ? 0 : 96;
        const lightness = useBlackParticle ? 8 + Math.random() * 10 : 41 + Math.random() * 16;
        const alpha = useBlackParticle ? 0.92 : 0.96;
        const glowAlpha = useBlackParticle ? 0.38 : 0.86;
        const shape = shapes[Math.floor(Math.random() * shapes.length)];

        particle.className = 'absolute mix-blend-screen will-change-transform';
        particle.style.left = `${originX}px`;
        particle.style.top = `${originY}px`;
        particle.style.width = `${size}px`;
        particle.style.height = `${size}px`;
        particle.style.background = `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
        particle.style.boxShadow = `0 0 ${10 + size}px hsla(${hue}, ${saturation}%, ${lightness}%, ${glowAlpha})`;
        particle.style.opacity = '0';

        if (shape === 'circle') {
            particle.style.borderRadius = '9999px';
        } else if (shape === 'square') {
            particle.style.borderRadius = '15%';
        } else if (shape === 'diamond') {
            particle.style.clipPath = 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)';
        } else if (shape === 'pill') {
            particle.style.borderRadius = '9999px';
            particle.style.width = `${size * 1.8}px`;
            particle.style.height = `${Math.max(1.5, size * 0.7)}px`;
        } else if (shape === 'spark') {
            particle.style.clipPath = 'polygon(50% 0%, 61% 34%, 98% 50%, 61% 66%, 50% 100%, 39% 66%, 2% 50%, 39% 34%)';
        }

        particlesLayer.appendChild(particle);

        const animation = particle.animate([
            {
                transform: 'translate3d(0, 0, 0) scale(0.4)',
                opacity: 0
            },
            {
                transform: 'translate3d(0, 0, 0) scale(1)',
                opacity: 1,
                offset: 0.14
            },
            {
                transform: `translate3d(${deltaX * 0.62}px, ${deltaY * 0.62}px, 0) scale(${isDarkSpell ? 0.72 : 0.78})`,
                opacity: isDarkSpell ? 0.62 : 0.54,
                offset: 0.68
            },
            {
                transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${isDarkSpell ? 0.5 : 0.7})`,
                opacity: 0
            }
        ], {
            duration,
            easing: 'cubic-bezier(0.16, 0.74, 0.12, 1)',
            fill: 'forwards'
        });

        animation.addEventListener('finish', () => {
            particle.remove();
        }, { once: true });
    }

    if (typeof onComplete === 'function') {
        const maxParticleDuration = isDarkSpell ? 6000 : 5200;
        const transitionDelay = Math.max(0, maxParticleDuration - BASILISK_ENCHANTED_TRANSITION_LEAD_MS);

        window.setTimeout(onComplete, transitionDelay);
    }
}

function playBasiliskStaffSpellCast(staffLayer, particlesLayer, basiliskLayer, prefersReducedMotion, department, onEnchantedShown, enchantedFrameSource = BASILISK_ENCHANTED_FRAME_SOURCE, hissAudioSource = BASILISK_HISS_AUDIO_SOURCE, transitionFrameSource = BASILISK_TAUNT_FRAME_SOURCE) {
    staffLayer.getAnimations().forEach((animation) => animation.cancel());

    const swing = staffLayer.animate([
        { transform: 'rotate(-130deg)' },
        { transform: 'rotate(-124deg)', offset: 0.18 },
        { transform: 'rotate(-118deg)', offset: 0.34 },
        { transform: 'rotate(-136deg)', offset: 0.56 },
        { transform: 'rotate(-123deg)', offset: 0.76 },
        { transform: 'rotate(-133deg)', offset: 0.9 },
        { transform: 'rotate(-130deg)' }
    ], {
        duration: BASILISK_STAFF_SPELL_CAST_MS,
        easing: 'cubic-bezier(0.22, 0.9, 0.16, 1)',
        fill: 'forwards'
    });

    if (prefersReducedMotion) {
        window.setTimeout(() => {
            showFrame(basiliskLayer, enchantedFrameSource);
            window.setTimeout(() => {
                playBasiliskHissAudio(hissAudioSource);
            }, BASILISK_CAST_HISS_DELAY_MS);

            if (typeof onEnchantedShown === 'function') {
                onEnchantedShown();
            }
        }, BASILISK_STAFF_SPELL_CAST_MS);

        return swing;
    }

    const originX = window.innerWidth / 2;
    const originY = window.innerHeight / 2;

    playBasiliskSpellAudio(department);
    window.setTimeout(() => {
        showFrame(basiliskLayer, transitionFrameSource);
        window.setTimeout(() => {
            playBasiliskHissAudio(hissAudioSource);
        }, BASILISK_CAST_HISS_DELAY_MS);

        emitBasiliskSpellParticles(particlesLayer, originX, originY, department, () => {
            window.setTimeout(() => {
                showFrame(basiliskLayer, enchantedFrameSource);

                if (typeof onEnchantedShown === 'function') {
                    onEnchantedShown();
                }
            }, BASILISK_TAUNT_DELAY_MS);
        });
    }, BASILISK_SPELL_PARTICLE_DELAY_MS);

    return swing;
}

function showBasiliskContinueLabel(label, delayMs = BASILISK_CONTINUE_BUTTON_REVEAL_DELAY_MS) {
    const pendingTimeoutId = Number(label.dataset.showTimeoutId || 0);

    if (pendingTimeoutId) {
        window.clearTimeout(pendingTimeoutId);
    }

    label.style.pointerEvents = 'none';
    label.style.opacity = '0';

    const timeoutId = window.setTimeout(() => {
        label.dataset.showTimeoutId = '';
        label.style.pointerEvents = 'auto';
        label.style.opacity = '1';
    }, delayMs);

    label.dataset.showTimeoutId = String(timeoutId);
}

function hideBasiliskContinueLabel(label) {
    const pendingTimeoutId = Number(label.dataset.showTimeoutId || 0);

    if (pendingTimeoutId) {
        window.clearTimeout(pendingTimeoutId);
        label.dataset.showTimeoutId = '';
    }

    label.style.pointerEvents = 'none';
    label.style.opacity = '0';
}

function updateBasiliskDialogue(chatbox, continueLabel, dialogues, index) {
    const dialogue = getDialogueEntry(dialogues, index);
    const text = chatbox.querySelector('p');

    if (text instanceof HTMLElement) {
        text.textContent = dialogue?.text || '';
    }

    continueLabel.textContent = dialogue?.readMore || '';
}

function showFrame(layer, source) {
    layer.style.backgroundImage = `url('${source}')`;
}

function showFinalBackdropSlowly() {
    const finalBackdrop = document.getElementById('sorting-backdrop-final');

    if (!(finalBackdrop instanceof HTMLElement)) {
        return;
    }

    finalBackdrop.style.transitionDuration = `${BASILISK_FINAL_BACKDROP_FADE_IN_MS}ms`;
    finalBackdrop.style.opacity = '1';
}

function fadeOutBasiliskStaffLayer(staffLayer) {
    if (!(staffLayer instanceof HTMLElement)) {
        return;
    }

    staffLayer.style.transitionProperty = 'opacity, transform';
    staffLayer.style.transitionDuration = `${BASILISK_FINAL_BACKDROP_FADE_IN_MS}ms`;
    staffLayer.style.transitionTimingFunction = 'ease-out';
    staffLayer.style.transform = 'translate(-3px, 10px) rotate(-130deg)';
    staffLayer.style.opacity = '0';
}

function fadeOutBasiliskAfterFinalBackdrop(basiliskLayer) {
    if (!(basiliskLayer instanceof HTMLElement)) {
        return;
    }

    window.setTimeout(() => {
        basiliskLayer.style.opacity = '0';
    }, BASILISK_FINAL_BASILISK_FADE_TOTAL_DELAY_MS);
}

function createPhoenixLayer() {
    const layer = document.createElement('div');

    layer.setAttribute('aria-hidden', 'true');
    layer.className = 'pointer-events-none fixed top-[50px] z-[6] aspect-[16/9] w-[min(35vw,24rem)] bg-contain bg-center bg-no-repeat opacity-0';
    layer.style.right = '50vw';

    return layer;
}

function createPhoenixScrollLayer() {
    const layer = document.createElement('div');

    layer.setAttribute('aria-hidden', 'true');
    layer.className = 'pointer-events-none fixed left-1/2 top-[10%] z-[5] aspect-[3/4] w-[min(12vw,8rem)] -translate-x-1/2 bg-contain bg-center bg-no-repeat opacity-0';
    layer.style.backgroundImage = `url('${PHOENIX_SCROLL_SOURCE}')`;

    return layer;
}

function emitPhoenixScrollImpactParticles(hostElement, originX, originY) {
    if (!(hostElement instanceof HTMLElement)) {
        return;
    }

    for (let index = 0; index < PHOENIX_SCROLL_IMPACT_PARTICLE_COUNT; index += 1) {
        const particle = document.createElement('span');
        const angle = -Math.PI + Math.random() * Math.PI;
        const distance = 14 + Math.random() * PHOENIX_SCROLL_IMPACT_PARTICLE_SPREAD_PX;
        const deltaX = Math.cos(angle) * distance;
        const deltaY = -Math.abs(Math.sin(angle) * (10 + Math.random() * 38));
        const size = 1.5 + Math.random() * 4.5;
        const duration = PHOENIX_SCROLL_IMPACT_PARTICLE_DURATION_MS * (0.72 + Math.random() * 0.42);
        const hue = 30 + Math.random() * 16;
        const saturation = 74 + Math.random() * 24;
        const lightness = 52 + Math.random() * 18;
        const rotation = -24 + Math.random() * 48;

        particle.setAttribute('aria-hidden', 'true');
        particle.className = 'pointer-events-none fixed z-[6] mix-blend-screen will-change-transform';
        particle.style.left = `${originX}px`;
        particle.style.top = `${originY}px`;
        particle.style.width = `${size * (0.7 + Math.random() * 1.8)}px`;
        particle.style.height = `${size}px`;
        particle.style.borderRadius = Math.random() < 0.5 ? '9999px' : '20%';
        particle.style.background = `hsla(${hue}, ${saturation}%, ${lightness}%, 0.88)`;
        particle.style.boxShadow = `0 0 ${6 + size}px hsla(${hue}, ${saturation}%, ${lightness + 4}%, 0.62)`;
        particle.style.opacity = '0';

        hostElement.appendChild(particle);

        const animation = particle.animate([
            {
                transform: `translate3d(0, 0, 0) rotate(${rotation}deg) scale(0.65)`,
                opacity: 0
            },
            {
                transform: `translate3d(${deltaX * 0.48}px, ${deltaY * 0.48}px, 0) rotate(${rotation + 16}deg) scale(1)`,
                opacity: 0.95,
                offset: 0.24
            },
            {
                transform: `translate3d(${deltaX}px, ${deltaY + 18}px, 0) rotate(${rotation + 30}deg) scale(0.72)`,
                opacity: 0
            }
        ], {
            duration,
            easing: 'cubic-bezier(0.12, 0.64, 0.16, 1)',
            fill: 'forwards'
        });

        animation.addEventListener('finish', () => {
            particle.remove();
        }, { once: true });
    }
}

function dropPhoenixScroll(phoenixLayer, phoenixScrollLayer, prefersReducedMotion) {
    if (!(phoenixScrollLayer instanceof HTMLElement)) {
        return;
    }

    playPhoenixPaperFallingAudio();
    const dropDuration = prefersReducedMotion ? 1 : PHOENIX_SCROLL_DROP_DURATION_MS;
    const thudDelay = prefersReducedMotion
        ? 0
        : Math.max(
            0,
            Math.max(
                dropDuration - PHOENIX_SCROLL_THUD_LEAD_MS,
                Math.round(dropDuration * 0.88)
            ) - PHOENIX_SCROLL_IMPACT_ADVANCE_MS
        );
    window.setTimeout(() => {
        playPhoenixPaperThudAudio();
    }, thudDelay);

    const phoenixRect = phoenixLayer.getBoundingClientRect();
    const startX = phoenixRect.left + phoenixRect.width * 0.52;
    const startY = phoenixRect.top + phoenixRect.height * 0.78;
    const targetTopPx = window.innerHeight * PHOENIX_SCROLL_TARGET_TOP_RATIO;
    const leftDriftPx = Math.min(window.innerWidth * PHOENIX_SCROLL_TARGET_LEFT_DRIFT_RATIO, PHOENIX_SCROLL_TARGET_LEFT_DRIFT_MAX_PX);
    const targetX = Math.max(40, startX - leftDriftPx);
    const maxTravel = Math.max(0, window.innerHeight - startY - 40);
    const clampedTargetTopPx = Math.min(targetTopPx, startY + maxTravel);
    const dropDistancePx = Math.max(40, clampedTargetTopPx - startY);
    const landingOvershootPx = prefersReducedMotion
        ? 0
        : Math.min(PHOENIX_SCROLL_LANDING_OVERSHOOT_MAX_PX, Math.max(14, dropDistancePx * 0.14));
    const bounceUpPx = prefersReducedMotion
        ? 0
        : Math.min(PHOENIX_SCROLL_LANDING_BOUNCE_UP_MAX_PX, Math.max(7, landingOvershootPx * 0.52));
    const overshootTopPx = Math.min(window.innerHeight - 20, clampedTargetTopPx + landingOvershootPx);
    const bounceTopPx = Math.max(startY + 18, clampedTargetTopPx - bounceUpPx);
    const scrollRect = phoenixScrollLayer.getBoundingClientRect();
    const impactY = clampedTargetTopPx + Math.max(10, scrollRect.height * 0.42);

    phoenixScrollLayer.getAnimations().forEach((animation) => animation.cancel());
    phoenixScrollLayer.style.left = `${startX}px`;
    phoenixScrollLayer.style.top = `${startY}px`;
    phoenixScrollLayer.style.opacity = '1';

    if (!prefersReducedMotion) {
        window.setTimeout(() => {
            emitPhoenixScrollImpactParticles(document.body, targetX, impactY);
        }, thudDelay);
    }

    phoenixScrollLayer.animate([
        {
            left: `${startX}px`,
            top: `${startY}px`,
            transform: 'translateX(-50%) rotate(0deg)',
            opacity: 0.95
        },
        {
            left: `${startX - leftDriftPx * 0.18}px`,
            top: `${startY + (clampedTargetTopPx - startY) * 0.2}px`,
            transform: 'translateX(-50%) rotate(-17deg)',
            opacity: 1,
            offset: 0.2
        },
        {
            left: `${startX - leftDriftPx * 0.42}px`,
            top: `${startY + (clampedTargetTopPx - startY) * 0.42}px`,
            transform: 'translateX(-50%) rotate(22deg)',
            opacity: 1,
            offset: 0.42
        },
        {
            left: `${startX - leftDriftPx * 0.7}px`,
            top: `${startY + (clampedTargetTopPx - startY) * 0.66}px`,
            transform: 'translateX(-50%) rotate(-15deg)',
            opacity: 1,
            offset: 0.66
        },
        {
            left: `${targetX}px`,
            top: `${clampedTargetTopPx}px`,
            transform: 'translateX(-50%) rotate(12deg)',
            opacity: 1,
            offset: 0.82
        },
        {
            left: `${targetX}px`,
            top: `${overshootTopPx}px`,
            transform: `translateX(-50%) rotate(${PHOENIX_SCROLL_FINAL_ROTATION_DEG + 14}deg)`,
            opacity: 1,
            offset: 0.9
        },
        {
            left: `${targetX}px`,
            top: `${bounceTopPx}px`,
            transform: `translateX(-50%) rotate(${PHOENIX_SCROLL_FINAL_ROTATION_DEG - 7}deg)`,
            opacity: 1,
            offset: 0.965
        },
        {
            left: `${targetX}px`,
            top: `${clampedTargetTopPx}px`,
            transform: `translateX(-50%) rotate(${PHOENIX_SCROLL_FINAL_ROTATION_DEG}deg)`,
            opacity: 1
        }
    ], {
        duration: dropDuration,
        easing: prefersReducedMotion ? 'linear' : 'cubic-bezier(0.22, 0.78, 0.22, 1)',
        fill: 'forwards'
    });

    phoenixScrollLayer.style.left = `${targetX}px`;
    phoenixScrollLayer.style.top = `${clampedTargetTopPx}px`;
    phoenixScrollLayer.style.transform = `translateX(-50%) rotate(${PHOENIX_SCROLL_FINAL_ROTATION_DEG}deg)`;
}

function playPhoenixFlight(phoenixLayer, phoenixScrollLayer, onComplete) {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    playPhoenixFlightAudio();
    phoenixLayer.style.opacity = '1';
    phoenixLayer.style.backgroundImage = `url('${PHOENIX_FRAME_SOURCES[0]}')`;
    phoenixScrollLayer.style.opacity = '0';
    let frameIndex = 0;
    const scrollDropTimeoutId = window.setTimeout(() => {
        dropPhoenixScroll(phoenixLayer, phoenixScrollLayer, prefersReducedMotion);
    }, Math.round(PHOENIX_FLIGHT_DURATION_MS * PHOENIX_SCROLL_DROP_TRIGGER_RATIO));

    const frameIntervalId = window.setInterval(() => {
        frameIndex = (frameIndex + 1) % PHOENIX_FRAME_SOURCES.length;
        phoenixLayer.style.backgroundImage = `url('${PHOENIX_FRAME_SOURCES[frameIndex]}')`;
    }, PHOENIX_FRAME_SWITCH_MS);

    const animation = phoenixLayer.animate([{
        right: '-50vw',
        opacity: '1'
    }, {
        right: '100vw',
        opacity: '1'
    }], {
        duration: PHOENIX_FLIGHT_DURATION_MS,
        easing: 'linear',
        fill: 'forwards'
    });

    animation.addEventListener('finish', () => {
        window.clearTimeout(scrollDropTimeoutId);
        window.clearInterval(frameIntervalId);
        phoenixLayer.style.opacity = '0';
        stopPhoenixFlightAudio();
        if (typeof onComplete === 'function') {
            onComplete();
        }
    }, { once: true });
}

function replaceBackgroundAudioAfterBasiliskDefeat() {
    const audio = document.getElementById('background-audio');

    if (!(audio instanceof HTMLAudioElement)) {
        return;
    }

    const sourceElement = audio.querySelector('source[src]');
    const activeSource = sourceElement instanceof HTMLSourceElement
        ? sourceElement.getAttribute('src') || ''
        : audio.getAttribute('src') || '';

    if (activeSource === CHAMBER_BASILISK_DEFEATED_AUDIO_SOURCE) {
        return;
    }

    if (sourceElement instanceof HTMLSourceElement) {
        sourceElement.setAttribute('src', CHAMBER_BASILISK_DEFEATED_AUDIO_SOURCE);
    } else {
        audio.setAttribute('src', CHAMBER_BASILISK_DEFEATED_AUDIO_SOURCE);
    }

    audio.load();

    if (window.audioIsEnabled) {
        void audio.play().catch(() => {});
    }
}

function fadeOutBodyAndNavigateToMap() {
    const bodyElement = document.body;

    if (!(bodyElement instanceof HTMLElement)) {
        window.location.href = getPageUrl('map');
        return;
    }

    const currentOpacity = window.getComputedStyle(bodyElement).opacity || '1';
    bodyElement.style.opacity = currentOpacity;
    bodyElement.style.transitionProperty = 'opacity';
    bodyElement.style.transitionDuration = `${CHAMBER_MAP_REDIRECT_FADE_DURATION_MS}ms`;
    bodyElement.style.transitionTimingFunction = 'ease-out';

    void bodyElement.offsetWidth;

    window.requestAnimationFrame(() => {
        bodyElement.style.opacity = '0';
    });

    window.setTimeout(() => {
        window.location.href = getPageUrl('map');
    }, CHAMBER_MAP_REDIRECT_DELAY_MS);
}

function startBasiliskSequence(layer, backdrop, chatbox, continueLabel, onContinueShown) {
    const timeoutIds = [];

    const schedule = (callback, delay) => {
        const timeoutId = window.setTimeout(callback, delay);
        timeoutIds.push(timeoutId);
        return timeoutId;
    };

    const runFrameSequence = () => {
        layer.style.opacity = '1';
        showFrame(layer, BASILISK_FRAME_SOURCES[0]);
        schedule(() => playBasiliskHissAudio(), BASILISK_HISS_DELAY_MS);

        schedule(() => showFrame(layer, BASILISK_FRAME_SOURCES[1]), BASILISK_FRAME_STEP_MS);

        schedule(() => {
            showFrame(layer, BASILISK_FRAME_SOURCES[2]);
        }, BASILISK_FRAME_STEP_MS * 2);

        schedule(() => showFrame(layer, BASILISK_FRAME_SOURCES[3]), BASILISK_FRAME_STEP_MS * 3);
        schedule(() => showBasiliskBackdrop(backdrop), BASILISK_BACKDROP_DELAY_MS);
        schedule(() => showBasiliskChatbox(chatbox), BASILISK_BACKDROP_DELAY_MS + BASILISK_CHATBOX_DELAY_MS);
        schedule(() => {
            showBasiliskContinueLabel(continueLabel);

            if (typeof onContinueShown === 'function') {
                window.setTimeout(onContinueShown, BASILISK_CONTINUE_BUTTON_REVEAL_DELAY_MS);
            }
        }, BASILISK_BACKDROP_DELAY_MS + BASILISK_CHATBOX_DELAY_MS + BASILISK_CONTINUE_DELAY_MS);
    };

    const finishLoadingAndRun = async () => {
        await Promise.all(BASILISK_PRELOADS);
        runFrameSequence();
    };

    window.setTimeout(() => {
        void finishLoadingAndRun();
    }, BASILISK_APPEAR_DELAY_MS);

    return () => {
        for (const timeoutId of timeoutIds) {
            window.clearTimeout(timeoutId);
        }
    };
}

async function initChamberScene(guest) {
    const body = document.body;

    if (!(body instanceof HTMLElement)) {
        return;
    }

    if (document.getElementById('basilisk-layer')) {
        return;
    }

    const dialogueGroups = await loadBasiliskDialogue();
    const encounterDialogues = dialogueGroups.encounterDialogues;
    const thirdGroupDialogues = dialogueGroups.thirdGroupDialogues;
    const fourthGroupDialogues = dialogueGroups.fourthGroupDialogues;
    const fifthGroupDialogues = dialogueGroups.fifthGroupDialogues;
    const sixthGroupDialogues = dialogueGroups.sixthGroupDialogues;
    const seventhGroupDialogues = dialogueGroups.seventhGroupDialogues;

    if (encounterDialogues.length === 0) {
        return;
    }

    const firstDialogue = getDialogueEntry(encounterDialogues, 0);
    const cabinDepartment = normalizeDepartment(guest?.house) ?? CABIN_DEFAULT_DEPARTMENT;
    const basiliskLayer = createBasiliskLayer();
    const basiliskBackdrop = createBasiliskBackdrop();
    const basiliskStaffLayer = createBasiliskStaffLayer();
    const basiliskWandHitbox = createBasiliskWandHitbox();
    const basiliskSpellParticlesLayer = createBasiliskSpellParticlesLayer();
    const phoenixLayer = createPhoenixLayer();
    const phoenixScrollLayer = createPhoenixScrollLayer();
    const basiliskContinueLabel = createBasiliskContinueLabel(firstDialogue?.readMore || '');
    const basiliskChatbox = createBasiliskChatbox(basiliskContinueLabel, firstDialogue?.text || '');
    let activeDialogues = encounterDialogues;
    let currentDialogueIndex = 0;
    let currentGroupId = 1;
    let isTransitioningGroup = false;
    let hasShownStaffLayer = false;
    let isContinueVisible = false;
    let hasStartedMapRedirect = false;
    let isWandArmed = false;

    const dialogueGroupById = {
        1: encounterDialogues,
        3: thirdGroupDialogues,
        4: fourthGroupDialogues,
        5: fifthGroupDialogues,
        6: sixthGroupDialogues,
        7: seventhGroupDialogues
    };

    const transitionToDialogueGroup = (groupId, delayMs = 0) => {
        const nextDialogues = dialogueGroupById[groupId];

        if (!Array.isArray(nextDialogues) || nextDialogues.length === 0) {
            isTransitioningGroup = false;
            return;
        }

        window.setTimeout(() => {
            currentGroupId = groupId;
            activeDialogues = nextDialogues;
            currentDialogueIndex = 0;

            if (currentGroupId === 2 || currentGroupId === 3) {
                startBasiliskStaffIdleSway(basiliskStaffLayer, prefersReducedMotion);
            }

            if (currentGroupId === 4) {
                showFinalBackdropSlowly();
                fadeOutBasiliskAfterFinalBackdrop(basiliskLayer);
                replaceBackgroundAudioAfterBasiliskDefeat();
            }

            if (currentGroupId === 5) {
                fadeOutBasiliskStaffLayer(basiliskStaffLayer);
                playPhoenixFlight(phoenixLayer, phoenixScrollLayer);
            }

            updateBasiliskDialogue(basiliskChatbox, basiliskContinueLabel, activeDialogues, currentDialogueIndex);
            showBasiliskChatbox(basiliskChatbox);
            showBasiliskContinueLabel(basiliskContinueLabel);
            window.setTimeout(() => {
                isContinueVisible = true;
            }, BASILISK_CONTINUE_BUTTON_REVEAL_DELAY_MS);
            isTransitioningGroup = false;
        }, delayMs);
    };

    basiliskContinueLabel.addEventListener('click', () => {
        if (isTransitioningGroup || !isContinueVisible) {
            return;
        }

        if (currentDialogueIndex >= activeDialogues.length - 1) {
            hideBasiliskChatbox(basiliskChatbox);
            hideBasiliskContinueLabel(basiliskContinueLabel);
            isContinueVisible = false;

            if (currentGroupId === 1) {
                isTransitioningGroup = true;

                if (!hasShownStaffLayer && cabinDepartment) {
                    showBasiliskStaffLayer(basiliskStaffLayer, cabinDepartment);
                    hasShownStaffLayer = true;
                }

                window.setTimeout(() => {
                    currentGroupId = 2;
                    startBasiliskStaffIdleSway(basiliskStaffLayer, prefersReducedMotion);
                    isWandArmed = true;
                    armBasiliskWand(basiliskStaffLayer, basiliskWandHitbox, prefersReducedMotion);
                }, BASILISK_STAFF_FADE_IN_MS);
            } else if (currentGroupId === 3) {
                isTransitioningGroup = true;
                isWandArmed = true;
                armBasiliskWand(basiliskStaffLayer, basiliskWandHitbox, prefersReducedMotion);
            } else if (currentGroupId === 4) {
                isTransitioningGroup = true;

                transitionToDialogueGroup(5, BASILISK_DIALOGUE_GROUP_REENTRY_DELAY_MS);
            } else if (currentGroupId === 5) {
                isTransitioningGroup = true;

                transitionToDialogueGroup(6, BASILISK_DIALOGUE_GROUP_REENTRY_DELAY_MS);
            } else if (currentGroupId === 6) {
                isTransitioningGroup = true;

                transitionToDialogueGroup(7, BASILISK_DIALOGUE_GROUP_REENTRY_DELAY_MS);
            } else if (currentGroupId === 7) {
                if (!hasStartedMapRedirect) {
                    hasStartedMapRedirect = true;
                    fadeOutBodyAndNavigateToMap();
                }

                isTransitioningGroup = false;
            }

            return;
        }

        currentDialogueIndex += 1;
        updateBasiliskDialogue(basiliskChatbox, basiliskContinueLabel, activeDialogues, currentDialogueIndex);
    });

    basiliskWandHitbox.addEventListener('click', () => {
        if (!isWandArmed || (currentGroupId !== 2 && currentGroupId !== 3)) {
            return;
        }

        isWandArmed = false;
        disarmBasiliskWand(basiliskStaffLayer, basiliskWandHitbox);

        const isFinalStrike = currentGroupId === 3;
        const nextGroupId = currentGroupId === 2 && cabinDepartment === 'slytherin'
            ? 4
            : currentGroupId + 1;

        playBasiliskStaffSpellCast(
            basiliskStaffLayer,
            basiliskSpellParticlesLayer,
            basiliskLayer,
            prefersReducedMotion,
            cabinDepartment,
            () => {
                transitionToDialogueGroup(nextGroupId);
            },
            isFinalStrike ? BASILISK_ENCHANTED_FINAL_FRAME_SOURCE : BASILISK_ENCHANTED_FRAME_SOURCE,
            isFinalStrike ? BASILISK_SECOND_HISS_AUDIO_SOURCE : BASILISK_HISS_AUDIO_SOURCE,
            isFinalStrike ? BASILISK_ENCHANTED_SECOND_FRAME_SOURCE : BASILISK_TAUNT_FRAME_SOURCE
        );
    });

    basiliskStaffLayer.appendChild(basiliskWandHitbox);
    basiliskLayer.id = 'basilisk-layer';
    basiliskBackdrop.id = 'basilisk-backdrop';
    basiliskStaffLayer.id = 'basilisk-staff-layer';
    basiliskSpellParticlesLayer.id = 'basilisk-spell-particles-layer';
    basiliskChatbox.id = 'basilisk-chatbox';
    phoenixLayer.id = 'phoenix-layer';
    phoenixScrollLayer.id = 'phoenix-scroll-layer';
    body.appendChild(basiliskBackdrop);
    body.appendChild(basiliskLayer);
    body.appendChild(basiliskStaffLayer);
    body.appendChild(basiliskSpellParticlesLayer);
    body.appendChild(phoenixLayer);
    body.appendChild(phoenixScrollLayer);
    body.appendChild(basiliskChatbox);

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
        window.setTimeout(() => {
            showFrame(basiliskLayer, BASILISK_FRAME_SOURCES[0]);
            basiliskLayer.style.opacity = '1';
            showBasiliskBackdrop(basiliskBackdrop);
            window.setTimeout(() => showBasiliskChatbox(basiliskChatbox), BASILISK_CHATBOX_DELAY_MS);
            window.setTimeout(() => {
                showBasiliskContinueLabel(basiliskContinueLabel);
                window.setTimeout(() => {
                    isContinueVisible = true;
                }, BASILISK_CONTINUE_BUTTON_REVEAL_DELAY_MS);
            }, BASILISK_CHATBOX_DELAY_MS + BASILISK_CONTINUE_DELAY_MS);
        }, BASILISK_APPEAR_DELAY_MS);
        return;
    }

    startBasiliskSequence(basiliskLayer, basiliskBackdrop, basiliskChatbox, basiliskContinueLabel, () => {
        isContinueVisible = true;
    });
}

const CHAMBER_AUDIO_UNLOCK_EVENTS = [...CHAMBER_AUDIO_GESTURE_EVENTS];

function unlockChamberBackgroundAudio() {
    const audio = document.getElementById('background-audio');

    if (!(audio instanceof HTMLAudioElement)) {
        return;
    }

    audio.muted = false;

    if (audio.readyState === HTMLMediaElement.HAVE_NOTHING) {
        audio.load();
    }

    void audio.play().then(() => {
        window.audioIsEnabled = true;
    }).catch(() => {});
}

document.addEventListener('DOMContentLoaded', () => {
    const audio = document.getElementById('background-audio');

    if (!(audio instanceof HTMLAudioElement)) {
        return;
    }

    const maybeStartAudio = () => {
        unlockChamberBackgroundAudio();
    };

    for (const eventName of CHAMBER_AUDIO_UNLOCK_EVENTS) {
        document.addEventListener(eventName, maybeStartAudio, { capture: true });
    }
}, { once: true });

async function bootstrapChamberPage() {
    const guest = await guardPage('chamber');

    if (!guest) {
        return;
    }

    await whenDomReady();
    initHouseCup(guest);
    void initChamberScene(guest);
}

void bootstrapChamberPage();
