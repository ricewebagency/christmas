// House points for the easter eggs on the Marauder's Map. The first time a guest finds an egg, their house earns
// points (the API keeps score): a golden "+10" bursts from where it happened and a house banner drops in.
// Finding an egg again (on any device) stays quiet. Guests who aren't coming or aren't sorted earn nothing.
// Dumbledore comments on every find (map-dumbledore.js); the banner stays up while he speaks.
import { sendEasterEggFound } from './api-client.js';
import { preloadDumbledore, speakForEgg } from './map-dumbledore.js';
import { playMapSound } from './map-sounds.js';

const HOUSES = {
    gryffindor: { name: 'Gryffindor', glow: 'rgba(255, 197, 0, 0.55)' },
    hufflepuff: { name: 'Hufflepuff', glow: 'rgba(236, 185, 57, 0.6)' },
    ravenclaw: { name: 'Ravenclaw', glow: 'rgba(148, 107, 45, 0.6)' },
    slytherin: { name: 'Slytherin', glow: 'rgba(170, 170, 170, 0.6)' }
};
const NUMBER_WORDS = { 5: 'Five', 10: 'Ten', 20: 'Twenty', 50: 'Fifty' };
// Let the egg's own effect get going before the reward joins in.
const DEFAULT_DELAY_MS = 700;
const BANNER_HOLD_MS = 3400;
const BANNER_IN_MS = 450;
const BANNER_OUT_MS = 500;
// Banner stays this much longer than Dumbledore's line.
const BANNER_AFTER_VOICE_MS = 600;
const SPARK_COUNT = 14;

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const random = (min, max) => min + Math.random() * (max - min);
const crestUrl = (house) => new URL(`../assets/images/admin/${house}-logo.png`, import.meta.url).href;
const parchmentUrl = new URL('../assets/images/parchment-cropped.png', import.meta.url).href;

