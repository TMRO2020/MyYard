/* =========================================================
   PERMA ENGINE — Module: Poziția mea V2 — experimental
   Nou motor izolat pentru testarea poziției GPS live.

   IMPORTANT:
   - Nu modifică și nu înlocuiește Core.Modules.PozitiaMea.
   - Primește toate sample-urile GPS pentru telemetrie.
   - Respinge salturile imposibile între două sample-uri consecutive.
   - Markerul albastru are o rază geometrică de 0,20 m pe teren.
   - Cercul de precizie folosește direct accuracy raportată de browser.
   ========================================================= */
Core.Modules.PozitiaMeaV2 = Core.Modules.PozitiaMeaV2 || {};

const PozitiaMeaV2 = Core.Modules.PozitiaMeaV2;

PozitiaMeaV2._watchId = null;
PozitiaMeaV2._active = false;
PozitiaMeaV2._marker = null;
PozitiaMeaV2._accuracyCircle = null;
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
PozitiaMeaV2._lastUpdateAt = 0;
PozitiaMeaV2._MAX_JUMP_METERS = 20;
PozitiaMeaV2._MARKER_RADIUS_METERS = 0.35;
PozitiaMeaV2._logging = false;
PozitiaMeaV2._logRows = [];
PozitiaMeaV2._logStartedAt = null;
PozitiaMeaV2._logSessionId = null;

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

PozitiaMeaV2._cleanupLayers = function () {
    if (!map) return;
    if (PozitiaMeaV2._marker && map.hasLayer(PozitiaMeaV2._marker)) map.removeLayer(PozitiaMeaV2._marker);
    if (PozitiaMeaV2._accuracyCircle && map.hasLayer(PozitiaMeaV2._accuracyCircle)) map.removeLayer(PozitiaMeaV2._accuracyCircle);
};

