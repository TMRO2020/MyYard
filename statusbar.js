/* PERMA ENGINE — UI Status Bar
   Etapa 13: bara de stare desktop generică.
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
    snap: "Oprit"
};

StatusBar._format = function (value, decimals = 2) {
    return Number.isFinite(value) ? value.toFixed(decimals).replace(".", ",") : "—";
};

StatusBar.Update = function (data = {}) {
    Object.assign(StatusBar._data, data);
    const root = document.getElementById("desktop-statusbar");
    if (!root) return;

    const d = StatusBar._data;
    root.innerHTML = `
        <span class="status-tool"><b>Tool</b>&nbsp;${d.tool}</span>
        <span class="status-coordinate">Lat&nbsp;<b>${d.lat}</b></span>
        <span class="status-coordinate">Lng&nbsp;<b>${d.lng}</b></span>
        <span class="status-metric">X&nbsp;<b>${d.x}</b></span>
        <span class="status-metric">Y&nbsp;<b>${d.y}</b></span>
        <span class="status-zoom">Zoom&nbsp;<b>${d.zoom}</b></span>
        <span class="status-snap">Snap&nbsp;<b>${d.snap}</b></span>
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
        snap: data.snap || StatusBar._data.snap
    });
};

StatusBar.Init = function () {
    StatusBar.Update();
};

document.addEventListener("DOMContentLoaded", StatusBar.Init);
