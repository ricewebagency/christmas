// House points for the easter eggs on the Marauder's Map. The first time a guest finds an egg, their house earns
// points (the API keeps score): a golden "+10" bursts from where it happened, then flies into the House Cup button
// (which lights up as it lands), and a small house ribbon writes itself in, in the top corner away from the find so
// it never covers what was just tapped. Without a visible House Cup button the "+10" just floats up and fades.
// Finding an egg again (on any device) stays quiet. Guests who aren't coming or aren't sorted earn nothing.
// Dumbledore comments on every find (map-dumbledore.js); the banner stays up while he speaks. A new find while a
// banner is up closes it (and cuts him off), and the new banner takes its place.
import { sendEasterEggFound } from './api-client.js?v=02bc12da1f';
import { preloadDumbledore, speakForEgg } from './map-dumbledore.js?v=02bc12da1f';
import { playMapSound } from './map-sounds.js?v=02bc12da1f';

const HOUSES = {
    gryffindor: { name: 'Gryffindor', glow: 'rgba(255, 197, 0, 0.55)' },
    hufflepuff: { name: 'Hufflepuff', glow: 'rgba(236, 185, 57, 0.6)' },
    ravenclaw: { name: 'Ravenclaw', glow: 'rgba(148, 107, 45, 0.6)' },
    slytherin: { name: 'Slytherin', glow: 'rgba(170, 170, 170, 0.6)' }
};
const NUMBER_WORDS = { 5: 'Five', 10: 'Ten', 20: 'Twenty', 50: 'Fifty' };
// A quiet line under the banner title: which secret was found, without spelling out how.
const EGG_HINTS = {
    compass: 'North, south, or straight to the feast',
    footsteps: 'Follow the footsteps',
    castle: 'A light in every window',
    snow: 'No Christmas without snow',
    nox: 'Even darkness has its secrets',
    revelio: 'Nothing stays hidden forever',
    mischief: 'Until next time, Marauder'
};
// Let the egg's own effect get going before the reward joins in.
const DEFAULT_DELAY_MS = 700;
const BANNER_HOLD_MS = 3400;
// The all-found ribbon stays a little longer: the note is still inking in.
const COMPLETION_HOLD_MS = 4500;
const BANNER_IN_MS = 750;
const BANNER_OUT_MS = 600;
// A banner that makes way for a newer one fades out this quickly.
const BANNER_SWAP_MS = 250;
// Reveal from left to right, like ink being written. The negative edges leave room for the glow.
const INK_HIDDEN = 'inset(-24px 100% -24px -24px)';
const INK_SHOWN = 'inset(-24px -24px -24px -24px)';
// Banner stays this much longer than Dumbledore's line.
const BANNER_AFTER_VOICE_MS = 600;
const SPARK_COUNT = 14;
// Flight into the House Cup button: pop in, linger, then fly.
const POP_MS = 300;
const LINGER_MS = 600;
const FLIGHT_MS = 1000;
// How far the "+10" rises while it lingers, before it flies off.
const LINGER_RISE_PX = 12;
const FLIGHT_STEPS = 12;
const FLIGHT_END_SCALE = 0.35;
const TRAIL_COUNT = 4;
const TRAIL_GAP_MS = 60;

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const random = (min, max) => min + Math.random() * (max - min);
const crestUrl = (house) => new URL(`../assets/images/admin/${house}-logo.png`, import.meta.url).href;
const parchmentUrl = new URL('../assets/images/parchment-cropped.png', import.meta.url).href;

const shift = (dx, dy, scale) => `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${scale})`;

