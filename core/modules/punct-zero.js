/* PERMA ENGINE — Module: Punct 0
   Etapa 15A-1: origine GPS a sistemului local X/Y.

   Păstrează coordonatele GPS și precizia raportată de dispozitiv.
   Nu modifică mecanismul GPS existent; folosește API-ul Core.functieGPS.
*/
Core.Modules.Punct0 = Core.Modules.Punct0 || {};

const Punct0 = Core.Modules.Punct0;

Punct0._data = null;
Punct0._marker = null;
Punct0._manualPlacement = false;

Punct0._normalize = function (data) {
    if (!data || !Number.isFinite(data.lat) || !Number.isFinite(data.lng)) return null;

    const normalized = {
        lat: Number(data.lat),
        lng: Number(data.lng),
        positionSource: data.positionSource === "manual" ? "manual" : "gps"
    };

    if (Number.isFinite(data.accuracy)) normalized.accuracy = Number(data.accuracy);
    if (Number.isFinite(data.altitude)) normalized.altitude = Number(data.altitude);
    if (Number.isFinite(data.altitudeAccuracy)) normalized.altitudeAccuracy = Number(data.altitudeAccuracy);
    if (Number.isFinite(data.heading)) normalized.heading = Number(data.heading);
    if (Number.isFinite(data.speed)) normalized.speed = Number(data.speed);
    if (Number.isFinite(data.timestamp)) normalized.timestamp = Number(data.timestamp);

    return normalized;
};

Punct0.Get = function () {
    return Punct0._data ? { ...Punct0._data } : null;
};

Punct0.GetMarker = function () {
    return Punct0._marker;
};

Punct0.GetOrigin = function () {
    const data = Punct0._data;
    return data ? L.latLng(data.lat, data.lng) : null;
};

Punct0.IsSet = function () {
    return !!Punct0._data;
};

Punct0._renderMarker = function () {
    if (!map) return;

    if (Punct0._marker) {
        map.removeLayer(Punct0._marker);
        Punct0._marker = null;
Punct0._manualPlacement = false;
    }

    const origin = Punct0.GetOrigin();
    if (!origin) return;

    const accuracy = Number.isFinite(Punct0._data?.accuracy) ? Punct0._data.accuracy : null;
    const accuracyText = accuracy !== null ? `Precizie GPS: ±${accuracy.toFixed(1).replace(".", ",")} m` : "Precizia GPS nu este disponibilă";

    Punct0._marker = L.marker(origin, {
        draggable: true,
        interactive: true,
        zIndexOffset: 3000,
        icon: L.divIcon({
            className: "project-origin-marker",
            html: `<div class="project-origin-cross"><span></span><i></i></div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14]
        })
    }).addTo(map);

    Punct0._marker.on("dragend", event => {
        const latlng = event.target.getLatLng();
        Punct0.SetManualPosition(latlng);
        if (typeof window.updatePunctZeroDependentGeometry === "function") window.updatePunctZeroDependentGeometry();
    });

    Punct0._marker.bindTooltip(`Punct 0 · X 0,00 m · Y 0,00 m<br>${accuracyText}`, {
        direction: "top",
        offset: [0, -10],
        className: "project-origin-tooltip"
    });
};

Punct0.SetFromPosition = function (position) {
    if (!position?.coords) return null;

    const data = Punct0._normalize({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        altitude: position.coords.altitude,
        altitudeAccuracy: position.coords.altitudeAccuracy,
        heading: position.coords.heading,
        speed: position.coords.speed,
        timestamp: Number.isFinite(position.timestamp) ? position.timestamp : Date.now()
    });

    if (!data) return null;

    data.positionSource = "gps";
    Punct0._data = data;
    Punct0._manualPlacement = false;
    Punct0._renderMarker();
    Punct0.UpdateStatus();
    return Punct0.Get();
};

Punct0.Set = function (data) {
    const normalized = Punct0._normalize(data);
    if (!normalized) return null;

    Punct0._data = normalized;
    Punct0._manualPlacement = normalized.positionSource === "manual";
    Punct0._renderMarker();
    Punct0.UpdateStatus();
    return Punct0.Get();
};

Punct0.SetManualPosition = function (latlng) {
    if (!latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) return null;

    const current = Punct0._data || {};
    Punct0._data = Punct0._normalize({
        ...current,
        lat: latlng.lat,
        lng: latlng.lng,
        positionSource: "manual"
    });
    Punct0._manualPlacement = true;
    Punct0._renderMarker();
    Punct0.UpdateStatus();
    return Punct0.Get();
};

Punct0.IsManual = function () {
    return Punct0._manualPlacement;
};

Punct0.StartManualPlacement = function () {
    Punct0._manualPlacement = true;
    return true;
};

Punct0.Capture = function () {
    if (!Core.functieGPS?.GetCurrentLocation) return Promise.reject(new Error("Serviciul GPS nu este disponibil."));

    return Core.functieGPS.GetCurrentLocation().then(position => Punct0.SetFromPosition(position));
};

Punct0.Clear = function () {
    if (Punct0._marker && map) map.removeLayer(Punct0._marker);
    Punct0._marker = null;
Punct0._manualPlacement = false;
    Punct0._data = null;
    Punct0.UpdateStatus();
};

Punct0.UpdateStatus = function () {
    const el = document.getElementById("punct-zero-status");
    if (!el) return;

    if (!Punct0._data) {
        el.textContent = "Punctul 0 nu este setat.";
        return;
    }

    const d = Punct0._data;
    const accuracy = Number.isFinite(d.accuracy)
        ? ` · precizie GPS ±${d.accuracy.toFixed(1).replace(".", ",")} m`
        : " · precizie GPS indisponibilă";
    const source = d.positionSource === "manual" ? " · poziție ajustată manual" : " · poziție GPS";

    el.innerHTML = `<b>Punct 0 activ</b> · X 0,00 m · Y 0,00 m${source}${accuracy}`;
};

Punct0.Serialize = function () {
    return Punct0.Get();
};

Punct0.Restore = function (data) {
    return Punct0.Set(data);
};
