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
const YANDEX_PHOTO_PUBLIC_KEY = 'https://disk.yandex.ru/d/N6CtniFgAEZ2FQ';
const YANDEX_PUBLIC_RESOURCE_API = 'https://cloud-api.yandex.net/v1/disk/public/resources';
const YANDEX_PUBLIC_RESOURCE_DOWNLOAD_API = 'https://cloud-api.yandex.net/v1/disk/public/resources/download';
const YANDEX_OTO_PHOTO_BASE_PATH = '/фото по ОТО';
const YANDEX_PTO_PHOTO_BASE_PATH = '/фото по ПТО';
const PHOTO_FOLDER_MAX_DEPTH = 4;
const PHOTO_FOLDER_LIMIT = 200;
const PHOTO_PREVIEW_SIZE = 'M';
const PHOTO_DISPLAY_LIMIT_PER_SOURCE = 24;
const PHOTO_CACHE_TTL_MS = 30000;
const EXCLUDED_PHOTO_NAME_RE = /(reference|referen|референс)/i;

let currentMinQuantity = 0;
let showGibdd = true;
let selectedCategories = new Set();
let allCategories = [];
const stationPhotoCache = new Map();
let duplicatePhotoOtoIds = new Set();

document.addEventListener('click', handlePhotoButtonClick);
document.addEventListener('click', handlePhotoLightboxClick);
document.addEventListener('click', handlePhotoGalleryClick);
document.addEventListener('click', handlePhotoModalCloseClick);
document.addEventListener('keydown', handlePhotoModalKeydown);

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

            duplicatePhotoOtoIds = collectDuplicatePhotoOtoIds(obj.features);

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

    const photoBlock = createPhotoBlock(feature);

    if (rows.length === 0 && !title) {
        rows.push(createBalloonRow('', getFeaturePlainText(feature)));
    }

    feature.properties.balloonContentHeader = '';
    feature.properties.balloonContentBody = [
        '<div class="map-balloon">',
        title ? `<div class="map-balloon__title">${escapeHtml(title)}</div>` : '',
        rows.join(''),
        photoBlock,
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

function createPhotoBlock(feature) {
    const ids = getFeaturePhotoIds(feature);

    if (!ids.otoId && !ids.ptoId) {
        return '';
    }

    return [
        '<div class="map-balloon__photos">',
        '<button type="button" class="map-photo-button" data-photo-load ',
        `data-oto-id="${escapeHtml(ids.otoId || '')}" `,
        `data-pto-id="${escapeHtml(ids.ptoId || '')}">`,
        'Показать фото станции',
        '</button>',
        '<div class="map-photo-gallery" data-photo-gallery></div>',
        '</div>'
    ].join('');
}

function getFeaturePhotoIds(feature) {
    const properties = feature.properties || {};
    const otoId = normalizePhotoFolderId(properties.otoId);
    const ptoId = normalizePhotoFolderId(properties.ptoId);

    return {
        otoId: duplicatePhotoOtoIds.has(otoId) ? '' : otoId,
        ptoId
    };
}

function collectDuplicatePhotoOtoIds(features) {
    const counts = new Map();

    (Array.isArray(features) ? features : []).forEach(feature => {
        const properties = feature && feature.properties ? feature.properties : {};
        const otoId = normalizePhotoFolderId(properties.otoId);
        if (!otoId) return;

        counts.set(otoId, (counts.get(otoId) || 0) + 1);
    });

    return new Set(
        Array.from(counts.entries())
            .filter(([, count]) => count > 1)
            .map(([otoId]) => otoId)
    );
}

function normalizePhotoFolderId(value) {
    if (value === undefined || value === null) return '';

    const digits = String(value).replace(/\D/g, '');
    if (!digits) return '';

    return digits.padStart(5, '0');
}

async function handlePhotoButtonClick(event) {
    const button = event.target.closest('[data-photo-load]');
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    const photoBlock = button.closest('.map-balloon__photos');
    const gallery = photoBlock ? photoBlock.querySelector('[data-photo-gallery]') : null;
    if (!gallery) return;

    const otoId = button.dataset.otoId || '';
    const ptoId = button.dataset.ptoId || '';

    button.disabled = true;
    button.textContent = 'Загрузка фото...';
    gallery.innerHTML = '<div class="map-photo-status">Ищу фото на Яндекс.Диске...</div>';

    try {
        const groups = await loadStationPhotoGroups(otoId, ptoId);
        const totalPhotos = getPhotoGroupsTotal(groups);

        if (totalPhotos > 0) {
            openPhotoModal(groups, getPhotoModalTitle(groups, totalPhotos));
            gallery.innerHTML = '<div class="map-photo-status">Галерея открыта поверх карты.</div>';
            button.disabled = false;
            button.textContent = 'Открыть галерею';
        } else {
            gallery.innerHTML = renderPhotoGroups(groups);
            button.disabled = false;
            button.textContent = 'Показать фото';
        }
    } catch (err) {
        console.error('Не удалось загрузить фото станции:', err);
        button.disabled = false;
        button.textContent = 'Повторить загрузку фото';
        gallery.innerHTML = '<div class="map-photo-status error">Не удалось загрузить фото с Яндекс.Диска.</div>';
    }
}

async function loadStationPhotoGroups(otoId, ptoId) {
    const emptyGroups = [];
    const normalizedOtoId = normalizePhotoFolderId(otoId);
    const normalizedPtoId = normalizePhotoFolderId(ptoId);
    const shouldSkipOto = duplicatePhotoOtoIds.has(normalizedOtoId);

    if (normalizedOtoId && !shouldSkipOto) {
        const otoGroup = await loadYandexPhotoGroup({
            label: 'Фото по ОТО',
            id: normalizedOtoId,
            path: `${YANDEX_OTO_PHOTO_BASE_PATH}/${normalizedOtoId}`
        });

        if (otoGroup.photos.length > 0) {
            return [otoGroup];
        }

        emptyGroups.push(otoGroup);
    }

    if (normalizedPtoId) {
        const ptoGroup = await loadYandexPhotoGroup({
            label: 'Фото по ПТО',
            id: normalizedPtoId,
            path: `${YANDEX_PTO_PHOTO_BASE_PATH}/${normalizedPtoId}`
        });

        if (ptoGroup.photos.length > 0) {
            return [ptoGroup];
        }

        emptyGroups.push(ptoGroup);
    }

    return emptyGroups;
}

function getPhotoGroupsTotal(groups) {
    return groups.reduce((sum, group) => sum + group.photos.length, 0);
}

function getPhotoModalTitle(groups, totalPhotos) {
    const group = groups.find(item => item.photos.length > 0) || groups[0];
    const sourceTitle = group ? `${group.label.replace('Фото по ', '')} ${group.id}` : 'Фото станции';

    return `${sourceTitle} · ${totalPhotos} фото`;
}

function openPhotoModal(groups, title) {
    closePhotoModal();

    const modal = document.createElement('div');
    modal.className = 'map-photo-modal map-photo-modal--gallery';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', title);
    modal.innerHTML = [
        '<div class="map-photo-modal__panel" role="document">',
        '<div class="map-photo-modal__header">',
        `<div class="map-photo-modal__title">${escapeHtml(title)}</div>`,
        '<button type="button" class="map-photo-modal__close" data-photo-modal-close aria-label="Закрыть">×</button>',
        '</div>',
        `<div class="map-photo-modal__body">${renderPhotoGroups(groups)}</div>`,
        '</div>'
    ].join('');

    document.body.appendChild(modal);

    const closeButton = modal.querySelector('[data-photo-modal-close]');
    if (closeButton) {
        closeButton.focus();
    }
}

function flattenPhotoGroups(groups) {
    const photos = [];

    groups.forEach(group => {
        group.photos.forEach(photo => {
            photos.push({
                ...photo,
                sourceTitle: `${group.label} ${group.id}`
            });
        });
    });

    return photos;
}

function renderPhotoViewer(photos) {
    const firstPhoto = photos[0];

    return [
        '<div class="map-photo-viewer">',
        '<div class="map-photo-viewer__stage">',
        '<button type="button" class="map-photo-viewer__nav" data-photo-prev aria-label="Предыдущее фото">‹</button>',
        '<button type="button" class="map-photo-viewer__image-wrap" data-photo-fullscreen aria-label="Открыть фото на весь экран">',
        `<img class="map-photo-viewer__image" data-photo-main src="${escapeHtml(firstPhoto.fullUrl || firstPhoto.downloadUrl || firstPhoto.previewUrl)}" alt="${escapeHtml(firstPhoto.name)}">`,
        '</button>',
        '<button type="button" class="map-photo-viewer__nav" data-photo-next aria-label="Следующее фото">›</button>',
        '</div>',
        '<div class="map-photo-viewer__footer">',
        '<div class="map-photo-viewer__meta">',
        `<div class="map-photo-viewer__name" data-photo-name>${escapeHtml(firstPhoto.name)}</div>`,
        `<div class="map-photo-viewer__source" data-photo-source>${escapeHtml(firstPhoto.sourceTitle)}</div>`,
        '</div>',
        '<div class="map-photo-viewer__actions">',
        `<span class="map-photo-viewer__counter" data-photo-counter>1 / ${photos.length}</span>`,
        '<button type="button" class="map-photo-viewer__fullscreen" data-photo-fullscreen>На весь экран</button>',
        `<a class="map-photo-viewer__download" data-photo-download href="${escapeHtml(firstPhoto.downloadUrl || firstPhoto.fullUrl || firstPhoto.previewUrl)}" download target="_blank" rel="noopener noreferrer">Скачать</a>`,
        '</div>',
        '</div>',
        '<div class="map-photo-thumbs">',
        photos.map((photo, index) => renderPhotoThumb(photo, index)).join(''),
        '</div>',
        '</div>'
    ].join('');
}

function renderPhotoThumb(photo, index) {
    return [
        `<button type="button" class="map-photo-thumb${index === 0 ? ' active' : ''}" data-photo-index="${index}" `,
        `data-photo-preview="${escapeHtml(photo.previewUrl || photo.fullUrl)}" `,
        `data-photo-full="${escapeHtml(photo.fullUrl || photo.downloadUrl || photo.previewUrl)}" `,
        `data-photo-download-url="${escapeHtml(photo.downloadUrl || photo.fullUrl || photo.previewUrl)}" `,
        `data-photo-name="${escapeHtml(photo.name)}" `,
        `data-photo-source="${escapeHtml(photo.sourceTitle)}" `,
        `aria-label="${escapeHtml(photo.sourceTitle + ': ' + photo.name)}">`,
        `<img src="${escapeHtml(photo.previewUrl || photo.fullUrl)}" alt="${escapeHtml(photo.name)}" loading="lazy" referrerpolicy="no-referrer">`,
        '</button>'
    ].join('');
}

function closePhotoModal() {
    closePhotoLightbox();
    closePhotoFancybox();

    const existing = document.querySelector('.map-photo-modal');
    if (existing) {
        existing.remove();
    }
}

async function handlePhotoGalleryClick(event) {
    const link = event.target.closest('[data-photo-open]');
    if (!link) return;

    const modal = link.closest('.map-photo-modal');
    if (!modal) return;

    if (!window.Fancybox) {
        return;
    }

    event.preventDefault();

    if (modal.dataset.photoOpening === '1') return;

    modal.dataset.photoOpening = '1';
    link.classList.add('map-photo-link--loading');

    try {
        await openPhotoFancybox(modal, link);
    } catch (err) {
        console.error('Не удалось открыть фото:', err);
        showMapStatus('Не удалось открыть фото. Попробуйте еще раз.', 'error');
    } finally {
        modal.dataset.photoOpening = '0';
        link.classList.remove('map-photo-link--loading');
    }
}

function handlePhotoModalCloseClick(event) {
    const modal = event.target.closest('.map-photo-modal');
    if (!modal) return;

    const thumb = event.target.closest('[data-photo-index]');
    if (thumb) {
        event.preventDefault();
        updatePhotoModalActivePhoto(modal, Number(thumb.dataset.photoIndex));
        return;
    }

    if (event.target.closest('[data-photo-prev]')) {
        event.preventDefault();
        shiftPhotoModalActivePhoto(modal, -1);
        return;
    }

    if (event.target.closest('[data-photo-next]')) {
        event.preventDefault();
        shiftPhotoModalActivePhoto(modal, 1);
        return;
    }

    if (event.target.closest('[data-photo-fullscreen]')) {
        event.preventDefault();
        openPhotoLightbox(modal, Number(modal.dataset.activePhotoIndex || '0'));
        return;
    }

    if (
        event.target.matches('[data-photo-modal-close]') ||
        event.target === modal
    ) {
        event.preventDefault();
        closePhotoModal();
    }
}

function handlePhotoModalKeydown(event) {
    if (isPhotoFancyboxOpen()) {
        return;
    }

    const lightbox = document.querySelector('.map-photo-lightbox');
    if (lightbox) {
        if (event.key === 'Escape') {
            event.preventDefault();
            closePhotoLightbox();
        } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            shiftPhotoLightboxActivePhoto(lightbox, -1);
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            shiftPhotoLightboxActivePhoto(lightbox, 1);
        }
        return;
    }

    if (event.key === 'Escape') {
        closePhotoModal();
        return;
    }

    const modal = document.querySelector('.map-photo-modal');
    if (!modal) return;

    if (event.key === 'ArrowLeft') {
        event.preventDefault();
        shiftPhotoModalActivePhoto(modal, -1);
    } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        shiftPhotoModalActivePhoto(modal, 1);
    }
}

