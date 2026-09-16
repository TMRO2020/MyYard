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
let perimeterDistanceLabels = [];
let perimeterDraftLine = null;

// Linii de plantare: fiecare linie are două capete editabile și o etichetă cu distanța.
let plantingLines = [];
let plantingLineVertexMarkers = [];
let plantingLineDraft = null;
let plantingLineDraftLabel = null;
let plantingLineDraftPoints = [];
let isPlantingLineDrawing = false;

let isPerimeterDrawing = false;
let gridGroup = L.layerGroup();
let gridOriginMarker = null;
let gridSizeMeters = 1;
let snapMode = "cell";
let gridRenderer = null;

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

function getSelectedItem() {
    return Core.Modules.Catalogue.GetSelectedItem();
}

function parseAndLoadCatalogue(jsonData) {
    return Core.Modules.Catalogue.Load(jsonData);
}

function fetchDefaultCatalogue() {
    return Core.Modules.Catalogue.LoadDefault();
}

function importCatalogueJSON(event) {
    return Core.Modules.Catalogue.ImportJSON(event);
}

// Wrappere de compatibilitate pentru listener-ele existente din app.js.
function populateCategorySelect() {
    return Core.Modules.Catalogue.PopulateCategorySelect();
}

function populateSpeciesSelect() {
    return Core.Modules.Catalogue.PopulateSpeciesSelect();
}