PozitiaMeaV2._ensureVisuals = function () {
    if (!map) return false;

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
        PozitiaMeaV2._marker.bindTooltip("Poziția mea V2", {
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

    PozitiaMeaV2._marker.setRadius(radiusPx);
};

PozitiaMeaV2._showLayers = function () {
    if (!map) return;
    if (PozitiaMeaV2._accuracyCircle && !map.hasLayer(PozitiaMeaV2._accuracyCircle)) {
        PozitiaMeaV2._accuracyCircle.addTo(map);
    }
    if (PozitiaMeaV2._marker && !map.hasLayer(PozitiaMeaV2._marker)) {
        PozitiaMeaV2._marker.addTo(map);
    }
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

PozitiaMeaV2._updateTelemetry = function () {
    const now = Date.now();
    PozitiaMeaV2._sampleTimes = PozitiaMeaV2._sampleTimes.filter(t => now - t <= 1000);

    PozitiaMeaV2._setText("gps-v2-state", PozitiaMeaV2._active ? "ACTIV" : "OPRIT");
    PozitiaMeaV2._setText("gps-v2-samples-sec", String(PozitiaMeaV2._sampleTimes.length));
    PozitiaMeaV2._setText("gps-v2-total", String(PozitiaMeaV2._totalSamples));
    PozitiaMeaV2._setText("gps-v2-accepted", String(PozitiaMeaV2._acceptedSamples));
    PozitiaMeaV2._setText("gps-v2-rejected", String(PozitiaMeaV2._rejectedSamples));
    PozitiaMeaV2._setText("gps-v2-accuracy", `±${PozitiaMeaV2._format(PozitiaMeaV2._lastAccuracyM)} m`);
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
    PozitiaMeaV2._lastReason = "acceptat";

    let elapsedS = null;
    let distanceM = null;
    let accepted = true;
    let reason = "acceptat";

    if (PozitiaMeaV2._lastRaw) {
        elapsedS = Math.max(0.001, (raw.timestamp - PozitiaMeaV2._lastRaw.timestamp) / 1000);
        distanceM = Core.functieGeometry.CalculateDistanceM(
            L.latLng(PozitiaMeaV2._lastRaw.lat, PozitiaMeaV2._lastRaw.lng),
            L.latLng(raw.lat, raw.lng)
        );

        PozitiaMeaV2._lastSampleIntervalS = elapsedS;
        PozitiaMeaV2._lastJumpDistanceM = Number.isFinite(distanceM) ? distanceM : null;

        // Comparație între sample-uri GPS consecutive. Un salt >20 m este
        // respins doar pentru afișarea poziției, dar rămâne în log.
        if (!Number.isFinite(distanceM) || distanceM > PozitiaMeaV2._MAX_JUMP_METERS) {
            accepted = false;
            reason = `respins · salt > ${PozitiaMeaV2._MAX_JUMP_METERS} m`;
            PozitiaMeaV2._rejectedSamples += 1;
        }
    }

    if (PozitiaMeaV2._logging) {
        const now = new Date();
        PozitiaMeaV2._logRows.push({
            n: PozitiaMeaV2._totalSamples,
            time: now.toISOString(),
            lat: PozitiaMeaV2._maskCoordinate(raw.lat),
            lng: PozitiaMeaV2._maskCoordinate(raw.lng),
            accuracyM: raw.accuracy,
            intervalS: elapsedS,
            distanceM,
            accepted,
            reason
        });
    }

    // Ultimul sample RAW este întotdeauna reperul pentru următorul sample.
    // Astfel logul și filtrul descriu exact mișcarea raportată de GPS,
    // nu o comparație între sample-uri vechi și ultimul fix acceptat.
    PozitiaMeaV2._lastRaw = raw;

    if (!accepted) {
        PozitiaMeaV2._lastReason = reason;
        PozitiaMeaV2._updateTelemetry();
        return;
    }

    PozitiaMeaV2._acceptedSamples += 1;
    PozitiaMeaV2._lastAccepted = raw;
    PozitiaMeaV2._lastUpdateAt = Date.now();

    const latlng = L.latLng(raw.lat, raw.lng);
    PozitiaMeaV2._marker.setLatLng(latlng);
    PozitiaMeaV2._accuracyCircle.setLatLng(latlng);
    PozitiaMeaV2._accuracyCircle.setRadius(
        Number.isFinite(raw.accuracy) && raw.accuracy > 0 ? raw.accuracy : 0
    );
    PozitiaMeaV2._updateMarkerPixelRadius();
    PozitiaMeaV2._showLayers();

    const accuracyText = Number.isFinite(raw.accuracy)
        ? `Precizie raportată: ±${PozitiaMeaV2._format(raw.accuracy)} m`
        : "Precizia raportată nu este disponibilă";

    PozitiaMeaV2._marker.setPopupContent(
        `<div class="my-location-popup"><strong>🔵 Poziția mea V2</strong><div>Lat ${PozitiaMeaV2._maskCoordinate(raw.lat)}</div><div>Lng ${PozitiaMeaV2._maskCoordinate(raw.lng)}</div><div>${accuracyText}</div></div>`
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
    PozitiaMeaV2._logStartedAt = null;
    PozitiaMeaV2._logSessionId = null;
    PozitiaMeaV2._lastReason = "log gol";
    PozitiaMeaV2._updateLogButtons();
    PozitiaMeaV2._updateTelemetry();
    return true;
};

PozitiaMeaV2.SaveLog = function () {
    if (!PozitiaMeaV2._logRows.length) {
        PozitiaMeaV2._lastReason = "nu există date de salvat";
        PozitiaMeaV2._updateTelemetry();
        return false;
    }

    const endedAt = new Date();
    const lines = [
        "PERMA ENGINE — GPS V2 DIAGNOSTIC LOG",
        `Session: ${PozitiaMeaV2._logSessionId || "GPSV2-unknown"}`,
        `Started: ${PozitiaMeaV2._logStartedAt ? PozitiaMeaV2._logStartedAt.toISOString() : "unknown"}`,
        `Saved: ${endedAt.toISOString()}`,
        `Samples logged: ${PozitiaMeaV2._logRows.length}`,
        "Coordinate privacy: latitude/longitude are intentionally masked; only the first 3 and last 4 decimal digits are retained (xx.xxx1234).",
        "",
        "n\ttime\tlat_masked\tlng_masked\taccuracy_m\tinterval_s\tdistance_from_previous_raw_m\taccepted\treason"
    ];

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
    a.download = `${PozitiaMeaV2._logSessionId || "GPSV2-log"}.txt`;
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
    PozitiaMeaV2._logStartedAt = null;
    PozitiaMeaV2._logSessionId = null;
    PozitiaMeaV2._lastReason = "așteaptă primul sample…";
    PozitiaMeaV2._updateButton();
    PozitiaMeaV2._updateLogButtons();
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

    // Straturile sunt afișate abia după primul fix acceptat; nu desenăm accidental
    // markerul inițial la coordonatele [0, 0].
    return true;
};

PozitiaMeaV2.Stop = function () {
    if (PozitiaMeaV2._watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(PozitiaMeaV2._watchId);
    }

    PozitiaMeaV2._watchId = null;
    PozitiaMeaV2._active = false;
    PozitiaMeaV2._logging = false;
    PozitiaMeaV2._lastReason = "oprit";
    PozitiaMeaV2._updateButton();
    PozitiaMeaV2._updateLogButtons();
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
    PozitiaMeaV2._updateTelemetry();
};

// app.js creează harta înainte de evenimentul load; inițializăm aici fără
// să modificăm aplicația principală.
window.addEventListener("load", () => PozitiaMeaV2.Init());
