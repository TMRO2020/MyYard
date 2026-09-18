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
let navigationAcceptedGpsSamples = [];
let navigationStationaryLockedPosition = null;
let navigationStationaryMode = false;
let navigationSharedGpsUnsubscribe = null;
let navigationOwnGpsWatch = false;
const NAVIGATION_GPS_SAMPLE_COUNT = 10;
let navigationMovementDetectionSamples = 3;
const NAVIGATION_MOVEMENT_SAMPLE_MIN = 2;
const NAVIGATION_MOVEMENT_SAMPLE_MAX = 10;

const NAVIGATION_ARRIVAL_RADIUS_M = 1;

// 15A-3E: filtrare GPS hibridă. Poziția reacționează rapid când utilizatorul
// se deplasează, dar când acesta stă pe loc blocăm poziția după ce confirmăm
// că variațiile rămân în zona de zgomot GPS.
const NAVIGATION_MAX_WALKING_SPEED_MPS = 2.0;
const NAVIGATION_SPIKE_TOLERANCE_M = 0.5;
const NAVIGATION_CALIBRATION_SECONDS = 10;
const NAVIGATION_MOVEMENT_CONFIRMATION_DEFAULT = 3;
const NAVIGATION_STATIONARY_RADIUS_MARGIN_M = 0.75;
const NAVIGATION_STATIONARY_MIN_SAMPLES = 3;

