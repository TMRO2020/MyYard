/* =========================================================
   PERMA ENGINE — Module: Navigation
   Etapa 14B — Orientare telefon + stabilizare GPS.

   Scop:
   - folosește harta Leaflet existentă;
   - folosește GPS-ul browserului fără a modifica fluxul GPS existent;
   - navighează către un treeObj existent din modulul Plants;
   - stabilizează poziția folosită pentru navigație folosind media ultimelor
     4 citiri GPS;
   - calculează direcția relativ la partea de sus a telefonului;
   - afișează temporar date de diagnostic pentru orientare/senzori.
   ========================================================= */
Core.Modules.Navigation = Core.Modules.Navigation || {};

const Navigation = Core.Modules.Navigation;

let navigationActive = false;
let navigationTarget = null;
let navigationWatchId = null;
let navigationCurrentMarker = null;
let navigationAccuracyCircle = null;
let navigationTargetCircle = null;
let navigationRouteLine = null;
let navigationPanel = null;
let navigationTargetDragHandler = null;
let navigationFirstFix = true;

// Test 14B: folosim ultimele 4 poziții pentru poziția filtrată.
const NAVIGATION_GPS_SAMPLE_COUNT = 4;
const NAVIGATION_ARRIVAL_RADIUS_M = 1;
let navigationGpsSamples = [];
let navigationLastRawPosition = null;

// Orientarea telefonului.
let navigationOrientationActive = false;
let navigationOrientationEventName = null;
let navigationDeviceHeading = null;
let navigationAlpha = null;
let navigationBeta = null;
let navigationGamma = null;
let navigationOrientationPermissionState = "unknown";

function navigationEnsurePanel() {
    if (navigationPanel) return navigationPanel;

    navigationPanel = document.createElement("section");
    navigationPanel.id = "navigation-panel";
    navigationPanel.className = "navigation-panel";
    navigationPanel.setAttribute("aria-live", "polite");
    navigationPanel.innerHTML = `
        <div class="navigation-panel-header">
            <div>
                <div class="navigation-title">🚶 Navigare la copac</div>
                <div id="navigation-target-name" class="navigation-target-name">Țintă</div>
            </div>
            <div class="navigation-header-actions">
                <button id="navigation-orientation" class="navigation-orientation-button" type="button">🧭 Orientare</button>
                <button id="navigation-stop" class="navigation-stop" type="button">Oprește</button>
            </div>
        </div>

        <div id="navigation-arrival" class="navigation-arrival">Aștept poziția GPS…</div>

        <div class="navigation-main">
            <div class="navigation-distance-block">
                <span class="navigation-label">Distanță</span>
                <strong id="navigation-distance">—</strong>
            </div>
            <div class="navigation-arrow-wrap" aria-hidden="true">
                <div id="navigation-arrow" class="navigation-arrow">↑</div>
            </div>
        </div>

        <div class="navigation-grid">
            <div><span>ΔX</span><b id="navigation-dx">—</b></div>
            <div><span>ΔY</span><b id="navigation-dy">—</b></div>
            <div><span>Țintă</span><b id="navigation-bearing">—</b></div>
            <div><span>GPS</span><b id="navigation-accuracy">—</b></div>
        </div>

        <div id="navigation-status" class="navigation-status">Se caută poziția GPS…</div>

        <div id="navigation-diagnostics" class="navigation-diagnostics">
            <div><span>Telefon</span><b id="navigation-heading">—</b></div>
            <div><span>Diferență</span><b id="navigation-relative-heading">—</b></div>
            <div><span>α / β / γ</span><b id="navigation-angles">—</b></div>
            <div><span>Filtru GPS</span><b id="navigation-gps-filter">0 / ${NAVIGATION_GPS_SAMPLE_COUNT}</b></div>
        </div>
    `;

    document.body.appendChild(navigationPanel);
    document.getElementById("navigation-stop").addEventListener("click", () => Navigation.Stop());
    document.getElementById("navigation-orientation").addEventListener("click", () => Navigation.EnableOrientation());

    return navigationPanel;
}

function navigationFormatMeters(value) {
    if (!Number.isFinite(value)) return "—";
    return `${value.toFixed(1).replace(".", ",")} m`;
}

