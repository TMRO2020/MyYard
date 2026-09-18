/* =========================================================
   PERMA ENGINE — Module: Poziția mea
   Etapa 15A-2B: poziție GPS live + integrare cu Navigation.

   Folosește exclusiv Geolocation API / GPS.
   Poziția live nu se persistă în proiect.
   ========================================================= */
Core.Modules.PozitiaMea = Core.Modules.PozitiaMea || {};

const PozitiaMea = Core.Modules.PozitiaMea;

PozitiaMea._watchId = null;
PozitiaMea._marker = null;
PozitiaMea._accuracyCircle = null;
PozitiaMea._active = false;
PozitiaMea._hasCentered = false;
PozitiaMea._lastPosition = null;
PozitiaMea._navigationSuspended = false;
PozitiaMea._navigationRestoreActive = false;
PozitiaMea._navigationRestoreVisible = false;
PozitiaMea._visible = false;
PozitiaMea._listeners = [];
PozitiaMea._calibrationActive = false;
PozitiaMea._calibrationComplete = false;
PozitiaMea._calibrationStartedAt = 0;
PozitiaMea._calibrationTimerId = null;
PozitiaMea._calibrationSamples = [];
PozitiaMea._calibrationCenter = null;
PozitiaMea._calibrationRadius = 0;
PozitiaMea._calibrationLastValid = null;
PozitiaMea._calibrationSeconds = 10;
PozitiaMea._lastValidGps = null;
PozitiaMea._estimatedSpeedMps = 0;
PozitiaMea._stationaryLocked = false;
PozitiaMea._acceptedCount = 0;
PozitiaMea._rejectedCount = 0;
PozitiaMea._movementCandidates = [];
PozitiaMea._movementRequired = 3;

PozitiaMea.IsActive = function () {
    return PozitiaMea._active;
};

PozitiaMea.IsVisible = function () {
    return PozitiaMea._visible;
};

PozitiaMea.Subscribe = function (onPosition, onError) {
    const listener = {
        onPosition: typeof onPosition === "function" ? onPosition : null,
        onError: typeof onError === "function" ? onError : null
    };
    PozitiaMea._listeners.push(listener);
    return function () {
        const index = PozitiaMea._listeners.indexOf(listener);
        if (index >= 0) PozitiaMea._listeners.splice(index, 1);
    };
};

PozitiaMea.GetLastPosition = function () {
    return PozitiaMea._lastPosition ? { ...PozitiaMea._lastPosition } : null;
};
PozitiaMea.GetCalibrationState = function () {
    const elapsed = PozitiaMea._calibrationActive && PozitiaMea._calibrationStartedAt
        ? Math.max(0, (Date.now() - PozitiaMea._calibrationStartedAt) / 1000)
        : 0;
    return {
        active: PozitiaMea._calibrationActive,
        complete: PozitiaMea._calibrationComplete,
        remainingSeconds: PozitiaMea._calibrationActive
            ? (PozitiaMea._calibrationStartedAt
                ? Math.max(0, Math.ceil(PozitiaMea._calibrationSeconds - elapsed))
                : PozitiaMea._calibrationSeconds)
            : 0,
        sampleCount: PozitiaMea._calibrationSamples.length,
        center: PozitiaMea._calibrationCenter
            ? { lat: PozitiaMea._calibrationCenter.lat, lng: PozitiaMea._calibrationCenter.lng }
            : null,
        radius: PozitiaMea._calibrationRadius
    };
};

PozitiaMea._isPlausibleLiveSample = function (sample, previous) {
    if (!previous) return true;
    const elapsed = Math.max(0.25, (sample.timestamp - previous.timestamp) / 1000);
    const distance = Core.functieGeometry.CalculateDistanceM(
        L.latLng(previous.lat, previous.lng),
        L.latLng(sample.lat, sample.lng)
    );
    if (!Number.isFinite(distance)) return false;
    return distance <= 2.0 * elapsed + 0.75;
};

PozitiaMea._getStationaryRadius = function () {
    if (!PozitiaMea._calibrationComplete) return 0;
    return Math.max(
        PozitiaMea._calibrationRadius + 0.75,
        Number.isFinite(PozitiaMea._lastPosition?.accuracy) && PozitiaMea._lastPosition.accuracy > 0
            ? PozitiaMea._lastPosition.accuracy
            : 0
    );
};