function shiftPhotoModalActivePhoto(modal, delta) {
    const thumbs = Array.from(modal.querySelectorAll('[data-photo-index]'));
    if (thumbs.length === 0) return;

    const currentIndex = Number(modal.dataset.activePhotoIndex || '0');
    const nextIndex = (currentIndex + delta + thumbs.length) % thumbs.length;
    updatePhotoModalActivePhoto(modal, nextIndex);
}

function updatePhotoModalActivePhoto(modal, index) {
    const thumbs = Array.from(modal.querySelectorAll('[data-photo-index]'));
    if (thumbs.length === 0) return;

    const safeIndex = Math.max(0, Math.min(index, thumbs.length - 1));
    const thumb = thumbs[safeIndex];

    const mainImage = modal.querySelector('[data-photo-main]');
    const name = modal.querySelector('[data-photo-name]');
    const source = modal.querySelector('[data-photo-source]');
    const counter = modal.querySelector('[data-photo-counter]');
    const download = modal.querySelector('[data-photo-download]');

    const previewUrl = thumb.dataset.photoPreview || thumb.dataset.photoFull || '';
    const fullUrl = thumb.dataset.photoFull || previewUrl;
    const downloadUrl = thumb.dataset.photoDownloadUrl || fullUrl;
    const photoName = thumb.dataset.photoName || 'Фото';
    const sourceTitle = thumb.dataset.photoSource || '';

    modal.dataset.activePhotoIndex = String(safeIndex);

    if (mainImage) {
        mainImage.onerror = () => {
            if (previewUrl && mainImage.src !== previewUrl) {
                mainImage.src = previewUrl;
            }
        };
        mainImage.src = fullUrl;
        mainImage.alt = `${sourceTitle}: ${photoName}`;
    }

    if (name) name.textContent = photoName;
    if (source) source.textContent = sourceTitle;
    if (counter) counter.textContent = `${safeIndex + 1} / ${thumbs.length}`;
    if (download) {
        download.href = downloadUrl;
        download.setAttribute('download', photoName);
    }

    thumbs.forEach((item, itemIndex) => {
        const isActive = itemIndex === safeIndex;
        item.classList.toggle('active', isActive);
        item.setAttribute('aria-current', isActive ? 'true' : 'false');
    });
}

