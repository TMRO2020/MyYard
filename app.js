/* =========================================================
   APP.JS — logica aplicației
   Catalogul rămâne extern: catalogue.json.
   Structura este pregătită pentru pomi, arbuști și viță de vie.
   ========================================================= */

let map;
let treeObjects = [];
let isPlantingMode = false;

let solarGroup = L.layerGroup();
let windGroup = L.layerGroup();

/* -------------------- PLANIFICARE TEREN -------------------- */
// Perimetrul este stocat ca LatLng-uri reale, iar grila este calculată
// într-un sistem metric local: X = Est (+), Y = Nord (+).
let perimeterPoints = [];
let perimeterPolygon = null;
let perimeterVertexMarkers = [];
let perimeterDraftLine = null;
let isPerimeterDrawing = false;
let gridGroup = L.layerGroup();
let gridOriginMarker = null;
let gridSizeMeters = 1;
let snapMode = "cell";
let gridRenderer = null;

/* Poziționare GPS live: punct albastru + cerc de acuratețe. */
let gpsWatchId = null;
let gpsMarker = null;
let gpsAccuracyCircle = null;
let gpsHasCentered = false;

/* Linii de plantare: geometrie editabilă, ancorată geografic. */
let plantingLines = [];
let isPlantingLineDrawing = false;
let plantingLineDraftPoints = [];
let plantingLineDraftMarkers = [];
let plantingLineDraft = null;
let plantingLineMeasurementGroup = L.layerGroup();

let CATALOG_ITEMS = [];
let SPECIES_CONFIG = {};

let currentCenter = [45.9432, 24.9668];
const FAVORITE_KEY = "perma_fav_location_v2";

/* -------------------- UTILITARE -------------------- */

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort((a, b) =>
        String(a).localeCompare(String(b), "ro", { sensitivity: "base" })
    );
}

function getCategory(item) {
    return item.categorie || item.subcategorie || item.tip || "Alte plante";
}

function getSpecies(item) {
    return item.specie || item.nume || "Necunoscut";
}

function getVariety(item) {
    return item.soi || item.nume || "Fără soi";
}

function getSelectedItem() {
    return CATALOG_ITEMS.find(item => item.id === document.getElementById("variety-select").value);
}

/* -------------------- CATALOG -------------------- */

/**
 * Normalizează atât catalogul plat actual, cât și eventuale JSON-uri
 * viitoare cu categorii/subcategorii.
 */
function flattenCatalogue(jsonData) {
    const flat = [];

    if (Array.isArray(jsonData)) {
        jsonData.forEach(entry => {
            if (!entry || typeof entry !== "object") return;

            const nested = entry.subcategorii || entry.articole || entry.items;
            if (Array.isArray(nested)) {
                nested.forEach(item => {
                    flat.push({ ...item, _group: entry.categorie || entry.nume || "General" });
                });
            } else {
                flat.push({ ...entry });
            }
        });
    } else if (jsonData && typeof jsonData === "object") {
        Object.entries(jsonData).forEach(([key, value]) => {
            if (!Array.isArray(value)) return;
            value.forEach(item => flat.push({ ...item, _group: key }));
        });
    }

    return flat.filter(item => item.id);
}

/**
 * Construiește baza internă de date. Nu mai folosim un singur <select>
 * cu zeci/sute de soiuri: utilizatorul alege întâi specia, apoi soiul.
 */
function parseAndLoadCatalogue(jsonData) {
    CATALOG_ITEMS = flattenCatalogue(jsonData);
    SPECIES_CONFIG = {};

    CATALOG_ITEMS.forEach(item => {
        const ec = item.cerinte_ecologice || {};
        const dim = item.dimensiuni_maturitate || {};
        const species = getSpecies(item);
        const variety = getVariety(item);

        SPECIES_CONFIG[item.id] = {
            id: item.id,
            species,
            variety,
            category: getCategory(item),
            name: `${species} — ${variety}`,
            color: item.culoare_harta || "#2e7d32",
            defaultCrown: Number(dim.diametru_coroana_m) || 4,
            defaultHeight: Number(dim.inaltime_m) || 3,
            minDistance: Number(item.distanta_minima_plantare_m) || 4,
            kb:
                `<b>Categorie:</b> ${escapeHtml(getCategory(item))}<br>` +
                `<b>Expunere:</b> ${escapeHtml(ec.expunere_soare || "Nespecificat")}<br>` +
                `<b>Poziționare:</b> ${escapeHtml(ec.pozitionare_recomandata || "Nespecificat")}<br>` +
                `<b>Vânt:</b> ${escapeHtml(ec.sensibilitate_vant || "Nespecificat")}<br>` +
                `<b>Distanță minimă:</b> ${escapeHtml(item.distanta_minima_plantare_m ?? "Nespecificat")} m<br>` +
                `<b>Îngrijire:</b> ${escapeHtml(item.tratamente_si_ingrijire || "Nespecificat")}`
        };
    });

    populateCategorySelect();
    populateSpeciesSelect();
    populateVarietySelect();

    const speciesCount = uniqueSorted(CATALOG_ITEMS.map(getSpecies)).length;
    const categoryCount = uniqueSorted(CATALOG_ITEMS.map(getCategory)).length;

    document.getElementById("catalogue-summary").innerHTML =
        `<b>${CATALOG_ITEMS.length}</b> poziții în catalog · ` +
        `<b>${speciesCount}</b> specii · <b>${categoryCount}</b> categorii`;

    updateCounters();
}

/* Select 1: categorie */
function populateCategorySelect() {
    const select = document.getElementById("category-select");
    const previous = select.value;

    select.innerHTML = `<option value="">Toate categoriile</option>`;

    uniqueSorted(CATALOG_ITEMS.map(getCategory)).forEach(category => {
        const option = document.createElement("option");
        option.value = category;
        option.textContent = category;
        select.appendChild(option);
    });

    if ([...select.options].some(o => o.value === previous)) select.value = previous;
}

/* Select 2: specie */
function populateSpeciesSelect() {
    const category = document.getElementById("category-select").value;
    const select = document.getElementById("species-select");
    const previous = select.value;

    const species = uniqueSorted(
        CATALOG_ITEMS
            .filter(item => !category || getCategory(item) === category)
            .map(getSpecies)
    );

    select.innerHTML = `<option value="">1. Alege specia</option>`;
    species.forEach(name => {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = `${name} (${CATALOG_ITEMS.filter(i => getSpecies(i) === name && (!category || getCategory(i) === category)).length})`;
        select.appendChild(option);
    });

    if (species.includes(previous)) select.value = previous;
    populateVarietySelect();
}

/* Select 3: soi */
function populateVarietySelect() {
    const category = document.getElementById("category-select").value;
    const species = document.getElementById("species-select").value;
    const select = document.getElementById("variety-select");
    const previous = select.value;

    const items = CATALOG_ITEMS.filter(item =>
        (!category || getCategory(item) === category) &&
        (!species || getSpecies(item) === species)
    );

    select.innerHTML = `<option value="">2. Alege soiul</option>`;

    items
        .slice()
        .sort((a, b) => getVariety(a).localeCompare(getVariety(b), "ro"))
        .forEach(item => {
            const option = document.createElement("option");
            option.value = item.id;
            option.textContent = `${getVariety(item)} · coroană ${item.dimensiuni_maturitate?.diametru_coroana_m || "?"} m`;
            select.appendChild(option);
        });

    if (items.some(item => item.id === previous)) select.value = previous;
}

