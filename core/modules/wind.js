/* PERMA ENGINE — Module: Wind
   Etapa 11: logica stratului de vânt este mutată incremental din app.js.
   Comportamentul vizual existent este păstrat.
*/
Core.Modules.Wind = Core.Modules.Wind || {};

const Wind = Core.Modules.Wind;

let windMap = null;
let windLayer = null;

Wind.Configure = function (mapInstance, layerGroup) {
    windMap = mapInstance || null;
    windLayer = layerGroup || null;
};

Wind.Start = function () {
    if (!windMap || !windLayer) return;
    windLayer.addTo(windMap);
    Wind.Update();
};

Wind.Stop = function () {
    if (!windMap || !windLayer) return;
    windMap.removeLayer(windLayer);
};

Wind.Toggle = function (enabled) {
    if (enabled) Wind.Start();
    else Wind.Stop();
};

Wind.IsActive = function () {
    return !!(windMap && windLayer && windMap.hasLayer(windLayer));
};

Wind.Update = function () {
    if (!windMap || !windLayer || !windMap.hasLayer(windLayer)) return;

    windLayer.clearLayers();
    const center = windMap.getCenter();

    Wind.DrawArrow(center, 45, "#1e3a8a", "Crivăț / NE");
    Wind.DrawArrow(center, 225, "#ef4444", "Vânt cald / SV");
};

Wind.DrawArrow = function (center, bearing, color, label) {
    if (!windLayer || !center || !Number.isFinite(bearing)) return;

    const dest = Core.functieGeometry.DestinationByBearing(center, bearing, 65);

    const line = L.polyline([center, dest], {
        color,
        weight: 4,
        opacity: .75
    }).addTo(windLayer);

    line.bindTooltip(label, { direction: "center" });
};

Wind.GetLayer = function () {
    return windLayer;
};
