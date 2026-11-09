import {
    getRandomExitDelayMs,
    lockInitialViewportHeight,
    pathEndsWith,
    runRevealExitSequence,
    setupLinkExitTransition
} from "./page-transitions.js";
import {
    clearGuestCode,
    getStoredGuestCode,
    readGuestCodeFromUrl,
    removeGuestCodeFromUrl,
    verifyGuestCode
} from "./api-client.js";
import { getNextStep, getPageUrl, whenDomReady } from "./guest-flow.js";
import { getPinErrorKind, getPinErrorMessage, openPinDialog } from "./pin-dialog.js";

const RSVP_LABELS = {
    pending: "Awaiting your response",
    accepted: "Owl received - attendance confirmed",
    declined: "Owl received - regrets noted"
};

const INVITE_LOADER_TIMINGS = {
    bottomFadeDelayMs: 1500,
    overlayFadeDelayMs: 1500,
    removeOverlayDelayMs: 900
};

const ENVELOPE_TOP_TRANSFORMS = {
    closed: "perspective(1600px) translate3d(0,0,0) rotateX(0deg)",
    opened: "perspective(1600px) translate3d(0,0,0) rotateX(74deg)"
};

const ENVELOPE_TOP_FILTERS = {
    closed: "drop-shadow(0 8px 8px rgba(0, 0, 0, 0.08))",
    opened: "drop-shadow(0 46px 40px rgba(0, 0, 0, 0.5))"
};

const RSVP_EXIT_FADE_DURATION_MS = 800;// Without a valid code the letter is shown first; the pincode dialog follows once its opening lines appeared.
const PIN_DIALOG_DELAY_MS = 1800;
const PIN_ERROR_PARAMS = ["pin-error", "retry-after"];

function pad(value) {
    return String(value).padStart(2, "0");
}

function getTimeParts(targetDate) {
    const now = new Date();
    const totalMs = targetDate.getTime() - now.getTime();

    if (totalMs <= 0) {
        return {
            isPast: true,
            days: 0,
            hours: 0,
            minutes: 0,
            seconds: 0
        };
    }

    const totalSeconds = Math.floor(totalMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return {
        isPast: false,
        days,
        hours,
        minutes,
        seconds
    };
}

function formatCountdown(parts) {
    return `${parts.days} DAYS · ${pad(parts.hours)} HOURS · ${pad(parts.minutes)} MIN · ${pad(parts.seconds)} SEC`;
}

function renderInvitationData(data) {
    const guestNameEl = document.getElementById("guest-name");
    const eventLocationEl = document.getElementById("event-location");
    const rsvpStatusEl = document.getElementById("rsvp-status");

    if (guestNameEl) {
        guestNameEl.textContent = data.guestName;
    }

    if (eventLocationEl) {
        eventLocationEl.textContent = data.location;
    }

    if (rsvpStatusEl) {
        rsvpStatusEl.textContent = RSVP_LABELS[data.rsvpStatus] || "Awaiting your response";
    }
}

function startCountdown(eventDateIso) {
    const countdownEl = document.getElementById("countdown");
    if (!countdownEl) {
        return;
    }

    const targetDate = new Date(eventDateIso);
    if (Number.isNaN(targetDate.getTime())) {
        countdownEl.textContent = "Countdown unavailable";
        return;
    }

    const update = () => {
        const parts = getTimeParts(targetDate);
        countdownEl.textContent = formatCountdown(parts);
    };

    update();
    window.setInterval(update, 1000);
}

function createSnowParticles() {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
        return;
    }

    const snowLayer = document.getElementById("snow-layer");
    if (!snowLayer) {
        return;
    }

    const particles = 18;

    for (let index = 0; index < particles; index += 1) {
        const snow = document.createElement("span");
        snow.className = "snow";
        snow.style.left = `${Math.random() * 100}%`;
        snow.style.opacity = (Math.random() * 0.55 + 0.2).toFixed(2);
        snow.style.animationDuration = `${Math.random() * 5 + 8}s`;
        snow.style.animationDelay = `${Math.random() * 8}s`;
        snow.style.setProperty("--snow-drift", `${Math.random() * 28 - 14}px`);
        snowLayer.appendChild(snow);
    }
}

