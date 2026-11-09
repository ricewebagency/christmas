export function lockInitialViewportHeight(cssVariableName = "--locked-vh") {
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    document.documentElement.style.setProperty(cssVariableName, `${viewportHeight}px`);
}

export function parseRevealDelayMs(element, cssVariableName = "--reveal-delay") {
    const customProperty = getComputedStyle(element).getPropertyValue(cssVariableName).trim();
    if (!customProperty) {
        return 0;
    }

    const parsed = Number.parseFloat(customProperty);
    return Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
}

const RANDOM_EXIT_DELAY_OPTIONS_MS = [400, 800, 1200, 1600, 2000];

export function getRandomExitDelayMs() {
    const index = Math.floor(Math.random() * RANDOM_EXIT_DELAY_OPTIONS_MS.length);
    return RANDOM_EXIT_DELAY_OPTIONS_MS[index];
}

export function runRevealExitSequence({
    selector = "[data-reveal]",
    fadeDurationMs = 450,
    revealDelayCssVariable = "--reveal-delay",
    getDelayMs = (element) => parseRevealDelayMs(element, revealDelayCssVariable)
} = {}) {
    const revealItems = Array.from(document.querySelectorAll(selector));
    if (revealItems.length === 0) {
        return 0;
    }

    let longestDelayMs = 0;

    revealItems.forEach((element) => {
        const delayMs = getDelayMs(element);
        longestDelayMs = Math.max(longestDelayMs, delayMs);

        element.style.animation = "none";
        element.style.opacity = "1";
        element.style.transitionProperty = "opacity";
        element.style.transitionDuration = `${fadeDurationMs}ms`;
        element.style.transitionTimingFunction = "ease-out";
        element.style.transitionDelay = `${delayMs}ms`;
        element.style.pointerEvents = "none";
    });

    window.requestAnimationFrame(() => {
        revealItems.forEach((element) => {
            element.style.opacity = "0";
        });
    });

    return longestDelayMs + fadeDurationMs;
}

export function pathEndsWith(href, pathSuffix, baseUrl = window.location.href) {
    if (!href || !pathSuffix) {
        return false;
    }

    try {
        const url = new URL(href, baseUrl);
        const normalizedPath = url.pathname.replace(/\/+$/, "");
        return normalizedPath.endsWith(pathSuffix);
    } catch {
        return false;
    }
}

function shouldHandleNavigationClick(event, link) {
    if (event.defaultPrevented || event.button !== 0) {
        return false;
    }

    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return false;
    }

    const target = link.getAttribute("target");
    if (target && target !== "_self") {
        return false;
    }

    return true;
}

export function setupLinkExitTransition({
    linkSelector = "a[href]",
    matchLink = () => true,
    getDelayMs = () => 0,
    navigate = (destination) => {
        window.location.assign(destination);
    }
} = {}) {
    const links = Array.from(document.querySelectorAll(linkSelector))
        .filter((link) => matchLink(link));

    if (links.length === 0) {
        return () => {};
    }

    let isNavigating = false;

    const onLinkClick = (event) => {
        const link = event.currentTarget;
        if (!(link instanceof HTMLAnchorElement)) {
            return;
        }

        if (isNavigating || !shouldHandleNavigationClick(event, link)) {
            return;
        }

        event.preventDefault();
        isNavigating = true;

        const destination = link.href;
        const rawDelayMs = Number(getDelayMs(link, event));
        const delayMs = Number.isFinite(rawDelayMs) ? Math.max(0, rawDelayMs) : 0;

        window.setTimeout(() => {
            navigate(destination, link, event);
        }, delayMs);
    };

    links.forEach((link) => {
        link.addEventListener("click", onLinkClick);
    });

    return () => {
        links.forEach((link) => {
            link.removeEventListener("click", onLinkClick);
        });
    };
}