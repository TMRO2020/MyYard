/* PERMA ENGINE — Module: Grid
   Etapa 5: logica grilei este mutată din app.js în modulul dedicat.
   Starea existentă rămâne compatibilă cu aplicația actuală pentru migrare incrementală.
*/
Core.Modules.Grid = Core.Modules.Grid || {};

const Grid = Core.Modules.Grid;

Grid.Update = function () {
    if (!map || Core.Modules.Perimeter.GetPoints().length < 3) return;

    gridGroup.clearLayers();

    const points = Core.Modules.Perimeter.GetPoints();
    const local = Core.functieGeometry.GetLocalPerimeter(points);
    if (!local) return;

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
        Core.functieGeometry.ClippedGridSegments(local, "x", x).forEach(([y1,y2]) => {
            L.polyline([
                Core.functieGeometry.LocalMetersToLatLng(x, y1, local.origin),
                Core.functieGeometry.LocalMetersToLatLng(x, y2, local.origin)
            ], lineOptions).addTo(gridGroup);
        });
    }

    if (lineCount <= maxLines) {
        for (let y = minY; y <= maxY + gridSizeMeters/2; y += gridSizeMeters) {
            if (++lineCount > maxLines) break;
            Core.functieGeometry.ClippedGridSegments(local, "y", y).forEach(([x1,x2]) => {
                L.polyline([
                    Core.functieGeometry.LocalMetersToLatLng(x1, y, local.origin),
                    Core.functieGeometry.LocalMetersToLatLng(x2, y, local.origin)
                ], lineOptions).addTo(gridGroup);
            });
        }
    }

    if (lineCount > maxLines) {
        status.textContent += " Grila a fost limitată pentru performanță; mărește pasul la 2–5 m dacă este nevoie.";
    }
};

Grid.Toggle = function (enabled) {
    if (!map) return;

    if (enabled) {
        if (Core.Modules.Perimeter.GetPoints().length < 3) {
            document.getElementById("grid-toggle").checked = false;
            alert("Desenează și închide mai întâi perimetrul zonei de plantare.");
            return;
        }
        gridGroup.addTo(map);
        Grid.Update();
    } else {
        map.removeLayer(gridGroup);
        document.getElementById("grid-status").textContent = "Grila este oprită.";
    }
};

Grid.SetSize = function (value) {
    const n = Number(value);
    if (![0.5, 1, 2, 5].includes(n)) return;
    gridSizeMeters = n;
    if (map?.hasLayer(gridGroup)) Grid.Update();
};

Grid.GetSize = function () {
    return gridSizeMeters;
};

Grid.IsVisible = function () {
    return !!map?.hasLayer(gridGroup);
};
