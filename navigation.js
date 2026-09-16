/* =========================================================
   PERMA ENGINE — Navigation Sandbox 14A
   Scop: testare independentă a navigației GPS către un punct.

   Nu depinde de app.js sau de PERMA ENGINE Stable Base 13C.
   ========================================================= */

let map;
let targetLatLng = null;
let targetMarker = null;
let targetZone = null;
let userMarker = null;
let accuracyCircle = null;
let watchId = null;
let latestPosition = null;
let pickingTarget = false;

const ARRIVAL_RADIUS_M = 1;

const $ = id => document.getElementById(id);

function formatDistance(m) {
    if (!Number.isFinite(m)) return "—";
    if (m < 10) return `${m.toFixed(1).replace(".", ",")} m`;
    return `${m.toFixed(1).replace(".", ",")} m`;
}

function formatSigned(m) {
    if (!Number.isFinite(m)) return "—";
    const sign = m >= 0 ? "+" : "−";
    return `${sign}${Math.abs(m).toFixed(1).replace(".", ",")} m`;
}

function formatBearing(deg) {
    if (!Number.isFinite(deg)) return "—";
    return `${Math.round(deg)}°`;
}

function createTargetIcon() {
    return L.divIcon({ className: "", html: '<div class="target-marker-icon"></div>', iconSize: [30,30], iconAnchor: [15,15] });
}

function createUserIcon() {
    return L.divIcon({ className: "", html: '<div class="user-marker-icon"></div>', iconSize: [22,22], iconAnchor: [11,11] });
}

function initMap() {
    const params = new URLSearchParams(location.search);
    const qLat = Number(params.get("lat"));
    const qLng = Number(params.get("lng"));
    const hasQueryTarget = Number.isFinite(qLat) && Number.isFinite(qLng);

    const defaultCenter = hasQueryTarget ? [qLat, qLng] : [45.9432, 24.9668];

    map = L.map("map", { zoomControl: false, tap: true, preferCanvas: true }).setView(defaultCenter, hasQueryTarget ? 21 : 19);

    L.tileLayer("https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
        maxZoom: 23,
        maxNativeZoom: 19,
        attribution: "&copy; Google"
    }).addTo(map);

    map.on("click", event => {
        if (!pickingTarget) return;
        setTarget(event.latlng.lat, event.latlng.lng, true);
        stopPicking();
    });

    $("btn-pick").addEventListener("click", startPicking);
    $("btn-clear").addEventListener("click", clearTarget);
    $("btn-set-coords").addEventListener("click", setTargetFromInputs);
    $("btn-locate").addEventListener("click", startNavigation);
    $("btn-stop").addEventListener("click", stopNavigation);

    if (hasQueryTarget) setTarget(qLat, qLng, false);
}

function startPicking() {
    pickingTarget = true;
    $("pick-hint").classList.remove("hidden");
    $("btn-pick").textContent = "Atinge harta…";
    map.getContainer().style.cursor = "crosshair";
}

function stopPicking() {
    pickingTarget = false;
    $("pick-hint").classList.add("hidden");
    $("btn-pick").textContent = "Alege ținta pe hartă";
    map.getContainer().style.cursor = "";
}

function setTargetFromInputs() {
    const lat = Number($("target-lat").value);
    const lng = Number($("target-lng").value);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        alert("Introdu o latitudine și o longitudine valide.");
        return;
    }
    setTarget(lat, lng, true);
}

