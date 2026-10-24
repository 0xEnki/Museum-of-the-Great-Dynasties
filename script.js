/* ==========================================================================
   Virtual Museum – application script (ES module, deferred by default)

   Sections (each talks to the others only through function arguments, so any
   of them can be moved to its own file later with a one-line `export`):

     1. Config                      8. Reveal-on-scroll
     2. DOM helpers                 9. Featured 3D carousel
     3. Formatting & images        10. Exhibitions grid + hall modal
     4. Data service               11. Treasures gallery (search + filter)
     5. Dialog helper              12. Artifact modal
     6. Zoom lightbox              13. Registry table (sort + filter)
     7. Header & navigation        14. Booking form
                                   15. Bootstrap

   Security notes
   - The site's CSP is `script-src 'self'`: no inline handlers (onclick="…"),
     no third-party scripts. Every interaction is wired here with
     addEventListener.
   - Text from the JSON files is inserted as text nodes only (see h()), so
     data can never inject markup.
   ========================================================================== */

/* ---------- 1. Config ---------- */
const CONFIG = Object.freeze({
    exhibitionsUrl: 'data/exhibitions.json',
    collectionUrl: 'data/collection.json',
    requestTimeoutMs: 10_000,

    // null = mock backend (no network call). Set to '/api/reservations' to POST for real.
    reservationsEndpoint: null,

    locale: 'ar-u-nu-latn', // Arabic text with Latin digits, matching the rest of the page
    imageWidths: [480, 800, 1200],
    bookingWindowDays: 180,
    searchDebounceMs: 160,

    // Lightbox zoom limits (1 = image fitted to the screen)
    zoom: Object.freeze({ min: 1, max: 5, buttonFactor: 1.5, doubleClickScale: 2.5 }),

    // Hosts whose images can be resized through URL parameters.
    // To use another CDN (Cloudinary, imgix, Firebase Resize Images…) change `resizedUrl()` only.
    resizableImageHosts: new Set(['images.unsplash.com']),
});

/** Shown instead of a broken-image icon when a picture fails to load (data: URIs are allowed by the CSP). */
const PLACEHOLDER_IMAGE =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 300'%3E%3Crect width='400' height='300' fill='%23212127'/%3E%3Cpath d='M200 105l45 45-45 45-45-45z' fill='none' stroke='%23d4af37' stroke-width='3'/%3E%3C/svg%3E";

/* ---------- 2. DOM helpers ---------- */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/**
 * Tiny element factory. Content is always inserted as text nodes (never as HTML),
 * so data coming from JSON or an API cannot inject markup.
 */
function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (value == null || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value === true ? '' : value);
    }
    node.append(...children.flat().filter((child) => child != null && child !== false));
    return node;
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isRtl = () => document.documentElement.dir === 'rtl';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const scrollBehavior = () => (prefersReducedMotion() ? 'auto' : 'smooth');

function debounce(fn, wait) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
}

