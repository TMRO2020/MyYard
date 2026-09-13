/* PERMA ENGINE — UI Sidebar
   Etapa 13: sidebar-ul existent rămâne UI-ul mobil/touch și panoul auxiliar desktop.
*/
Core.UI.Sidebar = Core.UI.Sidebar || {};

const Sidebar = Core.UI.Sidebar;

Sidebar.GetElement = function () {
    return document.getElementById("sidebar");
};

Sidebar.Open = function () {
    Sidebar.GetElement()?.classList.add("active");
};

Sidebar.Close = function () {
    Sidebar.GetElement()?.classList.remove("active");
};

Sidebar.Toggle = function () {
    Sidebar.GetElement()?.classList.toggle("active");
};

Sidebar.Focus = function (target) {
    Sidebar.Open();
    const map = {
        gps: "lat-input",
        perimeter: "btn-draw-perimeter",
        line: "btn-add-planting-line",
        snap: "snap-mode-select",
        grid: "grid-toggle",
        plant: "category-select",
        solar: "solar-toggle",
        wind: "wind-toggle",
        project: "import-file"
    };
    const element = document.getElementById(map[target] || target);
    if (!element) return;
    window.setTimeout(() => element.focus({ preventScroll: false }), 80);
};
