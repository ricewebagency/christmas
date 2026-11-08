// Marauder's Map footsteps: walkers follow the hidden SVG routes in map/index.html,
// placing alternating prints that ink in and fade out over the trail.
// Coordinates use the routes' viewBox (200 x 300, same 2:3 ratio as the map sheet).
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
// Each walker paces its route back and forth this many times before leaving.
const MIN_LEGS = 2;
const MAX_LEGS = 4;
// Routes closer than this (viewBox units) count as the same spot and never run at the same time.
const ROUTE_CLEARANCE = 10;
const RETRY_SPAWN_MS = 1200;
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

export function initMapFootsteps(mapEl) {
    const layerEl = mapEl.querySelector('[data-map-footsteps]');
    const routeEls = [...mapEl.querySelectorAll('[data-map-footstep-routes] path')];

    if (!(layerEl instanceof HTMLElement) || !routeEls.length) {
        return;
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return;
    }

    const timers = new Set();
    const busyRoutes = new Set();
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

    const walk = (routeEl, routeIndex) => {
        const length = routeEl.getTotalLength();
        const stepCount = Math.floor(length / STRIDE);
        const stepMs = random(420, 620);
        const peakOpacity = random(0.7, 0.95);
        let isReversed = Math.random() < 0.5;
        let legsLeft = MIN_LEGS + Math.floor(Math.random() * (MAX_LEGS - MIN_LEGS + 1));
        let isFirstLeg = true;
        let step = 0;

        const finish = () => {
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
                legsLeft -= 1;
                if (legsLeft <= 0) {
                    finish();
                    return;
                }

                // Turn around after a short pause; skip the turning point so it is not printed twice.
                isReversed = !isReversed;
                isFirstLeg = false;
                step = 1;
                later(takeStep, stepMs * random(1.5, 3));
                return;
            }

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
        }
    }).observe(mapEl, { attributes: true, attributeFilter: ['data-state'] });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stop();
        } else if (isOpen()) {
            start(0);
        }
    });
}