async function fetchDefaultCatalogue() {
    try {
        const response = await fetch("catalogue.json", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        parseAndLoadCatalogue(await response.json());
    } catch (error) {
        console.error("Nu am putut încărca catalogue.json:", error);
        document.getElementById("catalogue-summary").textContent =
            "catalogue.json nu a putut fi încărcat. Poți folosi butonul „Încarcă alt catalog JSON”.";
    }
}

function importCatalogueJSON(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = e => {
        try {
            parseAndLoadCatalogue(JSON.parse(e.target.result));
            alert("Catalog încărcat. Acum alegerea este: categorie → specie → soi.");
        } catch (error) {
            alert("Eroare catalog JSON: " + error.message);
        }
        event.target.value = "";
    };
    reader.readAsText(file);
}

/* -------------------- HARTĂ -------------------- */

function initMap() {
    const savedFavorite = localStorage.getItem(FAVORITE_KEY);
    if (savedFavorite) {
        try { currentCenter = JSON.parse(savedFavorite); } catch (_) {}
    }

    map = L.map("map", {
        zoomControl: false,
        tap: true,
        preferCanvas: true
    }).setView(currentCenter, 19);

    /*
     * Tile satelit. maxNativeZoom 19 înseamnă că la 20 Leaflet
     * poate mări ultimul nivel nativ. Dacă furnizorul schimbă
     * disponibilitatea tile-urilor, se poate înlocui URL-ul aici.
     */
    L.tileLayer("https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
        // Permitem apropierea mai mare pentru poziționarea fină.
        // Peste zoom-ul nativ imaginea va fi mărită/interpolată,
        // dar coordonata pomului rămâne geografic precisă.
        maxZoom: 23,
        maxNativeZoom: 19,
        attribution: "&copy; Google"
    }).addTo(map);

    gridRenderer = L.canvas({ padding: 0.5 });

    map.on("move", updateMicroclimateLayers);
    map.on("zoomend", () => {
        updateMicroclimateLayers();
        if (map.hasLayer(gridGroup)) updateGridLayer();
    });

    // Click-ul rămâne evenimentul principal. Pentru Android adăugăm și
    // un fallback pe touchend, în cazul în care browserul nu sintetizează
    // evenimentul click după o atingere scurtă.
    let lastTouchHandledAt = 0;
    map.getContainer().addEventListener("touchend", event => {
        if (!isPerimeterDrawing && !isPlantingLineDrawing) return;
        if (event.changedTouches.length !== 1) return;
        const touch = event.changedTouches[0];
        const rect = map.getContainer().getBoundingClientRect();
        const point = L.point(touch.clientX - rect.left, touch.clientY - rect.top);
        const latlng = map.containerPointToLatLng(point);
        lastTouchHandledAt = Date.now();
        if (isPerimeterDrawing) addPerimeterPoint(latlng);
        else addPlantingLinePoint(latlng);
    }, { passive: true });

    map.on("click", event => {
        // Dacă fallback-ul touchend a procesat deja aceeași atingere,
        // ignorăm click-ul sintetic pentru a evita dublarea punctului.
        if (Date.now() - lastTouchHandledAt < 500) return;
        // În modul de desenare, click-ul construiește perimetrul și nu plantează.
        if (isPerimeterDrawing) {
            addPerimeterPoint(event.latlng);
            return;
        }

        if (isPlantingLineDrawing) {
            addPlantingLinePoint(event.latlng);
            return;
        }

        if (!isPlantingMode) return;

        const selected = getSelectedItem();
        if (!selected) {
            alert("Alege întâi specia și apoi soiul.");
            return;
        }

        const placement = applySnapToLatLng(event.latlng);
        if (!placement.inside) {
            alert("Punctul ales este în afara perimetrului de plantare.");
            return;
        }

        addTreeToMap(placement.lat, placement.lng, selected.id);
    });

    document.getElementById("category-select").addEventListener("change", () => {
        populateSpeciesSelect();
    });
    document.getElementById("species-select").addEventListener("change", populateVarietySelect);

    fetchDefaultCatalogue();
    updateMicroclimateLayers();
}

/* -------------------- PLANIFICARE: PERIMETRU + GRID -------------------- */

function setPlanningButtonState(drawing) {
    const draw = document.getElementById("btn-draw-perimeter");
    const finish = document.getElementById("btn-finish-perimeter");
    const cancel = document.getElementById("btn-cancel-perimeter");
    if (draw) draw.disabled = drawing;
    if (finish) finish.disabled = !drawing || perimeterPoints.length < 3;
    if (cancel) cancel.disabled = !drawing;
}

function updatePerimeterStatus(message = null) {
    const el = document.getElementById("perimeter-status");
    if (!el) return;
    if (message) { el.textContent = message; return; }
    if (perimeterPoints.length < 3) {
        el.textContent = perimeterPoints.length
            ? `Puncte trasate: ${perimeterPoints.length}. Mai adaugă cel puțin ${3 - perimeterPoints.length}.`
            : "Niciun perimetru definit.";
        return;
    }
    const area = calculatePerimeterAreaM2();
    const perimeter = calculatePerimeterLengthM();
    el.innerHTML = `<b>Perimetru activ</b> · ${perimeter.toFixed(1)} m · suprafață ≈ ${formatArea(area)}`;
}

function formatArea(area) {
    if (!Number.isFinite(area)) return "—";
    return area >= 10000 ? `${(area / 10000).toFixed(2)} ha` : `${area.toFixed(0)} m²`;
}

function startPerimeterDrawing() {
    if (!map) return;

    // IMPORTANT pentru utilizarea pe telefon: meniul lateral ocupă aproape
    // tot ecranul. Îl închidem automat înainte ca utilizatorul să atingă
    // harta, altfel atingerile ar rămâne capturate de sidebar.
    closeSidebarForMapInteraction();
    if (isPlantingMode) stopPlantingMode();
    cancelPerimeterDrawing();
    isPerimeterDrawing = true;
    perimeterPoints = [];

    // În timpul desenării, dezactivăm temporar pan/zoom prin gesturi.
    // Astfel o atingere pe Android este interpretată sigur ca punct al perimetrului,
    // nu ca începutul unei deplasări a hărții.
    map.dragging.disable();
    map.doubleClickZoom.disable();
    document.getElementById("map").classList.add("perimeter-drawing");
    setPlanningButtonState(true);
    updatePerimeterStatus("Atinge colțurile zonei de plantare. Minimum 3 puncte.");
}

function addPerimeterPoint(latlng) {
    if (!isPerimeterDrawing) return;
    perimeterPoints.push(L.latLng(latlng.lat, latlng.lng));
    refreshPerimeterDraft();
    setPlanningButtonState(true);
    updatePerimeterStatus();
}

function refreshPerimeterDraft() {
    perimeterVertexMarkers.forEach(marker => map.removeLayer(marker));
    perimeterVertexMarkers = [];
    if (perimeterDraftLine) { map.removeLayer(perimeterDraftLine); perimeterDraftLine = null; }
    perimeterMeasurementGroup.clearLayers();
    if (!perimeterPoints.length) return;

    perimeterPoints.forEach((point, index) => {
        const marker = L.marker(point, {
            draggable: true,
            icon: L.divIcon({
                className: "perimeter-vertex",
                html: `<div title="Punct ${index + 1}"></div>`,
                iconSize: [18, 18],
                iconAnchor: [9, 9]
            }),
            zIndexOffset: 2500
        }).addTo(map);
        marker.on("drag", e => {
            perimeterPoints[index] = e.target.getLatLng();
            if (perimeterDraftLine) perimeterDraftLine.setLatLngs(perimeterPoints);
            updatePerimeterStatus();
        });
        marker.on("dragend", () => {
            if (perimeterDraftLine) perimeterDraftLine.setLatLngs(perimeterPoints);
            updatePerimeterStatus();
        });
        perimeterVertexMarkers.push(marker);
    });

    if (perimeterPoints.length >= 2) {
        perimeterDraftLine = L.polyline(perimeterPoints, {
            color: "#e8a317", weight: 3, dashArray: "7,6", opacity: .9,
            renderer: gridRenderer || undefined,
            interactive: false
        }).addTo(map);
    }
    updatePerimeterMeasurements(false);
}