function populateVarietySelect() {
    return Core.Modules.Catalogue.PopulateVarietySelect();
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
    Core.Modules.Solar.Configure(map, solarGroup);
    Core.Modules.Wind.Configure(map, windGroup);

    map.on("move", updateMicroclimateLayers);
    map.on("zoomend", () => {
        updateMicroclimateLayers();
        if (map.hasLayer(gridGroup)) updateGridLayer();
    });

    map.on("click", event => {
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

    map.on("mousemove", event => {
        if (isPlantingLineDrawing && plantingLineDraftPoints.length === 1) {
            refreshPlantingLineDraft(event.latlng);
        }
        updateDesktopStatus(event.latlng);
    });

    map.on("zoomend", () => updateDesktopStatus());

    document.getElementById("category-select").addEventListener("change", () => {
        populateSpeciesSelect();
    });
    document.getElementById("species-select").addEventListener("change", populateVarietySelect);

    fetchDefaultCatalogue();
    updateMicroclimateLayers();
    registerDesktopToolbarActions();
    updateDesktopStatus();
}

/* -------------------- LINII DE PLANTARE — COMPATIBILITATE -------------------- */

function closestPointOnSegmentXY(p, a, b) {
    return Core.functieGeometry.ClosestPointOnSegmentXY(p, a, b);
}

function getPlantingLineMidpoint(start, end) {
    return Core.Modules.PlantingLines.GetMidpoint(start, end);
}

function getPlantingLineDistance(start, end) {
    return Core.Modules.PlantingLines.GetDistance(start, end);
}

function selectPlantingLine(line) {
    return Core.Modules.PlantingLines.Select(line);
}

function createPlantingLineLabel(line) {
    return Core.Modules.PlantingLines.CreateLabel(line);
}

function removePlantingLine(lineId) {
    const result = Core.Modules.PlantingLines.Remove(lineId);
    updateDesktopStatus();
    return result;
}

function refreshPlantingLineVisual(line) {
    return Core.Modules.PlantingLines.RefreshVisual(line);
}

function renderAllPlantingLines() {
    return Core.Modules.PlantingLines.RenderAll();
}

function startPlantingLineDrawing() {
    const result = Core.Modules.PlantingLines.Start();
    Core.UI.Toolbar?.RefreshContext();
    return result;
}

function addPlantingLinePoint(latlng) {
    return Core.Modules.PlantingLines.AddPoint(latlng);
}

function refreshPlantingLineDraft(cursorLatLng = null) {
    return Core.Modules.PlantingLines.RefreshDraft(cursorLatLng);
}

function clearPlantingLineDraft() {
    return Core.Modules.PlantingLines.ClearDraft();
}

function cancelPlantingLineDrawing() {
    const result = Core.Modules.PlantingLines.Cancel();
    Core.UI.Toolbar?.RefreshContext();
    return result;
}

function clearPlantingLines() {
    const result = Core.Modules.PlantingLines.Clear();
    Core.UI.Toolbar?.RefreshContext();
    updateDesktopStatus();
    return result;
}

function applySnapToPlantingLine(latlng) {
    return Core.Modules.PlantingLines.ApplySnap(latlng);
}

/* -------------------- PLANIFICARE: PERIMETRU + GRID -------------------- */

function setPlanningButtonState(drawing) {
    return Core.Modules.Perimeter.SetPlanningButtonState(drawing);
}

function updatePerimeterStatus(message = null) {
    return Core.Modules.Perimeter.UpdateStatus(message);
}

function formatArea(area) {
    return Core.Modules.Perimeter.FormatArea(area);
}

function startPerimeterDrawing() {
    return Core.Modules.Perimeter.Start();
}

function addPerimeterPoint(latlng) {
    const result = Core.Modules.Perimeter.AddPoint(latlng);
    Core.UI.Toolbar?.RefreshContext();
    updateDesktopStatus();
    return result;
}

function updatePerimeterDistanceLabels() {
    return Core.Modules.Perimeter.UpdateDistanceLabels();
}

function refreshPerimeterDraft() {
    return Core.Modules.Perimeter.RefreshDraft();
}

function finishPerimeterDrawing() {
    const result = Core.Modules.Perimeter.Finish();
    Core.UI.Toolbar?.RefreshContext();
    updateDesktopStatus();
    return result;
}

function cancelPerimeterDrawing() {
    const result = Core.Modules.Perimeter.Cancel();
    Core.UI.Toolbar?.RefreshContext();
    return result;
}

function clearPerimeter() {
    const result = Core.Modules.Perimeter.Clear();
    Core.UI.Toolbar?.RefreshContext();
    updateDesktopStatus();
    return result;
}

function updatePerimeterGeometry() {
    return Core.Modules.Perimeter.UpdateGeometry();
}

function projectToLocalMeters(latlng, origin) {
    return Core.functieGeometry.ProjectToLocalMeters(latlng, origin);
}

function localMetersToLatLng(x, y, origin) {
    return Core.functieGeometry.LocalMetersToLatLng(x, y, origin);
}

function getLocalPerimeter() {
    return Core.functieGeometry.GetLocalPerimeter(perimeterPoints);
}

function calculatePerimeterAreaM2() {
    const local = getLocalPerimeter();
    return local ? Core.functieGeometry.CalculatePolygonAreaM2(local.points) : 0;
}

function calculatePerimeterLengthM() {
    return Core.functieGeometry.CalculateClosedPerimeterLengthM(perimeterPoints);
}

function pointInPolygonXY(point, polygon) {
    return Core.functieGeometry.PointInPolygonXY(point, polygon);
}

function clippedGridSegments(local, axis, value) {
    return Core.functieGeometry.ClippedGridSegments(local, axis, value);
}

function updateGridLayer() {
    return Core.Modules.Grid.Update();
}

function toggleGridLayer(enabled) {
    const result = Core.Modules.Grid.Toggle(enabled);
    Core.UI.Toolbar?.RefreshActiveStates();
    return result;
}

function setGridSize(value) {
    return Core.Modules.Grid.SetSize(value);
}

function setSnapMode(value) {
    const result = Core.Modules.Snap.SetMode(value);
    updateDesktopStatus();
    return result;
}

function applySnapToLatLng(latlng) {
    return Core.Modules.Snap.Apply(latlng);
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

/* -------------------- PLANTS — COMPATIBILITATE -------------------- */

function startPlantingMode() { return Core.Modules.Plants.Start(); }
function stopPlantingMode() { return Core.Modules.Plants.Stop(); }
function addTreeToMap(lat, lng, speciesKey, savedData = null) {
    const result = Core.Modules.Plants.Add(lat, lng, speciesKey, savedData);
    updateDesktopStatus();
    return result;
}
function activateSingleMove(id) { return Core.Modules.Plants.Move(id); }
function updateTreeDiameter(id) { return Core.Modules.Plants.UpdateDiameter(id); }
function updateTreeDetails(id) { return Core.Modules.Plants.UpdateDetails(id); }
function deleteTree(id) {
    const result = Core.Modules.Plants.Remove(id);
    updateDesktopStatus();
    return result;
}
function getPlantationCounts() { return Core.Modules.Plants.GetCounts(); }
function updateCounters() { return Core.Modules.Plants.UpdateCounters(); }
function toggleCounterDetails() { return Core.Modules.Plants.ToggleCounterDetails(); }

/* -------------------- LOCAȚIE -------------------- */

function toggleSidebar() {
    return Core.UI.Sidebar.Toggle();
}

function updateDesktopStatus(latlng = null) {
    if (!Core.UI.StatusBar || !map) return;

    const point = latlng || map.getCenter();
    let x = NaN;
    let y = NaN;

    if (perimeterPoints.length >= 3) {
        const local = Core.functieGeometry.ProjectToLocalMeters(point, perimeterPoints[0]);
        x = local.x;
        y = local.y;
    }

    const snapLabels = {
        off: "Oprit",
        cell: "Centru celulă",
        grid: "Intersecție grilă",
        line: "Linie apropiată"
    };

    let areaM2 = NaN;
    try {
        areaM2 = Core.Modules.Perimeter.GetSuprafataTotala_Mp();
    } catch (_) {}

    let plantCount = 0;
    try {
        plantCount = Core.Modules.Plants.GetCounts()?.total ?? 0;
    } catch (_) {
        plantCount = treeObjects.length;
    }

    let lineCount = 0;
    try {
        lineCount = Core.Modules.PlantingLines.GetCount?.() ?? plantingLines.length;
    } catch (_) {
        lineCount = plantingLines.length;
    }

    Core.UI.StatusBar.SetPointer({
        lat: point.lat,
        lng: point.lng,
        x,
        y,
        zoom: map.getZoom(),
        snap: snapLabels[snapMode] || snapMode,
        areaM2,
        plants: plantCount,
        lines: lineCount
    });
}

function createToolbarContextButton(container, label, onClick, options = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `cad-context-button${options.danger ? " danger" : ""}${options.primary ? " primary" : ""}`;
    button.textContent = label;
    button.title = options.title || label;
    if (options.disabled) button.disabled = true;
    button.addEventListener("click", event => {
        event.stopPropagation();
        if (button.disabled) return;
        onClick();
        Core.UI.Toolbar?.RefreshActiveStates();
        Core.UI.Toolbar?.RefreshContext();
    });
    container.appendChild(button);
    return button;
}

function createToolbarContextGroup(container, title = "") {
    const group = document.createElement("div");
    group.className = "cad-context-group";
    if (title) {
        const heading = document.createElement("span");
        heading.className = "cad-context-group-title";
        heading.textContent = title;
        group.appendChild(heading);
    }
    container.appendChild(group);
    return group;
}

function registerDesktopToolbarActions() {
    const Toolbar = Core.UI.Toolbar;
    if (!Toolbar) return;

    Toolbar.RegisterAction({
        id: "gps", label: "GPS", icon: "📍", title: "Poziționare GPS",
        onExecute: () => { Core.UI.StatusBar.SetTool("GPS"); getGPSLocation(); },
        renderContext: bar => {
            bar.innerHTML = `<div class="cad-context-heading"><b>GPS</b><span>Poziționare și coordonate</span></div>`;
            const group = createToolbarContextGroup(bar);
            createToolbarContextButton(group, "📍 Activează GPS", getGPSLocation, { primary: true });

            const coordinateGroup = createToolbarContextGroup(bar, "Coordonate");
            const latInput = document.createElement("input");
            latInput.type = "number";
            latInput.id = "cad-gps-lat-input";
            latInput.className = "cad-context-coordinate-input";
            latInput.step = "0.0000001";
            latInput.min = "-90";
            latInput.max = "90";
            latInput.placeholder = "Latitudine";
            latInput.title = "Latitudine";
            latInput.value = document.getElementById("lat-input")?.value || "";

            const lngInput = document.createElement("input");
            lngInput.type = "number";
            lngInput.id = "cad-gps-lng-input";
            lngInput.className = "cad-context-coordinate-input";
            lngInput.step = "0.0000001";
            lngInput.min = "-180";
            lngInput.max = "180";
            lngInput.placeholder = "Longitudine";
            lngInput.title = "Longitudine";
            lngInput.value = document.getElementById("lng-input")?.value || "";

            const goButton = document.createElement("button");
            goButton.type = "button";
            goButton.className = "cad-context-button primary cad-context-coordinate-go";
            goButton.textContent = "⌖ Mergi la coordonate";
            goButton.title = "Mergi la coordonatele introduse";
            goButton.addEventListener("click", event => {
                event.stopPropagation();
                const legacyLat = document.getElementById("lat-input");
                const legacyLng = document.getElementById("lng-input");
                if (legacyLat) legacyLat.value = latInput.value;
                if (legacyLng) legacyLng.value = lngInput.value;
                goToCustomCoords();
                Core.UI.Toolbar?.RefreshActiveStates();
                Core.UI.Toolbar?.RefreshContext();
            });

            [latInput, lngInput].forEach(input => {
                input.addEventListener("click", event => event.stopPropagation());
                input.addEventListener("keydown", event => {
                    event.stopPropagation();
                    if (event.key === "Enter") goButton.click();
                });
            });

            coordinateGroup.append(latInput, lngInput, goButton);
            createToolbarContextButton(group, "★ Salvează", saveFavoriteLocation);
            createToolbarContextButton(group, "★ Încarcă favorita", loadFavoriteLocation);

            const coords = createToolbarContextGroup(bar);
            const lat = document.getElementById("lat-input")?.value || "—";
            const lng = document.getElementById("lng-input")?.value || "—";
            coords.classList.add("cad-context-readout");
            coords.innerHTML = `<span>Lat <b>${lat}</b></span><span>Lng <b>${lng}</b></span>`;
        }
    });

    Toolbar.RegisterAction({
        id: "perimeter", label: "Perimetru", icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="5,6 12,3 20,7 18,17 8,20 3,13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="5" cy="6" r="1.7" fill="currentColor"/><circle cx="12" cy="3" r="1.7" fill="currentColor"/><circle cx="20" cy="7" r="1.7" fill="currentColor"/><circle cx="18" cy="17" r="1.7" fill="currentColor"/><circle cx="8" cy="20" r="1.7" fill="currentColor"/><circle cx="3" cy="13" r="1.7" fill="currentColor"/></svg>`, title: "Planificare perimetru",
        onExecute: () => {
            Core.UI.StatusBar.SetTool("Perimetru");
            if (document.getElementById("btn-cancel-perimeter")?.disabled !== false) startPerimeterDrawing();
        },
        renderContext: bar => {
            bar.innerHTML = `<div class="cad-context-heading"><b>PERIMETRU</b><span>Definește zona de plantare</span></div>`;
            const group = createToolbarContextGroup(bar);
            const drawing = !!document.getElementById("btn-cancel-perimeter")?.disabled === false;
            const finishDisabled = !!document.getElementById("btn-finish-perimeter")?.disabled;
            if (drawing) {
                createToolbarContextButton(group, "✓ Închide", finishPerimeterDrawing, { primary: true, disabled: finishDisabled });
                createToolbarContextButton(group, "↩ Anulează", cancelPerimeterDrawing);
            } else {
                createToolbarContextButton(group, "＋ Desenează perimetrul", startPerimeterDrawing, { primary: true });
            }
            createToolbarContextButton(group, "🗑 Șterge", clearPerimeter, { danger: true });
            const status = document.getElementById("perimeter-status")?.textContent || "Niciun perimetru definit.";
            const info = createToolbarContextGroup(bar);
            info.classList.add("cad-context-status");
            info.textContent = status;
        }
    });

    Toolbar.RegisterAction({
        id: "line", label: "Linie", icon: "📏", title: "Linii de plantare",
        onExecute: () => {
            Core.UI.StatusBar.SetTool("Linie");
            if (!isPlantingLineDrawing) startPlantingLineDrawing();
        },
        renderContext: bar => {
            bar.innerHTML = `<div class="cad-context-heading"><b>LINIE</b><span>Linii de plantare</span></div>`;
            const group = createToolbarContextGroup(bar);
            createToolbarContextButton(group, "＋ Linie nouă", startPlantingLineDrawing, { primary: true });
            createToolbarContextButton(group, "↩ Anulează", cancelPlantingLineDrawing);
            createToolbarContextButton(group, "🗑 Șterge toate", clearPlantingLines, { danger: true });
            const status = document.getElementById("planting-line-status")?.textContent || "Nicio linie de plantare.";
            const info = createToolbarContextGroup(bar);
            info.classList.add("cad-context-status");
            info.textContent = status;
        }
    });

    Toolbar.RegisterAction({
        id: "snap", label: "Snap", icon: "🧲", title: "Setări Snap",
        onExecute: () => Core.UI.StatusBar.SetTool("Snap"),
        renderContext: bar => {
            bar.innerHTML = `<div class="cad-context-heading"><b>SNAP</b><span>Alinierea punctelor</span></div>`;
            const group = createToolbarContextGroup(bar, "Mod");
            const modes = [
                ["off", "Oprit"], ["cell", "Centru celulă"], ["grid", "Intersecție grilă"], ["line", "Linie apropiată"]
            ];
            modes.forEach(([value, label]) => {
                createToolbarContextButton(group, label, () => setSnapMode(value), {
                    primary: snapMode === value,
                    title: `Snap: ${label}`
                });
            });
        }
    });

    Toolbar.RegisterAction({
        id: "grid", label: "Grid", icon: "▦", title: "Grilă metrică",
        onExecute: () => {
            const toggle = document.getElementById("grid-toggle");
            const next = !toggle?.checked;
            Core.UI.StatusBar.SetTool("Grid");
            if (toggle) toggle.checked = next;
            toggleGridLayer(next);
        },
        isActive: () => !!document.getElementById("grid-toggle")?.checked,
        renderContext: bar => {
            bar.innerHTML = `<div class="cad-context-heading"><b>GRID</b><span>Grilă metrică pentru proiectare</span></div>`;
            const group = createToolbarContextGroup(bar);
            const enabled = !!document.getElementById("grid-toggle")?.checked;
            createToolbarContextButton(group, "○ Grilă oprită", () => {
                const toggle = document.getElementById("grid-toggle");
                if (toggle) toggle.checked = false;
                toggleGridLayer(false);
            }, { primary: false });
            createToolbarContextButton(group, "● Grilă pornită", () => {
                const toggle = document.getElementById("grid-toggle");
                if (toggle) toggle.checked = true;
                toggleGridLayer(true);
            }, { primary: enabled });
            const sizeGroup = createToolbarContextGroup(bar, "Pas");
            [0.5, 1, 2, 5].forEach(value => {
                createToolbarContextButton(sizeGroup, `${String(value).replace(".", ",")} m`, () => setGridSize(value), {
                    primary: Number(gridSizeMeters) === value
                });
            });
        }
    });

    Toolbar.RegisterAction({
        id: "plant", label: "Plantă", icon: "🌱", title: "Mod plantare",
        onExecute: () => { Core.UI.StatusBar.SetTool("Plantă"); startPlantingMode(); },
        renderContext: bar => {
            bar.innerHTML = `<div class="cad-context-heading"><b>PLANTĂ</b><span>Plantează folosind catalogul</span></div>`;
            const group = createToolbarContextGroup(bar);
            createToolbarContextButton(group, "🌱 Activează", startPlantingMode, { primary: true });
            createToolbarContextButton(group, "✓ Oprește", stopPlantingMode);
            createToolbarContextButton(group, "⚙ Configurare", () => {
                Core.UI.Sidebar.Open();
                Core.UI.Sidebar.Focus("category-select");
            });
            const selected = getSelectedItem();
            const info = createToolbarContextGroup(bar);
            info.classList.add("cad-context-status");
            info.textContent = selected ? (selected.name || selected.id) : "Alege specia și soiul din bara de plantare.";
        }
    });

    Toolbar.RegisterAction({
        id: "solar", label: "Solar", icon: "☀️", title: "Strat solar",
        onExecute: () => {
            const toggle = document.getElementById("solar-toggle");
            const next = !toggle?.checked;
            Core.UI.StatusBar.SetTool("Solar");
            if (toggle) toggle.checked = next;
            toggleSolarLayer(next);
        },
        isActive: () => !!document.getElementById("solar-toggle")?.checked,
        renderContext: bar => {
            bar.innerHTML = `<div class="cad-context-heading"><b>SOLAR</b><span>Direcția razelor la solstiții</span></div>`;
            const group = createToolbarContextGroup(bar);
            const enabled = !!document.getElementById("solar-toggle")?.checked;
            createToolbarContextButton(group, "○ Solar oprit", () => {
                const toggle = document.getElementById("solar-toggle");
                if (toggle) toggle.checked = false;
                toggleSolarLayer(false);
            }, { primary: false });
            createToolbarContextButton(group, "● Solar pornit", () => {
                const toggle = document.getElementById("solar-toggle");
                if (toggle) toggle.checked = true;
                toggleSolarLayer(true);
            }, { primary: enabled });
        }
    });

    Toolbar.RegisterAction({
        id: "wind", label: "Vânt", icon: "🌬️", title: "Strat vânturi",
        onExecute: () => {
            const toggle = document.getElementById("wind-toggle");
            const next = !toggle?.checked;
            Core.UI.StatusBar.SetTool("Vânt");
            if (toggle) toggle.checked = next;
            toggleWindLayer(next);
        },
        isActive: () => !!document.getElementById("wind-toggle")?.checked,
        renderContext: bar => {
            bar.innerHTML = `<div class="cad-context-heading"><b>VÂNT</b><span>Direcțiile principale</span></div>`;
            const group = createToolbarContextGroup(bar);
            const enabled = !!document.getElementById("wind-toggle")?.checked;
            createToolbarContextButton(group, "○ Vânt oprit", () => {
                const toggle = document.getElementById("wind-toggle");
                if (toggle) toggle.checked = false;
                toggleWindLayer(false);
            }, { primary: false });
            createToolbarContextButton(group, "● Vânt pornit", () => {
                const toggle = document.getElementById("wind-toggle");
                if (toggle) toggle.checked = true;
                toggleWindLayer(true);
            }, { primary: enabled });
        }
    });

    Toolbar.RegisterAction({
        id: "project", label: "Proiect", icon: "💾", title: "Proiect și date",
        onExecute: () => Core.UI.StatusBar.SetTool("Proiect"),
        renderContext: bar => {
            bar.innerHTML = `<div class="cad-context-heading"><b>PROIECT</b><span>Salvare, încărcare și catalog</span></div>`;
            const group = createToolbarContextGroup(bar);
            createToolbarContextButton(group, "📥 Salvează", exportProjectJSON, { primary: true });
            createToolbarContextButton(group, "📤 Încarcă", () => document.getElementById("import-file")?.click());
            createToolbarContextButton(group, "📜 Catalog", () => document.getElementById("catalogue-file")?.click());
            const stats = createToolbarContextGroup(bar);
            stats.classList.add("cad-context-readout");
            const counts = getPlantationCounts();
            const area = calculatePerimeterAreaM2();
            stats.innerHTML = `<span>Suprafață <b>${Number.isFinite(area) && area > 0 ? formatArea(area) : "—"}</b></span><span>Plante <b>${counts?.total ?? treeObjects.length}</b></span>`;
        }
    });
}

function getGPSLocation() {
    return Core.functieGPS.ActiveazaGPS();
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
    const result = Core.Modules.Solar.Toggle(enabled);
    Core.UI.Toolbar?.RefreshActiveStates();
    return result;
}

function toggleWindLayer(enabled) {
    const result = Core.Modules.Wind.Toggle(enabled);
    Core.UI.Toolbar?.RefreshActiveStates();
    return result;
}

function updateMicroclimateLayers() {
    if (!map) return;

    Core.Modules.Solar.Update();

    Core.Modules.Wind.Update();
}

function destinationByBearing(center, bearingDeg, distanceMeters) {
    return Core.functieGeometry.DestinationByBearing(center, bearingDeg, distanceMeters);
}

function drawSolarRay(center, azimuthRad, color, label) {
    return Core.Modules.Solar.DrawRay(center, azimuthRad, color, label);
}

function drawWindArrow(center, bearing, color, label) {
    return Core.Modules.Wind.DrawArrow(center, bearing, color, label);
}

/* -------------------- COMPATIBILITY — COMPATIBILITATE -------------------- */

function analizeazaCompatibilitateMediu(lat, lng, currentTreeObj) {
    return Core.Modules.Compatibility.AnalyzeEnvironment(lat, lng, currentTreeObj);
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
            snapMode
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