PozitiaMea._calibrationIsPlausible = function (sample) {
    const previous = PozitiaMea._calibrationLastValid;
    if (!previous) return true;
    const elapsed = Math.max(0.25, (sample.timestamp - previous.timestamp) / 1000);
    const distance = Core.functieGeometry.CalculateDistanceM(
        L.latLng(previous.lat, previous.lng),
        L.latLng(sample.lat, sample.lng)
    );
    if (!Number.isFinite(distance)) return false;
    return distance <= 2.0 * elapsed + 0.75;
};

PozitiaMea._calibrationMedian = function (values) {
    const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!clean.length) return null;
    const middle = Math.floor(clean.length / 2);
    return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
};

PozitiaMea._finishCalibration = function () {
    if (!PozitiaMea._calibrationActive) return;
    const samples = PozitiaMea._calibrationSamples.slice();
    PozitiaMea._calibrationActive = false;
    PozitiaMea._calibrationComplete = samples.length >= 3;

    if (PozitiaMea._calibrationTimerId !== null) {
        clearInterval(PozitiaMea._calibrationTimerId);
        PozitiaMea._calibrationTimerId = null;
    }

    if (!samples.length) {
        PozitiaMea._calibrationComplete = false;
        PozitiaMea._setStatus("Calibrarea GPS nu a primit suficiente date.", "error");
        return;
    }

    const centerLat = PozitiaMea._calibrationMedian(samples.map(s => s.lat));
    const centerLng = PozitiaMea._calibrationMedian(samples.map(s => s.lng));
    if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) {
        PozitiaMea._calibrationComplete = false;
        PozitiaMea._setStatus("Calibrarea GPS nu a putut calcula centrul.", "error");
        return;
    }

    PozitiaMea._calibrationCenter = L.latLng(centerLat, centerLng);
    PozitiaMea._stationaryLocked = true;
    const distances = samples.map(sample => Core.functieGeometry.CalculateDistanceM(
        PozitiaMea._calibrationCenter,
        L.latLng(sample.lat, sample.lng)
    )).filter(Number.isFinite).sort((a, b) => a - b);
    const radiusIndex = Math.min(distances.length - 1, Math.floor((distances.length - 1) * 0.9));
    PozitiaMea._calibrationRadius = distances.length ? distances[radiusIndex] : 0;

    PozitiaMea._lastPosition = {
        lat: centerLat,
        lng: centerLng,
        accuracy: Number.isFinite(PozitiaMea._lastPosition?.accuracy) ? PozitiaMea._lastPosition.accuracy : null,
        timestamp: Date.now()
    };

    PozitiaMea._setStatus(
        `GPS calibrat · ${samples.length} samples · dispersie observată ±${PozitiaMea._calibrationRadius.toFixed(1).replace(".", ",")} m`,
        "active"
    );
};

PozitiaMea._startCalibration = function () {
    if (PozitiaMea._calibrationTimerId !== null) clearInterval(PozitiaMea._calibrationTimerId);
    PozitiaMea._calibrationActive = true;
    PozitiaMea._calibrationComplete = false;
    // Cronometrăm cele 10 secunde din momentul primului fix valid, astfel
    // încât calibrarea să fie efectiv 10 secunde de date GPS.
    PozitiaMea._calibrationStartedAt = 0;
    PozitiaMea._calibrationSamples = [];
    PozitiaMea._calibrationCenter = null;
    PozitiaMea._calibrationRadius = 0;
    PozitiaMea._calibrationLastValid = null;

    const update = () => {
        const state = PozitiaMea.GetCalibrationState();
        PozitiaMea._setStatus(
            `Calibrare GPS în curs · stați pe loc · ${state.remainingSeconds}s · samples ${state.sampleCount}`,
            "pending"
        );
        if (PozitiaMea._calibrationStartedAt && state.remainingSeconds <= 0) PozitiaMea._finishCalibration();
    };
    update();
    PozitiaMea._calibrationTimerId = setInterval(update, 250);
};

PozitiaMea._setStatus = function (text, state = "") {
    const el = document.getElementById("my-location-status");
    if (!el) return;
    el.textContent = text;
    el.dataset.state = state;
};

PozitiaMea._updateButton = function () {
    const button = document.getElementById("btn-my-location");
    if (!button) return;
    button.textContent = PozitiaMea._active ? "⏹ Oprește poziția mea" : "🔵 Poziția mea";
    button.classList.toggle("primary", PozitiaMea._active);
    button.setAttribute("aria-pressed", PozitiaMea._active ? "true" : "false");
};