/** Small "pop in" for content that swaps inside an open dialog (skipped for reduced motion). */
function flash(node) {
    if (prefersReducedMotion() || !node.animate) return;
    node.animate(
        [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
        { duration: 320, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
    );
}

/* ---------- 3. Formatting & images ---------- */
const fmt = {
    price(amount, currency) {
        if (amount === 0) return 'مجاني';
        return new Intl.NumberFormat(CONFIG.locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
    },
    date(date) {
        return new Intl.DateTimeFormat(CONFIG.locale, { dateStyle: 'full', calendar: 'gregory' }).format(date);
    },
    weekday(date) {
        return new Intl.DateTimeFormat(CONFIG.locale, { weekday: 'long', calendar: 'gregory' }).format(date);
    },
};

const toISODate = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Parses "YYYY-MM-DD" as a *local* date (new Date("YYYY-MM-DD") would be UTC and can shift a day). */
function parseISODate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const [, y, m, d] = match.map(Number);
    const date = new Date(y, m - 1, d);
    return date.getMonth() === m - 1 ? date : null; // rejects 2026-02-31 etc.
}

const startOfToday = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

/**
 * Makes Arabic text comparable for search: drops diacritics and tatweel, folds the
 * alef / yaa / taa-marbuta variants, converts Arabic-Indic digits, lower-cases Latin.
 */
function normalizeText(value) {
    return String(value)
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
        .replace(/[إأآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
        .trim();
}

/* Responsive images (one place to adapt if the CDN changes) */
const isResizable = (url) => {
    try {
        return CONFIG.resizableImageHosts.has(new URL(url).hostname);
    } catch {
        return false; // relative paths such as "images.jpeg" are served as they are
    }
};

function resizedUrl(url, width) {
    if (!isResizable(url)) return url;
    const u = new URL(url);
    u.search = new URLSearchParams({ auto: 'format', fit: 'crop', q: '75', w: String(width) }).toString();
    return u.toString();
}

const imageSrcset = (url) =>
    isResizable(url) ? CONFIG.imageWidths.map((w) => `${resizedUrl(url, w)} ${w}w`).join(', ') : null;

/** Swaps in the placeholder once if the picture fails; the flag prevents an error loop. */
function withImageFallback(img) {
    img.addEventListener('error', () => {
        if (img.dataset.fallback) return;
        img.dataset.fallback = 'true';
        img.removeAttribute('srcset');
        img.removeAttribute('sizes');
        img.src = PLACEHOLDER_IMAGE;
    });
    return img;
}

const createImage = (props) => withImageFallback(h('img', props));

/** Points an existing <img> (modal) at a new picture, with a srcset when the CDN supports it. */
function setImageSource(img, url, { width, sizes = '100vw' }) {
    delete img.dataset.fallback;
    const srcset = imageSrcset(url);
    if (srcset) {
        img.srcset = srcset;
        img.sizes = sizes;
    } else {
        img.removeAttribute('srcset');
        img.removeAttribute('sizes');
    }
    img.src = resizedUrl(url, width);
}

/** A pill-shaped toggle button. `data-label` reserves the bold width (see .t-filter-btn::after). */
const setPillLabel = (button, text) => {
    button.textContent = text;
    button.dataset.label = text;
};

function setActivePill(container, attribute, value) {
    for (const pill of $$(`[${attribute}]`, container)) {
        const on = pill.getAttribute(attribute) === value;
        pill.classList.toggle('active', on);
        pill.setAttribute('aria-pressed', String(on));
    }
}

/* ---------- 4. Data service ---------- */
async function fetchJson(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout?.(CONFIG.requestTimeoutMs) });
    if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${url}`);
    return response.json();
}

async function loadExhibitionData() {
    const data = await fetchJson(CONFIG.exhibitionsUrl);
    if (!data?.museum || !Array.isArray(data.exhibitions) || !Array.isArray(data.ticketTypes)) {
        throw new Error('Unexpected exhibitions data shape');
    }
    return data;
}

async function loadCollectionData() {
    const data = await fetchJson(CONFIG.collectionUrl);
    const valid = (item) => item?.id && item.name && item.category && item.status && item.image?.src;
    if (!Array.isArray(data?.items) || !Array.isArray(data.categories) || !Array.isArray(data.statuses)) {
        throw new Error('Unexpected collection data shape');
    }
    return { ...data, items: data.items.filter(valid) };
}

/**
 * Sends a reservation. With no endpoint configured it simulates a backend so the
 * whole UI flow can be tested. A real API must re-validate everything and
 * calculate the price on the server: never trust `payload.total`.
 */
async function submitReservation(payload) {
    if (!CONFIG.reservationsEndpoint) {
        await sleep(900);
        const reference = `LZ-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        return { reference };
    }

    const response = await fetch(CONFIG.reservationsEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json(); // expected: { reference: string }
}

/** Fills every [data-bind="museum.xxx"] element (hours, address, e-mail…) from the data file. */
function bindMuseumInfo(museum) {
    for (const node of $$('[data-bind]')) {
        const value = node.dataset.bind.split('.').reduce((obj, key) => obj?.[key], { museum });
        if (value == null) continue;
        node.textContent = value;

        const prefix = node.dataset.hrefPrefix;
        if (prefix && node instanceof HTMLAnchorElement) {
            node.href = prefix + String(value).replace(/\s+/g, '');
        }
    }
}

/** Replaces a container's content with an error message and a retry button. */
function showLoadError(container, message, retry, tag = 'div') {
    const button = h('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, 'إعادة المحاولة');
    button.addEventListener('click', retry);
    container.replaceChildren(h(tag, { class: 'notice' }, h('p', { role: 'alert' }, message), button));
}

/* ---------- 5. Dialog helper ---------- */
const syncScrollLock = () =>
    document.documentElement.classList.toggle('is-locked', Boolean($('dialog[open]')));

/**
 * Wraps a native <dialog>:
 *  - opens it modally (with a fallback for browsers without showModal)
 *  - closes on [data-modal-close] buttons and on a backdrop click
 *  - keeps page scrolling locked while ANY dialog is open (dialogs can stack)
 *  - returns focus to the element that opened it
 */
function bindDialog(dialog, { closeOnBackdrop = true } = {}) {
    let opener = null;
    let pressedOnBackdrop = false;

    const api = {
        element: dialog,
        open(openerElement) {
            opener = openerElement ?? document.activeElement;
            if (!dialog.open) {
                if (typeof dialog.showModal === 'function') dialog.showModal();
                else dialog.setAttribute('open', '');
            }
            syncScrollLock();
        },
        close() {
            if (typeof dialog.close === 'function') {
                dialog.close();
            } else {
                dialog.removeAttribute('open');
                dialog.dispatchEvent(new Event('close'));
            }
        },
        /** The next close should not move focus back (the caller moves it somewhere else). */
        forgetOpener() {
            opener = null;
        },
    };

    // A drag that starts inside the dialog and ends on the backdrop must not close it
    dialog.addEventListener('pointerdown', (event) => {
        pressedOnBackdrop = event.target === dialog;
    });
    dialog.addEventListener('click', (event) => {
        if (event.target.closest('[data-modal-close]')) api.close();
        else if (closeOnBackdrop && event.target === dialog && pressedOnBackdrop) api.close();
    });

    // Fires for every way of closing (button, Esc, backdrop): restore scroll and focus here, once.
    dialog.addEventListener('close', () => {
        syncScrollLock();
        if (opener?.isConnected) opener.focus({ preventScroll: true });
        opener = null;
    });

    return api;
}

/** Previous / next controls shared by the hall and artifact dialogs. */
function createPager({ prev, next, count, onStep }) {
    prev.addEventListener('click', () => onStep(-1));
    next.addEventListener('click', () => onStep(1));
    const group = prev.parentElement;
    return {
        update(index, total) {
            group.hidden = total < 2;
            count.textContent = `${index + 1} / ${total}`;
        },
    };
}

/** Arrow keys inside a dialog step through its list (in RTL the left arrow means "next"). */
function bindArrowKeys(dialog, onStep) {
    dialog.addEventListener('keydown', (event) => {
        if (event.target.closest('input, select, textarea')) return;
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        const towardsNext = (event.key === 'ArrowLeft') === isRtl();
        event.preventDefault();
        onStep(towardsNext ? 1 : -1);
    });
}

/* ---------- 6. Zoom lightbox ---------- */
/**
 * Full-screen magnifier: wheel / pinch / buttons / double-click to zoom,
 * drag to pan, keyboard + − 0 and arrow keys. The picture is moved with a CSS
 * transform only, so zooming never triggers layout.
 */
function createLightbox() {
    const dialog = $('#lightbox');
    const stage = $('#lightbox-stage');
    const image = withImageFallback($('#lightbox-image'));
    const caption = $('#lightbox-caption');
    const readout = $('#lightbox-zoom');
    const zoomOutButton = $('#lightbox-out');
    const zoomInButton = $('#lightbox-in');
    const resetButton = $('#lightbox-reset');
    const { min, max, buttonFactor, doubleClickScale } = CONFIG.zoom;

    const controller = bindDialog(dialog, { closeOnBackdrop: false });
    const view = { scale: 1, x: 0, y: 0 };
    const pointers = new Map();
    let pinch = null;
    let moved = false;

    /** How far the picture may travel before its edge would leave the screen. */
    const limits = () => ({
        x: Math.max(0, (image.offsetWidth * view.scale - stage.clientWidth) / 2),
        y: Math.max(0, (image.offsetHeight * view.scale - stage.clientHeight) / 2),
    });

    function apply({ animate = false } = {}) {
        const bound = limits();
        view.x = clamp(view.x, -bound.x, bound.x);
        view.y = clamp(view.y, -bound.y, bound.y);

        image.classList.toggle('is-animating', animate && !prefersReducedMotion());
        image.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
        readout.textContent = `${Math.round(view.scale * 100)}%`;
        zoomOutButton.disabled = view.scale <= min;
        zoomInButton.disabled = view.scale >= max;
        stage.classList.toggle('is-zoomed', view.scale > min);
    }

    /** Zooms to `next`, keeping the point (qx, qy) – measured from the stage centre – fixed on screen. */
    function zoomTo(next, qx = 0, qy = 0, animate = false) {
        const scale = clamp(next, min, max);
        const ratio = scale / view.scale;
        view.x = qx - (qx - view.x) * ratio;
        view.y = qy - (qy - view.y) * ratio;
        view.scale = scale;
        apply({ animate });
    }

    const fromCentre = (clientX, clientY) => {
        const box = stage.getBoundingClientRect();
        return { x: clientX - (box.left + box.width / 2), y: clientY - (box.top + box.height / 2) };
    };

    /* Wheel */
    stage.addEventListener(
        'wheel',
        (event) => {
            event.preventDefault();
            const q = fromCentre(event.clientX, event.clientY);
            zoomTo(view.scale * Math.exp(-event.deltaY * 0.0015), q.x, q.y);
        },
        { passive: false },
    );

    /* Pointer: one finger / mouse pans, two fingers pinch */
    stage.addEventListener('pointerdown', (event) => {
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        moved = false;
        stage.classList.add('is-dragging');
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
        }
    });

    stage.addEventListener('pointermove', (event) => {
        const point = pointers.get(event.pointerId);
        if (!point) return;
        const dx = event.clientX - point.x;
        const dy = event.clientY - point.y;
        point.x = event.clientX;
        point.y = event.clientY;

        if (pointers.size === 2 && pinch) {
            const [a, b] = [...pointers.values()];
            const centre = fromCentre((a.x + b.x) / 2, (a.y + b.y) / 2);
            zoomTo((pinch.scale * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.distance, centre.x, centre.y);
            moved = true;
        } else if (pointers.size === 1 && view.scale > min) {
            view.x += dx;
            view.y += dy;
            apply();
            if (Math.abs(dx) + Math.abs(dy) > 2) {
                moved = true;
                // Keep receiving moves if the pointer leaves the stage. Captured only once a real drag
                // starts: capturing on pointerdown would retarget plain clicks (and double-clicks) to the stage.
                if (!stage.hasPointerCapture(event.pointerId)) stage.setPointerCapture(event.pointerId);
            }
        }
    });

    const endPointer = (event) => {
        pointers.delete(event.pointerId);
        if (pointers.size < 2) pinch = null;
        if (!pointers.size) stage.classList.remove('is-dragging');
    };
    stage.addEventListener('pointerup', endPointer);
    stage.addEventListener('pointercancel', endPointer);

    /* A click on the empty dark area closes; a click after a drag does not */
    stage.addEventListener('click', (event) => {
        if (event.target === stage && !moved) controller.close();
    });

    image.addEventListener('dblclick', (event) => {
        const q = fromCentre(event.clientX, event.clientY);
        zoomTo(view.scale > min ? min : doubleClickScale, q.x, q.y, true);
    });

    /* Buttons */
    zoomOutButton.addEventListener('click', () => zoomTo(view.scale / buttonFactor, 0, 0, true));
    zoomInButton.addEventListener('click', () => zoomTo(view.scale * buttonFactor, 0, 0, true));
    resetButton.addEventListener('click', () => zoomTo(min, 0, 0, true));

    /* Keyboard */
    dialog.addEventListener('keydown', (event) => {
        const pan = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] }[event.key];
        if (event.key === '+' || event.key === '=') zoomTo(view.scale * buttonFactor, 0, 0, true);
        else if (event.key === '-' || event.key === '_') zoomTo(view.scale / buttonFactor, 0, 0, true);
        else if (event.key === '0') zoomTo(min, 0, 0, true);
        else if (pan && view.scale > min) {
            view.x += pan[0];
            view.y += pan[1];
            apply({ animate: true });
        } else return;
        event.preventDefault();
    });

    image.addEventListener('load', () => apply());
    window.addEventListener('resize', () => dialog.open && apply());

    return {
        /** @param {{src: string, alt: string, caption?: string}} picture */
        open(picture, openerElement) {
            Object.assign(view, { scale: 1, x: 0, y: 0 });
            delete image.dataset.fallback;
            image.alt = picture.alt ?? '';
            image.src = picture.src;
            caption.textContent = picture.caption ?? '';
            controller.open(openerElement);
            apply();
        },
    };
}

/* ---------- 7. Header & navigation ---------- */
function initHeader() {
    const header = $('#site-header');
    const toggle = $('#nav-toggle');
    const nav = $('#primary-nav');

    const setOpen = (open) => {
        toggle.setAttribute('aria-expanded', String(open));
        nav.classList.toggle('is-open', open);
    };
    const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';

    toggle.addEventListener('click', () => setOpen(!isOpen()));
    nav.addEventListener('click', (event) => event.target.closest('a') && setOpen(false));
    document.addEventListener('click', (event) => !header.contains(event.target) && setOpen(false));
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && isOpen()) {
            setOpen(false);
            toggle.focus();
        }
    });
    window.matchMedia('(min-width: 1000px)').addEventListener('change', (e) => e.matches && setOpen(false));

    // Subtle border once the page has scrolled (passive listener: never blocks scrolling)
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    initScrollSpy($$('a[href^="#"]', nav));
}

