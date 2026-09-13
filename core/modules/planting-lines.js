/* PERMA ENGINE — Module: PlantingLines
   Etapa 8: logica liniilor de plantare mutată din app.js în modulul dedicat.
   Migrare incrementală: păstrăm starea globală existentă pentru compatibilitate,
   iar app.js expune doar wrapper-ele istorice.
*/
Core.Modules.PlantingLines = Core.Modules.PlantingLines || {};

const PlantingLines = Core.Modules.PlantingLines;

function plantingLinesGetMidpoint(start, end) {
    return L.latLng(
        (start.lat + end.lat) / 2,
        (start.lng + end.lng) / 2
    );
}

function plantingLinesGetDistance(start, end) {
    return Core.functieGeometry.CalculateDistanceM(start, end);
}

function plantingLinesSelect(line) {
    if (!line) return;

    plantingLines.forEach(otherLine => {
        otherLine.selected = false;

        if (otherLine.label) {
            const element = otherLine.label.getElement();
            if (element) element.classList.remove("line-selected");
        }
    });

    line.selected = true;

    if (line.label) {
        const element = line.label.getElement();
        if (element) element.classList.add("line-selected");
    }
}

function plantingLinesCreateLabel(line) {
    const midpoint = plantingLinesGetMidpoint(line.points[0], line.points[1]);
    const distance = plantingLinesGetDistance(line.points[0], line.points[1]);

    const label = L.marker(midpoint, {
        interactive: true,
        zIndexOffset: 2300,
        icon: L.divIcon({
            className: "planting-line-distance-label",
            html: `
                <span>
                    ${distance.toFixed(1).replace(".", ",")} m
                    <button type="button" class="planting-line-delete" title="Șterge această linie" aria-label="Șterge această linie">×</button>
                </span>
            `,
            iconSize: [0, 0],
            iconAnchor: [0, 0]
        })
    }).addTo(map);

    label.on("click", event => {
        L.DomEvent.stopPropagation(event);
        plantingLinesRemove(line.id);
    });

    return label;
}

function plantingLinesRemove(lineId) {
    const index = plantingLines.findIndex(line => line.id === lineId);
    if (index === -1) return;

    const line = plantingLines[index];

    if (line.polyline && map) map.removeLayer(line.polyline);
    if (line.label && map) map.removeLayer(line.label);
    line.markers?.forEach(marker => map && map.removeLayer(marker));

    plantingLines.splice(index, 1);

    const status = document.getElementById("planting-line-status");
    if (status) {
        status.textContent = plantingLines.length
            ? `${plantingLines.length} ${plantingLines.length === 1 ? "linie" : "linii"} de plantare.`
            : "Nicio linie de plantare.";
    }
}

