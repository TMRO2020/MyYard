/* =========================================================
   PERMA ENGINE — Module: Poziția mea V2 — PATCH 03 experimental

   PATCH 03 adaugă strict peste V2:
   - marker DISPLAY albastru + marker RAW separat;
   - trail RAW GPS pentru diagnostic vizual;
   - reacție imediată a markerului DISPLAY la sample-ul acceptat;
   - diagnostic de staționare cu timer 30/40 s;
   - rezumatul staționării este inclus în log.

   IMPORTANT:
   - Nu modifică și nu înlocuiește Core.Modules.PozitiaMea.
   - Nu afișează și nu salvează coordonate GPS complete.
   - Filtrul >20 m rămâne neschimbat: sample-ul este păstrat ca RAW,
     dar nu mută markerul DISPLAY.
   ========================================================= */
Core.Modules.PozitiaMeaV2 = Core.Modules.PozitiaMeaV2 || {};

const PozitiaMeaV2 = Core.Modules.PozitiaMeaV2;

PozitiaMeaV2._watchId = null;
PozitiaMeaV2._active = false;
PozitiaMeaV2._marker = null;
PozitiaMeaV2._rawMarker = null;
PozitiaMeaV2._accuracyCircle = null;
PozitiaMeaV2._rawTrail = null;
PozitiaMeaV2._rawTrailPoints = [];
PozitiaMeaV2._lastAccepted = null;
PozitiaMeaV2._lastRaw = null;
PozitiaMeaV2._sampleTimes = [];
PozitiaMeaV2._totalSamples = 0;
PozitiaMeaV2._acceptedSamples = 0;
PozitiaMeaV2._rejectedSamples = 0;
PozitiaMeaV2._lastJumpDistanceM = null;
PozitiaMeaV2._lastSampleIntervalS = null;
PozitiaMeaV2._lastReason = "";
PozitiaMeaV2._lastAccuracyM = null;
PozitiaMeaV2._MARKER_RADIUS_METERS = 0.45;
PozitiaMeaV2._MAX_JUMP_METERS = 20;
PozitiaMeaV2._logging = false;
PozitiaMeaV2._logRows = [];
PozitiaMeaV2._logEvents = [];
PozitiaMeaV2._logStartedAt = null;
PozitiaMeaV2._logSessionId = null;
PozitiaMeaV2._stationary = null;
PozitiaMeaV2._stationaryTimer = null;
PozitiaMeaV2._lastStationaryResult = null;

PozitiaMeaV2.IsActive = function () {
    return PozitiaMeaV2._active;
};

PozitiaMeaV2._getEl = function (id) {
    return document.getElementById(id);
};

PozitiaMeaV2._maskCoordinate = function (value) {
    if (!Number.isFinite(value)) return "xx.———————";
    const fixed = Math.abs(value).toFixed(7);
    const parts = fixed.split(".");
    return `xx.${parts[1].slice(0, 3)}${parts[1].slice(-4)}`;
};

PozitiaMeaV2._setText = function (id, value) {
    const el = PozitiaMeaV2._getEl(id);
    if (el) el.textContent = value;
};

PozitiaMeaV2._format = function (value, decimals = 1) {
    return Number.isFinite(value) ? value.toFixed(decimals).replace(".", ",") : "—";
};

PozitiaMeaV2._distance = function (a, b) {
    if (!a || !b) return null;
    return Core.functieGeometry.CalculateDistanceM(
        L.latLng(a.lat, a.lng),
        L.latLng(b.lat, b.lng)
    );
};

PozitiaMeaV2._cleanupLayers = function () {
    if (!map) return;
    [
        PozitiaMeaV2._marker,
        PozitiaMeaV2._rawMarker,
        PozitiaMeaV2._accuracyCircle,
        PozitiaMeaV2._rawTrail
    ].forEach(layer => {
        if (layer && map.hasLayer(layer)) map.removeLayer(layer);
    });
};