function removeInviteLoader(loaderEl) {
    loaderEl.classList.add("pointer-events-none", "opacity-0");

    window.setTimeout(() => {
        loaderEl.remove();
        document.body.classList.remove("overflow-hidden");
    }, INVITE_LOADER_TIMINGS.removeOverlayDelayMs);
}

function waitForInviteLoaderActivation(loaderEl) {
    return new Promise((resolve) => {
        const onActivate = (event) => {
            if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") {
                return;
            }

            if (event.type === "keydown") {
                event.preventDefault();
            }

            if (typeof window.unlockBackgroundAudio === "function") {
                void window.unlockBackgroundAudio();
            }

            loaderEl.removeEventListener("click", onActivate);
            loaderEl.removeEventListener("keydown", onActivate);
            resolve();
        };

        loaderEl.addEventListener("click", onActivate);
        loaderEl.addEventListener("keydown", onActivate);
    });
}

function playInviteEnvelopeLoader() {
    const loaderEl = document.getElementById("invite-loader");
    const envelopeTopEl = document.getElementById("invite-envelope-top");
    const envelopeBottomEl = document.getElementById("invite-envelope-bottom");
    const hingeShadowEl = document.getElementById("invite-hinge-shadow");

    if (!loaderEl || !envelopeTopEl || !envelopeBottomEl || !hingeShadowEl) {
        return Promise.resolve();
    }

    document.body.classList.add("overflow-hidden");

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    envelopeTopEl.style.transform = ENVELOPE_TOP_TRANSFORMS.closed;
    envelopeTopEl.style.filter = ENVELOPE_TOP_FILTERS.closed;

    return new Promise((resolve) => {
        const finish = () => {
            removeInviteLoader(loaderEl);
            resolve();
        };

        waitForInviteLoaderActivation(loaderEl).then(() => {
            if (prefersReducedMotion) {
                envelopeTopEl.style.transform = ENVELOPE_TOP_TRANSFORMS.opened;
                envelopeTopEl.style.filter = ENVELOPE_TOP_FILTERS.opened;
                hingeShadowEl.classList.add("opacity-100");
                envelopeBottomEl.classList.add("opacity-0");
                finish();
                return;
            }

            window.requestAnimationFrame(() => {
                envelopeTopEl.style.transform = ENVELOPE_TOP_TRANSFORMS.opened;
                envelopeTopEl.style.filter = ENVELOPE_TOP_FILTERS.opened;
                hingeShadowEl.classList.add("opacity-100");

                window.setTimeout(() => {
                    envelopeBottomEl.classList.add("opacity-0");
                }, INVITE_LOADER_TIMINGS.bottomFadeDelayMs);

                window.setTimeout(() => {
                    finish();
                }, INVITE_LOADER_TIMINGS.overlayFadeDelayMs);
            });
        });
    });
}

function revealInvitationContent() {
    window.dispatchEvent(new CustomEvent("reveal-sequence:start"));
}

// Once the RSVP is answered, the letter's link continues the journey instead.
function setupInviteCta(guest) {
    if (guest.rsvpStatus === "pending") {
        return;
    }

    const ctaLink = document.querySelector("[data-invite-cta]");
    const ctaLabel = document.querySelector("[data-invite-cta-label]");

    if (ctaLink instanceof HTMLAnchorElement) {
        ctaLink.href = getPageUrl(getNextStep(guest));
    }

    if (ctaLabel instanceof HTMLElement) {
        ctaLabel.textContent = "Continue your journey";
    }}