function openPhotoLightbox(modal, index) {
    closePhotoLightbox();

    const thumbs = Array.from(modal.querySelectorAll('[data-photo-index]'));
    if (thumbs.length === 0) return;

    const safeIndex = normalizePhotoIndex(index, thumbs.length);
    const activePhoto = getPhotoDataFromThumb(thumbs[safeIndex]);
    const lightbox = document.createElement('div');
    lightbox.className = 'map-photo-lightbox';
    lightbox.setAttribute('role', 'dialog');
    lightbox.setAttribute('aria-modal', 'true');
    lightbox.setAttribute('aria-label', activePhoto.caption || activePhoto.name);
    lightbox.dataset.activePhotoIndex = String(safeIndex);
    lightbox.innerHTML = [
        '<div class="map-photo-lightbox__bar">',
        '<div class="map-photo-lightbox__meta">',
        `<div class="map-photo-lightbox__name" data-lightbox-name>${escapeHtml(activePhoto.name)}</div>`,
        `<div class="map-photo-lightbox__source" data-lightbox-source>${escapeHtml(activePhoto.sourceTitle)}</div>`,
        '</div>',
        '<div class="map-photo-lightbox__actions">',
        `<span class="map-photo-lightbox__counter" data-lightbox-counter>${safeIndex + 1} / ${thumbs.length}</span>`,
        '<button type="button" class="map-photo-lightbox__button" data-lightbox-actual-size>100%</button>',
        `<a class="map-photo-lightbox__button map-photo-lightbox__download" data-lightbox-download href="${escapeHtml(activePhoto.downloadUrl || activePhoto.fullUrl || activePhoto.previewUrl)}" download="${escapeHtml(activePhoto.name)}" target="_blank" rel="noopener noreferrer">Скачать</a>`,
        '<button type="button" class="map-photo-lightbox__button" data-lightbox-close>Закрыть</button>',
        '</div>',
        '</div>',
        '<div class="map-photo-lightbox__stage">',
        '<button type="button" class="map-photo-lightbox__nav" data-lightbox-prev aria-label="Предыдущее фото">‹</button>',
        '<div class="map-photo-lightbox__image-scroll">',
        `<img class="map-photo-lightbox__image" data-lightbox-image src="${escapeHtml(activePhoto.fullUrl || activePhoto.downloadUrl || activePhoto.previewUrl)}" alt="${escapeHtml(activePhoto.name)}">`,
        '</div>',
        '<button type="button" class="map-photo-lightbox__nav" data-lightbox-next aria-label="Следующее фото">›</button>',
        '</div>'
    ].join('');

    document.body.appendChild(lightbox);
    updatePhotoLightboxActivePhoto(lightbox, safeIndex);
}

