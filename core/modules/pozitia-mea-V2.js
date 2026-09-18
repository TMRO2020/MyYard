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
PozitiaMeaV2._MARKER_RADIUS_METERS = 0.20;

PozitiaMeaV2.IsActive = function () {
    return PozitiaMeaV2._active;
};

PozitiaMeaV2._getEl = function (id) {
    return document.getElementById(id);
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
        PozitiaMeaV2._setText("gps-v2-lat", PozitiaMeaV2._format(PozitiaMeaV2._lastAccepted.lat, 7));
        PozitiaMeaV2._setText("gps-v2-lng", PozitiaMeaV2._format(PozitiaMeaV2._lastAccepted.lng, 7));
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

    if (PozitiaMeaV2._lastRaw) {
        const elapsedS = Math.max(0.001, (raw.timestamp - PozitiaMeaV2._lastRaw.timestamp) / 1000);
        const distanceM = Core.functieGeometry.CalculateDistanceM(
            L.latLng(PozitiaMeaV2._lastRaw.lat, PozitiaMeaV2._lastRaw.lng),
            L.latLng(raw.lat, raw.lng)
        );

        PozitiaMeaV2._lastSampleIntervalS = elapsedS;
        PozitiaMeaV2._lastJumpDistanceM = Number.isFinite(distanceM) ? distanceM : null;

        // Regula experimentală simplă: un salt mai mare de 20 m între două
        // sample-uri consecutive este tratat ca teleportare GPS și nu mută harta.
        if (!Number.isFinite(distanceM) || distanceM > PozitiaMeaV2._MAX_JUMP_METERS) {
            PozitiaMeaV2._rejectedSamples += 1;
            PozitiaMeaV2._lastReason = `respins · salt > ${PozitiaMeaV2._MAX_JUMP_METERS} m`;
            // Păstrăm ultimul sample acceptat ca reper pentru următoarea comparație.
            // Astfel, un singur spike GPS nu poate declanșa o cascadă de respingeri.
            PozitiaMeaV2._updateTelemetry();
            return;
        }
    }

    PozitiaMeaV2._acceptedSamples += 1;
    PozitiaMeaV2._lastAccepted = raw;
    PozitiaMeaV2._lastRaw = raw;
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
        `<div class="my-location-popup"><strong>🔵 Poziția mea V2</strong><div>Lat ${raw.lat.toFixed(7)}</div><div>Lng ${raw.lng.toFixed(7)}</div><div>${accuracyText}</div></div>`
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
    PozitiaMeaV2._lastReason = "așteaptă primul sample…";
    PozitiaMeaV2._updateButton();
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
    PozitiaMeaV2._lastReason = "oprit";
    PozitiaMeaV2._updateButton();
    PozitiaMeaV2._updateTelemetry();
    PozitiaMeaV2._cleanupLayers();
    return true;
};

PozitiaMeaV2.Toggle = function () {
    return PozitiaMeaV2._active ? PozitiaMeaV2.Stop() : PozitiaMeaV2.Start();
};

PozitiaMeaV2.Init = function () {
    if (!map) return;
    map.on("zoomend", PozitiaMeaV2._updateMarkerPixelRadius);
    map.on("resize", PozitiaMeaV2._updateMarkerPixelRadius);
    PozitiaMeaV2._updateButton();
    PozitiaMeaV2._updateTelemetry();
};