PozitiaMea._ensureVisuals = function () {
    if (!map) return false;

    if (!PozitiaMea._marker) {
        PozitiaMea._marker = L.marker([0, 0], {
            interactive: true,
            zIndexOffset: 2500,
            icon: L.divIcon({
                className: "my-location-marker",
                html: '<div class="my-location-pulse"></div><div class="my-location-dot"></div>',
                iconSize: [34, 34],
                iconAnchor: [17, 17]
            })
        });

        PozitiaMea._marker.bindTooltip("Poziția mea", {
            direction: "top",
            offset: [0, -16]
        });

        PozitiaMea._marker.bindPopup("<div class=\"my-location-popup\"><strong>🔵 Poziția mea</strong><div>Se determină poziția…</div></div>", {
            closeButton: true
        });
    }

    if (!PozitiaMea._accuracyCircle) {
        PozitiaMea._accuracyCircle = L.circle([0, 0], {
            radius: 0,
            stroke: true,
            weight: 1,
            fill: true,
            fillOpacity: 0.08,
            interactive: false
        });
    }

    return true;
};

PozitiaMea._showVisuals = function () {
    if (!map) return;
    if (PozitiaMea._accuracyCircle && !map.hasLayer(PozitiaMea._accuracyCircle)) PozitiaMea._accuracyCircle.addTo(map);
    if (PozitiaMea._marker && !map.hasLayer(PozitiaMea._marker)) PozitiaMea._marker.addTo(map);
};

PozitiaMea._hideVisuals = function () {
    if (!map) return;
    if (PozitiaMea._marker && map.hasLayer(PozitiaMea._marker)) map.removeLayer(PozitiaMea._marker);
    if (PozitiaMea._accuracyCircle && map.hasLayer(PozitiaMea._accuracyCircle)) map.removeLayer(PozitiaMea._accuracyCircle);
};