function finishPerimeterDrawing() {
    if (!isPerimeterDrawing || perimeterPoints.length < 3) return;
    isPerimeterDrawing = false;
    document.getElementById("map").classList.remove("perimeter-drawing");
    restoreMapInteraction();
    setPlanningButtonState(false);

    // Transformăm linia de schiță în geometrie definitivă și păstrăm
    // doar un set de mânere editabile pentru colțurile perimetrului.
    if (perimeterDraftLine && map) map.removeLayer(perimeterDraftLine);
    perimeterDraftLine = null;
    perimeterVertexMarkers.forEach(marker => map && map.removeLayer(marker));
    perimeterVertexMarkers = [];

    updatePerimeterGeometry();
    updatePerimeterMeasurements(true);
    updatePerimeterStatus();
}

function restoreMapInteraction() {
    if (!map) return;
    map.dragging.enable();
    map.doubleClickZoom.enable();
}

function cancelPerimeterDrawing() {
    isPerimeterDrawing = false;
    document.getElementById("map")?.classList.remove("perimeter-drawing");
    restoreMapInteraction();
    if (perimeterDraftLine && map) map.removeLayer(perimeterDraftLine);
    perimeterDraftLine = null;
    perimeterVertexMarkers.forEach(marker => map && map.removeLayer(marker));
    perimeterVertexMarkers = [];
    setPlanningButtonState(false);
    if (!perimeterPolygon) {
        perimeterPoints = [];
        perimeterMeasurementGroup.clearLayers();
    } else {
        updatePerimeterMeasurements(true);
    }
    updatePerimeterStatus();
}

function clearPerimeter() {
    cancelPerimeterDrawing();
    if (perimeterPolygon && map) map.removeLayer(perimeterPolygon);
    perimeterPolygon = null;
    perimeterPoints = [];
    perimeterVertexMarkers.forEach(marker => map && map.removeLayer(marker));
    perimeterVertexMarkers = [];
    if (gridOriginMarker && map) map.removeLayer(gridOriginMarker);
    gridOriginMarker = null;
    gridGroup.clearLayers();
    if (map?.hasLayer(gridGroup)) map.removeLayer(gridGroup);
    perimeterMeasurementGroup.clearLayers();
    clearPlantingLines(false);
    const toggle = document.getElementById("grid-toggle");
    if (toggle) toggle.checked = false;
    updatePerimeterStatus("Niciun perimetru definit.");
    document.getElementById("grid-status").textContent = "Grila este oprită.";
}

function updatePerimeterGeometry() {
    if (perimeterPoints.length < 3) return;
    if (perimeterPolygon && map) map.removeLayer(perimeterPolygon);
    perimeterPolygon = L.polygon(perimeterPoints, {
        color: "#1f6b3a", weight: 3, fillColor: "#1f6b3a", fillOpacity: .08,
        interactive: false
    }).addTo(map);

    perimeterPolygon.bindTooltip("Zona de plantare", { className: "perimeter-label", sticky: true });

    // După închiderea perimetrului, punctele rămân editabile.
    perimeterPoints.forEach((point, index) => {
        const marker = L.marker(point, {
            draggable: true,
            icon: L.divIcon({
                className: "perimeter-vertex",
                html: `<div title="Colț ${index + 1}"></div>`,
                iconSize: [18, 18], iconAnchor: [9, 9]
            }),
            zIndexOffset: 2500
        }).addTo(map);
        marker.on("drag", e => {
            perimeterPoints[index] = e.target.getLatLng();
            perimeterPolygon.setLatLngs(perimeterPoints);
            if (map.hasLayer(gridGroup)) updateGridLayer();
            updatePerimeterMeasurements(true);
            updatePerimeterStatus();
        });
        marker.on("dragend", () => {
            perimeterPolygon.setLatLngs(perimeterPoints);
            updatePerimeterStatus();
            updatePerimeterMeasurements(true);
            if (map.hasLayer(gridGroup)) updateGridLayer();
        });
        perimeterVertexMarkers.push(marker);
    });

    if (gridOriginMarker) map.removeLayer(gridOriginMarker);
    gridOriginMarker = L.marker(perimeterPoints[0], {
        interactive: false,
        icon: L.divIcon({ className: "grid-origin-marker", html: "<div></div>", iconSize: [10,10], iconAnchor: [5,5] })
    }).addTo(map);

    if (map.hasLayer(gridGroup)) updateGridLayer();
}

function updatePerimeterMeasurements(closed = true) {
    if (!map) return;
    perimeterMeasurementGroup.clearLayers();
    if (perimeterPoints.length < 2) return;

    const segmentCount = closed ? perimeterPoints.length : perimeterPoints.length - 1;
    for (let i = 0; i < segmentCount; i++) {
        const a = perimeterPoints[i];
        const b = perimeterPoints[(i + 1) % perimeterPoints.length];
        const distance = map.distance(a, b);
        const mid = L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
        const label = L.marker(mid, {
            interactive: false,
            icon: L.divIcon({
                className: "perimeter-distance-label",
                html: `<span>L${i + 1}: ${distance.toFixed(1)} m</span>`,
                iconSize: null,
                iconAnchor: [0, 0]
            }),
            zIndexOffset: 2400
        }).addTo(perimeterMeasurementGroup);
    }
    perimeterMeasurementGroup.addTo(map);
}

function projectToLocalMeters(latlng, origin) {
    const R = 6378137;
    const lat0 = origin.lat * Math.PI / 180;
    return {
        x: (latlng.lng - origin.lng) * Math.PI / 180 * R * Math.cos(lat0),
        y: (latlng.lat - origin.lat) * Math.PI / 180 * R
    };
}

function localMetersToLatLng(x, y, origin) {
    const R = 6378137;
    const lat0 = origin.lat * Math.PI / 180;
    return L.latLng(
        origin.lat + (y / R) * 180 / Math.PI,
        origin.lng + (x / (R * Math.cos(lat0))) * 180 / Math.PI
    );
}

function getLocalPerimeter() {
    if (perimeterPoints.length < 3) return null;
    const origin = perimeterPoints[0];
    return {
        origin,
        points: perimeterPoints.map(p => projectToLocalMeters(p, origin))
    };
}

function calculatePerimeterAreaM2() {
    const local = getLocalPerimeter();
    if (!local) return 0;
    let sum = 0;
    for (let i = 0; i < local.points.length; i++) {
        const a = local.points[i];
        const b = local.points[(i + 1) % local.points.length];
        sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
}

function calculatePerimeterLengthM() {
    if (perimeterPoints.length < 2) return 0;
    let total = 0;
    for (let i = 0; i < perimeterPoints.length; i++) {
        total += map.distance(perimeterPoints[i], perimeterPoints[(i + 1) % perimeterPoints.length]);
    }
    return total;
}

function pointInPolygonXY(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        const intersects = ((yi > point.y) !== (yj > point.y)) &&
            (point.x < (xj - xi) * (point.y - yi) / ((yj - yi) || 1e-12) + xi);
        if (intersects) inside = !inside;
    }
    return inside;
}

