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
        Control: false,
        tap: true,
        preferCanvas: true
    }).setView(currentCenter, 19);

    /*
     * Tile satelit. maxNative 19 înseamnă că la 20 Leaflet
     * poate mări ultimul nivel nativ. Dacă furnizorul schimbă
     * disponibilitatea tile-urilor, se poate înlocui URL-ul aici.
     */
    L.tileLayer("https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
        maxZoom: 31,
        maxNativeZoom: 30,
        attribution: "&copy; Google"
    }).addTo(map);

    map.on("move", updateMicroclimateLayers);
    map.on("zoomend", updateMicroclimateLayers);

    map.on("click", event => {
        if (!isPlantingMode) return;

        const selected = getSelectedItem();
        if (!selected) {
            alert("Alege întâi specia și apoi soiul.");
            return;
        }

        addTreeToMap(event.latlng.lat, event.latlng.lng, selected.id);
    });

    document.getElementById("category-select").addEventListener("change", () => {
        populateSpeciesSelect();
    });
    document.getElementById("species-select").addEventListener("change", populateVarietySelect);

    fetchDefaultCatalogue();
    updateMicroclimateLayers();
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
        const p = e.target.getLatLng();
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

function getGPSLocation() {
    if (!navigator.geolocation) {
        alert("Acest browser nu oferă geolocație.");
        return;
    }

    navigator.geolocation.getCurrentPosition(
        position => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            map.setView([lat, lng], Math.max(19, map.getZoom()));
            document.getElementById("lat-input").value = lat.toFixed(7);
            document.getElementById("lng-input").value = lng.toFixed(7);
            updateMicroclimateLayers();
        },
        error => alert("Eroare GPS: " + error.message),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
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
        version: "3.0",
        timestamp: new Date().toISOString(),
        center: [map.getCenter().lat, map.getCenter().lng],
        zoom: map.getZoom(),
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
