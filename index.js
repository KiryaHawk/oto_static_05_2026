const DATA_URL = 'open.json';
const GIBDD_PRESET = 'islands#blueIcon';
const EXCLUDED_AUTO_SELECT_CATEGORIES = new Set(['Tm', 'Tb']);
const CATEGORY_ORDER = [
    'L',
    'M1',
    'M2',
    'M3',
    'N1',
    'N2',
    'N3',
    'O1',
    'O2',
    'O3',
    'O4',
    'Tm',
    'Tb'
];
const CATEGORY_ORDER_INDEX = new Map(
    CATEGORY_ORDER.map((category, index) => [category, index])
);
const DESKTOP_MAP_ZOOM_MARGIN = [120, 96, 120, 96];
const MOBILE_MAP_ZOOM_MARGIN = [140, 32, 104, 32];
const DESKTOP_BALLOON_MAX_WIDTH = 360;
const MOBILE_BALLOON_MAX_WIDTH = 300;
const BALLOON_MIN_WIDTH = 220;
const DESKTOP_BALLOON_AUTO_PAN_MARGIN = [132, 116, 132, 116];
const MOBILE_BALLOON_AUTO_PAN_MARGIN = [164, 40, 132, 40];
const MOBILE_MEDIA_QUERY = '(max-width: 640px)';
const WORLD_LONGITUDE_WIDTH = 360;

let currentMinQuantity = 0;
let showGibdd = true;
let selectedCategories = new Set();
let allCategories = [];

if (typeof ymaps !== 'undefined') {
    ymaps.ready(init);
} else {
    showMapStatus('Не удалось загрузить Яндекс.Карты.', 'error');
}

