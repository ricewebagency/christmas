import { CUSTOM_DISH_DESCRIPTION_MAX_LENGTH, CUSTOM_DISH_NAME_MAX_LENGTH, normalizeCustomDish } from './api-client.js';

// "Your own dish": the last page of the dish carousel in the cabin.

const FIELD_CLASS = 'w-full rounded-none border-0 border-b border-[#1f1d1a]/35 bg-transparent px-0 py-1 text-sm leading-tight text-[#1f1d1a] placeholder:text-[#1f1d1a]/35 transition-colors duration-200 focus:border-[#1f1d1a] focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-40 sm:text-base';
const LABEL_CLASS = 'block space-y-1';
const LABEL_TEXT_CLASS = 'block text-xs leading-none text-[#1f1d1a]/60';

// Same comparison as the API: lower case, no accents, letters and digits only.
export function dishNameKey(value) {
    return String(value ?? '').normalize('NFD').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}

function courseValue(course) {
    return String(course?.course || course?.course_nl || '').trim();
}

function createLabeledField(labelText, field) {
    const label = document.createElement('label');
    label.className = LABEL_CLASS;

    const text = document.createElement('span');
    text.className = LABEL_TEXT_CLASS;
    text.textContent = labelText;

    label.append(text, field);
    return label;
}

function revealable(element, delayMs) {
    element.dataset.reveal = 'true';
    element.style.setProperty('--reveal-delay', `${delayMs}ms`);
    return element;
}

// Carousel page with the form. revealDelayMs: when the page's content starts to appear.
export function createCustomDishPage(courseGroups, revealDelayMs) {
    const page = document.createElement('div');
    page.className = 'w-full shrink-0 basis-full';
    page.dataset.customDish = 'true';

    const content = document.createElement('div');
    content.className = 'space-y-3';

    const heading = revealable(document.createElement('p'), revealDelayMs);
    heading.className = 'text-sm leading-none text-[#1f1d1a] sm:text-base';
    heading.textContent = 'Your own dish';

    const intro = revealable(document.createElement('p'), revealDelayMs + 150);
    intro.className = 'text-xs leading-snug text-[#1f1d1a]/60';
    intro.textContent = 'Bringing something that is not on the menu? Add it here. It counts as one of your dishes.';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = CUSTOM_DISH_NAME_MAX_LENGTH;
    nameInput.autocomplete = 'off';
    nameInput.placeholder = "e.g. Grandma's apple pie";
    nameInput.className = FIELD_CLASS;
    nameInput.dataset.customDishName = 'true';

    const courseSelect = document.createElement('select');
    courseSelect.className = `${FIELD_CLASS} cursor-pointer appearance-none`;
    courseSelect.dataset.customDishCourse = 'true';
    courseSelect.dataset.pop = 'medium';

    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = 'Choose a course…';
    courseSelect.append(placeholderOption);

    (Array.isArray(courseGroups) ? courseGroups : []).forEach((course) => {
        const value = courseValue(course);

        if (!value) {
            return;
        }

        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        courseSelect.append(option);
    });

    const descriptionInput = document.createElement('input');
    descriptionInput.type = 'text';
    descriptionInput.maxLength = CUSTOM_DISH_DESCRIPTION_MAX_LENGTH;
    descriptionInput.autocomplete = 'off';
    descriptionInput.placeholder = 'e.g. vegetarian';
    descriptionInput.className = FIELD_CLASS;
    descriptionInput.dataset.customDishDescription = 'true';

    const nameField = revealable(createLabeledField('Dish', nameInput), revealDelayMs + 300);
    const detailGrid = revealable(document.createElement('div'), revealDelayMs + 450);
    detailGrid.className = 'grid grid-cols-1 gap-3 sm:grid-cols-2';
    detailGrid.append(createLabeledField('Course', courseSelect), createLabeledField('Note (optional)', descriptionInput));

    const hint = document.createElement('p');
    hint.className = 'hidden text-xs leading-snug text-red-900';
    hint.setAttribute('role', 'status');
    hint.dataset.customDishHint = 'true';

    const others = document.createElement('p');
    others.className = 'hidden text-xs leading-snug text-[#1f1d1a]/50';
    others.dataset.customDishOthers = 'true';

    content.append(heading, intro, nameField, detailGrid, hint, others);
    page.append(content);
    return page;
}