PozitiaMea._handlePosition = function (position) {
    if (!position?.coords || !PozitiaMea._ensureVisuals()) return;

    const lat = Number(position.coords.latitude);
    const lng = Number(position.coords.longitude);
    const accuracy = Number(position.coords.accuracy);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const timestamp = Number.isFinite(position.timestamp) ? position.timestamp : Date.now();
    const rawPosition = {
        lat,
        lng,
        accuracy: Number.isFinite(accuracy) ? accuracy : null,
        timestamp
    };

    if (PozitiaMea._calibrationActive) {
        if (PozitiaMea._calibrationIsPlausible(rawPosition)) {
            if (!PozitiaMea._calibrationStartedAt) PozitiaMea._calibrationStartedAt = Date.now();
            PozitiaMea._calibrationSamples.push(rawPosition);
            PozitiaMea._calibrationLastValid = rawPosition;
        }
        const state = PozitiaMea.GetCalibrationState();
        PozitiaMea._setStatus(
            `Calibrare GPS în curs · stați pe loc · ${state.remainingSeconds}s · samples ${state.sampleCount}`,
            "pending"
        );
        return;
    }

    const previousValid = PozitiaMea._lastValidGps;
    if (!PozitiaMea._isPlausibleLiveSample(rawPosition, previousValid)) {
        PozitiaMea._rejectedCount += 1;
        return;
    }

    PozitiaMea._acceptedCount += 1;
    let filtered = rawPosition;

    if (PozitiaMea._calibrationComplete && PozitiaMea._calibrationCenter) {
        const distanceFromCenter = Core.functieGeometry.CalculateDistanceM(
            PozitiaMea._calibrationCenter,
            L.latLng(rawPosition.lat, rawPosition.lng)
        );
        const stationaryRadius = PozitiaMea._getStationaryRadius();
        if (PozitiaMea._stationaryLocked) {
            if (distanceFromCenter <= stationaryRadius) {
                PozitiaMea._movementCandidates = [];
                filtered = {
                    lat: PozitiaMea._calibrationCenter.lat,
                    lng: PozitiaMea._calibrationCenter.lng,
                    accuracy: rawPosition.accuracy,
                    timestamp: rawPosition.timestamp
                };
            } else {
                let plausibleMovement = true;
                if (previousValid) {
                    const elapsed = Math.max(0.25, (rawPosition.timestamp - previousValid.timestamp) / 1000);
                    const distance = Core.functieGeometry.CalculateDistanceM(
                        L.latLng(previousValid.lat, previousValid.lng),
                        L.latLng(rawPosition.lat, rawPosition.lng)
                    );
                    const speed = Number.isFinite(distance) ? distance / elapsed : Infinity;
                    PozitiaMea._estimatedSpeedMps = Number.isFinite(speed) ? speed : 0;
                    plausibleMovement = speed <= 2.0;
                }

                if (plausibleMovement) {
                    PozitiaMea._movementCandidates.push(rawPosition);
                    if (PozitiaMea._movementCandidates.length > PozitiaMea._movementRequired) {
                        PozitiaMea._movementCandidates.shift();
                    }
                } else {
                    PozitiaMea._movementCandidates = [];
                }

                if (PozitiaMea._movementCandidates.length >= PozitiaMea._movementRequired) {
                    PozitiaMea._stationaryLocked = false;
                    filtered = rawPosition;
                    PozitiaMea._movementCandidates = [];
                } else {
                    filtered = {
                        lat: PozitiaMea._calibrationCenter.lat,
                        lng: PozitiaMea._calibrationCenter.lng,
                        accuracy: rawPosition.accuracy,
                        timestamp: rawPosition.timestamp
                    };
                }
            }
        } else if (previousValid) {
            const elapsed = Math.max(0.25, (rawPosition.timestamp - previousValid.timestamp) / 1000);
            const distance = Core.functieGeometry.CalculateDistanceM(
                L.latLng(previousValid.lat, previousValid.lng),
                L.latLng(rawPosition.lat, rawPosition.lng)
            );
            PozitiaMea._estimatedSpeedMps = Number.isFinite(distance) ? distance / elapsed : 0;
        }
    }

    PozitiaMea._lastValidGps = rawPosition;
    PozitiaMea._lastPosition = filtered;

    const latlng = L.latLng(filtered.lat, filtered.lng);
    PozitiaMea._marker.setLatLng(latlng);
    PozitiaMea._accuracyCircle.setLatLng(latlng);
    PozitiaMea._accuracyCircle.setRadius(Number.isFinite(accuracy) && accuracy > 0 ? accuracy : 0);

    // Navigation are propria poziție stabilizată. Nu afișăm două poziții simultan.
    if (!PozitiaMea._navigationSuspended && PozitiaMea._visible) {
        PozitiaMea._showVisuals();
    }

    const accuracyText = Number.isFinite(accuracy)
        ? `Precizie GPS: ±${accuracy.toFixed(1).replace(".", ",")} m`
        : "Precizia GPS nu este disponibilă";

    PozitiaMea._marker.setPopupContent(
        `<div class="my-location-popup"><strong>🔵 Poziția mea</strong><div>Lat ${filtered.lat.toFixed(7)}</div><div>Lng ${filtered.lng.toFixed(7)}</div><div>${accuracyText}</div></div>`
    );

    PozitiaMea._setStatus(`Poziție GPS activă · ${accuracyText}`, "active");

    const latInput = document.getElementById("lat-input");
    const lngInput = document.getElementById("lng-input");
    if (latInput) latInput.value = filtered.lat.toFixed(7);
    if (lngInput) lngInput.value = filtered.lng.toFixed(7);

    if (!PozitiaMea._hasCentered && !PozitiaMea._navigationSuspended) {
        PozitiaMea._hasCentered = true;
        map.setView(latlng, Math.max(19, map.getZoom()));
    }

    if (typeof updateDesktopStatus === "function") updateDesktopStatus(latlng);
    if (typeof updateMicroclimateLayers === "function") updateMicroclimateLayers();

    PozitiaMea._listeners.slice().forEach(listener => {
        try {
            if (listener.onPosition) listener.onPosition(position);
        } catch (_) {}
    });
};

PozitiaMea._handleError = function (error) {
    if (!PozitiaMea._navigationSuspended) {
        const message = error?.code === 1
            ? "Accesul la locație a fost refuzat."
            : error?.code === 2
                ? "Poziția GPS nu este disponibilă."
                : error?.code === 3
                    ? "Determinarea poziției GPS a expirat."
                    : "Nu s-a putut determina poziția GPS.";
        PozitiaMea._setStatus(message, "error");
    }

    PozitiaMea._listeners.slice().forEach(listener => {
        try {
            if (listener.onError) listener.onError(error);
        } catch (_) {}
    });
};