function navigationFormatDelta(value) {
    if (!Number.isFinite(value)) return "—";
    const rounded = Math.abs(value) < 0.05 ? 0 : value;
    return `${rounded >= 0 ? "+" : "−"}${Math.abs(rounded).toFixed(1).replace(".", ",")} m`;
}

function navigationFormatBearing(value) {
    if (!Number.isFinite(value)) return "—";
    return `${Math.round(value)}°`;
}

function navigationNormalizeAngle(value) {
    if (!Number.isFinite(value)) return null;
    return ((value % 360) + 360) % 360;
}

function navigationNormalizeRelativeAngle(value) {
    if (!Number.isFinite(value)) return null;
    let result = ((value + 180) % 360 + 360) % 360 - 180;
    if (result === -180) result = 180;
    return result;
}

function navigationCalculateBearing(from, to) {
    const lat1 = from.lat * Math.PI / 180;
    const lat2 = to.lat * Math.PI / 180;
    const dLng = (to.lng - from.lng) * Math.PI / 180;

    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function navigationCreateCurrentIcon() {
    return L.divIcon({
        className: "navigation-current-point",
        html: `
            <div class="navigation-current-dot">
                <span></span>
            </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });
}

function navigationSetPanelState(state, message) {
    const panel = navigationEnsurePanel();
    panel.classList.remove("is-arrived", "is-waiting", "is-error");
    if (state) panel.classList.add(`is-${state}`);

    const status = document.getElementById("navigation-status");
    if (status) status.textContent = message || "";
}

function navigationUpdateTargetVisual() {
    if (!navigationActive || !navigationTarget) return;

    const targetLatLng = navigationTarget.marker.getLatLng();

    if (navigationTargetCircle) {
        navigationTargetCircle.setLatLng(targetLatLng);
    }

    if (navigationRouteLine && navigationCurrentMarker) {
        navigationRouteLine.setLatLngs([
            navigationCurrentMarker.getLatLng(),
            targetLatLng
        ]);
    }
}

function navigationGetFilteredPosition() {
    if (!navigationGpsSamples.length) return null;

    let lat = 0;
    let lng = 0;

    for (const sample of navigationGpsSamples) {
        lat += sample.lat;
        lng += sample.lng;
    }

    return L.latLng(
        lat / navigationGpsSamples.length,
        lng / navigationGpsSamples.length
    );
}

function navigationUpdateGpsFilterUI() {
    const filterEl = document.getElementById("navigation-gps-filter");
    if (filterEl) {
        filterEl.textContent = `${navigationGpsSamples.length} / ${NAVIGATION_GPS_SAMPLE_COUNT}`;
    }
}

function navigationGetScreenAngle() {
    if (typeof screen !== "undefined" && screen.orientation && Number.isFinite(screen.orientation.angle)) {
        return screen.orientation.angle;
    }
    if (typeof window.orientation === "number") return window.orientation;
    return 0;
}

function navigationHeadingFromDeviceOrientation(event) {
    // iOS Safari oferă direct heading-ul calculat de compass.
    if (Number.isFinite(event.webkitCompassHeading)) {
        return navigationNormalizeAngle(event.webkitCompassHeading);
    }

    // Pentru DeviceOrientation absolute folosim alpha și compensăm orientarea
    // ecranului. Este o estimare de heading pentru telefoanele care nu oferă
    // webkitCompassHeading.
    if (Number.isFinite(event.alpha)) {
        const screenAngle = navigationGetScreenAngle();
        return navigationNormalizeAngle(360 - event.alpha + screenAngle);
    }

    return null;
}

function navigationUpdateOrientationUI() {
    const headingEl = document.getElementById("navigation-heading");
    const relativeEl = document.getElementById("navigation-relative-heading");
    const anglesEl = document.getElementById("navigation-angles");
    const arrowEl = document.getElementById("navigation-arrow");
    const orientationButton = document.getElementById("navigation-orientation");

    if (headingEl) {
        headingEl.textContent = Number.isFinite(navigationDeviceHeading)
            ? `${Math.round(navigationDeviceHeading)}°`
            : "—";
    }

    if (anglesEl) {
        const a = Number.isFinite(navigationAlpha) ? Math.round(navigationAlpha) : "—";
        const b = Number.isFinite(navigationBeta) ? Math.round(navigationBeta) : "—";
        const g = Number.isFinite(navigationGamma) ? Math.round(navigationGamma) : "—";
        anglesEl.textContent = `${a}° / ${b}° / ${g}°`;
    }

    if (navigationTarget && navigationCurrentMarker && Number.isFinite(navigationDeviceHeading)) {
        const target = navigationTarget.marker.getLatLng();
        const current = navigationCurrentMarker.getLatLng();
        const bearing = navigationCalculateBearing(current, target);
        const relative = navigationNormalizeRelativeAngle(bearing - navigationDeviceHeading);

        if (relativeEl) {
            relativeEl.textContent = Number.isFinite(relative)
                ? `${relative > 0 ? "+" : "−"}${Math.round(Math.abs(relative))}°`
                : "—";
        }

        if (arrowEl && Number.isFinite(relative)) {
            // Săgeata este orientată relativ la partea de sus a telefonului.
            arrowEl.style.transform = `rotate(${relative}deg)`;
            arrowEl.classList.add("is-relative");
        }
    } else if (arrowEl) {
        // Fallback: înainte de disponibilitatea orientării, păstrăm bearing-ul
        // geografic folosit în 14A.
        const bearing = navigationGetBearing();
        arrowEl.style.transform = Number.isFinite(bearing)
            ? `rotate(${bearing}deg)`
            : "rotate(0deg)";
        arrowEl.classList.remove("is-relative");
    }

    if (orientationButton) {
        if (navigationOrientationActive) {
            orientationButton.textContent = "🧭 Activă";
            orientationButton.classList.add("is-active");
        } else if (navigationOrientationPermissionState === "denied") {
            orientationButton.textContent = "🧭 Permisiune refuzată";
            orientationButton.classList.remove("is-active");
        } else {
            orientationButton.textContent = "🧭 Activează orientarea";
            orientationButton.classList.remove("is-active");
        }
    }
}

function navigationHandleOrientation(event) {
    if (!navigationActive) return;

    navigationAlpha = Number.isFinite(event.alpha) ? event.alpha : null;
    navigationBeta = Number.isFinite(event.beta) ? event.beta : null;
    navigationGamma = Number.isFinite(event.gamma) ? event.gamma : null;

    const heading = navigationHeadingFromDeviceOrientation(event);
    if (Number.isFinite(heading)) {
        navigationDeviceHeading = heading;
        navigationOrientationActive = true;
        navigationOrientationPermissionState = "granted";
    }

    navigationUpdateOrientationUI();
}

function navigationAttachOrientationListener() {
    if (navigationOrientationEventName) return true;
    if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return false;

    // Preferăm evenimentul absolut când browserul îl oferă.
    if ("ondeviceorientationabsolute" in window) {
        window.addEventListener("deviceorientationabsolute", navigationHandleOrientation, true);
        navigationOrientationEventName = "deviceorientationabsolute";
    } else {
        window.addEventListener("deviceorientation", navigationHandleOrientation, true);
        navigationOrientationEventName = "deviceorientation";
    }

    return true;
}

async function navigationEnableOrientation() {
    navigationEnsurePanel();

    try {
        if (typeof DeviceOrientationEvent === "undefined") {
            navigationOrientationPermissionState = "unsupported";
            navigationUpdateOrientationUI();
            navigationSetPanelState(null, "Orientarea telefonului nu este disponibilă în acest browser.");
            return false;
        }

        // iOS 13+ cere permisiune explicită și apelul trebuie făcut dintr-o
        // acțiune a utilizatorului.
        if (typeof DeviceOrientationEvent.requestPermission === "function") {
            const permission = await DeviceOrientationEvent.requestPermission();
            navigationOrientationPermissionState = permission;
            if (permission !== "granted") {
                navigationOrientationActive = false;
                navigationUpdateOrientationUI();
                navigationSetPanelState(null, "Permisiunea pentru orientarea telefonului nu a fost acordată.");
                return false;
            }
        } else {
            navigationOrientationPermissionState = "granted";
        }

        const attached = navigationAttachOrientationListener();
        if (!attached) {
            navigationOrientationPermissionState = "unsupported";
            navigationUpdateOrientationUI();
            navigationSetPanelState(null, "Orientarea telefonului nu este disponibilă.");
            return false;
        }

        navigationSetPanelState(null, "Orientare activă · rotește telefonul și urmărește săgeata.");
        navigationUpdateOrientationUI();
        return true;
    } catch (error) {
        navigationOrientationPermissionState = "error";
        navigationOrientationActive = false;
        navigationUpdateOrientationUI();
        navigationSetPanelState(null, "Nu s-a putut activa orientarea telefonului.");
        return false;
    }
}

function navigationDetachOrientationListener() {
    if (!navigationOrientationEventName || typeof window === "undefined") return;

    window.removeEventListener(navigationOrientationEventName, navigationHandleOrientation, true);
    navigationOrientationEventName = null;
}

function navigationUpdatePosition(position) {
    if (!navigationActive || !navigationTarget || !map) return;

    const rawLat = Number(position.coords.latitude);
    const rawLng = Number(position.coords.longitude);
    const accuracy = Number(position.coords.accuracy);

    if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng)) return;

    navigationLastRawPosition = {
        lat: rawLat,
        lng: rawLng,
        accuracy,
        timestamp: Number(position.timestamp) || Date.now()
    };

    navigationGpsSamples.push({ lat: rawLat, lng: rawLng });
    if (navigationGpsSamples.length > NAVIGATION_GPS_SAMPLE_COUNT) {
        navigationGpsSamples.shift();
    }
    navigationUpdateGpsFilterUI();

    const current = navigationGetFilteredPosition();
    if (!current) return;

    const target = navigationTarget.marker.getLatLng();
    const distance = Core.functieGeometry.CalculateDistanceM(current, target);
    const bearing = navigationCalculateBearing(current, target);

    // ΔX / ΔY respectă convenția PERMA: X = Est, Y = Nord.
    // Valorile reprezintă deplasarea necesară de la poziția curentă către țintă.
    const currentLocal = Core.functieGeometry.ProjectToLocalMeters(current, target);
    const dx = -currentLocal.x;
    const dy = -currentLocal.y;

    if (!navigationCurrentMarker) {
        navigationCurrentMarker = L.marker(current, {
            icon: navigationCreateCurrentIcon(),
            interactive: false,
            zIndexOffset: 3000
        }).addTo(map);
    } else {
        navigationCurrentMarker.setLatLng(current);
    }

    if (!navigationAccuracyCircle) {
        navigationAccuracyCircle = L.circle(current, {
            radius: Number.isFinite(accuracy) ? accuracy : 0,
            color: "#1976d2",
            fillColor: "#1976d2",
            fillOpacity: 0.08,
            weight: 1.5,
            interactive: false,
            zIndex: 2990
        }).addTo(map);
    } else {
        navigationAccuracyCircle.setLatLng(current);
        if (Number.isFinite(accuracy)) navigationAccuracyCircle.setRadius(accuracy);
    }

    navigationUpdateTargetVisual();

    const distanceEl = document.getElementById("navigation-distance");
    const dxEl = document.getElementById("navigation-dx");
    const dyEl = document.getElementById("navigation-dy");
    const bearingEl = document.getElementById("navigation-bearing");
    const accuracyEl = document.getElementById("navigation-accuracy");
    const arrowEl = document.getElementById("navigation-arrow");

    if (distanceEl) distanceEl.textContent = navigationFormatMeters(distance);
    if (dxEl) dxEl.textContent = navigationFormatDelta(dx);
    if (dyEl) dyEl.textContent = navigationFormatDelta(dy);
    if (bearingEl) bearingEl.textContent = navigationFormatBearing(bearing);
    if (accuracyEl) accuracyEl.textContent = Number.isFinite(accuracy)
        ? `±${navigationFormatMeters(accuracy)}`
        : "—";

    if (!navigationOrientationActive && arrowEl) {
        arrowEl.style.transform = `rotate(${bearing}deg)`;
    }
    navigationUpdateOrientationUI();

    if (navigationFirstFix) {
        navigationFirstFix = false;
        const bounds = L.latLngBounds([current, target]);
        if (distance < 25) {
            map.setView(current, Math.max(map.getZoom(), 20));
        } else {
            map.fitBounds(bounds.pad(0.45), {
                maxZoom: 21,
                animate: false
            });
        }
    }

    const arrived = distance <= NAVIGATION_ARRIVAL_RADIUS_M;
    if (navigationTargetCircle) {
        navigationTargetCircle.setStyle({
            color: arrived ? "#16803c" : "#ff9800",
            fillColor: arrived ? "#16803c" : "#ff9800",
            fillOpacity: arrived ? 0.24 : 0.10,
            weight: arrived ? 4 : 2
        });
    }

    if (arrived) {
        navigationSetPanelState("arrived", "🟢 Ești în raza de 1 m față de copac.");
        const arrival = document.getElementById("navigation-arrival");
        if (arrival) arrival.textContent = "🟢 ȚINTĂ ATINSĂ";
    } else if (navigationGpsSamples.length < NAVIGATION_GPS_SAMPLE_COUNT) {
        navigationSetPanelState(
            "waiting",
            `Stabilizare GPS · ${navigationGpsSamples.length}/${NAVIGATION_GPS_SAMPLE_COUNT} citiri`
        );
        const arrival = document.getElementById("navigation-arrival");
        if (arrival) arrival.textContent = "Stabilizez poziția…";
    } else {
        navigationSetPanelState(
            null,
            Number.isFinite(accuracy)
                ? `GPS activ · poziție filtrată din ultimele ${NAVIGATION_GPS_SAMPLE_COUNT} citiri · precizie raportată ±${navigationFormatMeters(accuracy)}`
                : `GPS activ · poziție filtrată din ultimele ${NAVIGATION_GPS_SAMPLE_COUNT} citiri`
        );
        const arrival = document.getElementById("navigation-arrival");
        if (arrival) arrival.textContent = "Mergi către țintă";
    }
}

function navigationHandleError(error) {
    if (!navigationActive) return;

    let message = "GPS indisponibil.";
    if (error && error.code === 1) message = "Permisiunea pentru GPS a fost refuzată.";
    if (error && error.code === 2) message = "Poziția GPS nu este disponibilă momentan.";
    if (error && error.code === 3) message = "GPS-ul a depășit timpul de așteptare.";

    navigationSetPanelState("error", message);
    const arrival = document.getElementById("navigation-arrival");
    if (arrival) arrival.textContent = "⚠ GPS";
}

function navigationStartWatch() {
    if (!navigator.geolocation) {
        navigationHandleError({ code: 2 });
        return;
    }

    if (navigationWatchId !== null) {
        navigator.geolocation.clearWatch(navigationWatchId);
        navigationWatchId = null;
    }

    // 14B.1: păstrăm comportamentul GPS care a funcționat în 14A și
    // cerem mai întâi o poziție imediată. Astfel interfața nu rămâne blocată
    // în "Aștept poziția GPS" dacă watchPosition întârzie primul callback.
    navigator.geolocation.getCurrentPosition(
        navigationUpdatePosition,
        navigationHandleError,
        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 20000
        }
    );

    // După primul request, continuăm cu urmărirea live pentru filtrul de 4
    // citiri. O valoare cached foarte recentă este acceptată pentru a evita
    // pauze inutile între actualizări, fără a schimba precizia raportată.
    navigationWatchId = navigator.geolocation.watchPosition(
        navigationUpdatePosition,
        navigationHandleError,
        {
            enableHighAccuracy: true,
            maximumAge: 1000,
            timeout: 20000
        }
    );
}

function navigationStart(treeObj) {
    if (!treeObj || !treeObj.marker || !map) return false;

    Navigation.Stop();

    navigationTarget = treeObj;
    navigationActive = true;
    navigationFirstFix = true;
    navigationGpsSamples = [];
    navigationLastRawPosition = null;
    navigationDeviceHeading = null;
    navigationAlpha = null;
    navigationBeta = null;
    navigationGamma = null;
    navigationOrientationActive = false;
    navigationOrientationPermissionState = "unknown";

    const panel = navigationEnsurePanel();
    panel.classList.add("is-visible");

    const species = treeObj.treeData?.species || "Copac";
    const variety = treeObj.treeData?.variety;
    const targetName = variety ? `${species} — ${variety}` : species;
    document.getElementById("navigation-target-name").textContent = targetName;

    const targetLatLng = treeObj.marker.getLatLng();

    navigationTargetCircle = L.circle(targetLatLng, {
        radius: NAVIGATION_ARRIVAL_RADIUS_M,
        color: "#ff9800",
        fillColor: "#ff9800",
        fillOpacity: 0.10,
        weight: 2,
        interactive: false,
        zIndex: 2800
    }).addTo(map);

    navigationRouteLine = L.polyline([targetLatLng, targetLatLng], {
        color: "#1976d2",
        weight: 3,
        opacity: 0.72,
        dashArray: "8,7",
        interactive: false,
        zIndex: 2750
    }).addTo(map);

    navigationTargetDragHandler = () => navigationUpdateTargetVisual();
    treeObj.marker.on("drag", navigationTargetDragHandler);
    treeObj.marker.on("dragend", navigationTargetDragHandler);

    navigationSetPanelState("waiting", "Se așteaptă primul punct GPS…");
    navigationUpdateOrientationUI();
    navigationUpdateGpsFilterUI();
    navigationStartWatch();

    if (typeof map.closePopup === "function") map.closePopup();
    return true;
}

function navigationStartByTreeId(id) {
    const treeObj = Array.isArray(treeObjects)
        ? treeObjects.find(t => String(t.id) === String(id))
        : null;

    if (!treeObj) {
        alert("Nu am găsit planta selectată.");
        return false;
    }

    return navigationStart(treeObj);
}

function navigationStop() {
    if (navigationWatchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(navigationWatchId);
    }
    navigationWatchId = null;

    if (navigationTarget && navigationTarget.marker && navigationTargetDragHandler) {
        navigationTarget.marker.off("drag", navigationTargetDragHandler);
        navigationTarget.marker.off("dragend", navigationTargetDragHandler);
    }

    if (map) {
        if (navigationCurrentMarker) map.removeLayer(navigationCurrentMarker);
        if (navigationAccuracyCircle) map.removeLayer(navigationAccuracyCircle);
        if (navigationTargetCircle) map.removeLayer(navigationTargetCircle);
        if (navigationRouteLine) map.removeLayer(navigationRouteLine);
    }

    navigationCurrentMarker = null;
    navigationAccuracyCircle = null;
    navigationTargetCircle = null;
    navigationRouteLine = null;
    navigationTargetDragHandler = null;
    navigationTarget = null;
    navigationActive = false;
    navigationFirstFix = true;
    navigationGpsSamples = [];
    navigationLastRawPosition = null;
    navigationDeviceHeading = null;
    navigationAlpha = null;
    navigationBeta = null;
    navigationGamma = null;
    navigationOrientationActive = false;
    navigationOrientationPermissionState = "unknown";

    navigationDetachOrientationListener();

    if (navigationPanel) {
        navigationPanel.classList.remove("is-visible", "is-arrived", "is-waiting", "is-error");
    }
}

Navigation.Start = navigationStart;
Navigation.StartByTreeId = navigationStartByTreeId;
Navigation.Stop = navigationStop;
Navigation.IsActive = () => navigationActive;
Navigation.GetTarget = () => navigationTarget;
Navigation.GetDistance = function () {
    if (!navigationActive || !navigationTarget || !navigationCurrentMarker) return null;
    return Core.functieGeometry.CalculateDistanceM(
        navigationCurrentMarker.getLatLng(),
        navigationTarget.marker.getLatLng()
    );
};
Navigation.GetBearing = function () {
    if (!navigationActive || !navigationTarget || !navigationCurrentMarker) return null;
    return navigationCalculateBearing(
        navigationCurrentMarker.getLatLng(),
        navigationTarget.marker.getLatLng()
    );
};
Navigation.EnableOrientation = navigationEnableOrientation;
Navigation.GetHeading = () => navigationDeviceHeading;
Navigation.GetRelativeBearing = function () {
    const bearing = Navigation.GetBearing();
    if (!Number.isFinite(bearing) || !Number.isFinite(navigationDeviceHeading)) return null;
    return navigationNormalizeRelativeAngle(bearing - navigationDeviceHeading);
};
Navigation.GetGpsSampleCount = () => navigationGpsSamples.length;
Navigation.GetGpsSampleWindow = () => NAVIGATION_GPS_SAMPLE_COUNT;