/** Marks the nav link of the section currently in view with aria-current. */
function initScrollSpy(links) {
    if (!('IntersectionObserver' in window)) return;

    const linkById = new Map(links.map((link) => [link.hash.slice(1), link]));
    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                linkById.forEach((link) => link.removeAttribute('aria-current'));
                // Sections without a nav link (carousel, booking) simply clear the highlight
                linkById.get(entry.target.id)?.setAttribute('aria-current', 'true');
            }
        },
        { rootMargin: '-40% 0px -55% 0px' },
    );

    for (const section of $$('main > section[id]')) observer.observe(section);
}

/* ---------- 8. Reveal-on-scroll ---------- */
function createRevealObserver() {
    if (!('IntersectionObserver' in window)) {
        return { observe: (el) => el.classList.add('is-visible') };
    }
    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            }
        },
        { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    );
    return { observe: (el) => observer.observe(el) };
}

/* ---------- 9. Featured 3D carousel ---------- */
/**
 * Cover-flow carousel. Every slide gets two CSS variables – --d (signed distance from the
 * active slide) and --abs – and style.css turns them into translate/rotate/scale. This file
 * therefore only decides *which* slide is active; the look stays in the stylesheet.
 */
function createCarousel(items, { onOpen }) {
    const box = $('#carousel-box');
    const stage = $('#carousel');
    const track = $('#carousel-track');
    const caption = $('#carousel-caption');
    const dotsHost = $('#carousel-dots');
    const total = items.length;
    let active = 0;

    const slides = items.map((item, index) => {
        const button = h(
            'button',
            { type: 'button', dataset: { index: String(index) } },
            createImage({
                src: resizedUrl(item.image.src, 480),
                srcset: imageSrcset(item.image.src),
                sizes: '235px',
                alt: item.image.alt ?? item.name,
                width: 235,
                height: 320,
                loading: 'lazy',
                decoding: 'async',
                draggable: 'false',
            }),
        );
        const li = h(
            'li',
            { class: 'carousel__item', role: 'group', 'aria-roledescription': 'شريحة', 'aria-label': `${index + 1} من ${total}` },
            button,
        );
        return { li, button, d: 0 };
    });
    track.replaceChildren(...slides.map((slide) => slide.li));

    const dots = items.map((item, index) =>
        h('button', { class: 'carousel__dot', type: 'button', 'aria-label': `الانتقال إلى ${item.name}`, dataset: { index: String(index) } }),
    );
    dotsHost.replaceChildren(...dots);

    /** Shortest signed distance from the active slide to slide i on the ring. */
    function offset(i) {
        let d = i - active;
        if (d > total / 2) d -= total;
        else if (d < -total / 2) d += total;
        return d;
    }

    function render() {
        slides.forEach((slide, i) => {
            const d = offset(i);
            const abs = Math.abs(d);
            const isActive = d === 0;

            // A slide wrapping from one end of the ring to the other must not sweep across the stage
            if (Math.abs(d - slide.d) > 2 && (abs >= 3 || Math.abs(slide.d) >= 3)) {
                slide.li.classList.add('is-jumping');
                requestAnimationFrame(() => requestAnimationFrame(() => slide.li.classList.remove('is-jumping')));
            }
            slide.d = d;

            slide.li.style.setProperty('--d', String(d));
            slide.li.style.setProperty('--abs', String(abs));
            slide.li.dataset.abs = String(Math.min(abs, 4));

            slide.button.tabIndex = isActive ? 0 : -1; // roving tabindex: arrows move between slides
            slide.button.setAttribute('aria-label', `${isActive ? 'فتح تفاصيل' : 'عرض'} ${items[i].name}`);
            if (isActive) slide.button.setAttribute('aria-current', 'true');
            else slide.button.removeAttribute('aria-current');
        });

        dots.forEach((dot, i) => dot.setAttribute('aria-current', String(i === active)));
        caption.replaceChildren(h('strong', {}, items[active].name), h('span', {}, items[active].era ?? ''));
    }

    function goTo(next, { focus = false } = {}) {
        active = ((next % total) + total) % total;
        render();
        if (focus) slides[active].button.focus({ preventScroll: true });
    }

    /* Buttons, dots and slides */
    $('#carousel-prev').addEventListener('click', () => goTo(active - 1));
    $('#carousel-next').addEventListener('click', () => goTo(active + 1));
    dotsHost.addEventListener('click', (event) => {
        const dot = event.target.closest('[data-index]');
        if (dot) goTo(Number(dot.dataset.index));
    });
    track.addEventListener('click', (event) => {
        const button = event.target.closest('[data-index]');
        if (!button) return;
        const index = Number(button.dataset.index);
        if (index === active) onOpen(items[index], button);
        else goTo(index, { focus: true });
    });

    /* Keyboard: in RTL the next slide sits on the left, so ArrowLeft = next */
    stage.addEventListener('keydown', (event) => {
        const step = { ArrowLeft: isRtl() ? 1 : -1, ArrowRight: isRtl() ? -1 : 1 }[event.key];
        if (step) goTo(active + step, { focus: true });
        else if (event.key === 'Home') goTo(0, { focus: true });
        else if (event.key === 'End') goTo(total - 1, { focus: true });
        else return;
        event.preventDefault();
    });

    /* Swipe / drag */
    let startX = null;
    let dragged = false;
    stage.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        startX = event.clientX;
        dragged = false;
    });
    stage.addEventListener('pointermove', (event) => {
        if (startX == null) return;
        const dx = event.clientX - startX;
        if (Math.abs(dx) < 48) return;
        // Dragging right pulls the slide waiting on the left (the next one in RTL) to the centre
        goTo(active + (dx > 0 === isRtl() ? 1 : -1));
        startX = event.clientX;
        dragged = true;
    });
    const endDrag = () => (startX = null);
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    stage.addEventListener('pointerleave', endDrag);
    // A drag must not also count as a click on the slide under the pointer
    stage.addEventListener(
        'click',
        (event) => {
            if (!dragged) return;
            event.stopPropagation();
            event.preventDefault();
            dragged = false;
        },
        true,
    );

    render();
    box.removeAttribute('aria-busy');
    $('.carousel__skeleton', box)?.remove();
}

/* ---------- 10. Exhibitions grid + hall modal ---------- */
function createExhibitionCard(exhibition, index) {
    const titleId = `exhibition-title-${exhibition.id}`;
    const { url, alt } = exhibition.image;
    const srcset = imageSrcset(url);

    const image = createImage({
        src: resizedUrl(url, 800),
        srcset,
        sizes: srcset ? '(min-width: 900px) 33vw, (min-width: 640px) 50vw, 100vw' : null,
        alt,
        width: 600,
        height: 450,
        loading: 'lazy',
        decoding: 'async',
    });

    const card = h(
        'article',
        { class: 'card', 'aria-labelledby': titleId, dataset: { id: exhibition.id } },
        h('div', { class: 'card__media' }, image),
        h(
            'div',
            { class: 'card__body' },
            h('p', { class: 'card__hall' }, exhibition.hall),
            h('h3', { class: 'card__title', id: titleId }, exhibition.title),
            h('p', { class: 'card__desc' }, exhibition.summary),
            h(
                'button',
                { class: 'btn-link', type: 'button', 'aria-haspopup': 'dialog' },
                h('span', {}, 'تفاصيل أكثر'),
                h('span', { class: 'visually-hidden' }, ` عن ${exhibition.title}`),
                h('span', { class: 'btn-link__arrow', 'aria-hidden': 'true' }, '←'),
            ),
        ),
    );

    const item = h('li', { class: 'reveal' }, card);
    item.style.setProperty('--i', String(index)); // stagger the one-time reveal
    return item;
}

function renderExhibitions(grid, exhibitions, reveal) {
    const items = exhibitions.map(createExhibitionCard);
    grid.replaceChildren(...items);
    grid.setAttribute('aria-busy', 'false');
    items.forEach((item) => reveal.observe(item));
}