function closePhotoLightbox() {
    const existing = document.querySelector('.map-photo-lightbox');
    if (existing) {
        existing.remove();
    }
}

function handlePhotoLightboxClick(event) {
    const lightbox = event.target.closest('.map-photo-lightbox');
    if (!lightbox) return;

    if (event.target.closest('[data-lightbox-close]')) {
        event.preventDefault();
        closePhotoLightbox();
        return;
    }

    if (event.target.closest('[data-lightbox-prev]')) {
        event.preventDefault();
        shiftPhotoLightboxActivePhoto(lightbox, -1);
        return;
    }

    if (event.target.closest('[data-lightbox-next]')) {
        event.preventDefault();
        shiftPhotoLightboxActivePhoto(lightbox, 1);
        return;
    }

    if (event.target.closest('[data-lightbox-actual-size]')) {
        event.preventDefault();
        togglePhotoLightboxActualSize(lightbox);
        return;
    }

    if (event.target === lightbox) {
        event.preventDefault();
        closePhotoLightbox();
    }
}

function shiftPhotoLightboxActivePhoto(lightbox, delta) {
    const modal = document.querySelector('.map-photo-modal');
    const thumbs = modal ? Array.from(modal.querySelectorAll('[data-photo-index]')) : [];
    if (thumbs.length === 0) return;

    const currentIndex = Number(lightbox.dataset.activePhotoIndex || '0');
    const nextIndex = normalizePhotoIndex(currentIndex + delta, thumbs.length);
    updatePhotoModalActivePhoto(modal, nextIndex);
    updatePhotoLightboxActivePhoto(lightbox, nextIndex);
}