// Intersecțiile unei linii verticale/orizontale cu poligonul. Sortarea +
// împerecherea segmentelor produce doar porțiunile de grilă aflate în teren.
function clippedGridSegments(local, axis, value) {
    const hits = [];
    const pts = local.points;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const aVal = axis === "x" ? a.x : a.y;
        const bVal = axis === "x" ? b.x : b.y;
        if ((aVal <= value && bVal >= value) || (aVal >= value && bVal <= value)) {
            const d = bVal - aVal;
            if (Math.abs(d) < 1e-12) continue;
            const t = (value - aVal) / d;
            if (t >= -1e-9 && t <= 1 + 1e-9) {
                const otherA = axis === "x" ? a.y : a.x;
                const otherB = axis === "x" ? b.y : b.x;
                hits.push(otherA + (otherB - otherA) * t);
            }
        }
    }
    hits.sort((a,b) => a-b);
    const unique = [];
    hits.forEach(v => { if (!unique.length || Math.abs(v - unique.at(-1)) > 1e-7) unique.push(v); });
    const segments = [];
    for (let i = 0; i + 1 < unique.length; i += 2) {
        const mid = (unique[i] + unique[i+1]) / 2;
        const point = axis === "x" ? { x: value, y: mid } : { x: mid, y: value };
        if (pointInPolygonXY(point, pts)) segments.push([unique[i], unique[i+1]]);
    }
    return segments;
}

function updateGridLayer() {
    if (!map || perimeterPoints.length < 3) return;
    gridGroup.clearLayers();
    const local = getLocalPerimeter();
    const pts = local.points;
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const minX = Math.floor(Math.min(...xs) / gridSizeMeters) * gridSizeMeters;
    const maxX = Math.ceil(Math.max(...xs) / gridSizeMeters) * gridSizeMeters;
    const minY = Math.floor(Math.min(...ys) / gridSizeMeters) * gridSizeMeters;
    const maxY = Math.ceil(Math.max(...ys) / gridSizeMeters) * gridSizeMeters;

    const estimatedCells = Math.max(0, (maxX - minX) / gridSizeMeters) * Math.max(0, (maxY - minY) / gridSizeMeters);
    const status = document.getElementById("grid-status");
    if (estimatedCells > 12000) {
        status.textContent = `Suprafața este mare (~${Math.round(estimatedCells).toLocaleString("ro-RO")} celule). Se afișează grila în modul optimizat.`;
    } else {
        status.textContent = `Grilă ${gridSizeMeters} × ${gridSizeMeters} m · orientată N–S / E–V · ~${Math.round(estimatedCells).toLocaleString("ro-RO")} celule.`;
    }

    const maxLines = 6000;
    let lineCount = 0;
    const lineOptions = { color: "#ffffff", weight: gridSizeMeters <= 1 ? 1 : 1.3, opacity: .52, interactive: false, renderer: gridRenderer || undefined, className: "grid-line" };

    for (let x = minX; x <= maxX + gridSizeMeters/2; x += gridSizeMeters) {
        if (++lineCount > maxLines) break;
        clippedGridSegments(local, "x", x).forEach(([y1,y2]) => {
            L.polyline([localMetersToLatLng(x,y1,local.origin), localMetersToLatLng(x,y2,local.origin)], lineOptions).addTo(gridGroup);
        });
    }
    if (lineCount <= maxLines) {
        for (let y = minY; y <= maxY + gridSizeMeters/2; y += gridSizeMeters) {
            if (++lineCount > maxLines) break;
            clippedGridSegments(local, "y", y).forEach(([x1,x2]) => {
                L.polyline([localMetersToLatLng(x1,y,local.origin), localMetersToLatLng(x2,y,local.origin)], lineOptions).addTo(gridGroup);
            });
        }
    }

    if (lineCount > maxLines) {
        status.textContent += " Grila a fost limitată pentru performanță; mărește pasul la 2–5 m dacă este nevoie.";
    }
}

function toggleGridLayer(enabled) {
    if (!map) return;
    if (enabled) {
        if (perimeterPoints.length < 3) {
            document.getElementById("grid-toggle").checked = false;
            alert("Desenează și închide mai întâi perimetrul zonei de plantare.");
            return;
        }
        gridGroup.addTo(map);
        updateGridLayer();
    } else {
        map.removeLayer(gridGroup);
        document.getElementById("grid-status").textContent = "Grila este oprită.";
    }
}

function setGridSize(value) {
    const n = Number(value);
    if (![0.5, 1, 2, 5].includes(n)) return;
    gridSizeMeters = n;
    if (map?.hasLayer(gridGroup)) updateGridLayer();
}

function setSnapMode(value) {
    snapMode = ["off", "cell", "grid", "line"].includes(value) ? value : "off";
    updatePlantingLineStatus();
}

function applySnapToLatLng(latlng) {
    if (snapMode === "line") {
        const lineSnap = applySnapToPlantingLine(latlng);
        if (lineSnap) return lineSnap;
        return { lat: latlng.lat, lng: latlng.lng, inside: true };
    }
    if (perimeterPoints.length < 3 || snapMode === "off") {
        return { lat: latlng.lat, lng: latlng.lng, inside: true };
    }
    const local = getLocalPerimeter();
    const p = projectToLocalMeters(latlng, local.origin);
    const step = gridSizeMeters;
    const x = snapMode === "cell" ? (Math.floor(p.x / step) + .5) * step : Math.round(p.x / step) * step;
    const y = snapMode === "cell" ? (Math.floor(p.y / step) + .5) * step : Math.round(p.y / step) * step;
    const snapped = { x, y };
    const snappedLatLng = localMetersToLatLng(x, y, local.origin);
    return {
        lat: snappedLatLng.lat,
        lng: snappedLatLng.lng,
        inside: pointInPolygonXY(snapped, local.points)
    };
}

/* -------------------- LINII DE PLANTARE -------------------- */

function setPlantingLineButtonState(drawing) {
    const add = document.getElementById("btn-add-planting-line");
    const cancel = document.getElementById("btn-cancel-planting-line");
    if (add) add.disabled = drawing;
    if (cancel) cancel.disabled = !drawing;
}

function updatePlantingLineStatus(message = null) {
    const el = document.getElementById("line-status");
    if (!el) return;
    if (message) { el.textContent = message; return; }
    if (isPlantingLineDrawing) {
        el.textContent = plantingLineDraftPoints.length === 0
            ? "Alege celula/punctul de START al liniei."
            : "Alege celula/punctul de FINAL al liniei.";
        return;
    }
    if (!plantingLines.length) {
        el.textContent = "Nicio linie de plantare definită.";
        return;
    }
    const distances = plantingLines.map((line, i) => `L${i + 1}: ${lineDistanceMeters(line).toFixed(1)} m`);
    el.textContent = `${plantingLines.length} ${plantingLines.length === 1 ? "linie" : "linii"} · ${distances.join(" · ")}`;
}

function snapPointToGridCell(latlng) {
    if (perimeterPoints.length < 3 || !map.hasLayer(gridGroup)) return { lat: latlng.lat, lng: latlng.lng, inside: true };
    const local = getLocalPerimeter();
    const p = projectToLocalMeters(latlng, local.origin);
    const step = gridSizeMeters;
    const x = (Math.floor(p.x / step) + 0.5) * step;
    const y = (Math.floor(p.y / step) + 0.5) * step;
    const snapped = { x, y };
    const point = localMetersToLatLng(x, y, local.origin);
    return { lat: point.lat, lng: point.lng, inside: pointInPolygonXY(snapped, local.points) };
}