function createHallModal({ exhibitions, lightbox, onBook }) {
    const dialog = $('#exhibition-modal');
    const controller = bindDialog(dialog);
    const ui = {
        image: withImageFallback($('#modal-image')),
        zoom: $('#modal-zoom'),
        hall: $('#modal-hall'),
        title: $('#modal-title'),
        description: $('#modal-desc'),
        dates: $('#modal-dates'),
        duration: $('#modal-duration'),
        highlights: $('#modal-highlights'),
    };

    let index = 0;

    function show(animate) {
        const exhibition = exhibitions[index];
        const { url, alt } = exhibition.image;
        setImageSource(ui.image, url, { width: 1000, sizes: '(min-width: 780px) 40vw, 100vw' });
        ui.image.alt = alt;

        ui.hall.textContent = exhibition.hall;
        ui.title.textContent = exhibition.title;
        ui.description.textContent = exhibition.description ?? exhibition.summary;
        ui.dates.textContent = exhibition.dates ?? '—';
        ui.duration.textContent = exhibition.duration ?? '—';
        ui.highlights.replaceChildren(...(exhibition.highlights ?? []).map((text) => h('li', {}, text)));
        pager.update(index, exhibitions.length);

        if (animate) {
            flash($('.modal__media', dialog));
            flash($('.modal__body', dialog));
        }
    }

    const step = (delta) => {
        index = (index + delta + exhibitions.length) % exhibitions.length;
        show(true);
    };
    const pager = createPager({ prev: $('#modal-prev'), next: $('#modal-next'), count: $('#modal-count'), onStep: step });
    bindArrowKeys(dialog, step);

    ui.zoom.addEventListener('click', () => {
        const { url, alt, title } = { ...exhibitions[index].image, title: exhibitions[index].title };
        lightbox.open({ src: resizedUrl(url, 1800), alt, caption: title }, ui.zoom);
    });

    $('#modal-book').addEventListener('click', () => {
        const exhibition = exhibitions[index];
        controller.forgetOpener(); // the booking form takes focus instead of the card button
        controller.close();
        onBook(exhibition);
    });

    return {
        open(exhibition, openerElement) {
            index = Math.max(0, exhibitions.indexOf(exhibition));
            show(false);
            controller.open(openerElement);
        },
    };
}

/* ---------- 11. Treasures gallery (search + category filter) ---------- */
function createArtifactCard(item, index) {
    const srcset = imageSrcset(item.image.src);
    const titleId = `artifact-title-${item.id}`;

    const card = h(
        'article',
        { class: 'card', 'aria-labelledby': titleId, dataset: { id: item.id } },
        h(
            'div',
            { class: 'card__media' },
            createImage({
                src: resizedUrl(item.image.src, 800),
                srcset,
                sizes: srcset ? '(min-width: 900px) 33vw, (min-width: 640px) 50vw, 100vw' : null,
                alt: item.image.alt ?? item.name,
                width: 600,
                height: 450,
                loading: 'lazy',
                decoding: 'async',
            }),
        ),
        h(
            'div',
            { class: 'card__body' },
            h('p', { class: 'card__hall' }, item.id),
            h('h3', { class: 'card__title', id: titleId }, item.name),
            h('p', { class: 'card__desc' }, item.era ?? ''),
            h(
                'button',
                { class: 'btn-link', type: 'button', 'aria-haspopup': 'dialog' },
                h('span', {}, 'عرض القطعة'),
                h('span', { class: 'visually-hidden' }, ` ${item.name}`),
                h('span', { class: 'btn-link__arrow', 'aria-hidden': 'true' }, '←'),
            ),
        ),
    );

    const li = h('li', { class: 'reveal' }, card);
    li.style.setProperty('--i', String(Math.min(index, 6))); // cap the stagger on long lists
    return li;
}

function createGallery(items, categories, { reveal, onOpen }) {
    const grid = $('#treasure-grid');
    const search = $('#searchInput');
    const pills = $('#filterButtonsContainer');
    const status = $('#treasure-status');
    const empty = $('#treasure-empty');
    const categoryLabel = new Map(categories.map((c) => [c.id, c.label]));

    let query = '';
    let category = 'all';
    let results = items;

    // Pre-normalised search text per item, so typing never re-processes the whole catalogue
    const indexed = items.map((item) => ({
        item,
        text: normalizeText([item.id, item.name, item.era, item.material, item.origin, categoryLabel.get(item.category)].join(' ')),
    }));

    /* Filter pills: the "all" button exists in the HTML, the rest come from the data */
    setPillLabel($('[data-filter="all"]', pills), `الكل (${items.length})`);
    pills.append(
        ...categories.map((c) => {
            const pill = h('button', { class: 't-filter-btn', type: 'button', 'aria-pressed': 'false', dataset: { filter: c.id } });
            setPillLabel(pill, c.label);
            return pill;
        }),
    );

    function render() {
        const terms = normalizeText(query).split(/\s+/).filter(Boolean);
        results = indexed
            .filter(({ item, text }) => (category === 'all' || item.category === category) && terms.every((term) => text.includes(term)))
            .map(({ item }) => item);

        grid.replaceChildren(...results.map(createArtifactCard));
        $$('.reveal', grid).forEach((el) => reveal.observe(el));
        grid.setAttribute('aria-busy', 'false');
        grid.hidden = results.length === 0;
        empty.hidden = results.length > 0;
        status.textContent = results.length ? `${results.length} قطعة معروضة` : 'لا توجد نتائج';
    }

    function reset() {
        query = '';
        category = 'all';
        search.value = '';
        setActivePill(pills, 'data-filter', 'all');
        render();
    }

    search.addEventListener(
        'input',
        debounce(() => {
            query = search.value;
            render();
        }, CONFIG.searchDebounceMs),
    );
    pills.addEventListener('click', (event) => {
        const pill = event.target.closest('[data-filter]');
        if (!pill) return;
        category = pill.dataset.filter;
        setActivePill(pills, 'data-filter', category);
        render();
    });
    $('#treasure-reset').addEventListener('click', () => {
        reset();
        search.focus();
    });

    grid.addEventListener('click', (event) => {
        const card = event.target.closest('.card[data-id]');
        const item = card && items.find((entry) => entry.id === card.dataset.id);
        if (item) onOpen(item, $('button', card), results);
    });

    render();
}

/* ---------- 12. Artifact modal ---------- */
function createArtifactModal({ categories, statuses, lightbox, onBook }) {
    const dialog = $('#artifact-modal');
    const controller = bindDialog(dialog);
    const ui = {
        image: withImageFallback($('#artifact-image')),
        zoom: $('#artifact-zoom'),
        code: $('#artifact-code'),
        title: $('#artifact-title'),
        description: $('#artifact-desc'),
        specs: $('#artifact-specs'),
    };
    const categoryLabel = new Map(categories.map((c) => [c.id, c.label]));
    const statusLabel = new Map(statuses.map((s) => [s.id, s.label]));

    let list = [];
    let index = 0;

    function show(animate) {
        const item = list[index];
        setImageSource(ui.image, item.image.src, { width: 1000, sizes: '(min-width: 780px) 40vw, 100vw' });
        ui.image.alt = item.image.alt ?? item.name;

        ui.code.textContent = item.id;
        ui.title.textContent = item.name;
        ui.description.textContent = item.description ?? '';

        const rows = [
            ['الفئة', categoryLabel.get(item.category)],
            ['الحقبة', item.era],
            ['المادة', item.material],
            ['المصدر', item.origin],
            ['حالة العرض', statusLabel.get(item.status)],
        ].filter(([, value]) => value);
        ui.specs.replaceChildren(...rows.map(([label, value]) => h('div', {}, h('dt', {}, label), h('dd', {}, value))));
        pager.update(index, list.length);

        if (animate) {
            flash($('.modal__media', dialog));
            flash($('.modal__body', dialog));
        }
    }

    const step = (delta) => {
        index = (index + delta + list.length) % list.length;
        show(true);
    };
    const pager = createPager({ prev: $('#artifact-prev'), next: $('#artifact-next'), count: $('#artifact-count'), onStep: step });
    bindArrowKeys(dialog, step);

    ui.zoom.addEventListener('click', () => {
        const item = list[index];
        lightbox.open({ src: resizedUrl(item.image.src, 1800), alt: item.image.alt ?? item.name, caption: item.name }, ui.zoom);
    });

    $('#artifact-book').addEventListener('click', (event) => {
        event.preventDefault(); // the href is only a no-JavaScript fallback
        controller.forgetOpener();
        controller.close();
        onBook();
    });

    return {
        /** `context` is the list the visitor was browsing, so previous / next stay inside it. */
        open(item, openerElement, context = [item]) {
            list = context.includes(item) ? context : [item];
            index = list.indexOf(item);
            show(false);
            controller.open(openerElement);
        },
    };
}