// Offsets (relative to the find) along an upward-bowing curve from the lingering "+10" to the target, bunched at the
// start so it sets off slowly and speeds up into the button. The curve stays below the top of the screen.
function flightPath(from, to) {
    const startY = -LINGER_RISE_PX;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lift = Math.min(140, Math.max(60, Math.hypot(dx, dy) * 0.3));
    const control = { x: dx / 2, y: Math.max(Math.min(startY, dy) - lift, 24 - from.y) };

    return Array.from({ length: FLIGHT_STEPS + 1 }, (_, i) => {
        const t = (i / FLIGHT_STEPS) ** 2;
        const u = 1 - t;
        return {
            progress: i / FLIGHT_STEPS,
            x: 2 * u * t * control.x + t * t * dx,
            y: u * u * startY + 2 * u * t * control.y + t * t * dy
        };
    });
}

// "+10" in glowing ink with a ring of sparks, at a point on the screen. With a target ({ x, y }) it then flies there
// and onArrive() runs as it lands; without one it floats up and fades.
function burstAt(x, y, points, { target = null, onArrive = () => {} } = {}) {
    const rootEl = document.createElement('div');
    rootEl.setAttribute('aria-hidden', 'true');
    rootEl.className = 'pointer-events-none fixed z-[80] m-0 h-0 w-0 overflow-visible border-0 bg-transparent p-0';
    rootEl.style.left = `${x}px`;
    rootEl.style.top = `${y}px`;
    // A popover sits in the top layer, so the burst also shows over an open modal dialog (the finale's note).
    const asPopover = typeof rootEl.showPopover === 'function';
    if (asPopover) {
        rootEl.popover = 'manual';
    }

    const sparks = Array.from({ length: SPARK_COUNT }, () => {
        const el = document.createElement('span');
        el.className = 'absolute left-0 top-0 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,#fff_0%,#ffd76a_40%,rgba(255,170,40,0.4)_65%,transparent_75%)]';
        rootEl.append(el);
        return el;
    });

    const labelEl = document.createElement('span');
    labelEl.className = 'absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-inkpot text-4xl text-amber-300 [text-shadow:-1px_-1px_0_rgba(0,0,0,0.45),1px_-1px_0_rgba(0,0,0,0.45),-1px_1px_0_rgba(0,0,0,0.45),1px_1px_0_rgba(0,0,0,0.45),0_0_14px_rgba(255,196,92,0.95)]';
    labelEl.textContent = `+${points}`;
    rootEl.append(labelEl);
    document.body.append(rootEl);
    if (asPopover) {
        rootEl.showPopover();
    }

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

    if (target) {
        const path = flightPath({ x, y }, target);
        const total = POP_MS + LINGER_MS + FLIGHT_MS;
        const flightAt = (POP_MS + LINGER_MS) / total;
        // Fully visible for most of the flight, fading out over the last stretch into the button.
        const flightOpacity = (progress) => Math.min(1, (1 - progress) / 0.3);
        const flightScale = (progress) => 1 - (1 - FLIGHT_END_SCALE) * progress;

        const label = labelEl.animate([
            { transform: shift(0, 0, 0.3), opacity: 0, filter: 'blur(4px)', easing: 'ease-out' },
            { transform: shift(0, -LINGER_RISE_PX / 2, 1.2), opacity: 1, filter: 'blur(0px)', offset: POP_MS / total, easing: 'ease-out' },
            ...path.map(({ progress, x: dx, y: dy }) => ({
                transform: shift(dx, dy, flightScale(progress)),
                opacity: flightOpacity(progress),
                offset: flightAt + (1 - flightAt) * progress
            }))
        ], { duration: total, fill: 'both' });
        label.finished.then(onArrive, () => {});
        animations.push(label);

        // A short tail of sparks that follows the "+10" on its way.
        Array.from({ length: TRAIL_COUNT }, (_, i) => {
            const el = document.createElement('span');
            el.className = 'absolute left-0 top-0 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,#fff_0%,#ffd76a_45%,transparent_75%)]';
            rootEl.append(el);
            animations.push(el.animate(path.map(({ progress, x: dx, y: dy }) => ({
                transform: shift(dx, dy, 1 - 0.7 * progress),
                opacity: progress === 0 ? 0 : 0.85 * flightOpacity(progress) * (1 - i / TRAIL_COUNT)
            })), { duration: FLIGHT_MS, delay: POP_MS + LINGER_MS + (i + 1) * TRAIL_GAP_MS, fill: 'both' }));
        });
    } else {
        animations.push(labelEl.animate([
            { transform: 'translate(-50%, -50%) scale(0.3)', opacity: 0, filter: 'blur(4px)' },
            { transform: 'translate(-50%, -60%) scale(1.2)', opacity: 1, filter: 'blur(0px)', offset: 0.15 },
            { transform: 'translate(-50%, -80%) scale(1)', opacity: 1, offset: 0.6 },
            { transform: 'translate(-50%, -190%) scale(0.9)', opacity: 0, filter: 'blur(2px)' }
        ], { duration: 2000, easing: 'ease-out', fill: 'both' }));
    }

    Promise.allSettled(animations.map((animation) => animation.finished)).then(() => rootEl.remove());
}