PozitiaMeaV2._ensureVisuals = function () {
    if (!map) return false;

    if (!PozitiaMeaV2._rawTrail) {
        PozitiaMeaV2._rawTrail = L.polyline([], {
            weight: 2,
            opacity: 0.55,
            dashArray: "3 5",
            interactive: false,
            pane: "overlayPane"
        });
    }

    if (!PozitiaMeaV2._rawMarker) {
        PozitiaMeaV2._rawMarker = L.circleMarker([0, 0], {
            radius: 5,
            weight: 2,
            color: "#d32f2f",
            fill: true,
            fillColor: "#ffffff",
            fillOpacity: 0.95,
            interactive: false,
            pane: "markerPane"
        });
    }

    if (!PozitiaMeaV2._marker) {
        PozitiaMeaV2._marker = L.circleMarker([0, 0], {
            radius: 1,
            stroke: false,
            fill: true,
            fillColor: "#1976d2",
            fillOpacity: 1,
            interactive: true,
            bubblingMouseEvents: false,
            pane: "markerPane"
        });
        PozitiaMeaV2._marker.bindTooltip("Poziția mea V2 — DISPLAY", {
            direction: "top",
            offset: [0, -8]
        });
        PozitiaMeaV2._marker.bindPopup(
            '<div class="my-location-popup"><strong>🔵 Poziția mea V2</strong><div>Se determină poziția…</div></div>'
        );
    }

    if (!PozitiaMeaV2._accuracyCircle) {
        PozitiaMeaV2._accuracyCircle = L.circle([0, 0], {
            radius: 0,
            stroke: true,
            weight: 1,
            fill: true,
            fillOpacity: 0.08,
            interactive: false,
            pane: "overlayPane"
        });
    }

    PozitiaMeaV2._updateMarkerPixelRadius();
    return true;
};

PozitiaMeaV2._updateMarkerPixelRadius = function () {
    if (!map || !PozitiaMeaV2._marker) return;

    const center = PozitiaMeaV2._marker.getLatLng();
    if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return;

    const destination = Core.functieGeometry.DestinationByBearing(
        center,
        90,
        PozitiaMeaV2._MARKER_RADIUS_METERS
    );
    const p1 = map.latLngToLayerPoint(center);
    const p2 = map.latLngToLayerPoint(destination);
    const radiusPx = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

    // Pe zoom mic, păstrăm markerul vizibil fără să-i schimbăm raza geometrică.
    PozitiaMeaV2._marker.setRadius(Math.max(3, radiusPx));
};

PozitiaMeaV2._showLayers = function () {
    if (!map) return;
    [
        PozitiaMeaV2._rawTrail,
        PozitiaMeaV2._accuracyCircle,
        PozitiaMeaV2._rawMarker,
        PozitiaMeaV2._marker
    ].forEach(layer => {
        if (layer && !map.hasLayer(layer)) layer.addTo(map);
    });
};

PozitiaMeaV2._clearTrail = function () {
    PozitiaMeaV2._rawTrailPoints = [];
    if (PozitiaMeaV2._rawTrail) PozitiaMeaV2._rawTrail.setLatLngs([]);
};

PozitiaMeaV2._addRawTrailPoint = function (raw) {
    if (!PozitiaMeaV2._rawTrail || !raw) return;
    PozitiaMeaV2._rawTrailPoints.push([raw.lat, raw.lng]);
    // Pentru testele de câteva minute, 1000 de puncte sunt suficiente și
    // împiedică trail-ul să crească nelimitat dacă uităm GPS-ul pornit.
    if (PozitiaMeaV2._rawTrailPoints.length > 1000) {
        PozitiaMeaV2._rawTrailPoints.shift();
    }
    PozitiaMeaV2._rawTrail.setLatLngs(PozitiaMeaV2._rawTrailPoints);
};

PozitiaMeaV2._updateButton = function () {
    const button = PozitiaMeaV2._getEl("btn-my-location-v2");
    if (!button) return;
    button.textContent = PozitiaMeaV2._active
        ? "⏹ Oprește GPS V2"
        : "📍 Pornește GPS V2";
    button.classList.toggle("primary", PozitiaMeaV2._active);
    button.setAttribute("aria-pressed", PozitiaMeaV2._active ? "true" : "false");
};