/* ---------- 13. Registry table (sort + status filter) ---------- */
function createRegistry(items, statuses, { onOpen }) {
    const body = $('#table-body');
    const table = $('.data-table');
    const count = $('#table-status');
    const pills = $('#statusFilters');
    const headers = $$('[data-sort]');
    const statusLabel = new Map(statuses.map((s) => [s.id, s.label]));
    const collator = new Intl.Collator('ar', { numeric: true });
    const sortKeys = {
        id: (item) => item.id,
        name: (item) => item.name,
        material: (item) => item.material ?? '',
        status: (item) => statusLabel.get(item.status) ?? item.status,
    };

    let sort = { key: null, direction: 'asc' };
    let status = 'all';
    let rows = items;

    setPillLabel($('[data-status="all"]', pills), 'الكل');
    pills.append(
        ...statuses.map((s) => {
            const pill = h('button', { class: 't-filter-btn', type: 'button', 'aria-pressed': 'false', dataset: { status: s.id } });
            setPillLabel(pill, s.label);
            return pill;
        }),
    );

    function createRow(item) {
        const label = statusLabel.get(item.status) ?? item.status;
        return h(
            'div',
            { class: 'table-row', role: 'row', dataset: { id: item.id } },
            h('div', { class: 'td-item cell-code', role: 'cell', dataset: { col: 'id' } }, item.id),
            h(
                'div',
                { class: 'td-item', role: 'cell', dataset: { col: 'preview' } },
                createImage({ class: 'table-thumb', src: resizedUrl(item.image.src, 128), alt: '', width: 45, height: 45, loading: 'lazy', decoding: 'async' }),
            ),
            h(
                'div',
                { class: 'td-item', role: 'cell', dataset: { col: 'name' } },
                h('span', { class: 'cell-title' }, item.name),
                h('span', { class: 'cell-sub' }, item.era ?? ''),
            ),
            h(
                'div',
                { class: 'td-item', role: 'cell', dataset: { col: 'material' } },
                h('span', { class: 'cell-line' }, item.material ?? ''),
                h('span', { class: 'cell-sub' }, item.origin ?? ''),
            ),
            h('div', { class: 'td-item', role: 'cell', dataset: { col: 'status' } }, h('span', { class: `badge-status badge-status--${item.status}` }, label)),
            h(
                'div',
                { class: 'td-item', role: 'cell', dataset: { col: 'actions' } },
                h('button', { class: 'action-btn', type: 'button', 'aria-haspopup': 'dialog', 'aria-label': `معاينة القطعة: ${item.name}` }, 'معاينة القطعة'),
            ),
        );
    }

    function render() {
        rows = status === 'all' ? [...items] : items.filter((item) => item.status === status);
        if (sort.key) {
            const read = sortKeys[sort.key];
            const sign = sort.direction === 'asc' ? 1 : -1;
            rows.sort((a, b) => collator.compare(read(a), read(b)) * sign);
        }

        body.replaceChildren(...(rows.length ? rows.map(createRow) : [h('p', { class: 'notice', role: 'row' }, 'لا توجد قطع بهذه الحالة.')]));
        table.setAttribute('aria-busy', 'false');
        count.textContent = `عرض ${rows.length} من ${items.length} قطعة`;

        for (const button of headers) {
            const header = button.closest('[role="columnheader"]');
            header.setAttribute('aria-sort', sort.key === button.dataset.sort ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none');
        }
    }

    // Sort cycle per column: ascending → descending → original order
    $('.table-header-grid', table).addEventListener('click', (event) => {
        const button = event.target.closest('[data-sort]');
        if (!button) return;
        const key = button.dataset.sort;
        if (sort.key !== key) sort = { key, direction: 'asc' };
        else if (sort.direction === 'asc') sort = { key, direction: 'desc' };
        else sort = { key: null, direction: 'asc' };
        render();
    });

    pills.addEventListener('click', (event) => {
        const pill = event.target.closest('[data-status]');
        if (!pill) return;
        status = pill.dataset.status;
        setActivePill(pills, 'data-status', status);
        render();
    });

    body.addEventListener('click', (event) => {
        const row = event.target.closest('.table-row[data-id]');
        const item = row && items.find((entry) => entry.id === row.dataset.id);
        if (item) onOpen(item, $('.action-btn', row), rows);
    });

    render();
}

/* ---------- 14. Booking form ---------- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[\d\s()-]{7,20}$/;

function createBooking({ museum, ticketTypes, exhibitions }) {
    const form = $('#booking-form');
    const select = form.elements.exhibitionId;
    const dateInput = form.elements.visitDate;
    const ticketRows = $('#ticket-rows');
    const summaryLines = $('#summary-lines');
    const summaryTotal = $('#summary-total');
    const submitButton = $('#submit-btn');
    const formStatus = $('#form-status');
    const successPanel = $('#booking-success');
    const maxTickets = museum.maxTicketsPerBooking ?? 10;
    const maxDate = new Date(startOfToday().getTime() + CONFIG.bookingWindowDays * 86_400_000);

    let submitting = false;

    /* ----- Build dynamic controls ----- */
    select.replaceChildren(
        h('option', { value: 'all' }, 'جميع المعارض'),
        ...exhibitions.map((e) => h('option', { value: e.id }, `${e.title} (${e.hall})`)),
    );

    dateInput.min = toISODate(startOfToday());
    dateInput.max = toISODate(maxDate);

    const qtyInput = (type) => form.elements[`qty-${type.id}`];

    ticketRows.replaceChildren(
        ...ticketTypes.map((type) => {
            const inputId = `qty-${type.id}`;
            return h(
                'div',
                { class: 'ticket-row' },
                h(
                    'label',
                    { class: 'ticket-row__label', for: inputId },
                    h('span', {}, type.label),
                    h('small', {}, type.hint),
                    h('small', {}, fmt.price(type.price, museum.currency)),
                ),
                h(
                    'div',
                    { class: 'stepper' },
                    h('button', { type: 'button', 'aria-label': `تقليل عدد تذاكر ${type.label}`, dataset: { step: '-1', target: inputId } }, '−'),
                    h('input', {
                        id: inputId,
                        name: inputId,
                        type: 'number',
                        min: 0,
                        max: maxTickets,
                        value: 0,
                        inputmode: 'numeric',
                        dataset: { ticket: type.id },
                    }),
                    h('button', { type: 'button', 'aria-label': `زيادة عدد تذاكر ${type.label}`, dataset: { step: '1', target: inputId } }, '+'),
                ),
            );
        }),
    );

    /* ----- Quantities & summary ----- */
    const quantity = (type) => Math.max(0, Math.trunc(Number(qtyInput(type).value)) || 0);
    const totalQuantity = () => ticketTypes.reduce((sum, type) => sum + quantity(type), 0);
    const totalPrice = () => ticketTypes.reduce((sum, type) => sum + quantity(type) * type.price, 0);
    const typeByInputId = (id) => ticketTypes.find((t) => `qty-${t.id}` === id);

    function setQuantity(type, value) {
        const othersTotal = totalQuantity() - quantity(type);
        const allowed = Math.max(0, maxTickets - othersTotal);
        qtyInput(type).value = Math.min(Math.max(0, Math.trunc(value) || 0), allowed);
        renderSummary();
    }

    function renderSummary() {
        const selected = ticketTypes.filter((type) => quantity(type) > 0);

        summaryLines.replaceChildren(
            ...(selected.length
                ? selected.map((type) =>
                    h('li', {}, h('span', {}, `${quantity(type)} × ${type.label}`), h('span', {}, fmt.price(quantity(type) * type.price, museum.currency))))
                : [h('li', {}, 'لم تحدد أي تذاكر بعد.')]),
        );
        summaryTotal.textContent = selected.length ? fmt.price(totalPrice(), museum.currency) : '—';

        // Stepper buttons: can't go below 0 or above the per-booking limit
        const atLimit = totalQuantity() >= maxTickets;
        for (const button of $$('[data-step]', ticketRows)) {
            const type = typeByInputId(button.dataset.target);
            button.disabled = button.dataset.step === '-1' ? quantity(type) === 0 : atLimit;
        }
    }

    ticketRows.addEventListener('click', (event) => {
        const button = event.target.closest('[data-step]');
        if (!button) return;
        const type = typeByInputId(button.dataset.target);
        setQuantity(type, quantity(type) + Number(button.dataset.step));
        if ($('#tickets-fieldset').classList.contains('is-invalid')) setError('tickets', validateTickets());
    });
    ticketRows.addEventListener('input', renderSummary);
    ticketRows.addEventListener('change', (event) => {
        const type = typeByInputId(event.target.id);
        if (type) setQuantity(type, Number(event.target.value));
        if ($('#tickets-fieldset').classList.contains('is-invalid')) setError('tickets', validateTickets());
    });

    /* ----- Validation ----- */
    const rules = {
        fullName: (v) => (v.trim().length >= 3 ? '' : 'أدخل اسمك الكامل (3 أحرف على الأقل).'),
        email: (v) => {
            if (!v.trim()) return 'أدخل بريدك الإلكتروني.';
            return EMAIL_RE.test(v.trim()) ? '' : 'صيغة البريد غير صحيحة. مثال: name@example.com';
        },
        phone: (v) => (!v.trim() || PHONE_RE.test(v.trim()) ? '' : 'استخدم أرقاماً فقط، ويمكن أن يبدأ الرقم بعلامة +.'),
        visitDate: (v) => {
            if (!v) return 'اختر تاريخ الزيارة.';
            const date = parseISODate(v);
            if (!date) return 'التاريخ غير صحيح. اختر تاريخاً من التقويم.';
            if (date < startOfToday()) return 'اختر تاريخاً من اليوم فصاعداً.';
            if (date > maxDate) return `الحجز متاح حتى ${fmt.date(maxDate)}.`;
            if (museum.closedDays?.includes(date.getDay())) return `المتحف مغلق يوم ${fmt.weekday(date)}. اختر يوماً آخر.`;
            return '';
        },
    };

    function validateTickets() {
        const total = totalQuantity();
        if (total === 0) return 'اختر تذكرة واحدة على الأقل.';
        if (total > maxTickets) return `الحد الأقصى ${maxTickets} تذاكر في الحجز الواحد.`;
        return '';
    }

    function setError(name, message) {
        const errorNode = $(`#${name}-error`);
        const container = errorNode.closest('.field, .fieldset');
        errorNode.textContent = message;
        errorNode.hidden = !message;
        container.classList.toggle('is-invalid', Boolean(message));
        if (name !== 'tickets') form.elements[name].setAttribute('aria-invalid', String(Boolean(message)));
    }

    /** Validates everything; returns the first invalid control (or null). */
    function validateAll() {
        let firstInvalid = null;
        for (const name of Object.keys(rules)) {
            const message = rules[name](form.elements[name].value);
            setError(name, message);
            if (message && !firstInvalid) firstInvalid = form.elements[name];
        }
        const ticketsMessage = validateTickets();
        setError('tickets', ticketsMessage);
        if (ticketsMessage && !firstInvalid) firstInvalid = qtyInput(ticketTypes[0]);
        return firstInvalid;
    }

    // Validate a field when the user leaves it; once it is invalid, re-check while they fix it.
    form.addEventListener('focusout', (event) => {
        const name = event.target.name;
        if (rules[name]) setError(name, rules[name](event.target.value));
    });
    const recheck = (event) => {
        const name = event.target.name;
        if (rules[name] && event.target.closest('.field')?.classList.contains('is-invalid')) {
            setError(name, rules[name](event.target.value));
        }
    };
    form.addEventListener('input', recheck);
    form.addEventListener('change', recheck);

    /* ----- Submit ----- */
    function setBusy(busy) {
        submitting = busy;
        submitButton.setAttribute('aria-busy', String(busy));
        submitButton.textContent = busy ? 'جارٍ إرسال الحجز…' : 'تأكيد الحجز';
    }

    function buildPayload() {
        return {
            fullName: form.elements.fullName.value.trim(),
            email: form.elements.email.value.trim(),
            phone: form.elements.phone.value.trim(),
            exhibitionId: select.value,
            visitDate: dateInput.value,
            tickets: Object.fromEntries(ticketTypes.map((type) => [type.id, quantity(type)])),
            // Informational only: the server must price the order itself.
            total: totalPrice(),
            currency: museum.currency,
        };
    }

    function showSuccess(payload, reference) {
        const exhibitionTitle = exhibitions.find((e) => e.id === payload.exhibitionId)?.title ?? 'جميع المعارض';
        const ticketsText = ticketTypes
            .filter((type) => payload.tickets[type.id] > 0)
            .map((type) => `${payload.tickets[type.id]} ${type.label}`)
            .join('، ');

        const details = [
            ['رقم الحجز', reference],
            ['الاسم', payload.fullName],
            ['المعرض', exhibitionTitle],
            ['تاريخ الزيارة', fmt.date(parseISODate(payload.visitDate))],
            ['التذاكر', ticketsText],
            ['المجموع', fmt.price(payload.total, payload.currency)],
        ];
        $('#success-details').replaceChildren(...details.map(([label, value]) => h('div', {}, h('dt', {}, label), h('dd', {}, value))));

        form.hidden = true;
        successPanel.hidden = false;
        successPanel.focus();
        successPanel.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (submitting) return;

        formStatus.hidden = true;
        const firstInvalid = validateAll();
        if (firstInvalid) {
            firstInvalid.focus(); // screen readers announce the field plus its error message
            return;
        }

        const payload = buildPayload();

        // Honeypot filled in = bot. Pretend it worked, send nothing.
        if (form.elements.website.value) {
            showSuccess(payload, 'LZ-000000');
            return;
        }

        setBusy(true);
        try {
            const { reference } = await submitReservation(payload);
            showSuccess(payload, reference);
        } catch (error) {
            console.error('[museum] reservation failed:', error);
            formStatus.textContent = 'تعذّر إرسال الحجز. تحقق من اتصالك بالإنترنت ثم اضغط «تأكيد الحجز» مرة أخرى.';
            formStatus.hidden = false;
        } finally {
            setBusy(false);
        }
    });

    /* ----- Reset / public API ----- */
    function showForm() {
        successPanel.hidden = true;
        form.hidden = false;
    }

    $('#new-booking-btn').addEventListener('click', () => {
        form.reset();
        for (const name of [...Object.keys(rules), 'tickets']) setError(name, '');
        renderSummary();
        showForm();
        form.elements.fullName.focus();
    });

    renderSummary();

    return {
        /** Called by the hall modal: choose that exhibition in the form. */
        preselect(exhibitionId) {
            showForm();
            if ([...select.options].some((option) => option.value === exhibitionId)) select.value = exhibitionId;
        },
    };
}