// 15A-3A: direcția de deplasare este estimată numai din eșantioane GPS succesive.
// Nu folosim compass, magnetometru, gyroscope sau DeviceOrientation.
const NAVIGATION_MOVEMENT_MIN_SAMPLES = 4;
const NAVIGATION_DIRECTION_MIN_DISTANCE_M = 1;
let navigationSmoothedRelativeBearing = null;
let navigationLastMovementBearing = null;
let navigationWasMoving = false;
let navigationCalibrationSamples = [];
let navigationCalibrationStartedAt = 0;
let navigationCalibrationComplete = false;
let navigationCalibrationCenter = null;
let navigationCalibrationRadius = 0;
let navigationEstimatedPosition = null;
let navigationLastValidTimestamp = null;
let navigationLastValidPosition = null;
let navigationEstimatedSpeedMps = 0;
let navigationAcceptedCount = 0;
let navigationRejectedCount = 0;
let navigationLastRawSample = null;
let navigationMovementCandidates = [];

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
            <div class="navigation-arrow-wrap navigation-arrow-wrap-central" aria-hidden="true">
                <div id="navigation-arrow" class="navigation-arrow">↑</div>
            </div>
            <div class="navigation-arrow-wrap navigation-arrow-wrap-bearing" aria-hidden="true">
                <div id="navigation-compass" class="navigation-compass" aria-label="Busolă GPS">
                    <span class="navigation-compass-mark navigation-compass-n">N</span>
                    <span class="navigation-compass-mark navigation-compass-e">E</span>
                    <span class="navigation-compass-mark navigation-compass-s">S</span>
                    <span class="navigation-compass-mark navigation-compass-w">V</span>
                    <span class="navigation-compass-tick navigation-compass-tick-n"></span>
                    <span class="navigation-compass-tick navigation-compass-tick-e"></span>
                    <span class="navigation-compass-tick navigation-compass-tick-s"></span>
                    <span class="navigation-compass-tick navigation-compass-tick-w"></span>
                    <span class="navigation-compass-center"></span>
                </div>
            </div>
        </div>

        <div class="navigation-grid">
            <div><span>ΔX</span><b id="navigation-dx">—</b></div>
            <div><span>ΔY</span><b id="navigation-dy">—</b></div>
            <div><span>Țintă</span><b id="navigation-bearing">—</b></div>
            <div><span>GPS</span><b id="navigation-accuracy">—</b></div>
        </div>

        <div class="navigation-test-controls" aria-label="Reglaje temporare pentru testarea GPS">
            <span class="navigation-test-label">Samples mișcare</span>
            <button id="navigation-samples-minus" type="button" aria-label="Scade numărul de samples">−</button>
            <strong id="navigation-samples-value">6</strong>
            <button id="navigation-samples-plus" type="button" aria-label="Crește numărul de samples">+</button>
        </div>
        <div id="navigation-test-readout" class="navigation-test-readout" aria-live="polite">Stare: — · Δ: — · v: — · samples: —</div>
        <div id="navigation-telemetry" class="navigation-telemetry" aria-live="polite">Telemetrie: calibrare — · centru — · acceptate 0 · respinse 0</div>

        <div id="navigation-status" class="navigation-status">Se caută poziția GPS…</div>
    `;

    document.body.appendChild(navigationPanel);

    // 15A-3B rev.1: stilizarea săgeții este injectată de modul pentru ca
    // patch-ul să rămână autonom și să nu depindă de un fișier CSS separat.
    if (!document.getElementById("navigation-arrow-style")) {
        const style = document.createElement("style");
        style.id = "navigation-arrow-style";
        style.textContent = `
            #navigation-panel .navigation-main {
                position: relative;
                min-height: 116px;
                display: flex;
                align-items: center;
                justify-content: flex-start;
                padding: 2px 10px 8px 10px;
                box-sizing: border-box;
            }
            #navigation-panel .navigation-distance-block {
                position: relative;
                z-index: 1;
                min-width: 120px;
            }
            #navigation-panel .navigation-arrow-wrap {
                position: absolute;
                top: 50%;
                transform: translate(-50%, -50%);
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                box-sizing: border-box;
            }
            #navigation-panel .navigation-arrow-wrap-central {
                left: 53%;
                width: 92px;
                height: 92px;
                background: rgba(25, 118, 210, 0.07);
                border: 1px solid rgba(25, 118, 210, 0.16);
            }
            #navigation-panel .navigation-arrow-wrap-bearing {
                left: calc(100% - 54px);
                width: 76px;
                height: 76px;
                background: rgba(25, 118, 210, 0.06);
                border: 1px solid rgba(25, 118, 210, 0.14);
            }
            #navigation-panel .navigation-arrow {
                width: 54px;
                height: 76px;
                position: relative;
                background: #1976d2;
                clip-path: polygon(50% 0%, 100% 44%, 65% 44%, 65% 100%, 35% 100%, 35% 44%, 0% 44%);
                -webkit-clip-path: polygon(50% 0%, 100% 44%, 65% 44%, 65% 100%, 35% 100%, 35% 44%, 0% 44%);
                transform-origin: 50% 50%;
                transition: transform 180ms ease-out, opacity 220ms ease;
                user-select: none;
                -webkit-user-select: none;
                font-size: 0;
                line-height: 0;
                filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.14));
            }
            #navigation-panel .navigation-test-readout {
                margin: 2px 14px 8px;
                padding: 5px 8px;
                border-radius: 8px;
                background: rgba(25, 118, 210, 0.045);
                color: #66747d;
                font-size: 10px;
                line-height: 1.2;
                text-align: center;
                letter-spacing: 0.1px;
            }
            #navigation-panel .navigation-telemetry {
                margin: 0 14px 7px;
                color: #7a858c;
                font-size: 9px;
                line-height: 1.25;
                text-align: center;
                font-variant-numeric: tabular-nums;
            }
            #navigation-panel .navigation-compass {
                position: relative;
                width: 65px;
                height: 65px;
                border-radius: 50%;
                border: 1px solid rgba(25, 118, 210, 0.18);
                background: rgba(255, 255, 255, 0.82);
                box-shadow: inset 0 0 0 1px rgba(25, 118, 210, 0.05);
                transform: rotate(0deg);
                transition: transform 220ms ease-out, opacity 220ms ease;
                user-select: none;
                -webkit-user-select: none;
            }
            #navigation-panel .navigation-compass-mark {
                position: absolute;
                left: 50%;
                top: 50%;
                font-size: 11px;
                line-height: 1;
                font-weight: 800;
                color: #52636f;
                transform-origin: 0 0;
            }
            #navigation-panel .navigation-compass-n {
                color: #1976d2;
                transform: translate(-50%, -27px);
            }
            #navigation-panel .navigation-compass-e {
                transform: translate(21px, -50%);
            }
            #navigation-panel .navigation-compass-s {
                transform: translate(-50%, 18px);
            }
            #navigation-panel .navigation-compass-w {
                transform: translate(-29px, -50%);
            }
            #navigation-panel .navigation-compass-tick {
                position: absolute;
                left: 50%;
                top: 5px;
                width: 1px;
                height: 7px;
                background: rgba(82, 99, 111, 0.34);
                transform-origin: 0 27px;
            }
            #navigation-panel .navigation-compass-tick-e { transform: rotate(90deg); }
            #navigation-panel .navigation-compass-tick-s { transform: rotate(180deg); }
            #navigation-panel .navigation-compass-tick-w { transform: rotate(270deg); }
            #navigation-panel .navigation-compass-tick-n { background: #1976d2; }
            #navigation-panel .navigation-compass-center {
                position: absolute;
                left: 50%;
                top: 50%;
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: #1976d2;
                transform: translate(-50%, -50%);
                box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.10);
            }
            #navigation-panel .navigation-arrow-wrap-central::after {
                content: "";
                position: absolute;
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #1976d2;
                opacity: 0.18;
                pointer-events: none;
            }
            #navigation-panel .navigation-arrow-wrap-central.is-stationary .navigation-arrow {
                width: 16px;
                height: 16px;
                background: #1976d2;
                clip-path: circle(50% at 50% 50%);
                -webkit-clip-path: circle(50% at 50% 50%);
                transform: rotate(0deg) !important;
                opacity: 1;
                filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.12));
                animation: navigation-arrow-pulse 1.8s ease-in-out infinite;
            }
            #navigation-panel .navigation-arrow-wrap-central.is-moving .navigation-arrow {
                animation: none;
            }
            @keyframes navigation-arrow-pulse {
                0%, 100% { transform: scale(0.86); opacity: 0.72; }
                50% { transform: scale(1.08); opacity: 1; }
            }
            #navigation-panel .navigation-test-controls {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: 7px;
                margin: 5px 12px 2px;
                min-height: 30px;
                font-size: 11px;
                color: #66727a;
            }
            #navigation-panel .navigation-test-label {
                margin-right: 2px;
                font-weight: 700;
                letter-spacing: 0.1px;
            }
            #navigation-panel .navigation-test-controls button {
                width: 28px;
                height: 28px;
                padding: 0;
                border: 1px solid rgba(25, 118, 210, 0.18);
                border-radius: 9px;
                background: rgba(25, 118, 210, 0.06);
                color: #1976d2;
                font-size: 18px;
                line-height: 1;
                font-weight: 700;
                cursor: pointer;
            }
            #navigation-panel .navigation-test-controls button:active {
                transform: scale(0.96);
            }
            #navigation-panel .navigation-test-controls strong {
                min-width: 20px;
                text-align: center;
                color: #263238;
                font-size: 13px;
            }
            @media (max-width: 430px) {
                #navigation-panel .navigation-main {
                    min-height: 110px;
                }
                #navigation-panel .navigation-arrow-wrap-central {
                    width: 82px;
                    height: 82px;
                    left: 53%;
                }
                #navigation-panel .navigation-arrow-wrap-bearing {
                    width: 68px;
                    height: 68px;
                    left: calc(100% - 48px);
                }
                #navigation-panel .navigation-arrow {
                    width: 48px;
                    height: 68px;
                }
                #navigation-panel .navigation-test-readout {
                margin: 2px 14px 8px;
                padding: 5px 8px;
                border-radius: 8px;
                background: rgba(25, 118, 210, 0.045);
                color: #66747d;
                font-size: 10px;
                line-height: 1.2;
                text-align: center;
                letter-spacing: 0.1px;
            }
            #navigation-panel .navigation-telemetry {
                margin: 0 14px 7px;
                color: #7a858c;
                font-size: 9px;
                line-height: 1.25;
                text-align: center;
                font-variant-numeric: tabular-nums;
            }
            #navigation-panel .navigation-compass {
                    width: 48px;
                    height: 48px;
                }
                #navigation-panel .navigation-compass-n {
                    transform: translate(-50%, -20px);
                }
                #navigation-panel .navigation-compass-s {
                    transform: translate(-50%, 12px);
                }
                #navigation-panel .navigation-compass-e {
                    transform: translate(15px, -50%);
                }
                #navigation-panel .navigation-compass-w {
                    transform: translate(-21px, -50%);
                }
            }
        `;
        document.head.appendChild(style);
    }

    document.getElementById("navigation-stop").addEventListener("click", () => Navigation.Stop());

    const samplesMinus = document.getElementById("navigation-samples-minus");
    const samplesPlus = document.getElementById("navigation-samples-plus");
    const samplesValue = document.getElementById("navigation-samples-value");

    const updateSamplesControl = () => {
        if (samplesValue) samplesValue.textContent = String(navigationMovementDetectionSamples);
        if (samplesMinus) samplesMinus.disabled = navigationMovementDetectionSamples <= NAVIGATION_MOVEMENT_SAMPLE_MIN;
        if (samplesPlus) samplesPlus.disabled = navigationMovementDetectionSamples >= NAVIGATION_MOVEMENT_SAMPLE_MAX;
    };

    const changeMovementSamples = (delta) => {
        navigationMovementDetectionSamples = Math.max(
            NAVIGATION_MOVEMENT_SAMPLE_MIN,
            Math.min(NAVIGATION_MOVEMENT_SAMPLE_MAX, navigationMovementDetectionSamples + delta)
        );
        updateSamplesControl();
    };

    if (samplesMinus) samplesMinus.addEventListener("click", () => changeMovementSamples(-1));
    if (samplesPlus) samplesPlus.addEventListener("click", () => changeMovementSamples(1));
    updateSamplesControl();

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

function navigationMedian(values) {
    const clean = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
    if (!clean.length) return null;
    const middle = Math.floor(clean.length / 2);
    return clean.length % 2
        ? clean[middle]
        : (clean[middle - 1] + clean[middle]) / 2;
}

function navigationGetStabilizedPosition(samples) {
    if (!Array.isArray(samples) || !samples.length) return null;

    // 15A-3E: mediana rămâne utilă ca centru robust pentru un mic grup de
    // poziții, dar nu mai este folosită ca o fereastră lungă obligatorie.
    const lat = navigationMedian(samples.map(sample => sample.lat));
    const lng = navigationMedian(samples.map(sample => sample.lng));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return L.latLng(lat, lng);
}

function navigationSampleAccuracy(samples) {
    const accuracies = (samples || [])
        .map(sample => Number(sample.accuracy))
        .filter(value => Number.isFinite(value) && value > 0);
    return accuracies.length ? navigationMedian(accuracies) : 2;
}

function navigationIsPlausibleSample(sample, previous) {
    if (!previous) return true;

    const now = Number(sample.timestamp);
    const then = Number(previous.timestamp);
    const elapsedSeconds = Number.isFinite(now) && Number.isFinite(then)
        ? Math.max(0.25, (now - then) / 1000)
        : 1;

    const distance = Core.functieGeometry.CalculateDistanceM(
        L.latLng(previous.lat, previous.lng),
        L.latLng(sample.lat, sample.lng)
    );
    if (!Number.isFinite(distance)) return false;

    // Viteza este adaptată la intervalul real dintre samples. Toleranța GPS
    // este limitată pentru ca o precizie raportată foarte slabă să nu permită
    // salturi uriașe pe hartă.
    // Regula de testare 3F: viteza aparentă peste limita maximă admisă
    // pentru mersul pe jos este un spike și nu intră în poziția validă.
    const maximumPlausibleDistance = NAVIGATION_MAX_WALKING_SPEED_MPS * elapsedSeconds;
    return distance <= maximumPlausibleDistance;
}

function navigationDetectStationary(samples) {
    const required = Math.max(2, Math.min(NAVIGATION_MOVEMENT_SAMPLE_MAX, navigationMovementDetectionSamples));
    if (!Array.isArray(samples) || samples.length < required) return null;

    const recent = samples.slice(-required);
    const center = navigationGetStabilizedPosition(recent);
    if (!center) return null;

    const radius = Math.max(
        navigationCalibrationRadius || 0,
        0.5
    ) + NAVIGATION_STATIONARY_RADIUS_MARGIN_M;

    const distances = recent.map(sample => Core.functieGeometry.CalculateDistanceM(
        center,
        L.latLng(sample.lat, sample.lng)
    )).filter(Number.isFinite);
    if (distances.length < required) return null;

    const first = recent[0];
    const last = recent[recent.length - 1];
    const elapsed = Math.max(0.25, (Number(last.timestamp) - Number(first.timestamp)) / 1000 || 1);
    const netDistance = Core.functieGeometry.CalculateDistanceM(
        L.latLng(first.lat, first.lng),
        L.latLng(last.lat, last.lng)
    );
    const netSpeed = netDistance / elapsed;

    if (Math.max(...distances) <= radius && netSpeed < 0.65) {
        return { center, radius: Math.max(...distances), netSpeed };
    }
    return null;
}

function navigationCalculateMovementEvidence(samples) {
    const evidenceSampleCount = Math.max(
        NAVIGATION_MOVEMENT_SAMPLE_MIN,
        Math.min(NAVIGATION_MOVEMENT_SAMPLE_MAX, navigationMovementDetectionSamples)
    );

    if (!Array.isArray(samples) || samples.length < evidenceSampleCount) {
        return {
            moving: false,
            speed: 0,
            distance: 0,
            bearing: null,
            sampleCount: Array.isArray(samples) ? samples.length : 0,
            requiredSamples: evidenceSampleCount
        };
    }

    const recent = samples.slice(-evidenceSampleCount);
    const first = recent[0];
    const last = recent[recent.length - 1];
    const firstLatLng = L.latLng(first.lat, first.lng);
    const lastLatLng = L.latLng(last.lat, last.lng);
    const distance = Core.functieGeometry.CalculateDistanceM(firstLatLng, lastLatLng);

    const firstTime = Number(first.timestamp);
    const lastTime = Number(last.timestamp);
    const elapsedSeconds = Number.isFinite(firstTime) && Number.isFinite(lastTime)
        ? Math.max(0.25, (lastTime - firstTime) / 1000)
        : 1;
    const speed = Number.isFinite(distance) ? distance / elapsedSeconds : 0;

    const segmentBearings = [];
    const segmentDistances = [];
    for (let i = 1; i < recent.length; i++) {
        const a = L.latLng(recent[i - 1].lat, recent[i - 1].lng);
        const b = L.latLng(recent[i].lat, recent[i].lng);
        const d = Core.functieGeometry.CalculateDistanceM(a, b);
        if (Number.isFinite(d) && d > 0) {
            segmentDistances.push(d);
            segmentBearings.push(navigationCalculateBearing(a, b));
        }
    }

    const directionConsistent = segmentBearings.length <= 1
        ? segmentBearings.length === 1
        : (() => {
            let maxDelta = 0;
            for (let i = 1; i < segmentBearings.length; i++) {
                const delta = Math.abs(((segmentBearings[i] - segmentBearings[i - 1] + 540) % 360) - 180);
                maxDelta = Math.max(maxDelta, delta);
            }
            return maxDelta <= 85;
        })();

    const moving = Number.isFinite(distance) &&
        speed > 0 &&
        speed <= NAVIGATION_MAX_WALKING_SPEED_MPS &&
        directionConsistent &&
        segmentDistances.length >= Math.max(1, recent.length - 2);

    return {
        moving,
        speed,
        distance: Number.isFinite(distance) ? distance : 0,
        bearing: moving ? navigationCalculateBearing(firstLatLng, lastLatLng) : null,
        sampleCount: recent.length,
        requiredSamples: evidenceSampleCount
    };
}

function navigationCalculateMovementBearing(samples) {
    const evidence = navigationCalculateMovementEvidence(samples);
    return evidence.moving ? evidence.bearing : null;
}

function navigationRelativeBearing(movementBearing, targetBearing) {
    if (!Number.isFinite(movementBearing) || !Number.isFinite(targetBearing)) {
        return null;
    }

    // Unghiul este relativ la direcția reală de deplasare: 0° = înainte,
    // +90° = dreapta, -90° = stânga, ±180° = înapoi.
    return ((targetBearing - movementBearing + 540) % 360) - 180;
}

function navigationSmoothRelativeBearing(value, snap = false) {
    if (!Number.isFinite(value)) {
        // 15A-3C rev.2: păstrăm ultima direcție calculată. Când utilizatorul
        // stă pe loc nu mai avem direcție nouă, dar nu vrem să rotim săgeata
        // arbitrar și nici să pierdem istoricul pentru următoarea pornire.
        return Number.isFinite(navigationSmoothedRelativeBearing)
            ? navigationSmoothedRelativeBearing
            : null;
    }

    if (snap || !Number.isFinite(navigationSmoothedRelativeBearing)) {
        navigationSmoothedRelativeBearing = value;
        return value;
    }

    // Filtrare angulară ușoară pentru ca săgeata să nu tremure la fiecare
    // mică variație GPS, fără a introduce vreun senzor al telefonului.
    const delta = ((value - navigationSmoothedRelativeBearing + 540) % 360) - 180;
    navigationSmoothedRelativeBearing += delta * 0.35;
    navigationSmoothedRelativeBearing = ((navigationSmoothedRelativeBearing + 540) % 360) - 180;
    return navigationSmoothedRelativeBearing;
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

function navigationGetCalibrationState() {
    const pm = Core.Modules.PozitiaMea;
    if (pm?.GetCalibrationState) return pm.GetCalibrationState();
    return null;
}

function navigationApplyCalibrationState() {
    const state = navigationGetCalibrationState();
    if (!state?.complete || !state.center) return false;

    navigationCalibrationComplete = true;
    navigationCalibrationCenter = L.latLng(state.center.lat, state.center.lng);
    navigationCalibrationRadius = Number.isFinite(state.radius) ? Math.max(0, state.radius) : 0;
    navigationStationaryLockedPosition = navigationCalibrationCenter;
    navigationStationaryMode = true;
    navigationEstimatedPosition = navigationCalibrationCenter;
    return true;
}

function navigationUpdateTelemetry(extra = {}) {
    const el = document.getElementById("navigation-telemetry");
    if (!el) return;
    const state = navigationGetCalibrationState();
    const calibration = state?.complete
        ? `OK ${state.sampleCount}`
        : state?.active
            ? `în curs ${state.remainingSeconds}s/${state.sampleCount}`
            : "—";
    const radius = navigationCalibrationComplete
        ? `${navigationCalibrationRadius.toFixed(1).replace(".", ",")}m`
        : "—";
    const centerDistance = Number.isFinite(extra.centerDistance)
        ? `${extra.centerDistance.toFixed(1).replace(".", ",")}m`
        : "—";
    const speed = Number.isFinite(navigationEstimatedSpeedMps)
        ? `${navigationEstimatedSpeedMps.toFixed(1).replace(".", ",")}m/s`
        : "—";
    const status = extra.status || (navigationStationaryMode ? "STAȚIONAR" : "MIȘCARE");
    el.textContent = `Telemetrie: ${status} · calibrare ${calibration} · rază ${radius} · centru ${centerDistance} · v ${speed} · acceptate ${navigationAcceptedCount} · spike-uri ${navigationRejectedCount}`;
}

function navigationUpdateCalibrationReadout() {
    const state = navigationGetCalibrationState();
    if (!state) return;
    const remaining = Number.isFinite(state.remainingSeconds) ? state.remainingSeconds : 0;
    const collected = Number.isFinite(state.sampleCount) ? state.sampleCount : 0;
    if (!state.complete) {
        const el = document.getElementById("navigation-test-readout");
        if (el) el.textContent = `Calibrare GPS în curs · ${remaining}s · samples: ${collected}`;
        navigationUpdateTelemetry({ status: "CALIBRARE" });
        const arrival = document.getElementById("navigation-arrival");
        if (arrival) arrival.textContent = `📡 Calibrare GPS · stai pe loc · ${remaining}s`;
        return;
    }

    navigationApplyCalibrationState();
    const el = document.getElementById("navigation-test-readout");
    if (el && navigationStationaryMode) {
        el.textContent = `STAȚIONAR · centru GPS · rază: ${navigationCalibrationRadius.toFixed(1).replace(".", ",")} m`;
    }
}

function navigationGetCurrentEstimatedPosition(rawSample) {
    if (!navigationEstimatedPosition || !navigationLastValidPosition || !Number.isFinite(navigationEstimatedSpeedMps)) {
        return null;
    }

    const lastTime = Number(navigationLastValidTimestamp);
    const now = Number(rawSample.timestamp);
    if (!Number.isFinite(lastTime) || !Number.isFinite(now)) return null;
    const elapsed = Math.max(0, (now - lastTime) / 1000);
    if (elapsed <= 0 || navigationEstimatedSpeedMps <= 0) return navigationEstimatedPosition;

    const distance = Math.min(
        navigationEstimatedSpeedMps * elapsed,
        NAVIGATION_MAX_WALKING_SPEED_MPS * elapsed
    );
    const bearing = navigationLastMovementBearing;
    if (!Number.isFinite(bearing)) return navigationEstimatedPosition;

    const R = 6371000;
    const lat1 = navigationEstimatedPosition.lat * Math.PI / 180;
    const lng1 = navigationEstimatedPosition.lng * Math.PI / 180;
    const brng = bearing * Math.PI / 180;
    const angular = distance / R;
    const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(angular) +
        Math.cos(lat1) * Math.sin(angular) * Math.cos(brng)
    );
    const lng2 = lng1 + Math.atan2(
        Math.sin(brng) * Math.sin(angular) * Math.cos(lat1),
        Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
    );
    return L.latLng(lat2 * 180 / Math.PI, lng2 * 180 / Math.PI);
}

function navigationUpdateTestReadout(evidence, stateOverride = null) {
    const el = document.getElementById("navigation-test-readout");
    if (!el) return;

    const state = stateOverride || (evidence?.moving ? "ÎN MIȘCARE" : "STAȚIONAR");
    const distance = Number.isFinite(evidence?.distance)
        ? `${evidence.distance.toFixed(1)} m`
        : "—";
    const speed = Number.isFinite(evidence?.speed)
        ? `${evidence.speed.toFixed(1)} m/s`
        : "—";
    const count = `${evidence?.sampleCount || 0}/${evidence?.requiredSamples || navigationMovementDetectionSamples}`;
    el.textContent = `Stare: ${state} · Δ: ${distance} · v: ${speed} · samples: ${count}`;
}

function navigationCreateEstimatedPosition(origin, bearing, distance) {
    if (!origin || !Number.isFinite(bearing) || !Number.isFinite(distance) || distance <= 0) {
        return origin ? L.latLng(origin.lat, origin.lng) : null;
    }

    const R = 6371000;
    const lat1 = origin.lat * Math.PI / 180;
    const lng1 = origin.lng * Math.PI / 180;
    const brng = bearing * Math.PI / 180;
    const angular = distance / R;
    const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(angular) +
        Math.cos(lat1) * Math.sin(angular) * Math.cos(brng)
    );
    const lng2 = lng1 + Math.atan2(
        Math.sin(brng) * Math.sin(angular) * Math.cos(lat1),
        Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
    );
    return L.latLng(lat2 * 180 / Math.PI, lng2 * 180 / Math.PI);
}

function navigationPredictPosition(timestamp) {
    if (!navigationLastValidPosition ||
        !Number.isFinite(navigationLastMovementBearing) ||
        !Number.isFinite(navigationEstimatedSpeedMps)) {
        return navigationEstimatedPosition || (navigationLastValidPosition
            ? L.latLng(navigationLastValidPosition.lat, navigationLastValidPosition.lng)
            : null);
    }

    const elapsed = Math.max(0, (Number(timestamp) - Number(navigationLastValidTimestamp)) / 1000);
    if (elapsed <= 0 || navigationEstimatedSpeedMps <= 0) {
        return navigationEstimatedPosition || L.latLng(navigationLastValidPosition.lat, navigationLastValidPosition.lng);
    }

    const distance = Math.min(
        navigationEstimatedSpeedMps * elapsed,
        NAVIGATION_MAX_WALKING_SPEED_MPS * elapsed
    );
    return navigationCreateEstimatedPosition(
        L.latLng(navigationLastValidPosition.lat, navigationLastValidPosition.lng),
        navigationLastMovementBearing,
        distance
    );
}

function navigationUpdatePosition(position) {
    if (!navigationActive || !navigationTarget || !map) return;
    if (!position?.coords) return;

    const rawLat = Number(position.coords.latitude);
    const rawLng = Number(position.coords.longitude);
    if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng)) return;

    const timestamp = Number.isFinite(Number(position.timestamp))
        ? Number(position.timestamp)
        : Date.now();
    const accuracy = Number(position.coords.accuracy);
    const rawSample = {
        lat: rawLat,
        lng: rawLng,
        accuracy,
        timestamp
    };

    const calibrationState = navigationGetCalibrationState();
    if (calibrationState && !calibrationState.complete) {
        navigationUpdateCalibrationReadout();
        return;
    }

    if (!navigationCalibrationComplete) {
        navigationApplyCalibrationState();
    }

    const previousValid = navigationLastValidPosition;
    const elapsedSeconds = previousValid
        ? Math.max(0.25, (timestamp - previousValid.timestamp) / 1000)
        : 0;
    const distanceFromPrevious = previousValid
        ? Core.functieGeometry.CalculateDistanceM(
            L.latLng(previousValid.lat, previousValid.lng),
            L.latLng(rawSample.lat, rawSample.lng)
        )
        : 0;
    const apparentSpeed = previousValid && Number.isFinite(distanceFromPrevious)
        ? distanceFromPrevious / elapsedSeconds
        : 0;

    // Un singur filtru GPS: comparăm întotdeauna cu ultima poziție VALIDĂ.
    // Orice deplasare care ar implica peste 2 m/s este un spike și este ignorată.
    if (position.__permaGpsRejected === true ||
        (previousValid && !navigationIsPlausibleSample(rawSample, previousValid))) {
        navigationRejectedCount += 1;

        const current = navigationStationaryMode
            ? navigationStationaryLockedPosition
            : navigationPredictPosition(timestamp);

        navigationUpdateTestReadout({
            moving: navigationWasMoving,
            distance: Number.isFinite(distanceFromPrevious) ? distanceFromPrevious : 0,
            speed: Number.isFinite(apparentSpeed) ? apparentSpeed : 0,
            sampleCount: navigationMovementCandidates.length,
            requiredSamples: navigationMovementDetectionSamples
        }, navigationStationaryMode
            ? "STAȚIONAR · SPIKE RESPINS"
            : "ÎN MIȘCARE · PREDICȚIE · SPIKE RESPINS");

        navigationUpdateTelemetry({
            status: navigationStationaryMode ? "STAȚIONAR" : "PREDICȚIE",
            centerDistance: navigationCalibrationCenter && current
                ? Core.functieGeometry.CalculateDistanceM(navigationCalibrationCenter, current)
                : null
        });

        if (current) {
            navigationEstimatedPosition = current;
            navigationRenderCurrentPosition(current, accuracy, navigationWasMoving);
            navigationUpdateNavigationPanel(current, navigationTarget.marker.getLatLng(), accuracy,
                navigationCalculateBearing(current, navigationTarget.marker.getLatLng()),
                navigationSmoothedRelativeBearing);
        }
        return;
    }

    navigationAcceptedCount += 1;
    navigationAcceptedGpsSamples.push(rawSample);
    if (navigationAcceptedGpsSamples.length > NAVIGATION_GPS_SAMPLE_COUNT) {
        navigationAcceptedGpsSamples.shift();
    }
    navigationGpsSamples = navigationAcceptedGpsSamples.slice();
    navigationLastValidPosition = { ...rawSample };
    navigationLastValidTimestamp = timestamp;

    if (!navigationCalibrationComplete || !navigationCalibrationCenter) {
        // Fallback pentru situația în care GPS-ul este pornit fără calibrare disponibilă.
        navigationEstimatedPosition = L.latLng(rawLat, rawLng);
        navigationStationaryLockedPosition = navigationEstimatedPosition;
        navigationStationaryMode = true;
        navigationWasMoving = false;
        navigationEstimatedSpeedMps = 0;
    } else if (navigationStationaryMode) {
        const distanceFromCenter = Core.functieGeometry.CalculateDistanceM(
            navigationCalibrationCenter,
            L.latLng(rawLat, rawLng)
        );
        const stationaryRadius = navigationGetStationaryRadius();

        if (distanceFromCenter <= stationaryRadius) {
            navigationMovementCandidates = [];
            navigationEstimatedSpeedMps = 0;
            navigationEstimatedPosition = navigationStationaryLockedPosition || navigationCalibrationCenter;
        } else {
            navigationMovementCandidates.push(rawSample);
            if (navigationMovementCandidates.length > navigationMovementDetectionSamples) {
                navigationMovementCandidates.shift();
            }

            const required = navigationMovementDetectionSamples;
            let confirmedMoving = false;
            let movementBearing = null;
            let movementSpeed = apparentSpeed;

            if (navigationMovementCandidates.length >= required) {
                const first = navigationMovementCandidates[0];
                const last = navigationMovementCandidates[navigationMovementCandidates.length - 1];
                const firstPoint = L.latLng(first.lat, first.lng);
                const lastPoint = L.latLng(last.lat, last.lng);
                const moveDistance = Core.functieGeometry.CalculateDistanceM(firstPoint, lastPoint);
                const moveElapsed = Math.max(0.25, (last.timestamp - first.timestamp) / 1000);
                movementSpeed = Number.isFinite(moveDistance) ? moveDistance / moveElapsed : Infinity;

                // KISS: cele N samples trebuie să fie fiecare în afara zonei de staționare
                // și traiectoria lor să fie plauzibilă. Nu cerem o viteză minimă și nu cerem
                // consistență artificială de unghi pentru simpla detectare a mersului.
                const allOutside = navigationMovementCandidates.every(sample =>
                    Core.functieGeometry.CalculateDistanceM(
                        navigationCalibrationCenter,
                        L.latLng(sample.lat, sample.lng)
                    ) > stationaryRadius
                );
                confirmedMoving = allOutside && Number.isFinite(moveDistance) &&
                    moveDistance > 0 && movementSpeed <= NAVIGATION_MAX_WALKING_SPEED_MPS;

                if (confirmedMoving) {
                    movementBearing = navigationCalculateBearing(firstPoint, lastPoint);
                    navigationLastMovementBearing = movementBearing;
                    navigationEstimatedSpeedMps = movementSpeed;
                    navigationStationaryMode = false;
                    navigationWasMoving = true;
                    navigationStationaryLockedPosition = null;
                    navigationEstimatedPosition = lastPoint;
                    navigationMovementCandidates = [];
                }
            }

            if (!confirmedMoving) {
                navigationEstimatedSpeedMps = Number.isFinite(apparentSpeed) ? apparentSpeed : 0;
                navigationEstimatedPosition = navigationStationaryLockedPosition || navigationCalibrationCenter;
            }
        }
    } else {
        // MOVING: ultimul sample valid este poziția curentă. Direcția se bazează pe
        // ultimele poziții valide, iar spike-urile nu ajung aici.
        if (Number.isFinite(distanceFromPrevious) && distanceFromPrevious > 0.05) {
            navigationEstimatedSpeedMps = Math.min(apparentSpeed, NAVIGATION_MAX_WALKING_SPEED_MPS);
            navigationLastMovementBearing = navigationCalculateBearing(
                L.latLng(previousValid.lat, previousValid.lng),
                L.latLng(rawLat, rawLng)
            );
        }
        navigationEstimatedPosition = L.latLng(rawLat, rawLng);

        const stationary = navigationDetectStationary(navigationAcceptedGpsSamples);
        if (stationary) {
            navigationStationaryMode = true;
            navigationWasMoving = false;
            navigationStationaryLockedPosition = stationary.center;
            navigationCalibrationCenter = stationary.center;
            navigationCalibrationRadius = Math.max(0.5, stationary.radius);
            navigationEstimatedSpeedMps = 0;
            navigationEstimatedPosition = stationary.center;
            navigationMovementCandidates = [];
        } else {
            navigationWasMoving = true;
        }
    }

    const current = navigationEstimatedPosition;
    if (!current) return;

    const wasMovingBefore = navigationWasMoving;
    const target = navigationTarget.marker.getLatLng();
    const distance = Core.functieGeometry.CalculateDistanceM(current, target);
    const bearing = navigationCalculateBearing(current, target);
    const movementBearing = navigationStationaryMode ? null : navigationLastMovementBearing;
    const rawRelativeBearing = navigationRelativeBearing(movementBearing, bearing);
    const resumedMovement = Number.isFinite(movementBearing) && !wasMovingBefore;
    const relativeBearing = navigationSmoothRelativeBearing(rawRelativeBearing, resumedMovement);

    if (Number.isFinite(movementBearing)) {
        navigationWasMoving = true;
    }

    navigationUpdateTestReadout({
        moving: navigationWasMoving,
        distance: Number.isFinite(distanceFromPrevious) ? distanceFromPrevious : 0,
        speed: navigationEstimatedSpeedMps,
        sampleCount: navigationMovementCandidates.length,
        requiredSamples: navigationMovementDetectionSamples
    }, navigationStationaryMode
        ? "STAȚIONAR"
        : (navigationWasMoving ? "ÎN MIȘCARE" : "STAȚIONAR"));

    navigationUpdateTelemetry({
        status: navigationStationaryMode ? "STAȚIONAR" : "ÎN MIȘCARE",
        centerDistance: navigationCalibrationCenter
            ? Core.functieGeometry.CalculateDistanceM(navigationCalibrationCenter, current)
            : null
    });

    navigationRenderCurrentPosition(current, accuracy, Number.isFinite(movementBearing));
    navigationUpdateNavigationPanel(current, target, accuracy, bearing, relativeBearing);
}

function navigationRenderCurrentPosition(current, accuracy, isMoving) {
    if (!current || !map) return;
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

    if (navigationFirstFix) {
        navigationFirstFix = false;
        const target = navigationTarget?.marker?.getLatLng();
        if (target) {
            const distance = Core.functieGeometry.CalculateDistanceM(current, target);
            if (distance < 25) {
                map.setView(current, Math.max(map.getZoom(), 20));
            } else {
                map.fitBounds(L.latLngBounds([current, target]).pad(0.45), {
                    maxZoom: 21,
                    animate: false
                });
            }
        }
    }
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
    navigationAcceptedGpsSamples = [];
    navigationStationaryLockedPosition = null;
    navigationStationaryMode = false;
    navigationMovementCandidates = [];
    navigationSmoothedRelativeBearing = null;
    navigationLastMovementBearing = null;
    navigationWasMoving = false;
    navigationCalibrationSamples = [];
    navigationCalibrationStartedAt = 0;
    navigationCalibrationComplete = false;
    navigationCalibrationCenter = null;
    navigationCalibrationRadius = 0;
    navigationEstimatedPosition = null;
    navigationLastValidTimestamp = null;
    navigationLastValidPosition = null;
    navigationEstimatedSpeedMps = 0;

    const panel = navigationEnsurePanel();
    const samplesValue = document.getElementById("navigation-samples-value");
    if (samplesValue) samplesValue.textContent = String(navigationMovementDetectionSamples);
    const testReadout = document.getElementById("navigation-test-readout");
    if (testReadout) testReadout.textContent = `Stare: — · Δ: — · v: — · samples: 0/${navigationMovementDetectionSamples}`;
    navigationAcceptedCount = 0;
    navigationRejectedCount = 0;
    navigationUpdateTelemetry({ status: "AȘTEAPTĂ" });
    const samplesMinus = document.getElementById("navigation-samples-minus");
    const samplesPlus = document.getElementById("navigation-samples-plus");
    if (samplesMinus) samplesMinus.disabled = navigationMovementDetectionSamples <= NAVIGATION_MOVEMENT_SAMPLE_MIN;
    if (samplesPlus) samplesPlus.disabled = navigationMovementDetectionSamples >= NAVIGATION_MOVEMENT_SAMPLE_MAX;
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

    navigationSetPanelState("waiting", "Se așteaptă calibrarea GPS…");
    navigationStartWatch();
    const calibrationState = navigationGetCalibrationState();
    if (calibrationState?.complete) navigationApplyCalibrationState();
    navigationUpdateCalibrationReadout();

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
    navigationAcceptedGpsSamples = [];
    navigationStationaryLockedPosition = null;
    navigationStationaryMode = false;
    navigationMovementCandidates = [];
    navigationSmoothedRelativeBearing = null;
    navigationLastMovementBearing = null;
    navigationWasMoving = false;
    navigationCalibrationSamples = [];
    navigationCalibrationStartedAt = 0;
    navigationCalibrationComplete = false;
    navigationCalibrationCenter = null;
    navigationCalibrationRadius = 0;
    navigationEstimatedPosition = null;
    navigationLastValidTimestamp = null;
    navigationLastValidPosition = null;
    navigationEstimatedSpeedMps = 0;
    navigationAcceptedCount = 0;
    navigationRejectedCount = 0;
    navigationLastRawSample = null;

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