function updatePhotoLightboxActivePhoto(lightbox, index) {
    const modal = document.querySelector('.map-photo-modal');
    const thumbs = modal ? Array.from(modal.querySelectorAll('[data-photo-index]')) : [];
    if (!modal || thumbs.length === 0) return;

    const safeIndex = normalizePhotoIndex(index, thumbs.length);
    const photo = getPhotoDataFromThumb(thumbs[safeIndex]);
    const image = lightbox.querySelector('[data-lightbox-image]');
    const name = lightbox.querySelector('[data-lightbox-name]');
    const source = lightbox.querySelector('[data-lightbox-source]');
    const counter = lightbox.querySelector('[data-lightbox-counter]');
    const download = lightbox.querySelector('[data-lightbox-download]');

    lightbox.dataset.activePhotoIndex = String(safeIndex);
    lightbox.classList.remove('map-photo-lightbox--actual-size');

    if (image) {
        image.onerror = () => {
            if (photo.previewUrl && image.src !== photo.previewUrl) {
                image.src = photo.previewUrl;
            }
        };
        image.src = photo.fullUrl || photo.downloadUrl || photo.previewUrl;
        image.alt = `${photo.sourceTitle}: ${photo.name}`;
    }

    if (name) name.textContent = photo.name;
    if (source) source.textContent = photo.sourceTitle;
    if (counter) counter.textContent = `${safeIndex + 1} / ${thumbs.length}`;
    if (download) {
        download.href = photo.downloadUrl || photo.fullUrl || photo.previewUrl;
        download.setAttribute('download', photo.name);
    }
}

function togglePhotoLightboxActualSize(lightbox) {
    const actual = lightbox.classList.toggle('map-photo-lightbox--actual-size');
    const button = lightbox.querySelector('[data-lightbox-actual-size]');
    if (button) {
        button.textContent = actual ? 'Вписать' : '100%';
    }
}

function getPhotoDataFromThumb(thumb) {
    return {
        previewUrl: thumb.dataset.photoPreview || '',
        fullUrl: thumb.dataset.photoFull || thumb.dataset.photoDownloadUrl || thumb.dataset.photoPreview || '',
        downloadUrl: thumb.dataset.photoDownloadUrl || thumb.dataset.photoFull || thumb.dataset.photoPreview || '',
        name: thumb.dataset.photoName || 'Фото',
        sourceTitle: thumb.dataset.photoSource || '',
        caption: thumb.getAttribute('aria-label') || ''
    };
}