// "+10" in glowing ink with a ring of sparks, at a point on the screen.
function burstAt(x, y, points) {
    const rootEl = document.createElement('div');
    rootEl.setAttribute('aria-hidden', 'true');
    rootEl.className = 'pointer-events-none fixed z-[80] h-0 w-0';
    rootEl.style.left = `${x}px`;
    rootEl.style.top = `${y}px`;

    const sparks = Array.from({ length: SPARK_COUNT }, () => {
        const el = document.createElement('span');
        el.className = 'absolute left-0 top-0 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,#fff_0%,#ffd76a_40%,rgba(255,170,40,0.4)_65%,transparent_75%)]';
        rootEl.append(el);
        return el;
    });

    const labelEl = document.createElement('span');
    labelEl.className = 'absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-inkpot text-4xl text-amber-300 [text-shadow:0_0_14px_rgba(255,196,92,0.95),0_1px_2px_rgba(0,0,0,0.6)]';
    labelEl.textContent = `+${points}`;
    rootEl.append(labelEl);
    document.body.append(rootEl);

    const animations = sparks.map((el, i) => {
        const angle = (i / SPARK_COUNT) * Math.PI * 2 + random(-0.2, 0.2);
        const distance = random(40, 95);
        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance;
        return el.animate([
            { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0 },
            { transform: 'translate(-50%, -50%) scale(1.3)', opacity: 1, offset: 0.12 },
            { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 18}px)) scale(0)`, opacity: 0 }
        ], { duration: random(900, 1400), delay: random(0, 120), easing: 'cubic-bezier(0.15, 0.8, 0.3, 1)', fill: 'both' });
    });

    animations.push(labelEl.animate([
        { transform: 'translate(-50%, -50%) scale(0.3)', opacity: 0, filter: 'blur(4px)' },
        { transform: 'translate(-50%, -60%) scale(1.2)', opacity: 1, filter: 'blur(0px)', offset: 0.15 },
        { transform: 'translate(-50%, -80%) scale(1)', opacity: 1, offset: 0.6 },
        { transform: 'translate(-50%, -190%) scale(0.9)', opacity: 0, filter: 'blur(2px)' }
    ], { duration: 2000, easing: 'ease-out', fill: 'both' }));

    Promise.allSettled(animations.map((animation) => animation.finished)).then(() => rootEl.remove());
}

// One banner at the top of the screen, reused for every reward. It is also the live region for screen readers.
function createBanner() {
    const rootEl = document.createElement('div');
    rootEl.setAttribute('role', 'status');
    rootEl.className = 'pointer-events-none fixed inset-x-0 top-4 z-[80] flex justify-center px-4';
    rootEl.innerHTML = `
        <div data-reward-card class="flex max-w-sm items-center gap-3 rounded-sm bg-cover bg-center px-4 py-2.5 opacity-0 shadow-[0_8px_30px_rgba(0,0,0,0.45)]">
            <img data-reward-crest alt="" class="h-11 w-11 shrink-0 object-contain">
            <div class="min-w-0 text-charcoal">
                <p data-reward-title class="font-inkpot text-xl leading-tight"></p>
                <p data-reward-detail class="text-xs italic text-charcoal/75"></p>
            </div>
        </div>`;
    document.body.append(rootEl);

    const cardEl = rootEl.querySelector('[data-reward-card]');
    cardEl.style.backgroundImage = `url("${parchmentUrl}")`;

    return {
        cardEl,
        crestEl: rootEl.querySelector('[data-reward-crest]'),
        titleEl: rootEl.querySelector('[data-reward-title]'),
        detailEl: rootEl.querySelector('[data-reward-detail]')
    };
}

// onStandings(allHousePoints, foundCount) runs after every recorded find (also repeat finds), for the House Cup.
export function createEggRewards(guest, { onStandings = () => {} } = {}) {
    const found = new Set(guest?.foundEggIds ?? []);
    const pending = new Set();
    const canEarn = guest?.rsvpStatus === 'accepted' && Boolean(HOUSES[guest?.house]);
    let banner = null;
    // Banners take turns, so two quick finds don't talk over each other.
    let bannerQueue = Promise.resolve();

    if (canEarn) {
        // Up front: a live region only announces changes made after it is on the page.
        banner = createBanner();
        new Image().src = crestUrl(guest.house);
        new Image().src = parchmentUrl;
        preloadDumbledore();
    }

    const showBanner = async (result) => {
        const house = HOUSES[result.house] ?? HOUSES[guest.house];
        const { cardEl, crestEl, titleEl, detailEl } = banner;

        crestEl.src = crestUrl(result.house ?? guest.house);
        cardEl.style.boxShadow = `0 8px 30px rgba(0, 0, 0, 0.45), 0 0 24px ${house.glow}`;
        titleEl.textContent = `${NUMBER_WORDS[result.pointsAwarded] ?? result.pointsAwarded} points to ${house.name}!`;
        detailEl.textContent = `Secret ${result.foundCount} of ${result.totalEggs} found · ${house.name} has ${result.housePoints} points`;

        const voiceMs = await speakForEgg(result).catch((error) => {
            console.warn('Dumbledore could not speak.', error);
            return 0;
        });
        const holdMs = Math.max(BANNER_HOLD_MS, voiceMs + BANNER_AFTER_VOICE_MS);
        const total = BANNER_IN_MS + holdMs + BANNER_OUT_MS;
        const inAt = BANNER_IN_MS / total;
        const outAt = (BANNER_IN_MS + holdMs) / total;

        const keyframes = reduceMotion()
            ? [{ opacity: 0 }, { opacity: 1, offset: inAt }, { opacity: 1, offset: outAt }, { opacity: 0 }]
            : [
                { opacity: 0, transform: 'translateY(-120%) rotate(-2deg)' },
                { opacity: 1, transform: 'translateY(6%) rotate(0.5deg)', offset: inAt * 0.7 },
                { opacity: 1, transform: 'translateY(0) rotate(0deg)', offset: inAt },
                { opacity: 1, transform: 'translateY(0) rotate(0deg)', offset: outAt },
                { opacity: 0, transform: 'translateY(-40%) rotate(0deg)' }
            ];
        const animation = cardEl.animate(keyframes, { duration: total, easing: 'ease-out', fill: 'both' });
        return animation.finished.catch(() => {});
    };

    const celebrate = (result, point) => {
        playMapSound('spell', 0, { volume: 0.5, fadeAfterMs: 1400, fadeMs: 900 });

        if (!reduceMotion()) {
            const x = point?.x ?? window.innerWidth / 2;
            const y = point?.y ?? window.innerHeight / 2;
            burstAt(x, y, result.pointsAwarded);
        }

        bannerQueue = bannerQueue.then(() => showBanner(result));
    };

    return {
        // point: { x, y } in client pixels where the egg was found (default: the middle of the screen).
        // delayMs: how long after the find the reward may show at the earliest.
        found(eggId, { point = null, delayMs = DEFAULT_DELAY_MS } = {}) {
            if (!canEarn || found.has(eggId) || pending.has(eggId)) {
                return;
            }

            pending.add(eggId);
            const startedAt = performance.now();

            sendEasterEggFound(eggId)
                .then((result) => {
                    found.add(eggId);
                    onStandings(result.allHousePoints, result.foundCount);

                    if (result.firstFind && result.pointsAwarded > 0) {
                        const wait = Math.max(0, delayMs - (performance.now() - startedAt));
                        window.setTimeout(() => celebrate(result, point), wait);
                    }
                }, (error) => {
                    // Not marked as found: the next time this egg turns up, it tries again.
                    console.warn(`Could not record easter egg ${eggId}.`, error);
                })
                .finally(() => pending.delete(eggId));
        }
    };
}

// Centre of an element on screen, for rewards that belong to a spot on the map.
export function centerOf(el) {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}
