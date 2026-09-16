/* PERMA ENGINE — Module: Perimeter
   Etapa 4: logica perimetrului este mutată din app.js în modulul dedicat.
   Starea existentă rămâne compatibilă cu aplicația actuală pentru migrare incrementală.
*/
Core.Modules.Perimeter = Core.Modules.Perimeter || {};

const Perimeter = Core.Modules.Perimeter;

Perimeter.SetPlanningButtonState = function (drawing) {
    const draw = document.getElementById("btn-draw-perimeter");
    const finish = document.getElementById("btn-finish-perimeter");
    const cancel = document.getElementById("btn-cancel-perimeter");
    if (draw) draw.disabled = drawing;
    if (finish) finish.disabled = !drawing || perimeterPoints.length < 3;
    if (cancel) cancel.disabled = !drawing;
};

Perimeter.FormatArea = function (area) {
    if (!Number.isFinite(area)) return "—";
    return area >= 10000 ? `${(area / 10000).toFixed(2)} ha` : `${area.toFixed(0)} m²`;
};

Perimeter.UpdateStatus = function (message = null) {
    const el = document.getElementById("perimeter-status");
    if (!el) return;
    if (message) {
        el.textContent = message;
        return;
    }
    if (perimeterPoints.length < 3) {
        el.textContent = perimeterPoints.length
            ? `Puncte trasate: ${perimeterPoints.length}. Mai adaugă cel puțin ${3 - perimeterPoints.length}.`
            : "Niciun perimetru definit.";
        return;
    }
    const area = calculatePerimeterAreaM2();
    const perimeter = calculatePerimeterLengthM();
    el.innerHTML = `<b>Perimetru activ</b> · ${perimeter.toFixed(1)} m · suprafață ≈ ${Perimeter.FormatArea(area)}`;
};

Perimeter.Start = function () {
    if (!map) return;
    if (isPlantingMode) stopPlantingMode();
    Perimeter.Cancel();
    isPerimeterDrawing = true;
    perimeterPoints = [];
    document.getElementById("map")?.classList.add("perimeter-drawing");
    Perimeter.SetPlanningButtonState(true);
    Perimeter.UpdateStatus("Atinge colțurile zonei de plantare. Minimum 3 puncte.");
};

Perimeter.AddPoint = function (latlng) {
    if (!isPerimeterDrawing) return;
    perimeterPoints.push(L.latLng(latlng.lat, latlng.lng));
    Perimeter.RefreshDraft();
    Perimeter.SetPlanningButtonState(true);
    Perimeter.UpdateStatus();
};

Perimeter.UpdateDistanceLabels = function () {
    if (!map) return;

    perimeterDistanceLabels.forEach(label => map.removeLayer(label));
    perimeterDistanceLabels = [];

    if (perimeterPoints.length < 2) return;

    const segmentCount = isPerimeterDrawing
        ? perimeterPoints.length - 1
        : perimeterPoints.length;

    for (let i = 0; i < segmentCount; i++) {
        const start = perimeterPoints[i];
        const end = perimeterPoints[(i + 1) % perimeterPoints.length];
        const distance = Core.functieGeometry.CalculateDistanceM(start, end);
        const midpoint = L.latLng(
            (start.lat + end.lat) / 2,
            (start.lng + end.lng) / 2
        );

        const label = L.marker(midpoint, {
            interactive: false,
            zIndexOffset: 2400,
            icon: L.divIcon({
                className: "perimeter-distance-label",
                html: `<span>${distance.toFixed(1).replace(".", ",")} m</span>`,
                iconSize: [0, 0],
                iconAnchor: [0, 0]
            })
        }).addTo(map);

        perimeterDistanceLabels.push(label);
    }
};

Perimeter.RefreshDraft = function () {
    perimeterVertexMarkers.forEach(marker => map.removeLayer(marker));
    perimeterVertexMarkers = [];
    if (perimeterDraftLine) {
        map.removeLayer(perimeterDraftLine);
        perimeterDraftLine = null;
    }
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
            Perimeter.UpdateDistanceLabels();
            Perimeter.UpdateStatus();
        });

        marker.on("dragend", () => {
            if (perimeterDraftLine) perimeterDraftLine.setLatLngs(perimeterPoints);
            Perimeter.UpdateDistanceLabels();
            Perimeter.UpdateStatus();
        });

        perimeterVertexMarkers.push(marker);
    });

    if (perimeterPoints.length >= 2) {
        perimeterDraftLine = L.polyline(perimeterPoints, {
            color: "#e8a317",
            weight: 3,
            dashArray: "7,6",
            opacity: .9,
            renderer: gridRenderer || undefined,
            interactive: false
        }).addTo(map);
    }

    Perimeter.UpdateDistanceLabels();
};