function normalizePhotoIndex(index, total) {
    if (total <= 0) return 0;
    return ((Number(index) || 0) % total + total) % total;
}

async function openPhotoFancybox(modal, activeLink) {
    const links = Array.from(modal.querySelectorAll('[data-photo-open]'));
    const preparedItems = await Promise.all(links.map(async (link, index) => {
        try {
            return {
                index,
                item: await getPhotoFancyboxItem(link)
            };
        } catch (err) {
            console.warn('Не удалось подготовить фото для просмотра:', link.dataset.photoPath || link.href, err);
            return {
                index,
                item: null
            };
        }
    }));
    const galleryEntries = preparedItems.filter(entry => entry.item && entry.item.src);
    const gallery = galleryEntries.map(entry => entry.item);

    if (!gallery.length) return;

    const activeLinkIndex = Math.max(0, links.indexOf(activeLink));
    const startIndex = Math.max(0, galleryEntries.findIndex(entry => entry.index === activeLinkIndex));
    ensurePhotoFancyboxDownloadButton();

    window.Fancybox.show(gallery, {
        startIndex,
        infinite: true,
        contentClick: false,
        wheel: 'zoom',
        Toolbar: {
            display: {
                left: ['infobar'],
                middle: [],
                right: ['download', 'zoom', 'slideshow', 'fullscreen', 'thumbs', 'close']
            }
        },
        Images: {
            zoom: true,
            Panzoom: {
                maxScale: 30,
                minScale: 1,
                zoomToMaxScale: true
            }
        },
        on: {
            ready: fancybox => {
                fancybox.container.addEventListener('click', event => {
                    const downloadButton = event.target.closest('[data-fancybox-download]');
                    if (!downloadButton) return;

                    event.preventDefault();
                    const slide = fancybox.getSlide();
                    if (!slide) return;

                    const downloadUrl = slide.custom && slide.custom.downloadUrl ? slide.custom.downloadUrl : slide.src;
                    const filename = slide.custom && slide.custom.filename ? slide.custom.filename : 'photo.jpg';
                    const anchor = document.createElement('a');
                    anchor.href = downloadUrl;
                    anchor.download = filename;
                    document.body.appendChild(anchor);
                    anchor.click();
                    anchor.remove();
                });
            },
            destroy: fancybox => {
                revokePhotoFancyboxObjectUrls(fancybox);
            }
        }
    });
}

async function getPhotoFancyboxItem(link) {
    await refreshPhotoLinkOriginalUrl(link);

    const fullUrl = link.dataset.photoFull || link.dataset.photoDownloadUrl || link.href || '';
    const filename = sanitizeFilename(link.dataset.photoName || 'photo.jpg');
    const objectUrl = await fetchPhotoObjectUrl(fullUrl);

    return {
        src: objectUrl,
        type: 'image',
        thumbSrc: link.dataset.photoPreview || '',
        caption: link.dataset.photoCaption || link.title || filename,
        custom: {
            filename,
            downloadUrl: objectUrl,
            originalUrl: fullUrl,
            objectUrl
        }
    };
}

async function fetchPhotoObjectUrl(url) {
    if (!url) return '';

    const response = await fetch(url, { referrerPolicy: 'no-referrer' });

    if (!response.ok) {
        throw new Error(`photo_fetch_${response.status}`);
    }

    const blob = await response.blob();
    return URL.createObjectURL(blob);
}

function revokePhotoFancyboxObjectUrls(fancybox) {
    if (!fancybox || !Array.isArray(fancybox.items)) return;

    fancybox.items.forEach(item => {
        const objectUrl = item.custom && item.custom.objectUrl;
        if (objectUrl && objectUrl.startsWith('blob:')) {
            URL.revokeObjectURL(objectUrl);
        }
    });
}

async function refreshPhotoLinkOriginalUrl(link) {
    const path = link.dataset.photoPath || '';
    if (!path) return;

    try {
        const freshUrl = await fetchYandexPhotoDownloadUrl(path);
        if (!freshUrl) return;

        link.href = freshUrl;
        link.dataset.photoFull = freshUrl;
        link.dataset.photoDownloadUrl = freshUrl;
    } catch (err) {
        console.warn('Не удалось обновить ссылку Яндекс.Диска для фото:', path, err);
    }
}