PozitiaMeaV2._updateStationaryButtons = function () {
    const b30 = PozitiaMeaV2._getEl("btn-gps-v2-stationary-30");
    const b40 = PozitiaMeaV2._getEl("btn-gps-v2-stationary-40");
    const stop = PozitiaMeaV2._getEl("btn-gps-v2-stationary-stop");
    const busy = !!PozitiaMeaV2._stationary;
    if (b30) b30.disabled = !PozitiaMeaV2._active || busy;
    if (b40) b40.disabled = !PozitiaMeaV2._active || busy;
    if (stop) stop.disabled = !busy;
};

PozitiaMeaV2._updateTelemetry = function () {
    const now = Date.now();
    PozitiaMeaV2._sampleTimes = PozitiaMeaV2._sampleTimes.filter(t => now - t <= 1000);

    PozitiaMeaV2._setText("gps-v2-state", PozitiaMeaV2._active ? "ACTIV" : "OPRIT");
    PozitiaMeaV2._setText("gps-v2-samples-sec", String(PozitiaMeaV2._sampleTimes.length));
    PozitiaMeaV2._setText("gps-v2-total", String(PozitiaMeaV2._totalSamples));
    PozitiaMeaV2._setText("gps-v2-accepted", String(PozitiaMeaV2._acceptedSamples));
    PozitiaMeaV2._setText("gps-v2-rejected", String(PozitiaMeaV2._rejectedSamples));
    PozitiaMeaV2._setText("gps-v2-log-state", PozitiaMeaV2._logging ? "ACTIV" : "OPRIT");
    PozitiaMeaV2._setText("gps-v2-log-count", String(PozitiaMeaV2._logRows.length));
    PozitiaMeaV2._setText("gps-v2-accuracy", PozitiaMeaV2._lastAccuracyM === null
        ? "—"
        : `±${PozitiaMeaV2._format(PozitiaMeaV2._lastAccuracyM)} m`);
    PozitiaMeaV2._setText("gps-v2-jump", PozitiaMeaV2._lastJumpDistanceM === null
        ? "—"
        : `${PozitiaMeaV2._format(PozitiaMeaV2._lastJumpDistanceM)} m`);
    PozitiaMeaV2._setText("gps-v2-interval", PozitiaMeaV2._lastSampleIntervalS === null
        ? "—"
        : `${PozitiaMeaV2._format(PozitiaMeaV2._lastSampleIntervalS, 2)} s`);
    PozitiaMeaV2._setText("gps-v2-filter", PozitiaMeaV2._lastReason || "—");

    if (PozitiaMeaV2._lastAccepted) {
        PozitiaMeaV2._setText("gps-v2-lat", PozitiaMeaV2._maskCoordinate(PozitiaMeaV2._lastAccepted.lat));
        PozitiaMeaV2._setText("gps-v2-lng", PozitiaMeaV2._maskCoordinate(PozitiaMeaV2._lastAccepted.lng));
    } else {
        PozitiaMeaV2._setText("gps-v2-lat", "—");
        PozitiaMeaV2._setText("gps-v2-lng", "—");
    }

    if (PozitiaMeaV2._stationary) {
        const left = Math.max(0, Math.ceil((PozitiaMeaV2._stationary.endAt - Date.now()) / 1000));
        PozitiaMeaV2._setText(
            "gps-v2-stationary-status",
            `📍 ${PozitiaMeaV2._stationary.label} · STAI PE LOC · ${left} s rămase · sample-uri ${PozitiaMeaV2._stationary.samples.length}`
        );
    }
};