function plantingLinesRefreshVisual(line) {
    if (!map || !line || !Array.isArray(line.points) || line.points.length < 2) return;

    // IMPORTANT: în timpul dragului actualizăm markerul existent.
    // Nu îl ștergem și nu îl recreăm, pentru a păstra gestul Leaflet.
    if (line.polyline) {
        line.polyline.setLatLngs(line.points);
    } else {
        line.polyline = L.polyline(line.points, {
            color: "#ffffff",
            weight: 4,
            opacity: .95,
            dashArray: "10,6",
            interactive: true,
            renderer: gridRenderer || undefined
        }).addTo(map);

        line.polyline.on("click", event => {
            L.DomEvent.stopPropagation(event);
            plantingLinesSelect(line);
        });
    }

    const midpoint = plantingLinesGetMidpoint(line.points[0], line.points[1]);
    const distance = plantingLinesGetDistance(line.points[0], line.points[1]);

    if (!line.label) {
        line.label = plantingLinesCreateLabel(line);
    } else {
        line.label.setLatLng(midpoint);
        line.label.setIcon(L.divIcon({
            className: "planting-line-distance-label" + (line.selected ? " line-selected" : ""),
            html: `
                <span>
                    ${distance.toFixed(1).replace(".", ",")} m
                    <button type="button" class="planting-line-delete" title="Șterge această linie" aria-label="Șterge această linie">×</button>
                </span>
            `,
            iconSize: [0, 0],
            iconAnchor: [0, 0]
        }));
    }

    if (!Array.isArray(line.markers)) line.markers = [];

    line.points.forEach((point, index) => {
        let marker = line.markers[index];

        if (!marker) {
            marker = L.marker(point, {
                draggable: true,
                zIndexOffset: 2400,
                icon: L.divIcon({
                    className: "planting-line-vertex",
                    html: `<div title="${index === 0 ? "Începutul liniei" : "Sfârșitul liniei"}"></div>`,
                    iconSize: [18, 18],
                    iconAnchor: [9, 9]
                })
            }).addTo(map);

            marker.on("drag", e => {
                line.points[index] = e.target.getLatLng();
                line.selected = true;

                if (line.label) {
                    const element = line.label.getElement();
                    if (element) element.classList.add("line-selected");
                }

                if (line.polyline) line.polyline.setLatLngs(line.points);

                const newMidpoint = plantingLinesGetMidpoint(line.points[0], line.points[1]);
                const newDistance = plantingLinesGetDistance(line.points[0], line.points[1]);

                if (line.label) {
                    line.label.setLatLng(newMidpoint);
                    line.label.setIcon(L.divIcon({
                        className: "planting-line-distance-label line-selected",
                        html: `
                            <span>
                                ${newDistance.toFixed(1).replace(".", ",")} m
                                <button type="button" class="planting-line-delete" title="Șterge această linie" aria-label="Șterge această linie">×</button>
                            </span>
                        `,
                        iconSize: [0, 0],
                        iconAnchor: [0, 0]
                    }));
                }
            });

            marker.on("dragend", e => {
                line.points[index] = e.target.getLatLng();
                if (line.polyline) line.polyline.setLatLngs(line.points);

                const newMidpoint = plantingLinesGetMidpoint(line.points[0], line.points[1]);
                const newDistance = plantingLinesGetDistance(line.points[0], line.points[1]);

                if (line.label) {
                    line.label.setLatLng(newMidpoint);
                    line.label.setIcon(L.divIcon({
                        className: "planting-line-distance-label" + (line.selected ? " line-selected" : ""),
                        html: `
                            <span>
                                ${newDistance.toFixed(1).replace(".", ",")} m
                                <button type="button" class="planting-line-delete" title="Șterge această linie" aria-label="Șterge această linie">×</button>
                            </span>
                        `,
                        iconSize: [0, 0],
                        iconAnchor: [0, 0]
                    }));
                }

                line.selected = false;
                if (line.label) {
                    const element = line.label.getElement();
                    if (element) element.classList.remove("line-selected");
                }
            });

            line.markers[index] = marker;
        } else {
            // Sincronizare fără înlocuirea markerului existent.
            marker.setLatLng(point);
        }
    });
}

function plantingLinesRenderAll() {
    plantingLines.forEach(line => plantingLinesRefreshVisual(line));
}

function plantingLinesStart() {
    if (!map) return;

    if (isPerimeterDrawing) Core.Modules.Perimeter.Cancel();
    if (isPlantingMode) Core.Modules.Plants.Stop();

    plantingLinesCancel();

    isPlantingLineDrawing = true;
    plantingLineDraftPoints = [];
    document.getElementById("map")?.classList.add("planting-line-drawing");

    const status = document.getElementById("planting-line-status");
    if (status) status.textContent = "Alege punctul de început al liniei.";
}