async function fetchYandexPhotoDownloadUrl(path) {
    const params = new URLSearchParams({
        public_key: YANDEX_PHOTO_PUBLIC_KEY,
        path
    });
    const response = await fetch(`${YANDEX_PUBLIC_RESOURCE_DOWNLOAD_API}?${params.toString()}`);

    if (!response.ok) {
        throw new Error(`yandex_download_${response.status}`);
    }

    const data = await response.json();
    return data.href || '';
}

function ensurePhotoFancyboxDownloadButton() {
    if (!window.Fancybox) return;

    window.Fancybox.defaults = window.Fancybox.defaults || {};
    window.Fancybox.defaults.Toolbar = window.Fancybox.defaults.Toolbar || {};
    window.Fancybox.defaults.Toolbar.items = window.Fancybox.defaults.Toolbar.items || {};

    if (window.Fancybox.defaults.Toolbar.items.download) return;

    window.Fancybox.defaults.Toolbar.items.download = {
        tpl: [
            '<button class="f-button" title="Скачать" data-fancybox-download>',
            '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">',
            '<path d="M12 3v10m0 0 4-4m-4 4-4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
            '<path d="M4 17v3h16v-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
            '</svg>',
            '</button>'
        ].join('')
    };
}

function closePhotoFancybox() {
    if (window.Fancybox && isPhotoFancyboxOpen()) {
        window.Fancybox.close();
    }
}

function isPhotoFancyboxOpen() {
    return Boolean(document.querySelector('.fancybox__container'));
}

async function loadYandexPhotoGroup(source) {
    const cached = stationPhotoCache.get(source.path);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.result;
    }

    try {
        const photos = await collectYandexPhotos(source.path, 0);
        const result = {
            ...source,
            photos: photos.sort((a, b) => a.name.localeCompare(b.name, 'ru')),
            error: ''
        };
        stationPhotoCache.set(source.path, {
            result,
            expiresAt: Date.now() + PHOTO_CACHE_TTL_MS
        });
        return result;
    } catch (err) {
        const result = {
            ...source,
            photos: [],
            error: err.message || 'unknown_error'
        };
        stationPhotoCache.set(source.path, {
            result,
            expiresAt: Date.now() + PHOTO_CACHE_TTL_MS
        });
        return result;
    }
}

async function collectYandexPhotos(folderPath, depth) {
    const folder = await fetchYandexFolderItems(folderPath);

    if (!folder.exists) {
        return [];
    }

    const photos = [];
    const folders = [];

    folder.items.forEach(item => {
        if (item.type === 'file' && isPhotoResource(item)) {
            photos.push(normalizeYandexPhoto(item));
        } else if (item.type === 'dir' && item.path) {
            folders.push(item.path);
        }
    });

    if (depth < PHOTO_FOLDER_MAX_DEPTH) {
        const nestedPhotoLists = await Promise.all(
            folders.map(path => collectYandexPhotos(path, depth + 1))
        );

        nestedPhotoLists.forEach(list => photos.push(...list));
    }

    return photos.filter(photo => photo.previewUrl || photo.fullUrl);
}

async function fetchYandexFolderItems(folderPath) {
    const items = [];
    let offset = 0;
    let total = null;

    do {
        const params = new URLSearchParams({
            public_key: YANDEX_PHOTO_PUBLIC_KEY,
            path: folderPath,
            limit: String(PHOTO_FOLDER_LIMIT),
            offset: String(offset),
            preview_size: PHOTO_PREVIEW_SIZE,
            fields: 'path,name,type,media_type,mime_type,file,preview,sizes.name,sizes.url,_embedded.total,_embedded.items.path,_embedded.items.name,_embedded.items.type,_embedded.items.media_type,_embedded.items.mime_type,_embedded.items.file,_embedded.items.preview,_embedded.items.sizes.name,_embedded.items.sizes.url'
        });

        const response = await fetch(`${YANDEX_PUBLIC_RESOURCE_API}?${params.toString()}`);

        if (response.status === 404) {
            return { exists: false, items: [] };
        }

        if (!response.ok) {
            throw new Error(`Yandex Disk HTTP ${response.status}`);
        }

        const data = await response.json();
        const embedded = data._embedded || {};
        const pageItems = Array.isArray(embedded.items) ? embedded.items : [];

        items.push(...pageItems);
        total = Number.isFinite(Number(embedded.total)) ? Number(embedded.total) : items.length;
        offset += pageItems.length;

        if (pageItems.length === 0) {
            break;
        }
    } while (total !== null && offset < total);

    return { exists: true, items };
}