function snapPointToGridIntersection(latlng) {
    if (perimeterPoints.length < 3 || !map.hasLayer(gridGroup)) return { lat: latlng.lat, lng: latlng.lng, inside: true };
    const local = getLocalPerimeter();
    const p = projectToLocalMeters(latlng, local.origin);
    const step = gridSizeMeters;
    const x = Math.round(p.x / step) * step;
    const y = Math.round(p.y / step) * step;
    const snapped = { x, y };
    const point = localMetersToLatLng(x, y, local.origin);
    return { lat: point.lat, lng: point.lng, inside: pointInPolygonXY(snapped, local.points) };
}

function startPlantingLineDrawing() {
    if (!map) return;

    // Închidem automat meniul pentru ca utilizatorul să poată alege
    // punctele A și B direct pe hartă, inclusiv pe ecrane mici.
    closeSidebarForMapInteraction();
    if (perimeterPoints.length < 3) {
        alert("Desenează și închide mai întâi perimetrul.");
        return;
    }
    if (!map.hasLayer(gridGroup)) {
        alert("Activează mai întâi grila metrică. Linia folosește celulele grilei pentru start și final.");
        return;
    }
    stopPlantingMode();
    cancelPlantingLineDrawing();
    isPlantingLineDrawing = true;
    plantingLineDraftPoints = [];
    map.dragging.disable();
    map.doubleClickZoom.disable();
    document.getElementById("map").classList.add("planting-line-drawing");
    setPlantingLineButtonState(true);
    updatePlantingLineStatus();
}

function addPlantingLinePoint(latlng) {
    if (!isPlantingLineDrawing) return;
    const snapped = snapPointToGridCell(latlng);
    if (!snapped.inside) {
        alert("Punctul liniei trebuie să fie în interiorul perimetrului.");
        return;
    }
    const point = L.latLng(snapped.lat, snapped.lng);
    plantingLineDraftPoints.push(point);
    refreshPlantingLineDraft();

    if (plantingLineDraftPoints.length === 2) {
        createPlantingLine(plantingLineDraftPoints[0], plantingLineDraftPoints[1]);
        cancelPlantingLineDrawing();
    }
}

function refreshPlantingLineDraft() {
    plantingLineDraftMarkers.forEach(m => map.removeLayer(m));
    plantingLineDraftMarkers = [];
    if (plantingLineDraft) { map.removeLayer(plantingLineDraft); plantingLineDraft = null; }

    plantingLineDraftPoints.forEach((point, index) => {
        const marker = L.marker(point, {
            draggable: true,
            icon: L.divIcon({
                className: "planting-line-handle",
                html: `<div>${index === 0 ? "A" : "B"}</div>`,
                iconSize: [28, 28], iconAnchor: [14, 14]
            }),
            zIndexOffset: 2700
        }).addTo(map);
        marker.on("drag", e => {
            plantingLineDraftPoints[index] = e.target.getLatLng();
            refreshPlantingLineDraft();
        });
        plantingLineDraftMarkers.push(marker);
    });

    if (plantingLineDraftPoints.length === 2) {
        plantingLineDraft = L.polyline(plantingLineDraftPoints, { color: "#e8a317", weight: 4, dashArray: "8,6", interactive: false }).addTo(map);
    }
    updatePlantingLineStatus();
}

function lineDistanceMeters(line) {
    return map.distance(line.start, line.end);
}

function createPlantingLine(start, end, savedData = null) {
    const data = savedData || {
        id: `line_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        start: [start.lat, start.lng],
        end: [end.lat, end.lng]
    };
    const a = L.latLng(data.start[0], data.start[1]);
    const b = L.latLng(data.end[0], data.end[1]);
    const line = L.polyline([a, b], { color: "#f59e0b", weight: 4, opacity: .9, dashArray: "10,6" }).addTo(map);
    const obj = { id: data.id, start: a, end: b, line, startMarker: null, endMarker: null, labelMarker: null };
    plantingLines.push(obj);

    const makeHandle = (point, label, index) => {
        const marker = L.marker(point, {
            draggable: true,
            icon: L.divIcon({ className: "planting-line-handle", html: `<div>${label}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
            zIndexOffset: 2600
        }).addTo(map);
        marker.on("drag", e => {
            const p = e.target.getLatLng();
            if (perimeterPoints.length >= 3 && !pointInPolygonXY(projectToLocalMeters(p, perimeterPoints[0]), getLocalPerimeter().points)) {
                return;
            }
            if (index === 0) obj.start = p; else obj.end = p;
            obj.line.setLatLngs([obj.start, obj.end]);
            updatePlantingLineVisuals(obj);
        });
        marker.on("dragend", e => {
            let p = e.target.getLatLng();
            // Pentru capetele liniei, modul „Linie” înseamnă libertate de mișcare;
            // snap-ul la grilă se aplică doar dacă utilizatorul alege Cell/Intersecție.
            if (["cell", "grid"].includes(snapMode) && map.hasLayer(gridGroup)) {
                const snapped = snapMode === "cell"
                    ? snapPointToGridCell(p)
                    : snapPointToGridIntersection(p);
                if (snapped.inside) p = L.latLng(snapped.lat, snapped.lng);
            }
            if (perimeterPoints.length >= 3 && !pointInPolygonXY(projectToLocalMeters(p, perimeterPoints[0]), getLocalPerimeter().points)) {
                e.target.setLatLng(index === 0 ? obj.start : obj.end);
                return;
            }
            e.target.setLatLng(p);
            if (index === 0) obj.start = p; else obj.end = p;
            obj.line.setLatLngs([obj.start, obj.end]);
            updatePlantingLineVisuals(obj);
        });
        return marker;
    };

    obj.startMarker = makeHandle(a, "A", 0);
    obj.endMarker = makeHandle(b, "B", 1);
    updatePlantingLineVisuals(obj);
    updatePlantingLineStatus();
}

function updatePlantingLineVisuals(obj) {
    obj.line.setLatLngs([obj.start, obj.end]);
    if (obj.labelMarker) map.removeLayer(obj.labelMarker);
    const mid = L.latLng((obj.start.lat + obj.end.lat) / 2, (obj.start.lng + obj.end.lng) / 2);
    obj.labelMarker = L.marker(mid, {
        interactive: false,
        icon: L.divIcon({ className: "planting-line-distance", html: `<span>${lineDistanceMeters(obj).toFixed(1)} m</span>`, iconSize: null, iconAnchor: [0, 0] }),
        zIndexOffset: 2550
    }).addTo(map);
    updatePlantingLineStatus();
}

function cancelPlantingLineDrawing() {
    isPlantingLineDrawing = false;
    document.getElementById("map")?.classList.remove("planting-line-drawing");
    restoreMapInteraction();
    plantingLineDraftMarkers.forEach(m => map && map.removeLayer(m));
    plantingLineDraftMarkers = [];
    if (plantingLineDraft && map) map.removeLayer(plantingLineDraft);
    plantingLineDraft = null;
    plantingLineDraftPoints = [];
    setPlantingLineButtonState(false);
    updatePlantingLineStatus();
}