function setTarget(lat, lng, recenter) {
    targetLatLng = L.latLng(lat, lng);

    if (!targetMarker) targetMarker = L.marker(targetLatLng, { icon: createTargetIcon(), zIndexOffset: 500 }).addTo(map);
    else targetMarker.setLatLng(targetLatLng);

    if (!targetZone) {
        targetZone = L.circle(targetLatLng, {
            radius: ARRIVAL_RADIUS_M,
            weight: 3,
            fillOpacity: 0.08,
            className: "target-zone"
        }).addTo(map);
    } else targetZone.setLatLng(targetLatLng);

    $("target-lat").value = lat.toFixed(7);
    $("target-lng").value = lng.toFixed(7);
    $("target-status").textContent = `Țintă setată: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;

    if (recenter) map.setView(targetLatLng, Math.max(21, map.getZoom()));

    if (latestPosition) updateNavigation(latestPosition);
}

function clearTarget() {
    stopNavigation();
    targetLatLng = null;
    if (targetMarker) { map.removeLayer(targetMarker); targetMarker = null; }
    if (targetZone) { map.removeLayer(targetZone); targetZone = null; }
    $("target-status").textContent = "Alege un punct pe hartă.";
    $("target-lat").value = "";
    $("target-lng").value = "";
}

function startNavigation() {
    if (!targetLatLng) {
        alert("Alege mai întâi copacul/ținta.");
        return;
    }

    if (!navigator.geolocation) {
        alert("Acest browser nu oferă geolocație.");
        return;
    }

    if (watchId !== null) navigator.geolocation.clearWatch(watchId);

    $("navigation-card").classList.remove("hidden");
    $("gps-status").textContent = "Se caută GPS…";
    $("nav-state").textContent = "Se caută GPS…";

    watchId = navigator.geolocation.watchPosition(
        position => {
            latestPosition = position;
            updateUserPosition(position);
            updateNavigation(position);
        },
        error => {
            $("gps-status").textContent = `GPS: ${gpsErrorText(error)}`;
            $("nav-state").textContent = "GPS indisponibil";
        },
        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 15000
        }
    );
}

function stopNavigation() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    $("navigation-card").classList.add("hidden");
    $("gps-status").textContent = latestPosition ? "GPS oprit" : "GPS oprit";
}

function gpsErrorText(error) {
    if (error.code === 1) return "permisiune refuzată";
    if (error.code === 2) return "poziție indisponibilă";
    if (error.code === 3) return "timeout";
    return error.message || "eroare";
}

function updateUserPosition(position) {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    const accuracy = position.coords.accuracy;
    const point = L.latLng(lat, lng);

    if (!userMarker) userMarker = L.marker(point, { icon: createUserIcon(), zIndexOffset: 1000 }).addTo(map);
    else userMarker.setLatLng(point);

    if (!accuracyCircle) {
        accuracyCircle = L.circle(point, { radius: accuracy, weight: 1, fillOpacity: 0.04, className: "accuracy-circle" }).addTo(map);
    } else {
        accuracyCircle.setLatLng(point);
        accuracyCircle.setRadius(accuracy);
    }

    $("current-lat").textContent = `Lat ${lat.toFixed(7)}`;
    $("current-lng").textContent = `Lng ${lng.toFixed(7)}`;
    $("gps-status").textContent = `GPS ±${Math.round(accuracy)} m`;
    $("gps-accuracy").textContent = `Precizie ±${Math.round(accuracy)} m`;
}

function updateNavigation(position) {
    if (!targetLatLng) return;

    const current = L.latLng(position.coords.latitude, position.coords.longitude);
    const distance = map.distance(current, targetLatLng);
    const bearing = calculateBearing(current.lat, current.lng, targetLatLng.lat, targetLatLng.lng);
    const delta = localDeltaMeters(current, targetLatLng);
    const arrived = distance <= ARRIVAL_RADIUS_M;

    $("distance-value").textContent = formatDistance(distance);
    $("delta-x").textContent = formatSigned(delta.x);
    $("delta-y").textContent = formatSigned(delta.y);
    $("bearing-value").textContent = formatBearing(bearing);
    $("nav-state").textContent = arrived ? "ȚINTĂ ATINSĂ" : "În drum spre țintă";

    const badge = $("arrival-badge");
    badge.classList.toggle("arrived", arrived);
    badge.textContent = arrived ? "🟢 Ești în raza de 1 m" : `Ținta este la ${formatDistance(distance)}`;

    // North-up: săgeata indică bearing-ul geografic către țintă.
    $("direction-arrow").style.transform = `rotate(${bearing}deg)`;

    if (targetMarker) targetMarker.setOpacity(arrived ? 1 : 0.95);
}

function calculateBearing(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * Math.PI / 180;
    const p2 = lat2 * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function localDeltaMeters(from, to) {
    const latRad = ((from.lat + to.lat) / 2) * Math.PI / 180;
    const metersPerDegLat = 111132.92 - 559.82 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad);
    const metersPerDegLng = 111412.84 * Math.cos(latRad) - 93.5 * Math.cos(3 * latRad);
    return {
        x: (to.lng - from.lng) * metersPerDegLng,
        y: (to.lat - from.lat) * metersPerDegLat
    };
}

window.addEventListener("load", initMap);