Perimeter.Finish = function () {
    if (!isPerimeterDrawing || perimeterPoints.length < 3) return;
    isPerimeterDrawing = false;
    document.getElementById("map")?.classList.remove("perimeter-drawing");
    Perimeter.SetPlanningButtonState(false);

    if (perimeterDraftLine && map) map.removeLayer(perimeterDraftLine);
    perimeterDraftLine = null;
    perimeterVertexMarkers.forEach(marker => map && map.removeLayer(marker));
    perimeterVertexMarkers = [];

    Perimeter.UpdateGeometry();
    Perimeter.UpdateStatus();
};

Perimeter.Cancel = function () {
    isPerimeterDrawing = false;
    document.getElementById("map")?.classList.remove("perimeter-drawing");
    if (perimeterDraftLine && map) map.removeLayer(perimeterDraftLine);
    perimeterDraftLine = null;
    perimeterVertexMarkers.forEach(marker => map && map.removeLayer(marker));
    perimeterVertexMarkers = [];
    perimeterDistanceLabels.forEach(label => map && map.removeLayer(label));
    perimeterDistanceLabels = [];
    Perimeter.SetPlanningButtonState(false);
    if (!perimeterPolygon) perimeterPoints = [];
    Perimeter.UpdateStatus();
};

Perimeter.Clear = function () {
    Perimeter.Cancel();
    if (perimeterPolygon && map) map.removeLayer(perimeterPolygon);
    perimeterPolygon = null;
    perimeterPoints = [];
    perimeterVertexMarkers.forEach(marker => map && map.removeLayer(marker));
    perimeterVertexMarkers = [];
    perimeterDistanceLabels.forEach(label => map && map.removeLayer(label));
    perimeterDistanceLabels = [];

    if (gridOriginMarker && map) map.removeLayer(gridOriginMarker);
    gridOriginMarker = null;
    gridGroup.clearLayers();
    if (map?.hasLayer(gridGroup)) map.removeLayer(gridGroup);

    const toggle = document.getElementById("grid-toggle");
    if (toggle) toggle.checked = false;

    Perimeter.UpdateStatus("Niciun perimetru definit.");
    const gridStatus = document.getElementById("grid-status");
    if (gridStatus) gridStatus.textContent = "Grila este oprită.";
};

Perimeter.UpdateGeometry = function () {
    if (perimeterPoints.length < 3 || !map) return;

    if (perimeterPolygon) map.removeLayer(perimeterPolygon);
    perimeterPolygon = L.polygon(perimeterPoints, {
        color: "#f5f5f5",
        weight: 5,
        fillColor: "#f5f5f5",
        fillOpacity: .08,
        interactive: false
    }).addTo(map);

    perimeterPolygon.bindTooltip("Zona de plantare", {
        className: "perimeter-label",
        sticky: true
    });

    perimeterPoints.forEach((point, index) => {
        const marker = L.marker(point, {
            draggable: true,
            icon: L.divIcon({
                className: "perimeter-vertex",
                html: `<div title="Colț ${index + 1}"></div>`,
                iconSize: [18, 18],
                iconAnchor: [9, 9]
            }),
            zIndexOffset: 2500
        }).addTo(map);

        marker.on("drag", e => {
            perimeterPoints[index] = e.target.getLatLng();
            perimeterPolygon.setLatLngs(perimeterPoints);
            Perimeter.UpdateDistanceLabels();
            if (map.hasLayer(gridGroup)) updateGridLayer();
            Perimeter.UpdateStatus();
        });

        marker.on("dragend", () => {
            perimeterPolygon.setLatLngs(perimeterPoints);
            Perimeter.UpdateDistanceLabels();
            Perimeter.UpdateStatus();
            if (map.hasLayer(gridGroup)) updateGridLayer();
        });

        perimeterVertexMarkers.push(marker);
    });

    Perimeter.UpdateDistanceLabels();

    if (gridOriginMarker) map.removeLayer(gridOriginMarker);
    gridOriginMarker = null;

    if (!Core.Modules.Punct0?.IsSet?.()) {
        gridOriginMarker = L.marker(perimeterPoints[0], {
            interactive: false,
            icon: L.divIcon({
                className: "grid-origin-marker",
                html: "<div></div>",
                iconSize: [10, 10],
                iconAnchor: [5, 5]
            })
        }).addTo(map);
    }

    if (map.hasLayer(gridGroup)) updateGridLayer();
};

/* API publică intuitivă */
Perimeter.GetPoints = function () {
    return perimeterPoints.map(point => L.latLng(point.lat, point.lng));
};

Perimeter.GetSuprafataTotala_Mp = function () {
    return calculatePerimeterAreaM2();
};

Perimeter.GetLungimeTotala_M = function () {
    return calculatePerimeterLengthM();
};

Perimeter.IsActive = function () {
    return perimeterPoints.length >= 3;
};