function clearPlantingLines(showMessage = true) {
    cancelPlantingLineDrawing();
    plantingLines.forEach(obj => {
        if (obj.line) map.removeLayer(obj.line);
        if (obj.startMarker) map.removeLayer(obj.startMarker);
        if (obj.endMarker) map.removeLayer(obj.endMarker);
        if (obj.labelMarker) map.removeLayer(obj.labelMarker);
    });
    plantingLines = [];
    if (showMessage) updatePlantingLineStatus("Nicio linie de plantare definită.");
}

function nearestPointOnSegmentXY(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-12) return { x: a.x, y: a.y, t: 0 };
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    return { x: a.x + t * dx, y: a.y + t * dy, t };
}

function applySnapToPlantingLine(latlng) {
    if (snapMode !== "line" || !plantingLines.length || perimeterPoints.length < 3) return null;
    const local = getLocalPerimeter();
    const p = projectToLocalMeters(latlng, local.origin);
    let best = null;
    plantingLines.forEach(obj => {
        const a = projectToLocalMeters(obj.start, local.origin);
        const b = projectToLocalMeters(obj.end, local.origin);
        const q = nearestPointOnSegmentXY(p, a, b);
        const dx = q.x - p.x, dy = q.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (!best || d2 < best.d2) best = { q, d2 };
    });
    if (!best) return null;
    const snapped = localMetersToLatLng(best.q.x, best.q.y, local.origin);
    return { lat: snapped.lat, lng: snapped.lng, inside: pointInPolygonXY(best.q, local.points), distance: Math.sqrt(best.d2) };
}

function serializePerimeter() {
    return perimeterPoints.map(p => [p.lat, p.lng]);
}

function restorePerimeter(points) {
    if (!Array.isArray(points) || points.length < 3) return;
    clearPerimeter();
    perimeterPoints = points
        .filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
        .map(p => L.latLng(p[0], p[1]));
    if (perimeterPoints.length < 3) { perimeterPoints = []; return; }
    updatePerimeterGeometry();
    updatePerimeterStatus();
}

/* -------------------- PLANTARE -------------------- */

function startPlantingMode() {
    const selected = getSelectedItem();
    if (!selected) {
        alert("Alege întâi categoria (opțional), specia și soiul.");
        return;
    }

    isPlantingMode = true;
    document.getElementById("map").classList.add("planting-active");
    document.getElementById("btn-start-plant").style.display = "none";
    document.getElementById("btn-stop-plant").style.display = "block";
    document.getElementById("planting-badge").style.display = "block";
}

function stopPlantingMode() {
    isPlantingMode = false;
    document.getElementById("map").classList.remove("planting-active");
    document.getElementById("btn-start-plant").style.display = "block";
    document.getElementById("btn-stop-plant").style.display = "none";
    document.getElementById("planting-badge").style.display = "none";

    treeObjects.forEach(obj => updateMarkerVisualState(obj, false));
}

function addTreeToMap(lat, lng, speciesKey, savedData = null) {
    const species = SPECIES_CONFIG[speciesKey] || {
        name: "Plantă nespecificată",
        species: "Necunoscut",
        variety: "Necunoscut",
        category: "Alte plante",
        color: "#2e7d32",
        defaultCrown: 4,
        defaultHeight: 3,
        kb: "Fără date."
    };

    const treeData = savedData || {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        speciesKey,
        species: species.species,
        variety: species.variety,
        category: species.category,
        height: species.defaultHeight,
        crownDiameter: species.defaultCrown,
        age: 2,
        plantedAt: new Date().toISOString()
    };

    const marker = L.marker([lat, lng], {
        icon: createTreeIcon(species.color),
        draggable: true, // mereu activ: utilizatorul poate regla poziția cu degetul
        autoPan: true,
        zIndexOffset: 1000
    }).addTo(map);

    const crownCircle = L.circle([lat, lng], {
        radius: Math.max(0.25, Number(treeData.crownDiameter) / 2),
        color: species.color,
        fillColor: species.color,
        fillOpacity: 0.28,
        weight: 2,
        dashArray: isPlantingMode ? "5,5" : null
    }).addTo(map);

    const treeObj = { id: treeData.id, treeData, marker, crownCircle };
    treeObjects.push(treeObj);

    bindTreePopup(treeObj);

    marker.on("drag", e => {
        crownCircle.setLatLng(e.target.getLatLng());
    });

    marker.on("dragend", e => {
        let p = e.target.getLatLng();
        if (perimeterPoints.length >= 3 && snapMode !== "off") {
            const snapped = applySnapToLatLng(p);
            if (snapped.inside) {
                p = L.latLng(snapped.lat, snapped.lng);
                e.target.setLatLng(p);
            }
        }
        if (perimeterPoints.length >= 3 && !pointInPolygonXY(projectToLocalMeters(p, perimeterPoints[0]), getLocalPerimeter().points)) {
            alert("Pomul trebuie să rămână în interiorul perimetrului de plantare.");
            return;
        }
        crownCircle.setLatLng(p);
        analizeazaCompatibilitateMediu(p.lat, p.lng, treeObj);
        updateCounters();
    });

    crownCircle.on("click", () => marker.openPopup());

    analizeazaCompatibilitateMediu(lat, lng, treeObj);
    updateCounters();
}

