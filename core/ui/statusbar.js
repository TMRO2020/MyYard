/* PERMA ENGINE — UI Status Bar
   Etapa 13C: Smart Statusbar.
   Primește date de la aplicație și nu accesează direct starea modulelor.
*/
Core.UI.StatusBar = Core.UI.StatusBar || {};

const StatusBar = Core.UI.StatusBar;
StatusBar._data = {
    tool: "Navigare",
    lat: "—",
    lng: "—",
    x: "— m",
    y: "— m",
    zoom: "—",
    snap: "Oprit",
    areaM2: NaN,
    plants: 0,
    lines: 0
};

StatusBar._format = function (value, decimals = 2) {
    return Number.isFinite(value) ? value.toFixed(decimals).replace(".", ",") : "—";
};

StatusBar._formatInteger = function (value) {
    return Number.isFinite(value)
        ? Math.round(value).toLocaleString("ro-RO")
        : "—";
};

StatusBar._formatArea = function (value) {
    return Number.isFinite(value) && value > 0
        ? `${Math.round(value).toLocaleString("ro-RO")} m²`
        : "—";
};

StatusBar.Update = function (data = {}) {
    Object.assign(StatusBar._data, data);
    const root = document.getElementById("desktop-statusbar");
    if (!root) return;

    const d = StatusBar._data;
    root.innerHTML = `
        <span class="status-tool"><span class="status-key">Tool</span><b>${d.tool}</b></span>
        <span class="status-coordinate"><span class="status-key">Lat</span><b>${d.lat}</b></span>
        <span class="status-coordinate"><span class="status-key">Lng</span><b>${d.lng}</b></span>
        <span class="status-metric"><span class="status-key">X</span><b>${d.x}</b></span>
        <span class="status-metric"><span class="status-key">Y</span><b>${d.y}</b></span>
        <span class="status-zoom"><span class="status-key">Zoom</span><b>${d.zoom}</b></span>
        <span class="status-snap"><span class="status-key">Snap</span><b>${d.snap}</b></span>
        <span class="status-project"><span class="status-key">Suprafață</span><b>${StatusBar._formatArea(d.areaM2)}</b></span>
        <span class="status-project"><span class="status-key">Plante</span><b>${StatusBar._formatInteger(d.plants)}</b></span>
        <span class="status-project"><span class="status-key">Linii</span><b>${StatusBar._formatInteger(d.lines)}</b></span>
    `;
};

StatusBar.SetTool = function (tool) {
    StatusBar.Update({ tool });
};

StatusBar.SetPointer = function (data = {}) {
    StatusBar.Update({
        lat: StatusBar._format(data.lat, 7),
        lng: StatusBar._format(data.lng, 7),
        x: `${StatusBar._format(data.x, 2)} m`,
        y: `${StatusBar._format(data.y, 2)} m`,
        zoom: Number.isFinite(data.zoom) ? data.zoom : StatusBar._data.zoom,
        snap: data.snap || StatusBar._data.snap,
        areaM2: Number.isFinite(data.areaM2) ? data.areaM2 : StatusBar._data.areaM2,
        plants: Number.isFinite(data.plants) ? data.plants : StatusBar._data.plants,
        lines: Number.isFinite(data.lines) ? data.lines : StatusBar._data.lines
    });
};

StatusBar.Init = function () {
    StatusBar.Update();
};

document.addEventListener("DOMContentLoaded", StatusBar.Init);
