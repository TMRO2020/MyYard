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
let navigationFirstFix = true;

const NAVIGATION_ARRIVAL_RADIUS_M = 1;

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
            <div><span>Direcție</span><b id="navigation-bearing">—</b></div>
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

    const current = L.latLng(position.coords.latitude, position.coords.longitude);
    const target = navigationTarget.marker.getLatLng();
    const accuracy = Number(position.coords.accuracy);

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
    if (arrowEl) arrowEl.style.transform = `rotate(${bearing}deg)`;

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
    } else {
        navigationSetPanelState(
            null,
            Number.isFinite(accuracy)
                ? `GPS activ · precizie raportată ±${navigationFormatMeters(accuracy)}`
                : "GPS activ"
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
    }

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

    navigationTarget = treeObj;
    navigationActive = true;
    navigationFirstFix = true;

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