PozitiaMeaV2._handlePosition = function (position) {
    if (!position?.coords || !PozitiaMeaV2._ensureVisuals()) return;

    const lat = Number(position.coords.latitude);
    const lng = Number(position.coords.longitude);
    const accuracy = Number(position.coords.accuracy);
    const timestamp = Number.isFinite(position.timestamp) ? position.timestamp : Date.now();

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const raw = {
        lat,
        lng,
        accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
        timestamp
    };

    PozitiaMeaV2._totalSamples += 1;
    PozitiaMeaV2._sampleTimes.push(Date.now());
    PozitiaMeaV2._lastAccuracyM = raw.accuracy;

    let elapsedS = null;
    let distanceM = null;
    let accepted = true;
    let reason = "acceptat";

    if (PozitiaMeaV2._lastRaw) {
        elapsedS = Math.max(0.001, (raw.timestamp - PozitiaMeaV2._lastRaw.timestamp) / 1000);
        distanceM = PozitiaMeaV2._distance(PozitiaMeaV2._lastRaw, raw);
        PozitiaMeaV2._lastSampleIntervalS = elapsedS;
        PozitiaMeaV2._lastJumpDistanceM = Number.isFinite(distanceM) ? distanceM : null;

        if (!Number.isFinite(distanceM) || distanceM > PozitiaMeaV2._MAX_JUMP_METERS) {
            accepted = false;
            reason = `respins · salt > ${PozitiaMeaV2._MAX_JUMP_METERS} m`;
            PozitiaMeaV2._rejectedSamples += 1;
        }
    }

    // RAW este vizibil și este păstrat indiferent dacă sample-ul trece filtrul.
    PozitiaMeaV2._rawMarker.setLatLng([raw.lat, raw.lng]);
    PozitiaMeaV2._addRawTrailPoint(raw);
    PozitiaMeaV2._showLayers();

    if (PozitiaMeaV2._stationary) {
        PozitiaMeaV2._stationary.samples.push({ ...raw, distanceM, accepted });
    }

    if (PozitiaMeaV2._logging) {
        PozitiaMeaV2._logRows.push({
            n: PozitiaMeaV2._totalSamples,
            time: new Date().toISOString(),
            lat: PozitiaMeaV2._maskCoordinate(raw.lat),
            lng: PozitiaMeaV2._maskCoordinate(raw.lng),
            accuracyM: raw.accuracy,
            intervalS: elapsedS,
            distanceM,
            accepted,
            reason
        });
    }

    // Următorul sample este comparat întotdeauna cu ultimul RAW.
    PozitiaMeaV2._lastRaw = raw;

    if (!accepted) {
        PozitiaMeaV2._lastReason = reason;
        PozitiaMeaV2._updateTelemetry();
        return;
    }

    PozitiaMeaV2._acceptedSamples += 1;
    PozitiaMeaV2._lastAccepted = raw;
    PozitiaMeaV2._lastReason = "acceptat · DISPLAY actualizat";

    const latlng = L.latLng(raw.lat, raw.lng);
    // Actualizare directă, fără interpolare sau întârziere artificială.
    PozitiaMeaV2._marker.setLatLng(latlng);
    PozitiaMeaV2._accuracyCircle.setLatLng(latlng);
    PozitiaMeaV2._accuracyCircle.setRadius(
        Number.isFinite(raw.accuracy) && raw.accuracy > 0 ? raw.accuracy : 0
    );
    PozitiaMeaV2._updateMarkerPixelRadius();

    const accuracyText = Number.isFinite(raw.accuracy)
        ? `Precizie raportată: ±${PozitiaMeaV2._format(raw.accuracy)} m`
        : "Precizia raportată nu este disponibilă";

    PozitiaMeaV2._marker.setPopupContent(
        `<div class="my-location-popup"><strong>🔵 Poziția mea V2</strong><div>Lat ${PozitiaMeaV2._maskCoordinate(raw.lat)}</div><div>Lng ${PozitiaMeaV2._maskCoordinate(raw.lng)}</div><div>${accuracyText}</div><div>DISPLAY = ultimul sample acceptat</div></div>`
    );

    PozitiaMeaV2._updateTelemetry();
};

PozitiaMeaV2._handleError = function (error) {
    const message = error?.code === 1
        ? "Accesul la locație a fost refuzat."
        : error?.code === 2
            ? "Poziția GPS nu este disponibilă."
            : error?.code === 3
                ? "Determinarea poziției GPS a expirat."
                : "Nu s-a putut determina poziția GPS.";

    PozitiaMeaV2._lastReason = `eroare · ${message}`;
    PozitiaMeaV2._setText("gps-v2-filter", PozitiaMeaV2._lastReason);
};

PozitiaMeaV2.StartLog = function () {
    if (PozitiaMeaV2._logging) return true;
    if (!PozitiaMeaV2._active) {
        PozitiaMeaV2._lastReason = "pornește GPS V2 înaintea logării";
        PozitiaMeaV2._updateTelemetry();
        return false;
    }
    PozitiaMeaV2._logging = true;
    PozitiaMeaV2._logRows = [];
    PozitiaMeaV2._logEvents = [];
    PozitiaMeaV2._logStartedAt = new Date();
    PozitiaMeaV2._logSessionId = `GPSV2-${PozitiaMeaV2._logStartedAt.toISOString().replace(/[:.]/g, "-")}`;
    PozitiaMeaV2._lastReason = "logare pornită";
    PozitiaMeaV2._updateLogButtons();
    PozitiaMeaV2._updateTelemetry();
    return true;
};