// Points for a house: a "+N" bursts from point ({ x, y } in client pixels, default the middle of the screen) and flies
// into the House Cup button (cup from initHouseCup), which lights up as it lands. Also used on the Sorting Hat page.
export function burstHousePoints(house, points, { point = null, cup = null } = {}) {
    playMapSound('spell', 0, { volume: 0.5, fadeAfterMs: 1400, fadeMs: 900 });

    const glow = (HOUSES[house] ?? HOUSES.gryffindor).glow;
    const target = cup?.target() ?? null;

    if (reduceMotion()) {
        // No burst or flight: the button just lights up.
        if (target) {
            cup.pulse(glow);
        }
        return;
    }

    const x = point?.x ?? window.innerWidth / 2;
    const y = point?.y ?? window.innerHeight / 2;
    burstAt(x, y, points, { target, onArrive: () => cup?.pulse(glow) });
}

// Moves the ribbon to the top of the top layer, above a modal dialog that opened after it.
function raiseBanner(rootEl) {
    if (!rootEl.popover) {
        return;
    }

    try {
        if (rootEl.matches(':popover-open')) {
            rootEl.hidePopover();
        }
        rootEl.showPopover();
    } catch {
        // Not in the top layer then; it still shows over the page itself.
    }
}

// One small parchment ribbon in a top corner, reused for every reward. It is also the live region for screen readers.
// A popover, so raiseBanner() can put it in the top layer, above an open modal dialog (the finale's note).
function createBanner() {
    const rootEl = document.createElement('div');
    rootEl.setAttribute('role', 'status');
    rootEl.className = 'pointer-events-none fixed bottom-auto top-3 z-[80] m-0 max-w-[calc(100vw-1.5rem)] overflow-visible border-0 bg-transparent p-0 sm:top-4';
    if (typeof rootEl.showPopover === 'function') {
        rootEl.popover = 'manual';
    }
    rootEl.innerHTML = `
        <div data-reward-card class="flex items-center gap-2 rounded-full bg-cover bg-center py-1 pl-2 pr-5 opacity-0 shadow-[0_2px_10px_rgba(0,0,0,0.35)]">
            <img data-reward-crest alt="" class="h-7 w-7 shrink-0 rounded-full border border-charcoal/30 bg-amber-50/40 object-contain p-0.5">
            <div class="min-w-0 leading-none text-charcoal">
                <p class="truncate">
                    <span data-reward-title class="font-inkpot text-base"></span>
                    <span data-reward-detail aria-hidden="true" class="ml-1 text-[11px] italic text-charcoal/60"></span>
                </p>
                <p data-reward-hint aria-hidden="true" class="mt-0.5 hidden truncate font-inkpot text-xs text-charcoal/60"></p>
                <span data-reward-sr class="sr-only"></span>
            </div>
        </div>`;
    document.body.append(rootEl);
    rootEl.showPopover?.();

    const cardEl = rootEl.querySelector('[data-reward-card]');
    cardEl.style.backgroundImage = `url("${parchmentUrl}")`;

    return {
        rootEl,
        cardEl,
        crestEl: rootEl.querySelector('[data-reward-crest]'),
        titleEl: rootEl.querySelector('[data-reward-title]'),
        detailEl: rootEl.querySelector('[data-reward-detail]'),
        hintEl: rootEl.querySelector('[data-reward-hint]'),
        srEl: rootEl.querySelector('[data-reward-sr]')
    };
}

