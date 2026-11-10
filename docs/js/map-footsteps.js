// Marauder's Map footsteps: walkers follow the hidden SVG routes in map/index.html,
// placing alternating prints that ink in and fade out over the trail.
// Coordinates use the routes' viewBox (200 x 300, same 2:3 ratio as the map sheet).
// A walker's footsteps sound only plays while its name is shown (tapped) and its feet move.
import { createMapSoundVoice } from './map-sounds.js?v=fd0efeab0f';

const VIEWBOX_WIDTH = 200;
const VIEWBOX_HEIGHT = 300;
const MAX_WALKERS = 4;
const STRIDE = 5;
const FOOT_SPREAD = 1.4;
const FOOT_WIDTH = 2.5;
const FOOT_LENGTH = 5;
const TRAIL_STEPS = 22;
const EDGE_FADE_STEPS = 3;
const START_DELAY_MS = 2000;
// A walker normally walks its route once; only now and then does it turn around and walk back.
const RETURN_CHANCE = 1 / 6;
// Routes closer than this (viewBox units) count as the same spot and never run at the same time.
const ROUTE_CLEARANCE = 10;
const RETRY_SPAWN_MS = 1200;
// Name labels (easter egg): shown above a walker that is tapped, then inked away again.
const LABEL_MS = 5000;
const LABEL_FADE_MS = 900;
const LABEL_OFFSET = 4;
// A name tag stays centred above its walker; near the screen edge at most this share of it may slide out of view.
const LABEL_MAX_OFFSCREEN = 0.3;
const LABEL_HIT_PX = 32;
// footsteps.mp3 has a step every ~570 ms; playback speed follows each walker's pace.
const SOUND_STEP_MS = 570;
const SOUND_MIN_RATE = 0.85;
const SOUND_MAX_RATE = 1.4;
const SOUND_FADE_MS = 250;
const SVG_NS = 'http://www.w3.org/2000/svg';
const FOOT_SVG = '<ellipse cx="5.4" cy="6" rx="3.9" ry="5.6"/><ellipse cx="4.6" cy="16.2" rx="3" ry="3.6"/>';

const random = (min, max) => min + Math.random() * (max - min);

const samplePath = (pathEl) => {
    const length = pathEl.getTotalLength();
    const points = [];
    for (let d = 0; d <= length; d += 2) {
        points.push(pathEl.getPointAtLength(d));
    }
    return points;
};

// For each route, the indexes of routes that come within ROUTE_CLEARANCE of it.
const findRouteConflicts = (routeEls) => {
    const samples = routeEls.map(samplePath);
    const minDistSq = ROUTE_CLEARANCE * ROUTE_CLEARANCE;
    const isNear = (a, b) => a.some((p) => b.some((q) => (p.x - q.x) ** 2 + (p.y - q.y) ** 2 < minDistSq));

    return samples.map((points, i) => new Set(
        samples.map((_, j) => j).filter((j) => j !== i && isNear(points, samples[j])),
    ));
};

