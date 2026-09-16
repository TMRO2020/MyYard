/* PERMA ENGINE — Module: Snap
   Etapa 6: logica Snap mutată incremental din app.js.
   Păstrăm starea globală existentă pentru compatibilitate.
*/
Core.Modules.Snap = Core.Modules.Snap || {};

const Snap = Core.Modules.Snap;

Snap.SetMode = function (value) {
    snapMode = ["off", "cell", "grid", "line"].includes(value) ? value : "off";
    return snapMode;
};

Snap.GetMode = function () {
    return snapMode;
};

Snap.ApplyToPlantingLine = function (latlng) {
    if (!map || !plantingLines.length) {
        return { lat: latlng.lat, lng: latlng.lng, inside: true };
    }

    const origin = Core.Modules.Punct0?.GetOrigin?.() || (perimeterPoints.length ? perimeterPoints[0] : plantingLines[0].points[0]);
    const p = Core.functieGeometry.ProjectToLocalMeters(latlng, origin);

    let best = null;

    plantingLines.forEach(line => {
        const a = Core.functieGeometry.ProjectToLocalMeters(line.points[0], origin);
        const b = Core.functieGeometry.ProjectToLocalMeters(line.points[1], origin);
        const closest = Core.functieGeometry.ClosestPointOnSegmentXY(p, a, b);
        const dx = closest.x - p.x;
        const dy = closest.y - p.y;
        const distance2 = dx * dx + dy * dy;

        if (!best || distance2 < best.distance2) {
            best = { point: closest, distance2 };
        }
    });

    if (!best) {
        return { lat: latlng.lat, lng: latlng.lng, inside: true };
    }

    const snappedLatLng = Core.functieGeometry.LocalMetersToLatLng(
        best.point.x,
        best.point.y,
        origin
    );

    let inside = true;
    if (perimeterPoints.length >= 3) {
        const local = Core.functieGeometry.GetLocalPerimeter(perimeterPoints, Core.Modules.Punct0?.GetOrigin?.() || null);
        inside = Core.functieGeometry.PointInPolygonXY(best.point, local.points);
    }

    return {
        lat: snappedLatLng.lat,
        lng: snappedLatLng.lng,
        inside
    };
};

Snap.Apply = function (latlng) {
    if (!latlng) return { lat: 0, lng: 0, inside: false };

    if (snapMode === "line") {
        return Snap.ApplyToPlantingLine(latlng);
    }

    if (perimeterPoints.length < 3 || snapMode === "off") {
        return { lat: latlng.lat, lng: latlng.lng, inside: true };
    }

    const local = Core.functieGeometry.GetLocalPerimeter(perimeterPoints, Core.Modules.Punct0?.GetOrigin?.() || null);
    const p = Core.functieGeometry.ProjectToLocalMeters(latlng, local.origin);
    const step = gridSizeMeters;

    const x = snapMode === "cell"
        ? (Math.floor(p.x / step) + .5) * step
        : Math.round(p.x / step) * step;
    const y = snapMode === "cell"
        ? (Math.floor(p.y / step) + .5) * step
        : Math.round(p.y / step) * step;

    const snapped = { x, y };
    const snappedLatLng = Core.functieGeometry.LocalMetersToLatLng(
        x, y, local.origin
    );

    return {
        lat: snappedLatLng.lat,
        lng: snappedLatLng.lng,
        inside: Core.functieGeometry.PointInPolygonXY(snapped, local.points)
    };
};