function createTreeIcon(color) {
    return L.divIcon({
        className: "tree-center-point",
        html: `<div style="
            width:16px;height:16px;border-radius:50%;
            background:${escapeHtml(color)};
            border:2px solid #fff;
            box-shadow:0 1px 6px rgba(0,0,0,.65);
        "></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });
}

function updateMarkerVisualState(treeObj, moving) {
    treeObj.crownCircle.setStyle({
        dashArray: moving ? "6,6" : null,
        weight: moving ? 3 : 2
    });
}

function activateSingleMove(id) {
    const obj = treeObjects.find(t => String(t.id) === String(id));
    if (!obj) return;

    obj.marker.dragging.enable();
    updateMarkerVisualState(obj, true);
    map.closePopup();
    alert("Poți trage acum punctul cu degetul. El rămâne fixat geografic pe hartă.");
}

/* -------------------- FIȘA TEHNICĂ -------------------- */

function bindTreePopup(treeObj) {
    const data = treeObj.treeData;
    const species = SPECIES_CONFIG[data.speciesKey] || {};

    const popupContent = `
        <div class="tree-popup">
            <h3>${escapeHtml(species.name || `${data.species} — ${data.variety}`)}</h3>
            <div class="meta">🌱 ${escapeHtml(data.category || species.category || "")}</div>

            <label>Diametru coroană (m)</label>
            <input type="number" id="pop-crown-${data.id}" value="${Number(data.crownDiameter) || 1}" step="0.1" min="0.1"
                oninput="updateTreeDiameter('${data.id}')">

            <label>Înălțime curentă (m)</label>
            <input type="number" id="pop-height-${data.id}" value="${Number(data.height) || 0}" step="0.1" min="0"
                onchange="updateTreeDetails('${data.id}')">

            <label>Vârstă estimată (ani)</label>
            <input type="number" id="pop-age-${data.id}" value="${Number(data.age) || 0}" step="1" min="0"
                onchange="updateTreeDetails('${data.id}')">

            <div class="knowledge-base">
                ${species.kb || "Fără informații suplimentare."}
            </div>

            <div class="popup-actions">
                <button class="btn-small btn-move" onclick="activateSingleMove('${data.id}')">✋ Mută</button>
                <button class="btn-small btn-danger" onclick="deleteTree('${data.id}')">🗑️ Șterge</button>
            </div>
        </div>
    `;

    treeObj.marker.bindPopup(popupContent, { maxWidth: 330 });
    treeObj.crownCircle.bindPopup(popupContent, { maxWidth: 330 });
}

function updateTreeDiameter(id) {
    const obj = treeObjects.find(t => String(t.id) === String(id));
    if (!obj) return;

    const input = document.getElementById(`pop-crown-${id}`);
    const value = Math.max(0.1, parseFloat(input?.value) || 1);
    obj.treeData.crownDiameter = value;
    obj.crownCircle.setRadius(value / 2);
    updateCounters();
}

function updateTreeDetails(id) {
    const obj = treeObjects.find(t => String(t.id) === String(id));
    if (!obj) return;

    const h = parseFloat(document.getElementById(`pop-height-${id}`)?.value);
    const a = parseInt(document.getElementById(`pop-age-${id}`)?.value, 10);

    obj.treeData.height = Number.isFinite(h) ? h : 0;
    obj.treeData.age = Number.isFinite(a) ? a : 0;
    updateCounters();
}

function deleteTree(id) {
    const index = treeObjects.findIndex(t => String(t.id) === String(id));
    if (index === -1) return;

    map.removeLayer(treeObjects[index].marker);
    map.removeLayer(treeObjects[index].crownCircle);
    treeObjects.splice(index, 1);
    updateCounters();
}

/* -------------------- CONTOR -------------------- */

function getPlantationCounts() {
    const bySpecies = {};
    const byVariety = {};

    treeObjects.forEach(obj => {
        const species = obj.treeData.species || SPECIES_CONFIG[obj.treeData.speciesKey]?.species || "Necunoscut";
        const variety = obj.treeData.variety || SPECIES_CONFIG[obj.treeData.speciesKey]?.variety || "Fără soi";

        bySpecies[species] = (bySpecies[species] || 0) + 1;

        const key = `${species}|||${variety}`;
        byVariety[key] = (byVariety[key] || 0) + 1;
    });

    return { total: treeObjects.length, bySpecies, byVariety };
}

function updateCounters() {
    if (!map) return;

    const counts = getPlantationCounts();
    document.getElementById("tree-total").textContent = counts.total;

    const speciesLines = Object.entries(counts.bySpecies)
        .sort((a,b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, count]) => `${name}: ${count}`);

    document.getElementById("counter-breakdown").textContent =
        speciesLines.length ? speciesLines.join(" · ") : "Nicio plantă";

    const details = document.getElementById("counter-details");
    const speciesRows = Object.entries(counts.bySpecies)
        .sort((a,b) => a[0].localeCompare(b[0], "ro"))
        .map(([name,count]) => `<div class="stats-row"><span>${escapeHtml(name)}</span><b>${count}</b></div>`)
        .join("");

    const varietyRows = Object.entries(counts.byVariety)
        .sort((a,b) => a[0].localeCompare(b[0], "ro"))
        .map(([key,count]) => {
            const [species,variety] = key.split("|||");
            return `<div class="stats-row"><span>${escapeHtml(species)} — ${escapeHtml(variety)}</span><b>${count}</b></div>`;
        }).join("");

    details.innerHTML = `
        <b>Total: ${counts.total}</b>
        <div class="section-title">Pe specii</div>
        ${speciesRows || "—"}
        <div class="section-title">Pe soiuri</div>
        ${varietyRows || "—"}
    `;

    document.getElementById("sidebar-stats").innerHTML = `
        <b>Total: ${counts.total}</b>
        <div class="section-title">Pe specii</div>
        ${speciesRows || "—"}
    `;
}

function toggleCounterDetails() {
    document.getElementById("counter-details").classList.toggle("open");
}

/* -------------------- LOCAȚIE -------------------- */

function toggleSidebar() {
    document.getElementById("sidebar").classList.toggle("active");
}

function closeSidebarForMapInteraction() {
    const sidebar = document.getElementById("sidebar");
    if (sidebar?.classList.contains("active")) {
        sidebar.classList.remove("active");
        // După animația sidebarului, Leaflet își recalculează zona vizibilă.
        setTimeout(() => map?.invalidateSize({ pan: false }), 320);
    }
}

function updateGPSVisuals(lat, lng, accuracy) {
    const point = L.latLng(lat, lng);
    if (!gpsMarker) {
        gpsMarker = L.circleMarker(point, {
            radius: 7,
            color: "#ffffff",
            weight: 3,
            fillColor: "#1976d2",
            fillOpacity: 1,
            interactive: false,
            pane: "markerPane"
        }).addTo(map);
    } else {
        gpsMarker.setLatLng(point);
    }

    if (Number.isFinite(accuracy) && accuracy > 0) {
        if (!gpsAccuracyCircle) {
            gpsAccuracyCircle = L.circle(point, {
                radius: accuracy,
                color: "#1976d2",
                weight: 1,
                fillColor: "#1976d2",
                fillOpacity: 0.10,
                interactive: false
            }).addTo(map);
        } else {
            gpsAccuracyCircle.setLatLng(point);
            gpsAccuracyCircle.setRadius(accuracy);
        }
    }

    document.getElementById("lat-input").value = lat.toFixed(7);
    document.getElementById("lng-input").value = lng.toFixed(7);
}

function getGPSLocation() {
    if (!navigator.geolocation) {
        alert("Acest browser nu oferă geolocație.");
        return;
    }

    if (gpsWatchId !== null) {
        return;
    }

    const button = document.getElementById("gps-button");
    const stopButton = document.getElementById("gps-stop-button");
    if (button) button.textContent = "📍 GPS activ";
    if (stopButton) stopButton.disabled = false;
    gpsHasCentered = false;

    gpsWatchId = navigator.geolocation.watchPosition(
        position => {
            const { latitude, longitude, accuracy } = position.coords;
            updateGPSVisuals(latitude, longitude, accuracy);
            // Centrăm harta doar la prima poziție. După aceea utilizatorul poate
            // deplasa harta fără ca GPS-ul să-i fure controlul.
            if (!gpsHasCentered) {
                map.setView([latitude, longitude], Math.max(19, map.getZoom()), { animate: false });
                gpsHasCentered = true;
            }
        },
        error => {
            stopGPS();
            alert("Eroare GPS: " + error.message);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 2000 }
    );
}

function stopGPS() {
    if (gpsWatchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(gpsWatchId);
        gpsWatchId = null;
    }
    const button = document.getElementById("gps-button");
    const stopButton = document.getElementById("gps-stop-button");
    if (button) button.textContent = "📍 Activează GPS";
    if (stopButton) stopButton.disabled = true;
    gpsHasCentered = false;
    // Păstrăm punctul albastru pe hartă, ca să poți vedea ultima poziție cunoscută.
}

function goToCustomCoords() {
    const lat = parseFloat(document.getElementById("lat-input").value);
    const lng = parseFloat(document.getElementById("lng-input").value);

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        alert("Introdu coordonate valide.");
        return;
    }

    map.setView([lat, lng], 19);
    updateMicroclimateLayers();
}

function saveFavoriteLocation() {
    const center = map.getCenter();
    localStorage.setItem(FAVORITE_KEY, JSON.stringify([center.lat, center.lng]));
    alert("Locația curentă a fost salvată ca favorită.");
}

function loadFavoriteLocation() {
    const saved = localStorage.getItem(FAVORITE_KEY);
    if (!saved) {
        alert("Nu există încă o locație favorită.");
        return;
    }

    try {
        const [lat, lng] = JSON.parse(saved);
        map.setView([lat, lng], 19);
        document.getElementById("lat-input").value = lat.toFixed(7);
        document.getElementById("lng-input").value = lng.toFixed(7);
    } catch (_) {
        alert("Locația favorită este invalidă.");
    }
}

/* -------------------- MICROCLIMAT -------------------- */

function toggleSolarLayer(enabled) {
    if (enabled) {
        solarGroup.addTo(map);
        updateMicroclimateLayers();
    } else {
        map.removeLayer(solarGroup);
    }
}

function toggleWindLayer(enabled) {
    if (enabled) {
        windGroup.addTo(map);
        updateMicroclimateLayers();
    } else {
        map.removeLayer(windGroup);
    }
}

function updateMicroclimateLayers() {
    if (!map) return;
    const center = map.getCenter();

    if (map.hasLayer(solarGroup)) {
        solarGroup.clearLayers();

        const year = new Date().getFullYear();
        const summerSolstice = new Date(year, 5, 21);
        const winterSolstice = new Date(year, 11, 21);

        const summer = SunCalc.getTimes(summerSolstice, center.lat, center.lng);
        const winter = SunCalc.getTimes(winterSolstice, center.lat, center.lng);

        drawSolarRay(center, SunCalc.getPosition(summer.sunrise, center.lat, center.lng).azimuth, "#f59e0b", "Răsărit — vară");
        drawSolarRay(center, SunCalc.getPosition(summer.sunset, center.lat, center.lng).azimuth, "#d97706", "Apus — vară");
        drawSolarRay(center, SunCalc.getPosition(winter.sunrise, center.lat, center.lng).azimuth, "#3b82f6", "Răsărit — iarnă");
        drawSolarRay(center, SunCalc.getPosition(winter.sunset, center.lat, center.lng).azimuth, "#1d4ed8", "Apus — iarnă");
    }

    if (map.hasLayer(windGroup)) {
        windGroup.clearLayers();
        drawWindArrow(center, 45, "#1e3a8a", "Crivăț / NE");
        drawWindArrow(center, 225, "#ef4444", "Vânt cald / SV");
    }
}

function destinationByBearing(center, bearingDeg, distanceMeters) {
    const R = 6371000;
    const brng = bearingDeg * Math.PI / 180;
    const lat1 = center.lat * Math.PI / 180;
    const lon1 = center.lng * Math.PI / 180;
    const d = distanceMeters / R;

    const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(d) +
        Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
    );

    const lon2 = lon1 + Math.atan2(
        Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
        Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );

    return L.latLng(lat2 * 180 / Math.PI, lon2 * 180 / Math.PI);
}

function drawSolarRay(center, azimuthRad, color, label) {
    const bearing = ((azimuthRad * 180 / Math.PI) + 180) % 360;
    const dest = destinationByBearing(center, bearing, 80);

    const line = L.polyline([center, dest], {
        color, weight: 3, opacity: .82, dashArray: "7,6"
    }).addTo(solarGroup);

    line.bindTooltip(label, { direction: "center" });
}

function drawWindArrow(center, bearing, color, label) {
    const dest = destinationByBearing(center, bearing, 65);

    const line = L.polyline([center, dest], {
        color, weight: 4, opacity: .75
    }).addTo(windGroup);

    line.bindTooltip(label, { direction: "center" });
}

/* -------------------- ALERTĂ MEDIU — PLACEHOLDER -------------------- */

/**
 * Punct de extensie pentru viitoarea analiză de compatibilitate.
 *
 * Primește coordonatele pomului, lista/distanțele față de ceilalți
 * pomi și straturile de umbră/vânt. Momentan NU emite alerte.
 */
function analizeazaCompatibilitateMediu(lat, lng, currentTreeObj) {
    const distanteFataDeAltiPomi = treeObjects
        .filter(obj => obj !== currentTreeObj)
        .map(obj => ({
            id: obj.id,
            specie: obj.treeData.species,
            soi: obj.treeData.variety,
            distanta_m: map.distance(
                [lat, lng],
                obj.marker.getLatLng()
            )
        }));

    const liniiUmbrire = solarGroup;
    const liniiVant = windGroup;

    // TODO:
    // 1. verifică distanța minimă specifică soiului;
    // 2. verifică suprapunerea coroanelor la maturitate;
    // 3. verifică incompatibilități precum nuc → plante sensibile;
    // 4. verifică expunerea la soare și umbra sezonieră;
    // 5. verifică zonele de vânt/Crivăț;
    // 6. returnează alerte explicabile utilizatorului.
    void lat; void lng; void currentTreeObj; void distanteFataDeAltiPomi; void liniiUmbrire; void liniiVant;
}

/* -------------------- EXPORT / IMPORT -------------------- */

function exportProjectJSON() {
    const exportData = {
        format: "permacultura-project",
        version: "4.0",
        timestamp: new Date().toISOString(),
        center: [map.getCenter().lat, map.getCenter().lng],
        zoom: map.getZoom(),
        planning: {
            perimeter: serializePerimeter(),
            gridEnabled: map.hasLayer(gridGroup),
            gridSizeMeters,
            snapMode,
            plantingLines: plantingLines.map(line => ({
                id: line.id,
                start: [line.start.lat, line.start.lng],
                end: [line.end.lat, line.end.lng]
            }))
        },
        favoriteLocation: localStorage.getItem(FAVORITE_KEY)
            ? JSON.parse(localStorage.getItem(FAVORITE_KEY))
            : null,
        trees: treeObjects.map(obj => {
            const p = obj.marker.getLatLng();
            return {
                lat: p.lat,
                lng: p.lng,
                data: { ...obj.treeData }
            };
        })
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `proiect_permacultura_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

function importProjectJSON(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = e => {
        try {
            const project = JSON.parse(e.target.result);

            treeObjects.forEach(obj => {
                map.removeLayer(obj.marker);
                map.removeLayer(obj.crownCircle);
            });
            treeObjects = [];

            if (Array.isArray(project.center)) {
                map.setView(project.center, Number(project.zoom) || 19);
            }

            if (Array.isArray(project.favoriteLocation)) {
                localStorage.setItem(FAVORITE_KEY, JSON.stringify(project.favoriteLocation));
            }

            if (project.planning?.gridSizeMeters) {
                setGridSize(project.planning.gridSizeMeters);
                document.getElementById("grid-size-select").value = String(project.planning.gridSizeMeters);
            }
            if (project.planning?.snapMode) {
                setSnapMode(project.planning.snapMode);
                document.getElementById("snap-mode-select").value = project.planning.snapMode;
            }
            if (Array.isArray(project.planning?.perimeter) && project.planning.perimeter.length >= 3) {
                restorePerimeter(project.planning.perimeter);
                if (project.planning.gridEnabled) {
                    document.getElementById("grid-toggle").checked = true;
                    toggleGridLayer(true);
                }
            }

            clearPlantingLines(false);
            (project.planning?.plantingLines || []).forEach(lineData => {
                if (Array.isArray(lineData.start) && Array.isArray(lineData.end)) {
                    createPlantingLine(L.latLng(lineData.start[0], lineData.start[1]), L.latLng(lineData.end[0], lineData.end[1]), lineData);
                }
            });

            (project.trees || []).forEach(tree => {
                if (Number.isFinite(tree.lat) && Number.isFinite(tree.lng) && tree.data?.speciesKey) {
                    addTreeToMap(tree.lat, tree.lng, tree.data.speciesKey, tree.data);
                }
            });

            updateCounters();
            alert(`Proiect încărcat: ${treeObjects.length} plante.`);
        } catch (error) {
            alert("Eroare la importul proiectului: " + error.message);
        }

        event.target.value = "";
    };
    reader.readAsText(file);
}

/* -------------------- START -------------------- */

window.addEventListener("load", initMap);