PozitiaMeaV2.StopLog = function () {
    if (!PozitiaMeaV2._logging) return true;
    PozitiaMeaV2._logging = false;
    PozitiaMeaV2._lastReason = "logare oprită";
    PozitiaMeaV2._updateLogButtons();
    PozitiaMeaV2._updateTelemetry();
    return true;
};

PozitiaMeaV2.ClearLog = function () {
    PozitiaMeaV2._logging = false;
    PozitiaMeaV2._logRows = [];
    PozitiaMeaV2._logEvents = [];
    PozitiaMeaV2._logStartedAt = null;
    PozitiaMeaV2._logSessionId = null;
    PozitiaMeaV2._lastReason = "log gol";
    PozitiaMeaV2._updateLogButtons();
    PozitiaMeaV2._updateTelemetry();
    return true;
};

PozitiaMeaV2._stationaryStats = function (session) {
    const samples = session?.samples || [];
    const steps = samples.map(s => s.distanceM).filter(Number.isFinite);
    const accuracies = samples.map(s => s.accuracy).filter(Number.isFinite);
    const start = samples[0] || null;
    const end = samples[samples.length - 1] || null;

    let centerLat = null;
    let centerLng = null;
    let maxFromCenterM = null;
    if (samples.length) {
        centerLat = samples.reduce((sum, s) => sum + s.lat, 0) / samples.length;
        centerLng = samples.reduce((sum, s) => sum + s.lng, 0) / samples.length;
        const center = { lat: centerLat, lng: centerLng };
        maxFromCenterM = Math.max(...samples.map(s => PozitiaMeaV2._distance(center, s) || 0));
    }

    return {
        label: session.label,
        durationS: Math.round((session.endAt - session.startAt) / 1000),
        samples: samples.length,
        accepted: samples.filter(s => s.accepted).length,
        rejected: samples.filter(s => !s.accepted).length,
        minStepM: steps.length ? Math.min(...steps) : null,
        avgStepM: steps.length ? steps.reduce((a, b) => a + b, 0) / steps.length : null,
        maxStepM: steps.length ? Math.max(...steps) : null,
        netM: start && end ? PozitiaMeaV2._distance(start, end) : null,
        maxFromCenterM,
        avgAccuracyM: accuracies.length ? accuracies.reduce((a, b) => a + b, 0) / accuracies.length : null,
        minAccuracyM: accuracies.length ? Math.min(...accuracies) : null,
        maxAccuracyM: accuracies.length ? Math.max(...accuracies) : null
    };
};

PozitiaMeaV2._renderStationaryResult = function (stats) {
    if (!stats) return;
    const text = [
        `${stats.label}: ${stats.samples} sample-uri`,
        `pas min/med/max ${PozitiaMeaV2._format(stats.minStepM, 2)}/${PozitiaMeaV2._format(stats.avgStepM, 2)}/${PozitiaMeaV2._format(stats.maxStepM, 2)} m`,
        `start→final ${PozitiaMeaV2._format(stats.netM, 2)} m`,
        `max față de centru ${PozitiaMeaV2._format(stats.maxFromCenterM, 2)} m`,
        `accuracy medie ${PozitiaMeaV2._format(stats.avgAccuracyM, 2)} m`
    ].join(" · ");
    PozitiaMeaV2._setText("gps-v2-stationary-result", `Ultimul diagnostic: ${text}`);
};