function plantingLinesAddPoint(latlng) {
    if (!isPlantingLineDrawing || !latlng) return;

    plantingLineDraftPoints.push(L.latLng(latlng.lat, latlng.lng));

    if (plantingLineDraftPoints.length === 1) {
        plantingLinesRefreshDraft();
        const status = document.getElementById("planting-line-status");
        if (status) status.textContent = "Alege punctul de sfârșit al liniei.";
        return;
    }

    if (plantingLineDraftPoints.length === 2) {
        const line = {
            id: `line_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            points: [plantingLineDraftPoints[0], plantingLineDraftPoints[1]],
            polyline: null,
            label: null,
            markers: [],
            selected: false
        };

        plantingLines.push(line);
        plantingLinesClearDraft();
        isPlantingLineDrawing = false;
        document.getElementById("map")?.classList.remove("planting-line-drawing");
        plantingLinesRefreshVisual(line);

        const status = document.getElementById("planting-line-status");
        if (status) {
            status.textContent = `Linie adăugată: ${plantingLinesGetDistance(line.points[0], line.points[1]).toFixed(1).replace(".", ",")} m.`;
        }
    }
}

function plantingLinesRefreshDraft(cursorLatLng = null) {
    if (!map) return;

    if (plantingLineDraft) {
        map.removeLayer(plantingLineDraft);
        plantingLineDraft = null;
    }

    if (plantingLineDraftLabel) {
        map.removeLayer(plantingLineDraftLabel);
        plantingLineDraftLabel = null;
    }

    if (!plantingLineDraftPoints.length) return;

    const startPoint = plantingLineDraftPoints[0];

    if (cursorLatLng) {
        const endPoint = L.latLng(cursorLatLng.lat, cursorLatLng.lng);
        const distance = map.distance(startPoint, endPoint);
        const midpoint = plantingLinesGetMidpoint(startPoint, endPoint);

        plantingLineDraft = L.polyline([startPoint, endPoint], {
            color: "#ffffff",
            weight: 4,
            opacity: .95,
            dashArray: "8,6",
            interactive: false
        }).addTo(map);

        plantingLineDraftLabel = L.marker(midpoint, {
            interactive: false,
            zIndexOffset: 2350,
            icon: L.divIcon({
                className: "planting-line-distance-label planting-line-draft-label line-selected",
                html: `<span>${distance.toFixed(1).replace(".", ",")} m</span>`,
                iconSize: [0, 0],
                iconAnchor: [0, 0]
            })
        }).addTo(map);

        return;
    }

    plantingLineDraft = L.circleMarker(startPoint, {
        radius: 7,
        color: "#ffffff",
        weight: 3,
        fillColor: "#1f6b3a",
        fillOpacity: 1,
        interactive: false
    }).addTo(map);
}

function plantingLinesClearDraft() {
    if (plantingLineDraft && map) map.removeLayer(plantingLineDraft);
    if (plantingLineDraftLabel && map) map.removeLayer(plantingLineDraftLabel);
    plantingLineDraft = null;
    plantingLineDraftLabel = null;
    plantingLineDraftPoints = [];
}

function plantingLinesCancel() {
    isPlantingLineDrawing = false;
    document.getElementById("map")?.classList.remove("planting-line-drawing");
    plantingLinesClearDraft();

    const status = document.getElementById("planting-line-status");
    if (status && plantingLines.length) {
        status.textContent = `${plantingLines.length} ${plantingLines.length === 1 ? "linie" : "linii"} de plantare.`;
    } else if (status) {
        status.textContent = "Nicio linie de plantare.";
    }
}

function plantingLinesClear() {
    plantingLinesCancel();

    plantingLines.forEach(line => {
        if (line.polyline && map) map.removeLayer(line.polyline);
        if (line.label && map) map.removeLayer(line.label);
        line.markers?.forEach(marker => map && map.removeLayer(marker));
    });

    plantingLines = [];
    plantingLineVertexMarkers = [];

    const status = document.getElementById("planting-line-status");
    if (status) status.textContent = "Nicio linie de plantare.";
}

function plantingLinesApplySnap(latlng) {
    return Core.Modules.Snap.ApplyToPlantingLine(latlng);
}

/* API publică intuitivă */
PlantingLines.GetMidpoint = plantingLinesGetMidpoint;
PlantingLines.GetDistance = plantingLinesGetDistance;
PlantingLines.Select = plantingLinesSelect;
PlantingLines.CreateLabel = plantingLinesCreateLabel;
PlantingLines.Remove = plantingLinesRemove;
PlantingLines.RefreshVisual = plantingLinesRefreshVisual;
PlantingLines.RenderAll = plantingLinesRenderAll;
PlantingLines.Start = plantingLinesStart;
PlantingLines.AddPoint = plantingLinesAddPoint;
PlantingLines.RefreshDraft = plantingLinesRefreshDraft;
PlantingLines.ClearDraft = plantingLinesClearDraft;
PlantingLines.Cancel = plantingLinesCancel;
PlantingLines.Stop = plantingLinesCancel;
PlantingLines.Clear = plantingLinesClear;
PlantingLines.ApplySnap = plantingLinesApplySnap;
PlantingLines.GetLines = function () { return plantingLines; };
PlantingLines.GetCount = function () { return plantingLines.length; };