/* ---------- 15. Bootstrap ---------- */
/** Scrolls to the booking section and moves keyboard focus into the form. */
function goToBooking({ focusForm = true } = {}) {
    $('#tickets').scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    history.replaceState(null, '', '#tickets');
    if (focusForm && !$('#booking-root').hidden) $('#fullName').focus({ preventScroll: true });
}

/** Exhibitions, hall modal and booking form: they all depend on data/exhibitions.json. */
async function initExhibitions({ reveal, lightbox }) {
    const grid = $('#exhibition-grid');
    const status = $('#booking-status');

    let data;
    try {
        data = await loadExhibitionData();
    } catch (error) {
        console.error('[museum] could not load exhibitions:', error);
        const retry = () => {
            grid.setAttribute('aria-busy', 'true');
            status.hidden = false;
            status.textContent = 'جارٍ تحميل خيارات الحجز…';
            initExhibitions({ reveal, lightbox });
        };
        grid.setAttribute('aria-busy', 'false');
        showLoadError(grid, 'تعذّر تحميل المعارض. تحقق من الاتصال بالإنترنت ثم أعد المحاولة.', retry, 'li');
        status.textContent = 'تعذّر تحميل خيارات الحجز. أعد تحميل المعارض لإظهار النموذج.';
        return;
    }

    bindMuseumInfo(data.museum);

    const booking = createBooking(data);
    const modal = createHallModal({
        exhibitions: data.exhibitions,
        lightbox,
        onBook(exhibition) {
            booking.preselect(exhibition.id);
            goToBooking();
        },
    });

    renderExhibitions(grid, data.exhibitions, reveal);

    // One delegated listener instead of one per card; the whole card is clickable
    grid.addEventListener('click', (event) => {
        const card = event.target.closest('.card[data-id]');
        const exhibition = card && data.exhibitions.find((e) => e.id === card.dataset.id);
        if (exhibition) modal.open(exhibition, $('button', card));
    });

    status.hidden = true;
    $('#booking-root').hidden = false;
}

/** Carousel, gallery, registry table and the artifact dialog: they all depend on data/collection.json. */
async function initCollection({ reveal, lightbox }) {
    const retry = () => {
        $('#featured').hidden = false;
        $('#treasure-grid').setAttribute('aria-busy', 'true');
        initCollection({ reveal, lightbox });
    };

    let data;
    try {
        data = await loadCollectionData();
    } catch (error) {
        console.error('[museum] could not load the collection:', error);
        $('#featured').hidden = true;
        $('#treasure-grid').setAttribute('aria-busy', 'false');
        showLoadError($('#treasure-grid'), 'تعذّر تحميل المقتنيات. تحقق من الاتصال بالإنترنت ثم أعد المحاولة.', retry, 'li');
        showLoadError($('#table-body'), 'تعذّر تحميل سجل المقتنيات.', retry);
        return;
    }

    const { items, categories, statuses } = data;
    if (!items.length) return;

    const artifactModal = createArtifactModal({ categories, statuses, lightbox, onBook: () => goToBooking() });
    const open = (item, opener, context) => artifactModal.open(item, opener, context);

    createCarousel(items, { onOpen: (item, opener) => open(item, opener, items) });
    createGallery(items, categories, { reveal, onOpen: open });
    createRegistry(items, statuses, { onOpen: open });
}

