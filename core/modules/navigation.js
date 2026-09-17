/* =========================================================
   PERMA ENGINE — Module: Navigation
   Etapa 14A — Navigație la planta selectată.

   Scop:
   - folosește harta Leaflet existentă;
   - folosește GPS-ul browserului fără a modifica fluxul GPS existent;
   - navighează către un treeObj existent din modulul Plants;
   - afișează poziția curentă, ținta, distanța, ΔX/ΔY și precizia GPS.

   Modulul este intenționat mic și independent pentru testare în teren.
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
let navigationOwnTargetMarker = false;
let navigationFirstFix = true;
let navigationGpsSamples = [];
let navigationSharedGpsUnsubscribe = null;
let navigationOwnGpsWatch = false;
const NAVIGATION_GPS_SAMPLE_COUNT = 4;

const NAVIGATION_ARRIVAL_RADIUS_M = 1;

// 15A-3A: direcția de deplasare este estimată numai din eșantioane GPS succesive.
// Nu folosim compass, magnetometru, gyroscope sau DeviceOrientation.
const NAVIGATION_MOVEMENT_MIN_SAMPLES = 3;

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
            <button id="navigation-stop" class="navigation-stop" type="button">Oprește</button>
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
    `;

    document.body.appendChild(navigationPanel);
    document.getElementById("navigation-stop").addEventListener("click", () => Navigation.Stop());

    return navigationPanel;
}

function navigationFormatMeters(value) {
    if (!Number.isFinite(value)) return "—";
    if (value < 10) return `${value.toFixed(1).replace(".", ",")} m`;
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

function navigationCalculateMovementBearing(samples) {
    if (!Array.isArray(samples) || samples.length < NAVIGATION_MOVEMENT_MIN_SAMPLES) return null;

    const first = samples[0];
    const last = samples[samples.length - 1];
    if (!first || !last) return null;

    const distance = Core.functieGeometry.CalculateDistanceM(
        L.latLng(first.lat, first.lng),
        L.latLng(last.lat, last.lng)
    );

    // Nu interpretăm zgomotul GPS drept deplasare. Folosim acuratețea
    // disponibilă pentru capetele ferestrei ca prag adaptiv.
    const accuracies = samples
        .map(sample => Number(sample.accuracy))
        .filter(value => Number.isFinite(value) && value > 0);
    const averageAccuracy = accuracies.length
        ? accuracies.reduce((sum, value) => sum + value, 0) / accuracies.length
        : 2;
    const minimumMovement = Math.max(1, averageAccuracy * 0.75);

    if (!Number.isFinite(distance) || distance < minimumMovement) return null;

    return navigationCalculateBearing(
        L.latLng(first.lat, first.lng),
        L.latLng(last.lat, last.lng)
    );
}

function navigationRelativeBearing(movementBearing, targetBearing) {
    if (!Number.isFinite(movementBearing) || !Number.isFinite(targetBearing)) {
        return null;
    }

    // Unghiul este relativ la direcția reală de deplasare: 0° = înainte,
    // +90° = dreapta, -90° = stânga, ±180° = înapoi.
    return ((targetBearing - movementBearing + 540) % 360) - 180;
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

function navigationUpdatePosition(position) {
    if (!navigationActive || !navigationTarget || !map) return;

    const rawLat = Number(position.coords.latitude);
    const rawLng = Number(position.coords.longitude);
    if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng)) return;

    // Stabilizare simplă: media ultimelor 4 poziții GPS.
    // Păstrăm această logică separată de precizia raportată de telefon.
    navigationGpsSamples.push({ lat: rawLat, lng: rawLng, accuracy: Number(position.coords.accuracy) });
    if (navigationGpsSamples.length > NAVIGATION_GPS_SAMPLE_COUNT) {
        navigationGpsSamples.shift();
    }

    const sampleCount = navigationGpsSamples.length;
    const averageLat = navigationGpsSamples.reduce((sum, sample) => sum + sample.lat, 0) / sampleCount;
    const averageLng = navigationGpsSamples.reduce((sum, sample) => sum + sample.lng, 0) / sampleCount;

    const current = L.latLng(averageLat, averageLng);
    const target = navigationTarget.marker.getLatLng();
    const accuracy = Number(position.coords.accuracy);

    const distance = Core.functieGeometry.CalculateDistanceM(current, target);
    const bearing = navigationCalculateBearing(current, target);
    const movementBearing = navigationCalculateMovementBearing(navigationGpsSamples);
    const relativeBearing = navigationRelativeBearing(movementBearing, bearing);

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

    if (arrowEl) {
        // 15A-3B: săgeata este un indicator vizual relativ la deplasarea
        // utilizatorului, nu o busolă. Înainte = 0°, dreapta = +90°,
        // stânga = -90°. Dacă GPS-ul nu poate determina deplasarea,
        // nu inventăm orientarea.
        if (Number.isFinite(relativeBearing)) {
            arrowEl.style.transform = `rotate(${relativeBearing}deg)`;
            arrowEl.style.opacity = "1";
        } else {
            arrowEl.style.transform = "rotate(0deg)";
            arrowEl.style.opacity = "0.38";
        }
    }

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
        navigationSetPanelState("arrived", "🟢 Ținta a fost atinsă. Se revine la poziția mea.");
        const arrival = document.getElementById("navigation-arrival");
        if (arrival) arrival.textContent = "🟢 ȚINTĂ ATINSĂ";

        // Ajungerea la țintă nu oprește automat navigarea.
        // Utilizatorul decide când apasă „Oprește”.
    } else {
        navigationSetPanelState(
            null,
            sampleCount < NAVIGATION_GPS_SAMPLE_COUNT
                ? `Stabilizare GPS ${sampleCount}/${NAVIGATION_GPS_SAMPLE_COUNT} · precizie raportată ${Number.isFinite(accuracy) ? `±${navigationFormatMeters(accuracy)}` : "—"}`
                : (Number.isFinite(accuracy)
                    ? `GPS activ · poziție stabilizată · precizie raportată ±${navigationFormatMeters(accuracy)}`
                    : "GPS activ · poziție stabilizată")
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
    // Dacă GPS-ul live al aplicației este deja activ, folosim același flux GPS.
    // Astfel nu deschidem două watchPosition concurente pe telefon.
    if (Core.Modules.PozitiaMea?.IsActive?.() && Core.Modules.PozitiaMea?.Subscribe) {
        navigationOwnGpsWatch = false;
        navigationSharedGpsUnsubscribe = Core.Modules.PozitiaMea.Subscribe(
            navigationUpdatePosition,
            navigationHandleError
        );
        return;
    }

    if (!navigator.geolocation) {
        navigationHandleError({ code: 2 });
        return;
    }

    if (navigationWatchId !== null) {
        navigator.geolocation.clearWatch(navigationWatchId);
    }

    navigationOwnGpsWatch = true;
    navigationWatchId = navigator.geolocation.watchPosition(
        navigationUpdatePosition,
        navigationHandleError,
        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 15000
        }
    );
}

function navigationStart(treeObj) {
    if (!treeObj || !treeObj.marker || !map) return false;

    Navigation.Stop();

    if (Core.Modules.PozitiaMea?.SuspendForNavigation) {
        Core.Modules.PozitiaMea.SuspendForNavigation();
    }

    navigationTarget = treeObj;
    navigationActive = true;
    navigationFirstFix = true;
    navigationGpsSamples = [];

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
    if (navigationSharedGpsUnsubscribe) {
        navigationSharedGpsUnsubscribe();
        navigationSharedGpsUnsubscribe = null;
    }

    if (navigationOwnGpsWatch && navigationWatchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(navigationWatchId);
    }
    navigationWatchId = null;
    navigationOwnGpsWatch = false;

    if (navigationTarget && navigationTarget.marker && navigationTargetDragHandler) {
        navigationTarget.marker.off("drag", navigationTargetDragHandler);
        navigationTarget.marker.off("dragend", navigationTargetDragHandler);
    }

    if (map) {
        if (navigationCurrentMarker) map.removeLayer(navigationCurrentMarker);
        if (navigationAccuracyCircle) map.removeLayer(navigationAccuracyCircle);
        if (navigationTargetCircle) map.removeLayer(navigationTargetCircle);
        if (navigationRouteLine) map.removeLayer(navigationRouteLine);
        if (navigationOwnTargetMarker && navigationTarget?.marker) map.removeLayer(navigationTarget.marker);
    }

    navigationCurrentMarker = null;
    navigationAccuracyCircle = null;
    navigationTargetCircle = null;
    navigationRouteLine = null;
    navigationTargetDragHandler = null;
    navigationOwnTargetMarker = false;
    navigationTarget = null;
    navigationActive = false;
    navigationFirstFix = true;
    navigationGpsSamples = [];

    if (Core.Modules.PozitiaMea?.RestoreAfterNavigation) {
        Core.Modules.PozitiaMea.RestoreAfterNavigation();
    }

    if (navigationPanel) {
        navigationPanel.classList.remove("is-visible", "is-arrived", "is-waiting", "is-error");
    }
}

Navigation.StartByLatLng = function (latlng, label = "Locație", marker = null) {
    if (!latlng || !Number.isFinite(Number(latlng.lat)) || !Number.isFinite(Number(latlng.lng)) || !map) {
        return false;
    }

    const targetLatLng = L.latLng(Number(latlng.lat), Number(latlng.lng));
    const targetMarker = marker || L.marker(targetLatLng, { interactive: false, opacity: 0 }).addTo(map);
    navigationOwnTargetMarker = !marker;
    const target = {
        marker: targetMarker,
        treeData: { species: label }
    };

    return navigationStart(target);
};

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