function isPhotoResource(item) {
    const name = item && item.name ? String(item.name) : '';
    const mimeType = item && item.mime_type ? String(item.mime_type) : '';

    if (isExcludedReferencePhotoName(name)) {
        return false;
    }

    return (
        item.media_type === 'image' ||
        mimeType.startsWith('image/') ||
        /\.(jpe?g|jfif|png|webp)$/i.test(name)
    );
}

function isExcludedReferencePhotoName(name) {
    return EXCLUDED_PHOTO_NAME_RE.test(String(name || ''));
}

function normalizeYandexPhoto(item) {
    return {
        name: item.name || 'Фото',
        previewUrl: getYandexPhotoSizeUrl(item, ['M', 'L', 'DEFAULT', 'S']) || item.preview || item.file || '',
        fullUrl: item.file || getYandexPhotoSizeUrl(item, ['ORIGINAL', 'XXXL', 'XXL', 'XL']) || item.preview || '',
        downloadUrl: item.file || getYandexPhotoSizeUrl(item, ['ORIGINAL', 'XXXL', 'XXL', 'XL']) || item.preview || '',
        path: item.path || ''
    };
}

function getYandexPhotoSizeUrl(item, preferredNames) {
    if (!Array.isArray(item.sizes)) {
        return '';
    }

    for (const preferredName of preferredNames) {
        const found = item.sizes.find(size => size.name === preferredName && size.url);
        if (found) {
            return found.url;
        }
    }

    return '';
}

function renderPhotoGroups(groups) {
    if (!groups || groups.length === 0) {
        return '<div class="map-photo-status">Для этой станции нет привязанных ОТО/ПТО.</div>';
    }

    const totalPhotos = groups.reduce((sum, group) => sum + group.photos.length, 0);
    const renderedGroups = groups.map(renderPhotoGroup).join('');

    if (totalPhotos === 0) {
        return [
            renderedGroups,
            '<div class="map-photo-status">Фото для этой станции на Яндекс.Диске не найдены.</div>'
        ].join('');
    }

    return renderedGroups;
}

function renderPhotoGroup(group) {
    const title = `${group.label} ${group.id}`;

    if (group.error) {
        return [
            '<div class="map-photo-group">',
            `<div class="map-photo-group__title">${escapeHtml(title)}</div>`,
            '<div class="map-photo-status error">Не удалось прочитать папку.</div>',
            '</div>'
        ].join('');
    }

    if (!group.photos.length) {
        return [
            '<div class="map-photo-group">',
            `<div class="map-photo-group__title">${escapeHtml(title)}</div>`,
            '<div class="map-photo-status">Фото не найдены.</div>',
            '</div>'
        ].join('');
    }

    const visiblePhotos = group.photos;
    const hiddenCount = group.photos.length - visiblePhotos.length;

    return [
        '<div class="map-photo-group">',
        `<div class="map-photo-group__title">${escapeHtml(title)} (${group.photos.length})</div>`,
        '<div class="map-photo-grid">',
        visiblePhotos.map(photo => renderPhotoLink(photo, title)).join(''),
        '</div>',
        hiddenCount > 0
            ? `<div class="map-photo-status">Показано ${visiblePhotos.length} из ${group.photos.length} фото.</div>`
            : '',
        '</div>'
    ].join('');
}

function renderPhotoLink(photo, title) {
    const href = photo.fullUrl || photo.downloadUrl || photo.previewUrl;
    const src = photo.previewUrl || photo.fullUrl;
    const caption = `${title}: ${photo.name}`;

    return [
        `<a class="map-photo-link" href="${escapeHtml(href)}" data-photo-open `,
        `data-photo-full="${escapeHtml(photo.fullUrl || href)}" `,
        `data-photo-preview="${escapeHtml(src)}" `,
        `data-photo-download-url="${escapeHtml(photo.downloadUrl || href)}" `,
        `data-photo-path="${escapeHtml(photo.path || '')}" `,
        `data-photo-name="${escapeHtml(photo.name)}" `,
        `data-photo-caption="${escapeHtml(caption)}" `,
        `data-photo-source="${escapeHtml(title)}" `,
        `title="${escapeHtml(caption)}" target="_blank" rel="noopener noreferrer">`,
        `<img src="${escapeHtml(src)}" alt="${escapeHtml(caption)}" loading="lazy" referrerpolicy="no-referrer">`,
        '</a>'
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

function sanitizeFilename(value) {
    const name = String(value || 'photo.jpg').trim() || 'photo.jpg';
    return name.replace(/[\\/:*?"<>|]/g, '_');
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