function init() {
    $('#year').textContent = new Date().getFullYear();

    const reveal = createRevealObserver();
    $$('.reveal').forEach((el) => reveal.observe(el));

    initHeader();

    const lightbox = createLightbox();
    initExhibitions({ reveal, lightbox }).catch((error) => console.error('[museum] exhibitions failed:', error));
    initCollection({ reveal, lightbox }).catch((error) => console.error('[museum] collection failed:', error));
}

/* ==========================================================================
   MOTION UPGRADE  (appended; runs before init() and never touches the HTML source)
   Only CSSOM writes (style.setProperty / classList) – strict-CSP friendly, no libraries.
   ========================================================================== */
function initMotionUpgrade() {
    const root = document.documentElement;
    const reduceMq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fineMq = window.matchMedia('(hover: hover) and (pointer: fine)');
    const raf = window.requestAnimationFrame.bind(window);

    // Let the CSS know AOS really loaded, so its spring overrides can never strand content
    if (window.AOS) root.classList.add('fx-aos');

    /* ---- Archive modal: play an exit animation before the original close function hides it ---- */
    const originalClose = window.closeArchiveModal;
    if (typeof originalClose === 'function') {
        window.closeArchiveModal = function () {
            const modal = document.getElementById('archiveModal');
            if (!modal || reduceMq.matches || modal.classList.contains('fx-closing')) return originalClose();
            modal.classList.add('fx-closing');
            setTimeout(() => {
                originalClose();
                modal.classList.remove('fx-closing');
            }, 260);
        };
    }

    if (reduceMq.matches) return; // everything below is purely decorative motion

    /* ---- AOS stagger: cards in the same grid row cascade; delay is cleared so hover stays instant ---- */
    if (window.AOS) {
        const grid = document.getElementById('treasure-grid');
        if (grid) {
            const cols = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').length);
            grid.querySelectorAll('.treasure-card[data-aos]').forEach((card, i) => {
                card.style.transitionDelay = `${(i % cols) * 90}ms`;
                card.addEventListener(
                    'transitionend',
                    (e) => e.propertyName === 'opacity' && card.style.removeProperty('transition-delay'),
                    { once: false },
                );
            });
        }
    }

    /* ---- Parallax: hero video + exhibition images, one rAF per scroll frame ---- */
    const hero = document.querySelector('.hero');
    const heroBg = hero && hero.querySelector('.hero__bg');
    const heroContent = hero && hero.querySelector('.hero__content');
    const galleryImgs = Array.from(document.querySelectorAll('.exhibition__image-link img'));
    let heroH = hero ? hero.offsetHeight : 0;
    let heroVisible = true;
    let ticking = false;

    const frame = () => {
        ticking = false;
        const vh = window.innerHeight;
        if (hero && heroVisible) {
            const p = Math.min(Math.max(window.scrollY / (heroH || vh), 0), 1.2);
            if (heroBg) heroBg.style.setProperty('--hero-y', `${(p * heroH * 0.18).toFixed(1)}px`);
            if (heroContent) {
                heroContent.style.setProperty('--hero-cy', `${(p * -42).toFixed(1)}px`);
                heroContent.style.setProperty('--hero-o', Math.max(0, 1 - p * 1.15).toFixed(3));
            }
        }
        // read all rects first, then write (no layout thrash)
        const reads = galleryImgs.map((img) => img.parentElement.getBoundingClientRect());
        galleryImgs.forEach((img, i) => {
            const r = reads[i];
            if (r.bottom < -80 || r.top > vh + 80) return;
            const n = ((r.top + r.height / 2) / vh - 0.5) * 2; // -1 … 1
            img.style.setProperty('--py', `${(n * -16).toFixed(1)}px`);
        });
    };
    const requestFrame = () => {
        if (!ticking) {
            ticking = true;
            raf(frame);
        }
    };
    window.addEventListener('scroll', requestFrame, { passive: true });
    window.addEventListener('resize', () => {
        heroH = hero ? hero.offsetHeight : 0;
        requestFrame();
    });
    if (hero && 'IntersectionObserver' in window) {
        new IntersectionObserver(([entry]) => {
            heroVisible = entry.isIntersecting;
            if (heroBg) heroBg.style.willChange = heroVisible ? 'translate' : 'auto';
        }).observe(hero);
    }
    requestFrame();

    /* ---- 3D tilt (cards, treasure cards, exhibition images) ---- */
    if (fineMq.matches) {
        const SEL = '.card[data-id], .treasure-card, .exhibition__image-link';
        const MAX_DEG = 7;
        let el = null;
        let rect = null;
        let tx = 0;
        let ty = 0;
        let cx = 0;
        let cy = 0;
        let gx = 0;
        let gy = 0;
        let looping = false;

        const loop = () => {
            if (!el) { looping = false; return; }
            // ease toward the pointer so the card feels weighty rather than glued
            cx += (tx - cx) * 0.18;
            cy += (ty - cy) * 0.18;
            const mag = Math.hypot(cx, cy);
            el.style.setProperty('rotate', mag < 0.002 ? '0 0 1 0deg' : `${-cy} ${cx} 0 ${(mag * MAX_DEG * 2).toFixed(2)}deg`);
            // gravitate toward the cursor + move the glare (CSS reads these as `translate`)
            el.style.setProperty('--mgx', `${(cx * 18).toFixed(1)}px`);
            el.style.setProperty('--mgy', `${(cy * 18).toFixed(1)}px`);
            el.style.setProperty('--gx', `${gx.toFixed(1)}px`);
            el.style.setProperty('--gy', `${gy.toFixed(1)}px`);
            raf(loop);
        };
        const leave = () => {
            if (!el) return;
            el.classList.remove('fx-tilting');
            el.style.removeProperty('rotate'); // base rule springs it back to rest
            el.style.removeProperty('--mgx');
            el.style.removeProperty('--mgy');
            el = null;
        };
        document.addEventListener(
            'pointermove',
            (e) => {
                if (e.pointerType !== 'mouse') return;
                const target = e.target.closest ? e.target.closest(SEL) : null;
                if (target !== el) {
                    leave();
                    if (!target) return;
                    el = target;
                    rect = el.getBoundingClientRect(); // measured at rest, before any tilt
                    cx = cy = 0;
                    el.classList.add('fx-tilting');
                    if (!looping) { looping = true; raf(loop); }
                }
                gx = e.clientX - rect.left;
                gy = e.clientY - rect.top;
                tx = Math.min(Math.max((e.clientX - rect.left) / rect.width - 0.5, -0.5), 0.5);
                ty = Math.min(Math.max((e.clientY - rect.top) / rect.height - 0.5, -0.5), 0.5);
            },
            { passive: true },
        );
        document.addEventListener('pointerleave', leave);
        window.addEventListener('scroll', leave, { passive: true }); // cached rect is stale after scrolling
        window.addEventListener('blur', leave);
    }

    /* ---- Table rows: soft highlight follows the pointer ---- */
    let rowRaf = 0;
    document.addEventListener(
        'pointermove',
        (e) => {
            const row = e.target.closest ? e.target.closest('.table-row, .archive-table tbody tr') : null;
            if (!row || rowRaf) return;
            const x = e.clientX;
            rowRaf = raf(() => {
                rowRaf = 0;
                row.style.setProperty('--mx', `${x - row.getBoundingClientRect().left}px`);
            });
        },
        { passive: true },
    );

    /* ---- Button ripple (WAAPI animating registered custom properties; no DOM nodes added) ---- */
    const RIPPLE = '.btn, .btn-detail, .action-btn, .exhibition__btn, .t-filter-btn, .nav--prev, .nav--next, .modal__close, .treasure-close-btn';
    document.addEventListener(
        'pointerdown',
        (e) => {
            const b = e.target.closest ? e.target.closest(RIPPLE) : null;
            if (!b || b.disabled || !b.animate) return;
            const r = b.getBoundingClientRect();
            const x = e.clientX - r.left;
            const y = e.clientY - r.top;
            const reach = Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y));
            b.style.setProperty('--rx', `${x}px`);
            b.style.setProperty('--ry', `${y}px`);
            b.classList.add('fx-rip');
            const anim = b.animate(
                [{ '--rip-r': '0px', '--rip-o': 0.38 }, { '--rip-r': `${reach}px`, '--rip-o': 0 }],
                { duration: 650, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
            );
            const done = () => b.classList.remove('fx-rip');
            anim.onfinish = done;
            anim.oncancel = done;
        },
        { passive: true },
    );
}

try {
    initMotionUpgrade();
} catch (error) {
    console.error('[museum] motion upgrade failed:', error);
}


