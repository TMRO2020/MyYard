/* PERMA ENGINE — functieGeometry
   Geometrie metrică locală și operații geometrice comune.
   Nu deține starea aplicației; primește puncte/origini ca argumente.
*/
Core.functieGeometry = Core.functieGeometry || {};

const Geometry = Core.functieGeometry;

Geometry.CalculateDistanceM = function (start, end) {
    if (!start || !end) return 0;
    return L.CRS.Earth.distance(start, end);
};

Geometry.DestinationByBearing = function (center, bearingDeg, distanceMeters) {
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
};

Geometry.ProjectToLocalMeters = function (latlng, origin) {
    const R = 6378137;
    const lat0 = origin.lat * Math.PI / 180;
    return {
        x: (latlng.lng - origin.lng) * Math.PI / 180 * R * Math.cos(lat0),
        y: (latlng.lat - origin.lat) * Math.PI / 180 * R
    };
};

Geometry.LocalMetersToLatLng = function (x, y, origin) {
    const R = 6378137;
    const lat0 = origin.lat * Math.PI / 180;
    return L.latLng(
        origin.lat + (y / R) * 180 / Math.PI,
        origin.lng + (x / (R * Math.cos(lat0))) * 180 / Math.PI
    );
};

Geometry.GetLocalPerimeter = function (points) {
    if (!Array.isArray(points) || points.length < 3) return null;
    const origin = points[0];
    return {
        origin,
        points: points.map(point => Geometry.ProjectToLocalMeters(point, origin))
    };
};

Geometry.CalculatePolygonAreaM2 = function (polygon) {
    if (!Array.isArray(polygon) || polygon.length < 3) return 0;
    let sum = 0;
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
};

Geometry.CalculateClosedPerimeterLengthM = function (points) {
    if (!Array.isArray(points) || points.length < 2) return 0;
    let total = 0;
    for (let i = 0; i < points.length; i++) {
        total += L.CRS.Earth.distance(points[i], points[(i + 1) % points.length]);
    }
    return total;
};

Geometry.PointInPolygonXY = function (point, polygon) {
    if (!point || !Array.isArray(polygon) || polygon.length < 3) return false;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        const intersects = ((yi > point.y) !== (yj > point.y)) &&
            (point.x < (xj - xi) * (point.y - yi) / ((yj - yi) || 1e-12) + xi);
        if (intersects) inside = !inside;
    }
    return inside;
};

Geometry.ClosestPointOnSegmentXY = function (p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;

    if (len2 <= 1e-12) {
        return { x: a.x, y: a.y, t: 0 };
    }

    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    return {
        x: a.x + t * dx,
        y: a.y + t * dy,
        t
    };
};

Geometry.ClippedGridSegments = function (local, axis, value) {
    if (!local || !Array.isArray(local.points) || !["x", "y"].includes(axis)) return [];

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

    hits.sort((a, b) => a - b);

    const unique = [];
    hits.forEach(v => {
        if (!unique.length || Math.abs(v - unique.at(-1)) > 1e-7) unique.push(v);
    });

    const segments = [];
    for (let i = 0; i + 1 < unique.length; i += 2) {
        const mid = (unique[i] + unique[i + 1]) / 2;
        const point = axis === "x" ? { x: value, y: mid } : { x: mid, y: value };
        if (Geometry.PointInPolygonXY(point, pts)) {
            segments.push([unique[i], unique[i + 1]]);
        }
    }

    return segments;
};
