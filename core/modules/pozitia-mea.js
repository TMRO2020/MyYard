/* =========================================================
   PERMA ENGINE — Module: Poziția mea
   Etapa 15A-2: poziție GPS live pe hartă.

   Folosește exclusiv Geolocation API / GPS.
   Nu persistă poziția curentă în proiect și nu modifică Navigation.
   ========================================================= */
Core.Modules.PozitiaMea = Core.Modules.PozitiaMea || {};

const PozitiaMea = Core.Modules.PozitiaMea;

PozitiaMea._watchId = null;
PozitiaMea._marker = null;
PozitiaMea._accuracyCircle = null;
PozitiaMea._active = false;
PozitiaMea._hasCentered = false;
PozitiaMea._lastPosition = null;

PozitiaMea.IsActive = function () {
    return PozitiaMea._active;
};

PozitiaMea.GetLastPosition = function () {
    return PozitiaMea._lastPosition ? { ...PozitiaMea._lastPosition } : null;
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

PozitiaMea._handlePosition = function (position) {
    if (!position?.coords || !PozitiaMea._ensureVisuals()) return;

    const lat = Number(position.coords.latitude);
    const lng = Number(position.coords.longitude);
    const accuracy = Number(position.coords.accuracy);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    PozitiaMea._lastPosition = {
        lat,
        lng,
        accuracy: Number.isFinite(accuracy) ? accuracy : null,
        timestamp: Number.isFinite(position.timestamp) ? position.timestamp : Date.now()
    };

    const latlng = L.latLng(lat, lng);
    PozitiaMea._marker.setLatLng(latlng);
    PozitiaMea._accuracyCircle.setLatLng(latlng);
    PozitiaMea._accuracyCircle.setRadius(Number.isFinite(accuracy) && accuracy > 0 ? accuracy : 0);

    if (!map.hasLayer(PozitiaMea._accuracyCircle)) PozitiaMea._accuracyCircle.addTo(map);
    if (!map.hasLayer(PozitiaMea._marker)) PozitiaMea._marker.addTo(map);

    const accuracyText = Number.isFinite(accuracy)
        ? `Precizie GPS: ±${accuracy.toFixed(1).replace(".", ",")} m`
        : "Precizia GPS nu este disponibilă";

    PozitiaMea._marker.setPopupContent(
        `<div class="my-location-popup"><strong>🔵 Poziția mea</strong><div>Lat ${lat.toFixed(7)}</div><div>Lng ${lng.toFixed(7)}</div><div>${accuracyText}</div></div>`
    );

    PozitiaMea._setStatus(`Poziție GPS activă · ${accuracyText}`, "active");

    const latInput = document.getElementById("lat-input");
    const lngInput = document.getElementById("lng-input");
    if (latInput) latInput.value = lat.toFixed(7);
    if (lngInput) lngInput.value = lng.toFixed(7);

    if (!PozitiaMea._hasCentered) {
        PozitiaMea._hasCentered = true;
        map.setView(latlng, Math.max(19, map.getZoom()));
    }

    if (typeof updateDesktopStatus === "function") updateDesktopStatus(latlng);
    if (typeof updateMicroclimateLayers === "function") updateMicroclimateLayers();
};

PozitiaMea._handleError = function (error) {
    const message = error?.code === 1
        ? "Accesul la locație a fost refuzat."
        : error?.code === 2
            ? "Poziția GPS nu este disponibilă."
            : error?.code === 3
                ? "Determinarea poziției GPS a expirat."
                : "Nu s-a putut determina poziția GPS.";

    PozitiaMea._setStatus(message, "error");
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
    PozitiaMea._hasCentered = false;
    PozitiaMea._lastPosition = null;
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

    return true;
};

PozitiaMea.Stop = function () {
    if (PozitiaMea._watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(PozitiaMea._watchId);
    }

    PozitiaMea._watchId = null;
    PozitiaMea._active = false;
    PozitiaMea._hasCentered = false;
    PozitiaMea._setStatus("Poziția mea nu este activă.");
    PozitiaMea._updateButton();

    if (map) {
        if (PozitiaMea._marker && map.hasLayer(PozitiaMea._marker)) map.removeLayer(PozitiaMea._marker);
        if (PozitiaMea._accuracyCircle && map.hasLayer(PozitiaMea._accuracyCircle)) map.removeLayer(PozitiaMea._accuracyCircle);
    }

    return true;
};

PozitiaMea.Toggle = function () {
    return PozitiaMea._active ? PozitiaMea.Stop() : PozitiaMea.Start();
};