// Returns { labelNearest(clientX, clientY, createTag) }: labels the walker closest to a tap.
// createTag(usedNames, known) returns { name, tagIndex, el }: a new name not in usedNames, or the
// walker's earlier tag (`known`, null the first time) so a walker keeps its name for its whole walk.
export function initMapFootsteps(mapEl) {
    const noop = { labelNearest: () => false };
    const layerEl = mapEl.querySelector('[data-map-footsteps]');
    // Labels get their own layer (same box): the footsteps layer multiplies with the map, which would tint the tags.
    const labelLayerEl = mapEl.querySelector('[data-map-footstep-labels]') ?? layerEl;
    const routeEls = [...mapEl.querySelectorAll('[data-map-footstep-routes] path')];

    if (!(layerEl instanceof HTMLElement) || !routeEls.length) {
        return noop;
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return noop;
    }

    const timers = new Set();
    const busyRoutes = new Set();
    // Active walkers: { x, y, label } in viewBox units; label is { el, name, timer } while shown.
    const walkers = new Set();
    // One sound voice per walker slot, created on first use and handed back when a walker leaves.
    const voices = [];
    const freeVoices = [];
    const takeVoice = () => {
        if (!freeVoices.length && voices.length < MAX_WALKERS) {
            const voice = createMapSoundVoice('footsteps');
            voices.push(voice);
            freeVoices.push(voice);
        }

        return freeVoices.pop() ?? null;
    };
    const routeConflicts = findRouteConflicts(routeEls);
    let isRunning = false;

    const later = (fn, ms) => {
        const id = window.setTimeout(() => {
            timers.delete(id);
            fn();
        }, ms);
        timers.add(id);
    };

    const placePrint = (x, y, angle, opacity, isLeft, lifetimeMs) => {
        const printEl = document.createElementNS(SVG_NS, 'svg');
        printEl.setAttribute('viewBox', '0 0 10 20');
        printEl.setAttribute('fill', 'currentColor');
        printEl.setAttribute('class', 'absolute opacity-0');
        printEl.innerHTML = FOOT_SVG;
        printEl.style.left = `${(x / VIEWBOX_WIDTH) * 100}%`;
        printEl.style.top = `${(y / VIEWBOX_HEIGHT) * 100}%`;
        printEl.style.width = `${(FOOT_WIDTH / VIEWBOX_WIDTH) * 100}%`;
        printEl.style.height = `${(FOOT_LENGTH / VIEWBOX_HEIGHT) * 100}%`;
        printEl.style.transform = `translate(-50%, -50%) rotate(${angle}deg)${isLeft ? ' scaleX(-1)' : ''}`;
        layerEl.appendChild(printEl);

        const animation = printEl.animate(
            [
                { opacity: 0 },
                { opacity, offset: 0.03 },
                { opacity: opacity * 0.85, offset: 0.55 },
                { opacity: 0 },
            ],
            { duration: lifetimeMs, easing: 'ease-out' },
        );
        animation.finished.then(() => printEl.remove(), () => printEl.remove());
    };

    // Keeps the label centred above its walker. Only when it would slide more than LABEL_MAX_OFFSCREEN
    // out of view (the map is wider than a phone) is it nudged back, so it can still hang off the edge a little.
    const placeLabel = (walker) => {
        const labelEl = walker.label?.el;

        if (!labelEl) {
            return;
        }

        const rect = layerEl.getBoundingClientRect();
        const width = labelEl.offsetWidth;
        const height = labelEl.offsetHeight;
        const inViewX = width * (0.5 - LABEL_MAX_OFFSCREEN);
        const minLeft = Math.max(0, -rect.left) + inViewX;
        const maxLeft = Math.min(rect.width, window.innerWidth - rect.left) - inViewX;
        const left = Math.min(Math.max((walker.x / VIEWBOX_WIDTH) * rect.width, minLeft), maxLeft);
        // `top` is the tag's bottom edge (it is translated up by its full height).
        const minTop = Math.max(0, -rect.top) + height * (1 - LABEL_MAX_OFFSCREEN);
        const top = Math.max(((walker.y - LABEL_OFFSET) / VIEWBOX_HEIGHT) * rect.height, minTop);
        labelEl.style.left = `${left}px`;
        labelEl.style.top = `${top}px`;
    };

    const releaseLabel = (walker) => {
        const label = walker.label;

        if (!label) {
            return;
        }

        walker.label = null;
        window.clearTimeout(label.timer);
        walker.syncSound?.();
        const fade = label.el.animate(
            [{ opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: 'blur(3px)' }],
            { duration: LABEL_FADE_MS, easing: 'ease-in', fill: 'forwards' },
        );
        fade.finished.then(() => label.el.remove(), () => label.el.remove());
    };

    // `tag` is { name, el }: the caller draws the name tag, this places it above the walker.
    const showLabel = (walker, { name, el: tagEl }) => {
        const labelEl = document.createElement('span');
        labelEl.dataset.mapFootstepLabel = '';
        labelEl.className = 'absolute block -translate-x-1/2 -translate-y-full';
        labelEl.append(tagEl);
        labelLayerEl.appendChild(labelEl);
        walker.label = { el: labelEl, name, timer: window.setTimeout(() => releaseLabel(walker), LABEL_MS) };
        walker.syncSound?.();
        placeLabel(walker);
        // Glide along with the walker only after the first placement.
        requestAnimationFrame(() => labelEl.classList.add('transition-[left,top]', 'duration-500', 'ease-out'));
        labelEl.animate(
            [{ opacity: 0, filter: 'blur(3px)' }, { opacity: 1, filter: 'blur(0px)' }],
            { duration: 700, easing: 'ease-out', fill: 'forwards' },
        );
    };

    const labelNearest = (clientX, clientY, createTag) => {
        if (!isRunning) {
            return false;
        }

        const rect = layerEl.getBoundingClientRect();
        let nearest = null;
        let nearestDist = Math.max(LABEL_HIT_PX, rect.width * 0.08);

        walkers.forEach((walker) => {
            if (walker.x === null) {
                return;
            }

            const dist = Math.hypot(
                rect.left + (walker.x / VIEWBOX_WIDTH) * rect.width - clientX,
                rect.top + (walker.y / VIEWBOX_HEIGHT) * rect.height - clientY,
            );
            if (dist < nearestDist) {
                nearest = walker;
                nearestDist = dist;
            }
        });

        if (!nearest) {
            return false;
        }

        if (nearest.label) {
            // Tapped again: keep the name a little longer.
            window.clearTimeout(nearest.label.timer);
            nearest.label.timer = window.setTimeout(() => releaseLabel(nearest), LABEL_MS);
            return true;
        }

        const usedNames = new Set([...walkers].filter((walker) => walker.known).map((walker) => walker.known.name));
        const tag = createTag(usedNames, nearest.known);
        nearest.known = { name: tag.name, tagIndex: tag.tagIndex };
        showLabel(nearest, tag);
        return true;
    };

    const walk = (routeEl, routeIndex) => {
        // `known` remembers the walker's name tag after the first tap.
        const walker = { x: null, y: null, label: null, known: null };
        walkers.add(walker);
        const length = routeEl.getTotalLength();
        const stepCount = Math.floor(length / STRIDE);
        const stepMs = random(420, 620);
        const peakOpacity = random(0.7, 0.95);
        let isReversed = Math.random() < 0.5;
        let legsLeft = Math.random() < RETURN_CHANCE ? 2 : 1;
        let isFirstLeg = true;
        let step = 0;
        const voice = takeVoice();
        const soundRate = Math.min(SOUND_MAX_RATE, Math.max(SOUND_MIN_RATE, SOUND_STEP_MS / stepMs));
        let isLegSounding = false;
        let isPausing = false;

        // Sound only while the walker is named and walking; sized to the steps left in this leg (plus one as slack).
        walker.syncSound = () => {
            if (!voice) {
                return;
            }

            const shouldSound = Boolean(walker.label) && !isPausing && step <= stepCount;
            if (shouldSound && !isLegSounding) {
                voice.play((stepCount - step + 2) * stepMs, { rate: soundRate, fadeMs: SOUND_FADE_MS });
                isLegSounding = true;
            } else if (!shouldSound && isLegSounding) {
                voice.stop(SOUND_FADE_MS);
                isLegSounding = false;
            }
        };

        const finish = () => {
            if (voice) {
                voice.stop(SOUND_FADE_MS);
                freeVoices.push(voice);
            }
            walkers.delete(walker);
            releaseLabel(walker);
            busyRoutes.delete(routeIndex);
            if (isRunning) {
                later(spawnWalker, random(300, 1500));
            }
        };

        const takeStep = () => {
            if (!isRunning) {
                finish();
                return;
            }

            if (step > stepCount) {
                // The feet stop here (turn or leave), so does the sound.
                walker.syncSound();
                legsLeft -= 1;
                if (legsLeft <= 0) {
                    finish();
                    return;
                }

                // Turn around after a short pause; skip the turning point so it is not printed twice.
                isReversed = !isReversed;
                isFirstLeg = false;
                step = 1;
                isPausing = true;
                later(() => {
                    isPausing = false;
                    takeStep();
                }, stepMs * random(1.5, 3));
                return;
            }

            walker.syncSound();

            const distance = isReversed ? length - step * STRIDE : step * STRIDE;
            const ahead = isReversed ? Math.max(0, distance - 1) : Math.min(length, distance + 1);
            const point = routeEl.getPointAtLength(distance);
            const next = routeEl.getPointAtLength(ahead);
            const heading = Math.atan2(next.y - point.y, next.x - point.x);
            const isLeft = step % 2 === 0;
            const side = isLeft ? -1 : 1;
            // Left of the heading is (sin, -cos) in screen coordinates.
            const x = point.x - Math.sin(heading) * FOOT_SPREAD * side;
            const y = point.y + Math.cos(heading) * FOOT_SPREAD * side;
            // Fade in on the first leg only, fade out on the last leg only.
            const fadeIn = isFirstLeg ? (step + 1) / EDGE_FADE_STEPS : 1;
            const fadeOut = legsLeft === 1 ? (stepCount - step + 1) / EDGE_FADE_STEPS : 1;
            const edgeFade = Math.min(1, fadeIn, fadeOut);
            const angle = (heading * 180) / Math.PI + 90 + random(-6, 6);
            walker.x = point.x;
            walker.y = point.y;
            placeLabel(walker);

            placePrint(x, y, angle, peakOpacity * Math.max(0.25, edgeFade), isLeft, stepMs * TRAIL_STEPS);
            step += 1;
            later(takeStep, stepMs * random(0.9, 1.1));
        };

        takeStep();
    };

    function spawnWalker() {
        if (!isRunning || busyRoutes.size >= MAX_WALKERS) {
            return;
        }

        const freeIndexes = routeEls
            .map((_, index) => index)
            .filter((index) => !busyRoutes.has(index) && ![...busyRoutes].some((busy) => routeConflicts[index].has(busy)));

        if (!freeIndexes.length) {
            // Every free route overlaps a busy one; try again once someone has moved on.
            later(spawnWalker, RETRY_SPAWN_MS);
            return;
        }

        const routeIndex = freeIndexes[Math.floor(Math.random() * freeIndexes.length)];
        busyRoutes.add(routeIndex);
        walk(routeEls[routeIndex], routeIndex);
    }

    const start = (delayMs) => {
        if (isRunning) {
            return;
        }

        isRunning = true;
        for (let i = 0; i < MAX_WALKERS; i += 1) {
            later(spawnWalker, delayMs + random(0, 2500) + i * 900);
        }
    };

    const stop = () => {
        isRunning = false;
        timers.forEach((id) => window.clearTimeout(id));
        timers.clear();
        busyRoutes.clear();
        walkers.forEach(releaseLabel);
        walkers.clear();
        voices.forEach((voice) => voice.stop(SOUND_FADE_MS));
        freeVoices.splice(0, freeVoices.length, ...voices);
    };

    const isOpen = () => mapEl.dataset.state === 'open';

    new MutationObserver(() => {
        if (isOpen()) {
            start(START_DELAY_MS);
            return;
        }

        stop();
        if (mapEl.dataset.state === 'closed') {
            layerEl.querySelectorAll(':scope > svg:not([data-map-footstep-routes])').forEach((el) => el.remove());
            labelLayerEl.querySelectorAll('[data-map-footstep-label]').forEach((el) => el.remove());
        }
    }).observe(mapEl, { attributes: true, attributeFilter: ['data-state'] });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stop();
        } else if (isOpen()) {
            start(0);
        }
    });

    return { labelNearest };
}