PozitiaMeaV2.StartStationary = function (durationS) {
    if (!PozitiaMeaV2._active || PozitiaMeaV2._stationary) return false;

    const labelEl = PozitiaMeaV2._getEl("gps-v2-stationary-label");
    const label = labelEl?.value || "ALT";
    const seconds = Number(durationS) === 30 ? 30 : 40;
    const startAt = Date.now();
    const session = {
        label,
        startAt,
        endAt: startAt + seconds * 1000,
        samples: []
    };

    PozitiaMeaV2._stationary = session;
    PozitiaMeaV2._logEvents.push({
        type: "stationary_start",
        time: new Date(startAt).toISOString(),
        label,
        durationS: seconds
    });

    PozitiaMeaV2._setText("gps-v2-stationary-result", `Ultimul diagnostic: —`);
    PozitiaMeaV2._updateStationaryButtons();
    PozitiaMeaV2._updateTelemetry();

    PozitiaMeaV2._stationaryTimer = setInterval(() => {
        if (!PozitiaMeaV2._stationary) return;
        if (Date.now() >= PozitiaMeaV2._stationary.endAt) {
            PozitiaMeaV2.StopStationary();
            return;
        }
        PozitiaMeaV2._updateTelemetry();
    }, 250);

    return true;
};

PozitiaMeaV2.StopStationary = function () {
    if (!PozitiaMeaV2._stationary) return false;

    const session = PozitiaMeaV2._stationary;
    clearInterval(PozitiaMeaV2._stationaryTimer);
    PozitiaMeaV2._stationaryTimer = null;
    session.endAt = Math.min(Date.now(), session.endAt);

    const stats = PozitiaMeaV2._stationaryStats(session);
    PozitiaMeaV2._lastStationaryResult = stats;
    PozitiaMeaV2._logEvents.push({
        type: "stationary_end",
        time: new Date().toISOString(),
        ...stats
    });

    PozitiaMeaV2._stationary = null;
    PozitiaMeaV2._renderStationaryResult(stats);
    PozitiaMeaV2._updateStationaryButtons();
    PozitiaMeaV2._updateTelemetry();
    return true;
};

PozitiaMeaV2.SaveLog = function () {
    if (!PozitiaMeaV2._logRows.length && !PozitiaMeaV2._logEvents.length) {
        PozitiaMeaV2._lastReason = "nu există date de salvat";
        PozitiaMeaV2._updateTelemetry();
        return false;
    }

    const endedAt = new Date();
    const lines = [
        "PERMA ENGINE — GPS V2 DIAGNOSTIC LOG — PATCH 03",
        `Session: ${PozitiaMeaV2._logSessionId || "GPSV2-unknown"}`,
        `Started: ${PozitiaMeaV2._logStartedAt ? PozitiaMeaV2._logStartedAt.toISOString() : "unknown"}`,
        `Saved: ${endedAt.toISOString()}`,
        `Samples logged: ${PozitiaMeaV2._logRows.length}`,
        `Stationary diagnostics: ${PozitiaMeaV2._logEvents.filter(e => e.type === "stationary_end").length}`,
        "Coordinate privacy: latitude/longitude are intentionally masked; only the first 3 and last 4 decimal digits are retained (xx.xxx1234).",
        "DISPLAY = last accepted GPS sample. RAW = every received GPS sample, including rejected samples.",
        "",
        "STATIONARY DIAGNOSTICS",
        "event\ttime\tlabel\tduration_s\tsamples\taccepted\trejected\tmin_step_m\tavg_step_m\tmax_step_m\tnet_m\tmax_from_center_m\tavg_accuracy_m\tmin_accuracy_m\tmax_accuracy_m"
    ];

    PozitiaMeaV2._logEvents.forEach(event => {
        if (event.type === "stationary_start") {
            lines.push([
                event.type, event.time, event.label, event.durationS,
                "", "", "", "", "", "", "", "", "", "", ""
            ].join("\t"));
        } else {
            const num = value => Number.isFinite(value) ? value.toFixed(3) : "";
            lines.push([
                event.type, event.time, event.label, event.durationS,
                event.samples, event.accepted, event.rejected,
                num(event.minStepM), num(event.avgStepM), num(event.maxStepM),
                num(event.netM), num(event.maxFromCenterM), num(event.avgAccuracyM),
                num(event.minAccuracyM), num(event.maxAccuracyM)
            ].join("\t"));
        }
    });

    lines.push("", "RAW GPS SAMPLES", "n\ttime\tlat_masked\tlng_masked\taccuracy_m\tinterval_s\tdistance_from_previous_raw_m\taccepted\treason");

    PozitiaMeaV2._logRows.forEach(row => {
        const num = value => Number.isFinite(value) ? value.toFixed(3) : "";
        lines.push([
            row.n, row.time, row.lat, row.lng, num(row.accuracyM),
            num(row.intervalS), num(row.distanceM), row.accepted ? "YES" : "NO", row.reason
        ].join("\t"));
    });

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${PozitiaMeaV2._logSessionId || "GPSV2-log"}-PATCH03.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    PozitiaMeaV2._lastReason = "log salvat";
    PozitiaMeaV2._updateTelemetry();
    return true;
};