function init() {
    showMapStatus('Загрузка карты...');

    fetch(DATA_URL)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status} ${response.statusText}`);
            }

            return response.json();
        })
        .then(obj => {
            const searchControls = new ymaps.control.SearchControl({
                options: {
                    float: 'right',
                    noPlacemark: true
                }
            });

            const myMap = new ymaps.Map('map', {
                center: [55.76, 37.64],
                zoom: 7,
                controls: [searchControls]
            });

            const removeControls = [
                'geolocationControl',
                'trafficControl',
                'fullscreenControl',
                'zoomControl',
                'rulerControl',
                'typeSelector'
            ];
            removeControls.forEach(ctrl => myMap.controls.remove(ctrl));

            const objectManager = new ymaps.ObjectManager({
                clusterize: true,
                clusterIconLayout: 'default#pieChart',
                zoomMargin: getMapZoomMargin(),
                ...getObjectManagerBalloonOptions()
            });
            syncClusterZoomMarginOnResize(objectManager);

            let minLatitude = Infinity;
            let maxLatitude = -Infinity;
            let minLongitude = Infinity;
            let maxLongitude = -Infinity;

            let minQuantity = Infinity;
            let maxQuantity = -Infinity;

            const validFeatures = [];
            const categorySet = new Set();

            obj.features.forEach(feature => {
                if (!feature.geometry || !Array.isArray(feature.geometry.coordinates)) return;

                const coords = feature.geometry.coordinates;
                if (coords.length < 2) return;

                const longitude = normalizeLongitudeForMap(Number(coords[0]));
                const latitude = Number(coords[1]);

                if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

                // Яндексу нужен формат [lat, lon]
                feature.geometry.coordinates = [latitude, longitude];

                minLatitude = Math.min(minLatitude, latitude);
                maxLatitude = Math.max(maxLatitude, latitude);
                minLongitude = Math.min(minLongitude, longitude);
                maxLongitude = Math.max(maxLongitude, longitude);

                if (!feature.properties) feature.properties = {};

                const quantity = extractQuantity(feature);
                const categories = extractCategories(feature);

                feature.properties.quantity = quantity;
                feature.properties.categoryList = categories;
                feature.properties.categoryNormalized = categories.join(', ');
                prepareFeatureBalloon(feature, quantity, categories);

                categories.forEach(cat => categorySet.add(cat));

                const isBlue = isGibddFeature(feature);

                if (!isBlue) {
                    if (quantity === null) return;

                    if (quantity < minQuantity) minQuantity = quantity;
                    if (quantity > maxQuantity) maxQuantity = quantity;
                }

                validFeatures.push(feature);
            });

            if (validFeatures.length === 0) {
                console.warn('Нет точек для отображения.');
                showMapStatus('Нет точек для отображения.', 'error');
                return;
            }

            if (minQuantity === Infinity || maxQuantity === -Infinity) {
                minQuantity = 0;
                maxQuantity = 0;
            }

            obj.features = validFeatures;

            objectManager.removeAll();
            objectManager.add(obj);
            myMap.geoObjects.add(objectManager);

            if (
                minLatitude !== Infinity &&
                maxLatitude !== -Infinity &&
                minLongitude !== Infinity &&
                maxLongitude !== -Infinity
            ) {
                myMap.setBounds(
                    [
                        [minLatitude, minLongitude],
                        [maxLatitude, maxLongitude]
                    ],
                    {
                        checkZoomRange: true,
                        zoomMargin: getMapZoomMargin()
                    }
                );
            }

            allCategories = sortCategories(Array.from(categorySet));

            setupFilterUI(minQuantity, maxQuantity, objectManager, allCategories);
            applyFilter(currentMinQuantity, objectManager);
            hideMapStatus();
        })
        .catch(err => {
            console.error(`Ошибка загрузки ${DATA_URL}:`, err);
            showMapStatus('Не удалось загрузить данные карты.', 'error');
        });
}

function showMapStatus(message, type = 'loading') {
    const status = document.getElementById('map-status');
    if (!status) return;

    status.textContent = message;
    status.hidden = false;
    status.classList.toggle('error', type === 'error');
}

function hideMapStatus() {
    const status = document.getElementById('map-status');
    if (!status) return;

    status.hidden = true;
}

function getMapZoomMargin() {
    if (window.matchMedia && window.matchMedia(MOBILE_MEDIA_QUERY).matches) {
        return MOBILE_MAP_ZOOM_MARGIN;
    }

    return DESKTOP_MAP_ZOOM_MARGIN;
}

function normalizeLongitudeForMap(longitude) {
    if (!Number.isFinite(longitude)) return longitude;

    return longitude < 0 ? longitude + WORLD_LONGITUDE_WIDTH : longitude;
}

function getBalloonMaxWidth() {
    if (window.matchMedia && window.matchMedia(MOBILE_MEDIA_QUERY).matches) {
        return MOBILE_BALLOON_MAX_WIDTH;
    }

    return DESKTOP_BALLOON_MAX_WIDTH;
}

function getBalloonAutoPanMargin() {
    if (window.matchMedia && window.matchMedia(MOBILE_MEDIA_QUERY).matches) {
        return MOBILE_BALLOON_AUTO_PAN_MARGIN;
    }

    return DESKTOP_BALLOON_AUTO_PAN_MARGIN;
}

function getObjectManagerBalloonOptions() {
    return {
        geoObjectBalloonMaxWidth: getBalloonMaxWidth(),
        geoObjectBalloonMinWidth: BALLOON_MIN_WIDTH,
        geoObjectBalloonAutoPan: true,
        geoObjectBalloonAutoPanMargin: getBalloonAutoPanMargin(),
        geoObjectBalloonCloseButton: true
    };
}

function syncClusterZoomMarginOnResize(objectManager) {
    if (!objectManager || !objectManager.options) return;

    let resizeTimer = null;

    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            objectManager.options.set({
                zoomMargin: getMapZoomMargin(),
                ...getObjectManagerBalloonOptions()
            });
        }, 150);
    });
}

function prepareFeatureBalloon(feature, quantity, categories) {
    if (!feature.properties) return;

    const title = getFeatureTitle(feature);
    const address = extractBalloonField(feature.properties.balloonContentBody, 'Адрес');
    const rows = [];

    if (address) {
        rows.push(createBalloonRow('Адрес', address));
    }

    if (categories.length > 0) {
        rows.push(createBalloonRow('Категория', categories.join(', ')));
    }

    if (quantity !== null) {
        rows.push(createBalloonRow(
            'Кол-во ДК за месяц',
            `<span class="map-balloon__quantity">${escapeHtml(quantity)}</span>`,
            true
        ));
    }

    if (rows.length === 0 && !title) {
        rows.push(createBalloonRow('', getFeaturePlainText(feature)));
    }

    feature.properties.balloonContentHeader = '';
    feature.properties.balloonContentBody = [
        '<div class="map-balloon">',
        title ? `<div class="map-balloon__title">${escapeHtml(title)}</div>` : '',
        rows.join(''),
        '</div>'
    ].join('');
}

function createBalloonRow(label, value, valueIsHtml = false) {
    const safeValue = valueIsHtml ? value : escapeHtml(value);

    if (!label) {
        return `<div class="map-balloon__row">${safeValue}</div>`;
    }

    return [
        '<div class="map-balloon__row">',
        `<span class="map-balloon__label">${escapeHtml(label)}:</span> `,
        safeValue,
        '</div>'
    ].join('');
}

function getFeatureTitle(feature) {
    const properties = feature.properties || {};
    const rawTitle =
        properties.clusterCaption ||
        properties.hintContent ||
        properties.balloonContentHeader ||
        '';

    return getTextFromHtml(rawTitle);
}

function getFeaturePlainText(feature) {
    const properties = feature.properties || {};
    const rawText =
        properties.balloonContentBody ||
        properties.clusterCaption ||
        properties.hintContent ||
        properties.balloonContentHeader ||
        '';

    return getTextFromHtml(rawText);
}

function extractBalloonField(html, label) {
    if (typeof html !== 'string' || !html) return '';

    if (typeof DOMParser !== 'undefined') {
        try {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const labelSpans = Array.from(doc.querySelectorAll('span'));
            const targetSpan = labelSpans.find(span => {
                const text = span.textContent.replace(':', '').trim();
                return text === label;
            });

            if (targetSpan && targetSpan.parentElement) {
                return targetSpan.parentElement.textContent
                    .replace(new RegExp(`^${escapeRegExp(label)}:\\s*`, 'i'), '')
                    .trim();
            }
        } catch (err) {
            console.warn('Не удалось разобрать содержимое балуна:', err);
        }
    }

    const re = new RegExp(`${escapeRegExp(label)}:\\s*<\\/span>\\s*([^<]+)`, 'i');
    const match = html.match(re);
    return match && match[1] ? getTextFromHtml(match[1]).trim() : '';
}

function getTextFromHtml(value) {
    if (value === undefined || value === null) return '';

    const normalized = String(value)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/div>\s*<div/gi, '</div>\n<div');

    if (typeof DOMParser !== 'undefined') {
        try {
            const doc = new DOMParser().parseFromString(normalized, 'text/html');
            return normalizeText(doc.body.textContent || '');
        } catch (err) {
            console.warn('Не удалось получить текст из HTML:', err);
        }
    }

    return normalizeText(normalized.replace(/<[^>]*>/g, ''));
}

function normalizeText(value) {
    return String(value)
        .replace(/\s+/g, ' ')
        .trim();
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractQuantity(feature) {
    if (!feature.properties) return null;

    if (
        feature.properties.quantity !== undefined &&
        feature.properties.quantity !== null &&
        feature.properties.quantity !== ''
    ) {
        const q = Number(feature.properties.quantity);
        if (Number.isFinite(q)) return q;
    }

    const body = feature.properties.balloonContentBody;
    if (typeof body === 'string') {
        const re = /Кол-во\s+ДК\s+за\s+месяц:\s*<span[^>]*>([\d\s]+)/i;
        const match = body.match(re);
        if (match && match[1]) {
            const q = parseInt(match[1].replace(/\s+/g, ''), 10);
            if (!isNaN(q)) return q;
        }
    }

    return null;
}

function extractCategories(feature) {
    if (!feature.properties) return [];

    let raw = '';

    if (
        feature.properties.category !== undefined &&
        feature.properties.category !== null &&
        String(feature.properties.category).trim() !== ''
    ) {
        raw = String(feature.properties.category).trim();
    } else {
        const body = feature.properties.balloonContentBody;
        if (typeof body === 'string') {
            const re = /Категория:<\/span>\s*([^<]+)/i;
            const match = body.match(re);
            if (match && match[1]) {
                raw = match[1].trim();
            }
        }
    }

    if (!raw) return [];

    return raw
        .split(/[;,|]/)
        .map(item => item.trim())
        .filter(Boolean)
        .filter((item, index, arr) => arr.indexOf(item) === index);
}

function sortCategories(categories) {
    return categories.sort((a, b) => {
        const ia = CATEGORY_ORDER_INDEX.has(a) ? CATEGORY_ORDER_INDEX.get(a) : Infinity;
        const ib = CATEGORY_ORDER_INDEX.has(b) ? CATEGORY_ORDER_INDEX.get(b) : Infinity;

        if (ia !== ib) return ia - ib;

        return a.localeCompare(b, 'ru');
    });
}

function getFeatureQuantity(feature) {
    if (!feature.properties) return extractQuantity(feature);

    const rawQuantity = feature.properties.quantity;

    if (rawQuantity !== undefined && rawQuantity !== null && rawQuantity !== '') {
        const q = Number(rawQuantity);
        if (Number.isFinite(q)) return q;
    }

    return extractQuantity(feature);
}

function getFeatureCategories(feature) {
    if (!feature.properties) return [];

    if (Array.isArray(feature.properties.categoryList)) {
        return feature.properties.categoryList;
    }

    return extractCategories(feature);
}

function isGibddFeature(feature) {
    return feature.options && feature.options.preset === GIBDD_PRESET;
}

function isAutoSelectCategory(category) {
    return !EXCLUDED_AUTO_SELECT_CATEGORIES.has(category);
}

function isCategoryFilterOff() {
    if (selectedCategories.size === 0) return true;

    const autoSelectCategories = allCategories.filter(isAutoSelectCategory);

    if (selectedCategories.size !== autoSelectCategories.length) {
        return false;
    }

    return autoSelectCategories.every(category => selectedCategories.has(category));
}

function setupFilterUI(minQuantity, maxQuantity, objectManager, categories) {
    const dkToggleBtn = document.getElementById('dk-filter-toggle');
    const categoryToggleBtn = document.getElementById('category-filter-toggle');
    const gibddToggle = document.getElementById('gibdd-toggle');

    const dkPanel = document.getElementById('dk-filter-panel');
    const categoryPanel = document.getElementById('category-filter-panel');

    const range = document.getElementById('quantity-range');
    const input = document.getElementById('quantity-input');
    const currentValueLabel = document.getElementById('filter-current-value');

    const categoryList = document.getElementById('category-checkboxes');
    const btnSelectAll = document.getElementById('categories-select-all');
    const btnClearAll = document.getElementById('categories-clear-all');

    if (
        !dkToggleBtn || !categoryToggleBtn || !gibddToggle ||
        !dkPanel || !categoryPanel ||
        !range || !input || !currentValueLabel ||
        !categoryList || !btnSelectAll || !btnClearAll
    ) {
        console.warn('Элементы фильтра не найдены.');
        return;
    }

    dkPanel.style.display = 'none';
    categoryPanel.style.display = 'none';

    range.min = minQuantity;
    range.max = minQuantity === maxQuantity ? maxQuantity + 1 : maxQuantity;
    range.step = 1;
    range.value = minQuantity;

    input.min = minQuantity;
    input.max = maxQuantity;
    input.step = 1;
    input.value = minQuantity;

    currentMinQuantity = minQuantity;
    updateCurrentValueLabel(minQuantity);

    categoryList.innerHTML = '';

    categories.forEach(category => {
        const label = document.createElement('label');
        label.className = 'category-check-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = category;
        checkbox.checked = false;

        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                selectedCategories.add(category);
            } else {
                selectedCategories.delete(category);
            }
            applyFilter(currentMinQuantity, objectManager);
        });

        const text = document.createElement('span');
        text.textContent = category;

        label.appendChild(checkbox);
        label.appendChild(text);
        categoryList.appendChild(label);
    });

    dkToggleBtn.addEventListener('click', () => {
        const isOpen = dkPanel.style.display === 'block';
        dkPanel.style.display = isOpen ? 'none' : 'block';
        dkToggleBtn.setAttribute('aria-expanded', String(!isOpen));

        if (!isOpen) {
            categoryPanel.style.display = 'none';
            categoryToggleBtn.setAttribute('aria-expanded', 'false');
        }
    });

    categoryToggleBtn.addEventListener('click', () => {
        const isOpen = categoryPanel.style.display === 'block';
        categoryPanel.style.display = isOpen ? 'none' : 'block';
        categoryToggleBtn.setAttribute('aria-expanded', String(!isOpen));

        if (!isOpen) {
            dkPanel.style.display = 'none';
            dkToggleBtn.setAttribute('aria-expanded', 'false');
        }
    });

    showGibdd = true;
    gibddToggle.classList.add('active');
    gibddToggle.setAttribute('aria-pressed', 'true');

    gibddToggle.addEventListener('click', () => {
        showGibdd = !showGibdd;
        gibddToggle.classList.toggle('active', showGibdd);
        gibddToggle.setAttribute('aria-pressed', String(showGibdd));
        applyFilter(currentMinQuantity, objectManager);
    });

    range.addEventListener('input', () => {
        const val = parseInt(range.value, 10);
        input.value = val;
        updateCurrentValueLabel(val);
        applyFilter(val, objectManager);
    });

    input.addEventListener('input', () => {
        let val = parseInt(input.value, 10);
        if (isNaN(val)) val = minQuantity;
        if (val < minQuantity) val = minQuantity;
        if (val > maxQuantity) val = maxQuantity;

        input.value = val;
        range.value = val;
        updateCurrentValueLabel(val);
        applyFilter(val, objectManager);
    });

    // "Все" = выбрать все, кроме Tm и Tb
    btnSelectAll.addEventListener('click', () => {
        selectedCategories = new Set(
            categories.filter(isAutoSelectCategory)
        );

        categoryList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.checked = isAutoSelectCategory(cb.value);
        });

        applyFilter(currentMinQuantity, objectManager);
    });

    btnClearAll.addEventListener('click', () => {
        selectedCategories.clear();
        categoryList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.checked = false;
        });
        applyFilter(currentMinQuantity, objectManager);
    });

    function updateCurrentValueLabel(minVal) {
        currentValueLabel.textContent = `Показываются точки с кол-вом ≥ ${minVal}`;
    }
}

function applyFilter(minQuantity, objectManager) {
    currentMinQuantity = minQuantity;

    if (!objectManager) return;

    const categoryFilterIsOff = isCategoryFilterOff();

    objectManager.setFilter(obj => {
        // ГИБДД управляется только своей кнопкой
        if (isGibddFeature(obj)) {
            return showGibdd;
        }

        const objCategories = getFeatureCategories(obj);

        // Категориальный фильтр только для обычных точек
        // ничего не выбрано -> показываем все
        // выбраны все кроме Tm/Tb -> тоже считаем как "все"
        // иначе объект должен содержать все выбранные категории
        if (!categoryFilterIsOff) {
            for (const selected of selectedCategories) {
                if (!objCategories.includes(selected)) {
                    return false;
                }
            }
        }

        const q = getFeatureQuantity(obj);
        if (q === null) return false;

        return q >= currentMinQuantity;
    });
}