// Wires up the form on the page from createCustomDishPage.
// onSelectMenuDish(dishId) => boolean: select a menu dish instead (true when it worked).
export function initCustomDishForm(page, { courseGroups = [], initial = null, onChange = () => {}, onSelectMenuDish = () => false } = {}) {
    const nameInput = page.querySelector('[data-custom-dish-name]');
    const courseSelect = page.querySelector('[data-custom-dish-course]');
    const descriptionInput = page.querySelector('[data-custom-dish-description]');
    const hintEl = page.querySelector('[data-custom-dish-hint]');
    const othersEl = page.querySelector('[data-custom-dish-others]');

    if (!(nameInput instanceof HTMLInputElement) || !(courseSelect instanceof HTMLSelectElement)
        || !(descriptionInput instanceof HTMLInputElement) || !(hintEl instanceof HTMLElement) || !(othersEl instanceof HTMLElement)) {
        return null;
    }

    // Menu dishes by name key (English and Dutch name).
    const menuDishes = new Map();
    (Array.isArray(courseGroups) ? courseGroups : []).forEach((course) => {
        (Array.isArray(course?.dishes) ? course.dishes : []).forEach((dish) => {
            const id = String(dish?.id ?? '').trim();
            const label = String(dish?.name || dish?.name_nl || '').trim();

            [dish?.name, dish?.name_nl].map(dishNameKey).filter(Boolean).forEach((key) => {
                if (id && !menuDishes.has(key)) {
                    menuDishes.set(key, { id, label });
                }
            });
        });
    });

    let otherDishes = [];
    let occupiedIds = new Set();
    let selectedIds = new Set();
    let locked = false;

    const readName = () => nameInput.value.replace(/\s+/g, ' ').trim();
    const menuMatch = () => menuDishes.get(dishNameKey(readName())) ?? null;

    // Course of the saved dish: match on course or course_nl.
    if (initial) {
        const savedCourse = (Array.isArray(courseGroups) ? courseGroups : [])
            .find((course) => [course?.course, course?.course_nl].some((value) => String(value ?? '').trim().toLowerCase() === initial.course.toLowerCase()));

        nameInput.value = initial.name;
        courseSelect.value = savedCourse ? courseValue(savedCourse) : '';
        descriptionInput.value = initial.description ?? '';
    }

    // soft: informative instead of a problem.
    const setHint = (text, { action = null, soft = false } = {}) => {
        hintEl.replaceChildren();
        hintEl.classList.toggle('hidden', !text);
        hintEl.classList.toggle('text-red-900', !soft);
        hintEl.classList.toggle('text-[#1f1d1a]/60', soft);

        if (!text) {
            return;
        }

        hintEl.append(text);

        if (action) {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.pop = 'small';
            button.className = 'ml-1 underline underline-offset-2 transition-colors duration-200 hover:text-[#1f1d1a] focus:outline-none focus-visible:outline-none';
            button.textContent = action.label;
            button.addEventListener('click', action.onClick);
            hintEl.append(button);
        }
    };

    const clear = () => {
        nameInput.value = '';
        courseSelect.value = '';
        descriptionInput.value = '';
    };

    const render = () => {
        const name = readName();
        const match = name ? menuMatch() : null;
        const fieldsDisabled = locked && !name;

        nameInput.disabled = fieldsDisabled;
        courseSelect.disabled = fieldsDisabled;
        descriptionInput.disabled = fieldsDisabled;
        courseSelect.classList.toggle('text-[#1f1d1a]/35', !courseSelect.value);

        if (match) {
            if (selectedIds.has(match.id)) {
                setHint(`${match.label} is on the menu, and you have already selected it.`);
            } else if (occupiedIds.has(match.id)) {
                setHint(`${match.label} is on the menu, and another guest already brings it.`);
            } else {
                setHint(`${match.label} is already on the menu.`, {
                    action: {
                        label: 'Select it instead',
                        onClick: () => {
                            if (onSelectMenuDish(match.id)) {
                                clear();
                                render();
                                onChange();
                            }
                        }
                    }
                });
            }
        } else if (name && !courseSelect.value) {
            setHint('Choose a course for your dish.');
        } else if (name && otherDishes.some((dish) => dishNameKey(dish.name) === dishNameKey(name))) {
            setHint('Another guest is already bringing this. You may of course bring it too.', { soft: true });
        } else if (fieldsDisabled) {
            setHint('Deselect a dish to add one of your own.', { soft: true });
        } else {
            setHint('');
        }

        othersEl.textContent = otherDishes.length
            ? `Others already bring: ${otherDishes.map((dish) => `${dish.name} (${dish.course})`).join(', ')}`
            : '';
        othersEl.classList.toggle('hidden', otherDishes.length === 0);
    };

    [nameInput, descriptionInput].forEach((input) => input.addEventListener('input', () => {
        render();
        onChange();
    }));

    courseSelect.addEventListener('change', () => {
        render();
        onChange();
    });

    render();

    return {
        // Something typed: takes a dish slot.
        hasName: () => readName().length > 0,
        // Typed but not valid (no course, or already on the menu): blocks confirming.
        isBlocking: () => readName().length > 0 && (!courseSelect.value || menuMatch() !== null),
        // { name, course, description } when complete, else null.
        getDish: () => (menuMatch() ? null : normalizeCustomDish({
            name: readName(),
            course: courseSelect.value,
            description: descriptionInput.value
        })),
        setOthers(dishes) {
            otherDishes = Array.isArray(dishes) ? dishes : [];
            render();
        },
        // occupied/selected: menu dish ids; locked: the dish limit is reached without an own dish.
        setMenuState({ occupied = new Set(), selected = new Set(), isLocked = false } = {}) {
            occupiedIds = occupied;
            selectedIds = selected;
            locked = isLocked;
            render();
        }
    };
}