function setupRsvpExitTransition() {
    setupLinkExitTransition({
        matchLink: (link) => link.hasAttribute("data-invite-cta") || pathEndsWith(link.getAttribute("href"), "/rsvp"),
        getDelayMs: () => runRevealExitSequence({
            fadeDurationMs: RSVP_EXIT_FADE_DURATION_MS,
            getDelayMs: getRandomExitDelayMs
        })
    });
}

function applyGuest(guest) {
    renderInvitationData(guest);
    startCountdown(guest.eventDate);
    setupInviteCta(guest);
}

// Error handed over by the home page (?pin-error=unknown|sealed&retry-after=N); removed from the URL.
function readPinErrorFromUrl() {
    const url = new URL(window.location.href);
    const kind = url.searchParams.get("pin-error");
    const retryAfter = Number(url.searchParams.get("retry-after")) || null;

    if (PIN_ERROR_PARAMS.some((param) => url.searchParams.has(param))) {
        PIN_ERROR_PARAMS.forEach((param) => url.searchParams.delete(param));
        window.history.replaceState(window.history.state, "", url.href);
    }

    return kind ? getPinErrorMessage(kind, retryAfter) : "";
}

// Resolves with { guest } for a valid code, or with the options for the pincode dialog.
async function resolveGuest() {
    const linkedCode = readGuestCodeFromUrl();
    removeGuestCodeFromUrl();
    const pinErrorMessage = readPinErrorFromUrl();
    const candidateCode = linkedCode ?? getStoredGuestCode();

    if (!candidateCode) {
        return { guest: null, dialog: { message: pinErrorMessage } };
    }

    try {
        return { guest: await verifyGuestCode(candidateCode) };
    } catch (error) {
        const kind = getPinErrorKind(error);

        if (kind === "unknown" && linkedCode === null) {
            clearGuestCode();
        }

        if (kind === "network") {
            // Keep the code so one tap on "Try again" is enough.
            return { guest: null, dialog: { message: getPinErrorMessage(kind), prefill: candidateCode, canRetry: true } };
        }

        return { guest: null, dialog: { message: getPinErrorMessage(kind, error?.retryAfterSeconds) } };
    }
}

function fadeInGuestName(guest) {
    const guestNameEl = document.getElementById("guest-name");

    if (!guestNameEl) {
        applyGuest(guest);
        return Promise.resolve();
    }

    guestNameEl.classList.add("opacity-0");

    return new Promise((resolve) => {
        window.setTimeout(() => {
            applyGuest(guest);
            guestNameEl.classList.remove("opacity-0");
            resolve();
        }, 700);
    });
}

async function initInvitePage(guestResultPromise) {
    const invitationRoot = document.getElementById("invitation-root");
    const mainEl = document.querySelector("main");

    createSnowParticles();

    // The envelope always comes first; the code check runs meanwhile.
    const [result] = await Promise.all([
        guestResultPromise.then((value) => {
            if (value.guest) {
                applyGuest(value.guest);
            } else if (mainEl) {
                // Nothing on the letter may be used until the password is given.
                mainEl.inert = true;
            }

            return value;
        }),
        playInviteEnvelopeLoader()
    ]);

    if (invitationRoot) {
        invitationRoot.classList.remove("opacity-0");
        invitationRoot.classList.add("opacity-100");
    }

    window.requestAnimationFrame(() => {
        revealInvitationContent();
    });

    if (result.guest) {
        return;
    }

    await new Promise((resolve) => window.setTimeout(resolve, PIN_DIALOG_DELAY_MS));

    const guest = await openPinDialog(result.dialog);

    if (mainEl) {
        mainEl.inert = false;
    }

    await fadeInGuestName(guest);
}

async function bootstrapInvitePage() {
    const guestResultPromise = resolveGuest();

    await whenDomReady();
    lockInitialViewportHeight();
    setupRsvpExitTransition();
    void initInvitePage(guestResultPromise);
}

void bootstrapInvitePage();