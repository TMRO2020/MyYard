/* PERMA ENGINE — Module: Solar
   Etapa 10: logica stratului solar este mutată incremental din app.js.
   Comportamentul vizual existent este păstrat.
*/
Core.Modules.Solar = Core.Modules.Solar || {};

const Solar = Core.Modules.Solar;

let solarMap = null;
let solarLayer = null;

Solar.Configure = function (mapInstance, layerGroup) {
    solarMap = mapInstance || null;
    solarLayer = layerGroup || null;
};

Solar.Start = function () {
    if (!solarMap || !solarLayer) return;
    solarLayer.addTo(solarMap);
    Solar.Update();
};

Solar.Stop = function () {
    if (!solarMap || !solarLayer) return;
    solarMap.removeLayer(solarLayer);
};

Solar.Toggle = function (enabled) {
    if (enabled) Solar.Start();
    else Solar.Stop();
};

Solar.IsActive = function () {
    return !!(solarMap && solarLayer && solarMap.hasLayer(solarLayer));
};

Solar.Update = function () {
    if (!solarMap || !solarLayer || !solarMap.hasLayer(solarLayer)) return;

    const center = solarMap.getCenter();
    solarLayer.clearLayers();

    const year = new Date().getFullYear();
    const summerSolstice = new Date(year, 5, 21);
    const winterSolstice = new Date(year, 11, 21);

    const summer = SunCalc.getTimes(summerSolstice, center.lat, center.lng);
    const winter = SunCalc.getTimes(winterSolstice, center.lat, center.lng);

    Solar.DrawRay(
        center,
        SunCalc.getPosition(summer.sunrise, center.lat, center.lng).azimuth,
        "#f59e0b",
        "Răsărit — vară"
    );
    Solar.DrawRay(
        center,
        SunCalc.getPosition(summer.sunset, center.lat, center.lng).azimuth,
        "#d97706",
        "Apus — vară"
    );
    Solar.DrawRay(
        center,
        SunCalc.getPosition(winter.sunrise, center.lat, center.lng).azimuth,
        "#3b82f6",
        "Răsărit — iarnă"
    );
    Solar.DrawRay(
        center,
        SunCalc.getPosition(winter.sunset, center.lat, center.lng).azimuth,
        "#1d4ed8",
        "Apus — iarnă"
    );
};

Solar.DrawRay = function (center, azimuthRad, color, label) {
    if (!solarLayer || !center || !Number.isFinite(azimuthRad)) return;

    const bearing = ((azimuthRad * 180 / Math.PI) + 180) % 360;
    const dest = Core.functieGeometry.DestinationByBearing(center, bearing, 80);

    const line = L.polyline([center, dest], {
        color,
        weight: 3,
        opacity: .82,
        dashArray: "7,6"
    }).addTo(solarLayer);

    line.bindTooltip(label, { direction: "center" });
};

Solar.GetLayer = function () {
    return solarLayer;
};