PozitiaMea.Start = function () {
    if (PozitiaMea._active) return true;
    if (!navigator.geolocation) {
        PozitiaMea._setStatus("Acest browser nu oferă geolocație.", "error");
        return false;
    }

    if (!PozitiaMea._ensureVisuals()) {
        PozitiaMea._setStatus("Harta nu este disponibilă.", "error");
        return false;
    }

    PozitiaMea._active = true;
    PozitiaMea._visible = true;
    PozitiaMea._hasCentered = false;
    PozitiaMea._lastPosition = null;
    PozitiaMea._lastValidGps = null;
    PozitiaMea._estimatedSpeedMps = 0;
    PozitiaMea._stationaryLocked = false;
    PozitiaMea._acceptedCount = 0;
    PozitiaMea._rejectedCount = 0;
    PozitiaMea._movementCandidates = [];
    PozitiaMea._calibrationActive = false;
    PozitiaMea._calibrationComplete = false;
    PozitiaMea._calibrationSamples = [];
    PozitiaMea._calibrationCenter = null;
    PozitiaMea._calibrationRadius = 0;
    PozitiaMea._setStatus("Se determină poziția GPS…", "pending");
    PozitiaMea._updateButton();

    PozitiaMea._watchId = navigator.geolocation.watchPosition(
        PozitiaMea._handlePosition,
        PozitiaMea._handleError,
        {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0
        }
    );

    PozitiaMea._startCalibration();
    return true;
};

PozitiaMea.Stop = function () {
    if (PozitiaMea._watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(PozitiaMea._watchId);
    }

    PozitiaMea._watchId = null;
    PozitiaMea._active = false;
    PozitiaMea._visible = false;
    PozitiaMea._hasCentered = false;
    PozitiaMea._navigationSuspended = false;
    PozitiaMea._navigationRestoreActive = false;
    PozitiaMea._navigationRestoreVisible = false;
    if (PozitiaMea._calibrationTimerId !== null) clearInterval(PozitiaMea._calibrationTimerId);
    PozitiaMea._calibrationTimerId = null;
    PozitiaMea._calibrationActive = false;
    PozitiaMea._calibrationComplete = false;
    PozitiaMea._calibrationSamples = [];
    PozitiaMea._calibrationCenter = null;
    PozitiaMea._calibrationRadius = 0;
    PozitiaMea._calibrationLastValid = null;
    PozitiaMea._lastValidGps = null;
    PozitiaMea._estimatedSpeedMps = 0;
    PozitiaMea._stationaryLocked = false;
    PozitiaMea._acceptedCount = 0;
    PozitiaMea._rejectedCount = 0;
    PozitiaMea._movementCandidates = [];
    PozitiaMea._setStatus("Poziția mea nu este activă.");
    PozitiaMea._updateButton();
    PozitiaMea._hideVisuals();

    return true;
};

PozitiaMea.Toggle = function () {
    return PozitiaMea._active ? PozitiaMea.ToggleVisibility() : PozitiaMea.Start();
};

PozitiaMea.ToggleVisibility = function () {
    if (!PozitiaMea._active) return PozitiaMea.Start();

    PozitiaMea._visible = !PozitiaMea._visible;
    if (PozitiaMea._visible && PozitiaMea._lastPosition) {
        PozitiaMea._showVisuals();
    } else if (!PozitiaMea._visible) {
        PozitiaMea._hideVisuals();
    }
    PozitiaMea._updateButton();
    return PozitiaMea._visible;
};

/*
 * Navigation suspendă doar afișarea vizuală a poziției mele.
 * Watch-ul GPS rămâne activ, astfel încât receptorul/browserul poate continua
 * să primească poziții și să-și îmbunătățească fix-ul în timp.
 */
PozitiaMea.SuspendForNavigation = function () {
    if (PozitiaMea._navigationSuspended) return;

    PozitiaMea._navigationSuspended = true;
    PozitiaMea._navigationRestoreActive = PozitiaMea._active;
    PozitiaMea._navigationRestoreVisible = PozitiaMea._visible;
    PozitiaMea._hideVisuals();
};

PozitiaMea.RestoreAfterNavigation = function () {
    if (!PozitiaMea._navigationSuspended) return;

    const restoreActive = PozitiaMea._navigationRestoreActive;
    const restoreVisible = PozitiaMea._navigationRestoreVisible;
    PozitiaMea._navigationSuspended = false;
    PozitiaMea._navigationRestoreActive = false;
    PozitiaMea._navigationRestoreVisible = false;

    if (restoreActive && PozitiaMea._active) {
        PozitiaMea._visible = restoreVisible;
        if (restoreVisible && PozitiaMea._lastPosition) PozitiaMea._showVisuals();
        PozitiaMea._updateButton();
    }
};