PozitiaMeaV2._updateLogButtons = function () {
    const start = PozitiaMeaV2._getEl("btn-gps-v2-log-start");
    const stop = PozitiaMeaV2._getEl("btn-gps-v2-log-stop");
    if (start) start.disabled = PozitiaMeaV2._logging || !PozitiaMeaV2._active;
    if (stop) stop.disabled = !PozitiaMeaV2._logging;
};

PozitiaMeaV2.Start = function () {
    if (PozitiaMeaV2._active) return true;
    if (!navigator.geolocation) {
        PozitiaMeaV2._lastReason = "browser fără geolocație";
        PozitiaMeaV2._updateTelemetry();
        return false;
    }
    if (!PozitiaMeaV2._ensureVisuals()) {
        PozitiaMeaV2._lastReason = "harta nu este disponibilă";
        PozitiaMeaV2._updateTelemetry();
        return false;
    }

    PozitiaMeaV2._active = true;
    PozitiaMeaV2._lastAccepted = null;
    PozitiaMeaV2._lastRaw = null;
    PozitiaMeaV2._sampleTimes = [];
    PozitiaMeaV2._totalSamples = 0;
    PozitiaMeaV2._acceptedSamples = 0;
    PozitiaMeaV2._rejectedSamples = 0;
    PozitiaMeaV2._lastJumpDistanceM = null;
    PozitiaMeaV2._lastSampleIntervalS = null;
    PozitiaMeaV2._lastAccuracyM = null;
    PozitiaMeaV2._logging = false;
    PozitiaMeaV2._logRows = [];
    PozitiaMeaV2._logEvents = [];
    PozitiaMeaV2._logStartedAt = null;
    PozitiaMeaV2._logSessionId = null;
    PozitiaMeaV2._stationary = null;
    PozitiaMeaV2._lastStationaryResult = null;
    PozitiaMeaV2._clearTrail();
    PozitiaMeaV2._lastReason = "așteaptă primul sample…";

    PozitiaMeaV2._updateButton();
    PozitiaMeaV2._updateLogButtons();
    PozitiaMeaV2._updateStationaryButtons();
    PozitiaMeaV2._updateTelemetry();

    PozitiaMeaV2._watchId = navigator.geolocation.watchPosition(
        PozitiaMeaV2._handlePosition,
        PozitiaMeaV2._handleError,
        {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0
        }
    );

    return true;
};

PozitiaMeaV2.Stop = function () {
    if (PozitiaMeaV2._stationary) PozitiaMeaV2.StopStationary();
    if (PozitiaMeaV2._watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(PozitiaMeaV2._watchId);
    }

    PozitiaMeaV2._watchId = null;
    PozitiaMeaV2._active = false;
    PozitiaMeaV2._logging = false;
    PozitiaMeaV2._lastReason = "oprit";
    PozitiaMeaV2._updateButton();
    PozitiaMeaV2._updateLogButtons();
    PozitiaMeaV2._updateStationaryButtons();
    PozitiaMeaV2._updateTelemetry();
    PozitiaMeaV2._cleanupLayers();
    return true;
};

PozitiaMeaV2.Toggle = function () {
    return PozitiaMeaV2._active ? PozitiaMeaV2.Stop() : PozitiaMeaV2.Start();
};

PozitiaMeaV2.Init = function () {
    if (typeof map === "undefined" || !map) return;
    map.on("zoomend", PozitiaMeaV2._updateMarkerPixelRadius);
    map.on("resize", PozitiaMeaV2._updateMarkerPixelRadius);
    PozitiaMeaV2._updateButton();
    PozitiaMeaV2._updateLogButtons();
    PozitiaMeaV2._updateStationaryButtons();
    PozitiaMeaV2._updateTelemetry();
};

window.addEventListener("load", () => PozitiaMeaV2.Init());