// onStandings(allHousePoints, foundCount) runs after every recorded find (also repeat finds), for the House Cup.
// cup: the House Cup from initHouseCup ({ target(), pulse(glow) }), or null.
// onAllFound(result) runs once when the guest finds their last secret (the finale, map-finale.js).
export function createEggRewards(guest, { onStandings = () => {}, cup = null, onAllFound = () => {} } = {}) {
    const found = new Set(guest?.foundEggIds ?? []);
    const pending = new Set();
    const canEarn = guest?.rsvpStatus === 'accepted' && Boolean(HOUSES[guest?.house]);
    let banner = null;
    // The newest find owns the banner; an older one that is still up (or about to show) gives way.
    let bannerToken = 0;
    let bannerAnimation = null;

    if (canEarn) {
        // Up front: a live region only announces changes made after it is on the page.
        banner = createBanner();
        new Image().src = crestUrl(guest.house);
        new Image().src = parchmentUrl;
        preloadDumbledore(guest.house);
    }

    // Fades out the banner that is up, from wherever its animation is now.
    const closeBanner = () => {
        if (!bannerAnimation) {
            return Promise.resolve();
        }

        const { cardEl } = banner;
        const from = Number(window.getComputedStyle(cardEl).opacity);
        bannerAnimation.cancel();
        bannerAnimation = cardEl.animate([{ opacity: from }, { opacity: 0 }], { duration: from ? BANNER_SWAP_MS : 0, easing: 'ease-in', fill: 'both' });
        return bannerAnimation.finished.catch(() => {});
    };

    const showBanner = async (result, point, eggId) => {
        const token = ++bannerToken;
        const house = HOUSES[result.house] ?? HOUSES[guest.house];
        const hint = EGG_HINTS[eggId] ?? '';

        // The last secret: the finale starts as Dumbledore says "Mischief managed!", or after the banner if he can't.
        let finaleStarted = false;
        const startFinale = () => {
            if (!finaleStarted && result.foundCount >= result.totalEggs) {
                finaleStarted = true;
                onAllFound(result);
            }
        };

        // He starts right away (cutting off the previous line) while the old banner fades out.
        const [voiceMs] = await Promise.all([
            speakForEgg({ ...result, house: result.house ?? guest.house }, { onLastSentence: startFinale }).catch((error) => {
                console.warn('Dumbledore could not speak.', error);
                return 0;
            }),
            closeBanner()
        ]);

        if (token !== bannerToken) {
            return;
        }

        return playBanner({
            houseKey: result.house ?? guest.house,
            // The corner opposite the find, so the castle or compass stays in view.
            onLeft: (point?.x ?? 0) > window.innerWidth / 2,
            title: `${NUMBER_WORDS[result.pointsAwarded] ?? result.pointsAwarded} points to ${house.name}!`,
            detail: `${result.foundCount}/${result.totalEggs}`,
            hint: hint ? `“${hint}”` : '',
            sr: `Secret ${result.foundCount} of ${result.totalEggs} found${hint ? `: ${hint}` : ''}. ${house.name} has ${result.housePoints} points.`,
            holdMs: Math.max(BANNER_HOLD_MS, voiceMs + BANNER_AFTER_VOICE_MS)
        }).then(startFinale);
    };

    // The finale's ribbon, as the Marauders' note appears: every secret found, and the bonus (when the API sent one).
    const showCompletion = async (result) => {
        const token = ++bannerToken;
        await closeBanner();

        if (token !== bannerToken) {
            return;
        }

        const houseKey = HOUSES[result?.house] ? result.house : guest.house;
        const houseName = HOUSES[houseKey].name;
        const total = Number(result?.totalEggs) || found.size;
        const bonus = Number(result?.bonusAwarded) || 0;

        await playBanner({
            houseKey,
            onLeft: false,
            title: `You found all ${total} secrets!`,
            detail: bonus > 0 ? `+${bonus}` : '',
            hint: bonus > 0 ? `${NUMBER_WORDS[bonus] ?? bonus} bonus points to ${houseName}` : '“Mischief managed”',
            sr: `You found all ${total} secrets of the map.${bonus > 0 ? ` ${bonus} bonus points to ${houseName}.` : ''}`,
            holdMs: COMPLETION_HOLD_MS
        });
    };

    // Writes the ribbon in, holds it for holdMs, and fades it out; resolves once it has gone (or another took over).
    const playBanner = ({ houseKey, onLeft, title, detail, hint, sr, holdMs }) => {
        const { rootEl, cardEl, crestEl, titleEl, detailEl, hintEl, srEl } = banner;
        const house = HOUSES[houseKey] ?? HOUSES[guest.house];

        raiseBanner(rootEl);
        // Inline, so they win over the popover's own inset: 0.
        rootEl.style.left = onLeft ? '0.75rem' : 'auto';
        rootEl.style.right = onLeft ? 'auto' : '0.75rem';

        crestEl.src = crestUrl(houseKey);
        cardEl.style.boxShadow = `0 2px 10px rgba(0, 0, 0, 0.35), 0 0 12px ${house.glow}`;
        titleEl.textContent = title;
        detailEl.textContent = detail;
        hintEl.textContent = hint;
        hintEl.classList.toggle('hidden', !hint);
        srEl.textContent = sr;

        const total = BANNER_IN_MS + holdMs + BANNER_OUT_MS;
        const inAt = BANNER_IN_MS / total;
        const outAt = (BANNER_IN_MS + holdMs) / total;

        const keyframes = reduceMotion()
            ? [{ opacity: 0 }, { opacity: 1, offset: inAt }, { opacity: 1, offset: outAt }, { opacity: 0 }]
            : [
                { opacity: 0, clipPath: INK_HIDDEN, filter: 'blur(2px)', easing: 'cubic-bezier(0.3, 0, 0.2, 1)' },
                { opacity: 1, clipPath: INK_SHOWN, filter: 'blur(0px)', offset: inAt },
                { opacity: 1, clipPath: INK_SHOWN, filter: 'blur(0px)', offset: outAt, easing: 'ease-in' },
                { opacity: 0, clipPath: INK_SHOWN, filter: 'blur(3px)' }
            ];
        bannerAnimation?.cancel();
        const animation = cardEl.animate(keyframes, { duration: total, fill: 'both' });
        bannerAnimation = animation;
        return animation.finished.then(() => {
            if (bannerAnimation === animation) {
                bannerAnimation = null;
            }
        }, () => {});
    };

    const celebrate = (result, point, eggId) => {
        burstHousePoints(HOUSES[result.house] ? result.house : guest.house, result.pointsAwarded, { point, cup });
        showBanner(result, point, eggId).catch((error) => console.warn('Reward banner failed.', error));
    };

    return {
        // Whether this guest already has the egg (from the API or found this visit).
        hasFound: (eggId) => found.has(eggId),
        // The finale (map-finale.js) calls this as the note appears. result: the API's answer for the last secret.
        allFound(result) {
            if (canEarn) {
                showCompletion(result).catch((error) => console.warn('Completion banner failed.', error));
            }
        },
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
                        window.setTimeout(() => celebrate(result, point, eggId), wait);
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
