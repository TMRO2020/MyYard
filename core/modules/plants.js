/* PERMA ENGINE — Module: Plants
   Etapa 7: logica de plantare și contorizare este mutată incremental din app.js.
   Starea existentă rămâne compatibilă cu aplicația actuală pentru migrare incrementală.
*/
Core.Modules.Plants = Core.Modules.Plants || {};

const Plants = Core.Modules.Plants;



function plantsStartPlantingMode() {
    const selected = Core.Modules.Catalogue.GetSelectedItem();
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

function plantsStopPlantingMode() {
    isPlantingMode = false;
    document.getElementById("map").classList.remove("planting-active");
    document.getElementById("btn-start-plant").style.display = "block";
    document.getElementById("btn-stop-plant").style.display = "none";
    document.getElementById("planting-badge").style.display = "none";

    treeObjects.forEach(obj => plantsUpdateMarkerVisualState(obj, false));
}

function plantsAddTreeToMap(lat, lng, speciesKey, savedData = null) {
    const species = Core.Modules.Catalogue.GetConfig(speciesKey) || {
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
        icon: plantsCreateTreeIcon(species.color),
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

    plantsBindTreePopup(treeObj);

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
        plantsUpdateCounters();
    });

    crownCircle.on("click", () => marker.openPopup());

    analizeazaCompatibilitateMediu(lat, lng, treeObj);
    plantsUpdateCounters();
}

function plantsCreateTreeIcon(color) {
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

function plantsUpdateMarkerVisualState(treeObj, moving) {
    treeObj.crownCircle.setStyle({
        dashArray: moving ? "6,6" : null,
        weight: moving ? 3 : 2
    });
}

function plantsActivateSingleMove(id) {
    const obj = treeObjects.find(t => String(t.id) === String(id));
    if (!obj) return;

    obj.marker.dragging.enable();
    plantsUpdateMarkerVisualState(obj, true);
    map.closePopup();
    alert("Poți trage acum punctul cu degetul. El rămâne fixat geografic pe hartă.");
}

/* -------------------- FIȘA TEHNICĂ -------------------- */

function plantsBindTreePopup(treeObj) {
    const data = treeObj.treeData;
    const species = Core.Modules.Catalogue.GetConfig(data.speciesKey) || {};

    const popupContent = `
        <div class="tree-popup">
            <h3>${escapeHtml(species.name || `${data.species} — ${data.variety}`)}</h3>
            <div class="meta">🌱 ${escapeHtml(data.category || species.category || "")}</div>

            <label>Diametru coroană (m)</label>
            <input type="number" id="pop-crown-${data.id}" value="${Number(data.crownDiameter) || 1}" step="0.1" min="0.1"
                oninput="plantsUpdateTreeDiameter('${data.id}')">

            <label>Înălțime curentă (m)</label>
            <input type="number" id="pop-height-${data.id}" value="${Number(data.height) || 0}" step="0.1" min="0"
                onchange="plantsUpdateTreeDetails('${data.id}')">

            <label>Vârstă estimată (ani)</label>
            <input type="number" id="pop-age-${data.id}" value="${Number(data.age) || 0}" step="1" min="0"
                onchange="plantsUpdateTreeDetails('${data.id}')">

            <div class="knowledge-base">
                ${species.kb || "Fără informații suplimentare."}
            </div>

            <button class="btn-small btn-navigate" onclick="Core.Modules.Navigation.StartByTreeId('${data.id}')">🚶 Mergi la locație</button>
            <div class="popup-actions">
                <button class="btn-small btn-move" onclick="plantsActivateSingleMove('${data.id}')">✋ Mută</button>
                <button class="btn-small btn-danger" onclick="plantsDeleteTree('${data.id}')">🗑️ Șterge</button>
            </div>
        </div>
    `;

    treeObj.marker.bindPopup(popupContent, { maxWidth: 330 });
    treeObj.crownCircle.bindPopup(popupContent, { maxWidth: 330 });
}

function plantsUpdateTreeDiameter(id) {
    const obj = treeObjects.find(t => String(t.id) === String(id));
    if (!obj) return;

    const input = document.getElementById(`pop-crown-${id}`);
    const value = Math.max(0.1, parseFloat(input?.value) || 1);
    obj.treeData.crownDiameter = value;
    obj.crownCircle.setRadius(value / 2);
    plantsUpdateCounters();
}

function plantsUpdateTreeDetails(id) {
    const obj = treeObjects.find(t => String(t.id) === String(id));
    if (!obj) return;

    const h = parseFloat(document.getElementById(`pop-height-${id}`)?.value);
    const a = parseInt(document.getElementById(`pop-age-${id}`)?.value, 10);

    obj.treeData.height = Number.isFinite(h) ? h : 0;
    obj.treeData.age = Number.isFinite(a) ? a : 0;
    plantsUpdateCounters();
}

function plantsDeleteTree(id) {
    const index = treeObjects.findIndex(t => String(t.id) === String(id));
    if (index === -1) return;

    map.removeLayer(treeObjects[index].marker);
    map.removeLayer(treeObjects[index].crownCircle);
    treeObjects.splice(index, 1);
    plantsUpdateCounters();
}

/* -------------------- CONTOR -------------------- */

function plantsGetPlantationCounts() {
    const bySpecies = {};
    const byVariety = {};

    treeObjects.forEach(obj => {
        const species = obj.treeData.species || Core.Modules.Catalogue.GetConfig(obj.treeData.speciesKey)?.species || "Necunoscut";
        const variety = obj.treeData.variety || Core.Modules.Catalogue.GetConfig(obj.treeData.speciesKey)?.variety || "Fără soi";

        bySpecies[species] = (bySpecies[species] || 0) + 1;

        const key = `${species}|||${variety}`;
        byVariety[key] = (byVariety[key] || 0) + 1;
    });

    return { total: treeObjects.length, bySpecies, byVariety };
}

function plantsUpdateCounters() {
    if (!map) return;

    const counts = plantsGetPlantationCounts();
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

function plantsToggleCounterDetails() {
    document.getElementById("counter-details").classList.toggle("open");
}



/* API publică intuitivă */
Plants.Start = function () { return plantsStartPlantingMode(); };
Plants.Stop = function () { return plantsStopPlantingMode(); };
Plants.Add = function (lat, lng, speciesKey, savedData = null) { return plantsAddTreeToMap(lat, lng, speciesKey, savedData); };
Plants.CreateIcon = function (color) { return plantsCreateTreeIcon(color); };
Plants.UpdateVisualState = function (treeObj, moving) { return plantsUpdateMarkerVisualState(treeObj, moving); };
Plants.Move = function (id) { return plantsActivateSingleMove(id); };
Plants.BindPopup = function (treeObj) { return plantsBindTreePopup(treeObj); };
Plants.UpdateDiameter = function (id) { return plantsUpdateTreeDiameter(id); };
Plants.UpdateDetails = function (id) { return plantsUpdateTreeDetails(id); };
Plants.Remove = function (id) { return plantsDeleteTree(id); };
Plants.GetCounts = function () { return plantsGetPlantationCounts(); };
Plants.UpdateCounters = function () { return plantsUpdateCounters(); };
Plants.ToggleCounterDetails = function () { return plantsToggleCounterDetails(); };
