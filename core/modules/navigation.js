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
let navigationGpsSamples = [];
let navigationOrientationActive = false;
let navigationOrientationHandler = null;
let navigationOrientationEventName = null;
let navigationHeading = null;
let navigationAlpha = null;
let navigationBeta = null;
let navigationGamma = null;
let navigationOrientationSource = "—";
const NAVIGATION_GPS_SAMPLE_COUNT = 4;

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
            <div class="navigation-header-actions">
                <button id="navigation-orientation" class="navigation-stop navigation-orientation" type="button">🧭 Orientare</button>
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
            <div><span>Direcție</span><b id="navigation-bearing">—</b></div>
            <div><span>GPS</span><b id="navigation-accuracy">—</b></div>
        </div>

        <div class="navigation-grid navigation-orientation-grid">
            <div><span>Telefon</span><b id="navigation-heading">—</b></div>
            <div><span>Diferență</span><b id="navigation-heading-delta">—</b></div>
            <div><span>α / β / γ</span><b id="navigation-euler">—</b></div>
            <div><span>Senzor</span><b id="navigation-orientation-source">—</b></div>
        </div>

        <div id="navigation-status" class="navigation-status">Se caută poziția GPS…</div>
    `;

    document.body.appendChild(navigationPanel);
    document.getElementById("navigation-stop").addEventListener("click", () => Navigation.Stop());
    document.getElementById("navigation-orientation").addEventListener("click", navigationEnableOrientation);

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

function navigationNormalizeDegrees(value) {
    return ((value % 360) + 360) % 360;
}

function navigationGetCardinal(value) {
    if (!Number.isFinite(value)) return "—";
    const heading = navigationNormalizeDegrees(value);
    if (heading >= 337.5 || heading < 22.5) return "N";
    if (heading < 67.5) return "NE";
    if (heading < 112.5) return "E";
    if (heading < 157.5) return "SE";
    if (heading < 202.5) return "S";
    if (heading < 247.5) return "SV";
    if (heading < 292.5) return "V";
    return "NV";
}

function navigationFormatDegrees(value) {
    if (!Number.isFinite(value)) return "—";
    return `${navigationGetCardinal(value)} ${Math.round(navigationNormalizeDegrees(value))}°`;
}

function navigationFormatSignedDegrees(value) {
    if (!Number.isFinite(value)) return "—";
    let normalized = ((value + 180) % 360 + 360) % 360 - 180;
    if (Math.abs(normalized) < 0.5) normalized = 0;
    return `${normalized >= 0 ? "+" : "−"}${Math.abs(Math.round(normalized))}°`;
}

function navigationGetScreenAngle() {
    if (typeof screen !== "undefined" && screen.orientation && Number.isFinite(screen.orientation.angle)) {
        return Number(screen.orientation.angle);
    }
    return 0;
}

function navigationExtractHeading(event) {
    // iOS/Safari oferă direct heading-ul busolei în webkitCompassHeading.
    if (Number.isFinite(event.webkitCompassHeading)) {
        return navigationNormalizeDegrees(event.webkitCompassHeading);
    }

    if (!Number.isFinite(event.alpha)) return null;

    // Pentru evenimente absolute, alpha este convertit în heading magnetic/geografic
    // disponibil dispozitivului. Corecția pentru rotația ecranului păstrează
    // referința la partea de sus a telefonului.
    return navigationNormalizeDegrees(360 - event.alpha + navigationGetScreenAngle());
}

function navigationUpdateOrientationUI() {
    if (!navigationActive) return;

    const headingEl = document.getElementById("navigation-heading");
    const deltaEl = document.getElementById("navigation-heading-delta");
    const eulerEl = document.getElementById("navigation-euler");
    const sourceEl = document.getElementById("navigation-orientation-source");
    const orientationButton = document.getElementById("navigation-orientation");

    if (headingEl) headingEl.textContent = navigationFormatDegrees(navigationHeading);

    const targetBearing = navigationCurrentMarker && navigationTarget
        ? navigationCalculateBearing(navigationCurrentMarker.getLatLng(), navigationTarget.marker.getLatLng())
        : null;
    const delta = Number.isFinite(targetBearing) && Number.isFinite(navigationHeading)
        ? ((targetBearing - navigationHeading + 540) % 360) - 180
        : null;

    if (deltaEl) deltaEl.textContent = navigationFormatSignedDegrees(delta);

    if (eulerEl) {
        const fmt = value => Number.isFinite(value) ? `${Math.round(value)}°` : "—";
        eulerEl.textContent = `${fmt(navigationAlpha)} / ${fmt(navigationBeta)} / ${fmt(navigationGamma)}`;
    }

    if (sourceEl) sourceEl.textContent = navigationOrientationActive ? navigationOrientationSource : "oprit";
    if (orientationButton) orientationButton.textContent = navigationOrientationActive ? "🧭 Activă" : "🧭 Orientare";
}

function navigationApplyArrow(bearing) {
    const arrowEl = document.getElementById("navigation-arrow");
    if (!arrowEl) return;

    if (navigationOrientationActive && Number.isFinite(navigationHeading)) {
        const relative = ((bearing - navigationHeading + 540) % 360) - 180;
        arrowEl.style.transform = `rotate(${relative}deg)`;
    } else {
        arrowEl.style.transform = `rotate(${bearing}deg)`;
    }
}

function navigationHandleOrientation(event) {
    if (!navigationActive) return;

    navigationAlpha = Number.isFinite(event.alpha) ? event.alpha : null;
    navigationBeta = Number.isFinite(event.beta) ? event.beta : null;
    navigationGamma = Number.isFinite(event.gamma) ? event.gamma : null;

    const heading = navigationExtractHeading(event);
    if (Number.isFinite(heading)) {
        navigationHeading = heading;
        navigationOrientationActive = true;
        if (event.webkitCompassHeading !== undefined) {
            navigationOrientationSource = "iOS busolă";
        } else if (event.absolute) {
            navigationOrientationSource = "absolute";
        } else {
            navigationOrientationSource = "orientare";
        }

        const bearing = Navigation.GetBearing();
        if (Number.isFinite(bearing)) navigationApplyArrow(bearing);
        navigationUpdateOrientationUI();
    }
}

async function navigationEnableOrientation() {
    if (!navigationActive) return;

    if (!window.DeviceOrientationEvent) {
        navigationSetPanelState("error", "Orientarea telefonului nu este disponibilă în acest browser.");
        return;
    }

    try {
        if (typeof DeviceOrientationEvent.requestPermission === "function") {
            const permission = await DeviceOrientationEvent.requestPermission();
            if (permission !== "granted") {
                navigationSetPanelState("error", "Permisiunea pentru orientarea telefonului a fost refuzată.");
                return;
            }
        }

        navigationDisableOrientation();

        if ("ondeviceorientationabsolute" in window) {
            navigationOrientationEventName = "deviceorientationabsolute";
            navigationOrientationHandler = navigationHandleOrientation;
            window.addEventListener(navigationOrientationEventName, navigationOrientationHandler, true);
        } else {
            navigationOrientationEventName = "deviceorientation";
            navigationOrientationHandler = navigationHandleOrientation;
            window.addEventListener(navigationOrientationEventName, navigationOrientationHandler, true);
        }

        navigationSetPanelState("waiting", "Orientarea este activată · ține partea de sus a telefonului spre direcția de mers.");
        navigationUpdateOrientationUI();
    } catch (error) {
        navigationSetPanelState("error", "Nu am putut activa orientarea telefonului.");
    }
}

function navigationDisableOrientation() {
    if (navigationOrientationHandler && navigationOrientationEventName) {
        window.removeEventListener(navigationOrientationEventName, navigationOrientationHandler, true);
    }
    navigationOrientationHandler = null;
    navigationOrientationEventName = null;
    navigationOrientationActive = false;
    navigationHeading = null;
    navigationAlpha = null;
    navigationBeta = null;
    navigationGamma = null;
    navigationOrientationSource = "—";
}

function navigationUpdatePosition(position) {
    if (!navigationActive || !navigationTarget || !map) return;

    const rawLat = Number(position.coords.latitude);
    const rawLng = Number(position.coords.longitude);
    if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng)) return;

    // Stabilizare simplă: media ultimelor 4 poziții GPS.
    // Păstrăm această logică separată de precizia raportată de telefon.
    navigationGpsSamples.push({ lat: rawLat, lng: rawLng });
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
    if (arrowEl) navigationApplyArrow(bearing);
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
    navigationDisableOrientation();

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

    if (navigationPanel) {
        navigationPanel.classList.remove("is-visible", "is-arrived", "is-waiting", "is-error");
    }
}



/* =========================================================
   14B.3 — Diagnostic orientare absolută
   Instrument temporar: nu modifică fluxul GPS și nu modifică
   calculul săgeții. Separă cele două tipuri de evenimente și
   afișează valorile brute relevante pentru dispozitiv.
   ========================================================= */
let navigationSensorDiagListening = false;
let navigationSensorDiagNormalCount = 0;
let navigationSensorDiagAbsoluteCount = 0;

function navigationSensorDiagSet(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function navigationSensorDiagFormat(value, suffix = "") {
    if (value === null) return "null";
    if (typeof value === "undefined") return "undef";
    if (Number.isFinite(value)) return value.toFixed(1) + suffix;
    return String(value);
}

function navigationSensorDiagRender(event, typeLabel) {
    const alpha = navigationSensorDiagFormat(event.alpha, "°");
    const beta = navigationSensorDiagFormat(event.beta, "°");
    const gamma = navigationSensorDiagFormat(event.gamma, "°");
    const compass = navigationSensorDiagFormat(event.webkitCompassHeading, "°");

    navigationSensorDiagSet("navdiag-last-type", typeLabel);
    navigationSensorDiagSet("navdiag-absolute", event.absolute === true ? "DA" : "NU");
    navigationSensorDiagSet("navdiag-alpha", alpha);
    navigationSensorDiagSet("navdiag-beta", beta);
    navigationSensorDiagSet("navdiag-gamma", gamma);
    navigationSensorDiagSet("navdiag-compass", compass);
    navigationSensorDiagSet("navdiag-angle", `${screen.orientation && Number.isFinite(screen.orientation.angle) ? screen.orientation.angle : "—"}°`);

    const shape = [event.alpha, event.beta, event.gamma]
        .map(v => v === null ? "null" : typeof v === "undefined" ? "undef" : typeof v)
        .join(" / ");
    navigationSensorDiagSet("navdiag-types", shape);
    navigationSensorDiagSet("navdiag-message", "Senzorul livrează evenimente; valorile sunt afișate separat.");
}

function navigationSensorDiagHandleNormal(event) {
    navigationSensorDiagNormalCount++;
    navigationSensorDiagSet("navdiag-normal-count", String(navigationSensorDiagNormalCount));
    navigationSensorDiagRender(event, "deviceorientation");
}

function navigationSensorDiagHandleAbsolute(event) {
    navigationSensorDiagAbsoluteCount++;
    navigationSensorDiagSet("navdiag-absolute-count", String(navigationSensorDiagAbsoluteCount));
    navigationSensorDiagRender(event, "deviceorientationabsolute");
}

function navigationSensorDiagEnsureUI() {
    const panel = navigationEnsurePanel();
    if (document.getElementById("navigation-sensor-diagnostic")) return;

    const box = document.createElement("div");
    box.id = "navigation-sensor-diagnostic";
    box.style.cssText = "margin-top:8px;padding:10px;border-top:1px solid rgba(0,0,0,.10);font-size:12px;";
    box.innerHTML = `
        <button id="navigation-sensor-test" type="button"
            style="width:100%;padding:9px 10px;border:1px solid rgba(25,118,210,.35);border-radius:10px;background:rgba(25,118,210,.08);font:inherit;font-weight:700;">
            🧪 Testează senzorul
        </button>
        <div style="margin-top:8px;font-weight:800;">🧭 Diagnostic orientare absolută</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;margin-top:6px;">
            <div>API <b id="navdiag-api">—</b></div>
            <div>Permission API <b id="navdiag-permission-api">—</b></div>
            <div>Permission <b id="navdiag-permission">—</b></div>
            <div>Ultimul tip <b id="navdiag-last-type">—</b></div>
            <div>Normal <b id="navdiag-normal-count">0</b></div>
            <div>Absolut <b id="navdiag-absolute-count">0</b></div>
            <div>absolute <b id="navdiag-absolute">—</b></div>
            <div>Screen angle <b id="navdiag-angle">—</b></div>
        </div>
        <div style="margin-top:7px;display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-variant-numeric:tabular-nums;">
            <div>α <b id="navdiag-alpha">—</b></div>
            <div>β <b id="navdiag-beta">—</b></div>
            <div>γ <b id="navdiag-gamma">—</b></div>
            <div>Compass <b id="navdiag-compass">—</b></div>
        </div>
        <div style="margin-top:6px;opacity:.78;">Tipuri α/β/γ: <b id="navdiag-types">—</b></div>
        <div id="navdiag-message" style="margin-top:6px;opacity:.78;">Apasă butonul pentru test.</div>
    `;
    panel.appendChild(box);

    document.getElementById("navigation-sensor-test").addEventListener("click", navigationSensorDiagStart);
}

async function navigationSensorDiagStart() {
    navigationSensorDiagEnsureUI();

    const apiAvailable = typeof window.DeviceOrientationEvent !== "undefined";
    navigationSensorDiagSet("navdiag-api", apiAvailable ? "DA" : "NU");

    if (!apiAvailable) {
        navigationSensorDiagSet("navdiag-message", "DeviceOrientationEvent nu este disponibil.");
        return;
    }

    const hasPermissionApi = typeof window.DeviceOrientationEvent.requestPermission === "function";
    navigationSensorDiagSet("navdiag-permission-api", hasPermissionApi ? "DA" : "NU");

    try {
        if (hasPermissionApi) {
            navigationSensorDiagSet("navdiag-permission", "cerere…");
            const permission = await window.DeviceOrientationEvent.requestPermission(true);
            navigationSensorDiagSet("navdiag-permission", permission);
            if (permission !== "granted") {
                navigationSensorDiagSet("navdiag-message", `Permisiune: ${permission}`);
                return;
            }
        } else {
            navigationSensorDiagSet("navdiag-permission", "nu este necesară");
        }

        if (!navigationSensorDiagListening) {
            navigationSensorDiagNormalCount = 0;
            navigationSensorDiagAbsoluteCount = 0;
            window.addEventListener("deviceorientation", navigationSensorDiagHandleNormal, true);
            window.addEventListener("deviceorientationabsolute", navigationSensorDiagHandleAbsolute, true);
            navigationSensorDiagListening = true;
        }

        navigationSensorDiagSet("navdiag-message", "Ascultă senzorul… ține telefonul drept și rotește-l lent 360°.");
    } catch (error) {
        navigationSensorDiagSet("navdiag-permission", "EROARE");
        navigationSensorDiagSet("navdiag-message", `Eroare: ${error && error.name ? error.name : error}`);
    }
}

navigationSensorDiagEnsureUI();

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