/* ==========================================================================
   CINEMATIC LAYER  (hero choreography, cursor lighting, magnetism, inertia scroll)
   GSAP + ScrollTrigger + Lenis are loaded as ES modules from jsDelivr (pinned versions).
   If the CDN is unreachable or blocked by CSP, everything above still works and the hero
   falls back to its original CSS entrance.
   ========================================================================== */
const CINE_URLS = {
    gsap: 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/index.js',
    scrollTrigger: 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/ScrollTrigger.js',
    lenis: 'https://cdn.jsdelivr.net/npm/lenis@1.1.20/dist/lenis.mjs',
};

/* --- Library-free: hero cursor parallax + ambient light (rAF lerp, stops when settled) --- */
function initHeroPointer() {
    const hero = document.querySelector('.hero');
    if (!hero || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    let tx = 0, ty = 0, cx = 0, cy = 0; // parallax target / current (-1…1)
    let tgx = 0, tgy = 0, gx = 0, gy = 0; // light target / current (px inside hero)
    let seeded = false;
    let running = false;

    const step = () => {
        cx += (tx - cx) * 0.07;
        cy += (ty - cy) * 0.07;
        gx += (tgx - gx) * 0.12;
        gy += (tgy - gy) * 0.12;
        hero.style.setProperty('--hmx', cx.toFixed(3));
        hero.style.setProperty('--hmy', cy.toFixed(3));
        hero.style.setProperty('--hgx', `${gx.toFixed(1)}px`);
        hero.style.setProperty('--hgy', `${gy.toFixed(1)}px`);
        const settled = Math.abs(tx - cx) + Math.abs(ty - cy) + Math.abs(tgx - gx) + Math.abs(tgy - gy) < 0.01;
        if (settled) { running = false; return; }
        requestAnimationFrame(step);
    };
    const wake = () => { if (!running) { running = true; requestAnimationFrame(step); } };

    hero.addEventListener(
        'pointermove',
        (e) => {
            if (e.pointerType !== 'mouse') return;
            const r = hero.getBoundingClientRect();
            tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
            ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
            tgx = e.clientX - r.left;
            tgy = e.clientY - r.top;
            if (!seeded) { gx = tgx; gy = tgy; seeded = true; }
            wake();
        },
        { passive: true },
    );
    hero.addEventListener('pointerleave', () => { tx = 0; ty = 0; wake(); });
}

/* --- Library-free: magnetic buttons (CSS transitions spring them back) --- */
function initMagneticButtons() {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const SEL = '.btn, .exhibition__btn, .btn-detail, .action-btn, .t-filter-btn, .nav--prev, .nav--next';
    let current = null;
    let queued = false;
    let ex = 0, ey = 0;
    const release = () => {
        if (!current) return;
        current.style.removeProperty('--mgx');
        current.style.removeProperty('--mgy');
        current = null;
    };
    document.addEventListener(
        'pointermove',
        (e) => {
            if (e.pointerType !== 'mouse') return;
            const b = e.target.closest ? e.target.closest(SEL) : null;
            if (b !== current) { release(); current = b; }
            if (!b || b.disabled) return;
            ex = e.clientX;
            ey = e.clientY;
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => {
                queued = false;
                if (!current) return;
                const r = current.getBoundingClientRect();
                const dx = (ex - (r.left + r.width / 2)) * 0.3;
                const dy = (ey - (r.top + r.height / 2)) * 0.3;
                current.style.setProperty('--mgx', `${Math.max(-10, Math.min(10, dx)).toFixed(1)}px`);
                current.style.setProperty('--mgy', `${Math.max(-8, Math.min(8, dy)).toFixed(1)}px`);
            });
        },
        { passive: true },
    );
    document.addEventListener('pointerleave', release);
}

async function initCinematic() {
    const root = document.documentElement;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    initHeroPointer();
    initMagneticButtons();

    // Load the libraries; give up (and restore the CSS entrance) if the CDN is slow or blocked
    let abandoned = false;
    let mods;
    try {
        mods = await Promise.race([
            Promise.all([import(CINE_URLS.gsap), import(CINE_URLS.scrollTrigger), import(CINE_URLS.lenis)]),
            new Promise((_, reject) => setTimeout(() => reject(new Error('CDN timeout')), 2800)),
        ]);
    } catch (error) {
        abandoned = true;
        root.classList.add('fx-hero-fallback');
        console.warn('[museum] cinematic libraries unavailable, using CSS fallback:', error.message);
        return;
    }
    if (abandoned) return;
    const gsap = mods[0].gsap || mods[0].default;
    const ScrollTrigger = mods[1].ScrollTrigger || mods[1].default;
    const Lenis = mods[2].default;
    gsap.registerPlugin(ScrollTrigger);
    root.classList.add('fx-cine');

    /* ---- 1. Hero entrance choreography ----
       Only elements that carry no CSS individual-transform properties are tweened
       (GSAP would otherwise fold `translate`/`scale` into `transform` and break the CSS parallax). */
    const $ = (s) => document.querySelector(s);
    const title = $('.hero__title');
    const lead = $('.hero__lead');
    const actions = $('.hero__actions');
    const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
    if (title) tl.fromTo(title, { opacity: 0, y: 90, scale: 1.08, filter: 'blur(20px)' }, { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', duration: 1.7 }, 0.2);
    if (lead) tl.fromTo(lead, { opacity: 0, y: 50, filter: 'blur(12px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.4 }, 0.55);
    if (actions) tl.fromTo(actions, { opacity: 0, y: 44, scale: 0.82 }, { opacity: 1, y: 0, scale: 1, duration: 1.5, ease: 'elastic.out(1, 0.62)' }, 0.9);
    tl.add(() => gsap.set([title, lead, actions].filter(Boolean), { clearProps: 'filter,transform,willChange' }));

    /* ---- 2. Inertia scrolling (Lenis driven by the GSAP ticker: one rAF loop for everything) ---- */
    let lenis = null;
    if (window.matchMedia('(pointer: fine)').matches) {
        lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, smoothWheel: true, syncTouch: false });
        lenis.on('scroll', ScrollTrigger.update);
        gsap.ticker.add((time) => lenis.raf(time * 1000));
        gsap.ticker.lagSmoothing(0);

        // Modals lock page scroll (html.is-locked / body overflow) – hand scrolling back to the browser
        let stopped = false;
        const syncLock = () => {
            const locked = root.classList.contains('is-locked') || document.body.style.overflow === 'hidden';
            if (locked === stopped) return;
            stopped = locked;
            locked ? lenis.stop() : lenis.start();
        };
        new MutationObserver(syncLock).observe(root, { attributes: true, attributeFilter: ['class'] });
        new MutationObserver(syncLock).observe(document.body, { attributes: true, attributeFilter: ['style'] });

        // In-page anchors and the site's own smooth scrollIntoView() calls glide on Lenis' inertia
        const headerOffset = () => -((document.getElementById('site-header') || {}).offsetHeight || 0);
        const glide = (target) => lenis.scrollTo(target, { offset: headerOffset(), duration: 1.6, easing: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)) });
        document.addEventListener(
            'click',
            (e) => {
                const a = e.target.closest && e.target.closest('a[href^="#"]');
                if (!a || a.classList.contains('skip-link') || a.getAttribute('href').length < 2) return;
                let target = null;
                try { target = document.querySelector(a.getAttribute('href')); } catch { /* invalid selector */ }
                if (!target) return;
                e.preventDefault();
                glide(target);
            },
            true,
        );
        const nativeScrollIntoView = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function (arg) {
            if (arg && typeof arg === 'object' && arg.behavior === 'smooth' && !stopped) return glide(this);
            return nativeScrollIntoView.call(this, arg);
        };
    }

    /* ---- 3. ScrollTrigger: elastic section-heading entrances (AOS-owned blocks are left alone) ---- */
    const targets = Array.from(
        document.querySelectorAll('.showcase__header, .section__head > *, .treasured-header > *, .treasured-search-wrapper, .archive-header > *'),
    ).filter((el) => !el.closest('[data-aos]') && el.getBoundingClientRect().top > window.innerHeight * 0.92);
    if (targets.length) {
        gsap.set(targets, { opacity: 0, y: 64, scale: 0.94 });
        ScrollTrigger.batch(targets, {
            start: 'top 90%',
            once: true,
            batchMax: 4,
            onEnter: (batch) =>
                gsap.to(batch, { opacity: 1, y: 0, scale: 1, duration: 1.6, ease: 'elastic.out(1, 0.72)', stagger: 0.12, clearProps: 'transform,willChange', overwrite: true }),
        });
    }

    // JSON-built sections change the page height after load – keep trigger positions honest
    if ('ResizeObserver' in window) {
        let t = 0;
        new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => ScrollTrigger.refresh(), 250); }).observe(document.body);
    }
}

initCinematic().catch((error) => console.error('[museum] cinematic layer failed:', error));


init();
