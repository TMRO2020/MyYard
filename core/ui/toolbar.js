/* PERMA ENGINE — UI Toolbar
   Etapa 13: toolbar desktop generic.
   Toolbar-ul nu cunoaște implementarea modulelor; primește acțiuni prin RegisterAction().
*/
Core.UI.Toolbar = Core.UI.Toolbar || {};

const Toolbar = Core.UI.Toolbar;
Toolbar._actions = Toolbar._actions || new Map();
Toolbar._root = null;

Toolbar.RegisterAction = function (config) {
    if (!config || !config.id || typeof config.onExecute !== "function") return;
    Toolbar._actions.set(config.id, {
        id: config.id,
        label: config.label || config.id,
        icon: config.icon || "",
        title: config.title || config.label || config.id,
        onExecute: config.onExecute,
        isActive: typeof config.isActive === "function" ? config.isActive : null
    });
    Toolbar.Render();
};

Toolbar.RemoveAction = function (id) {
    Toolbar._actions.delete(id);
    Toolbar.Render();
};

Toolbar.Render = function () {
    const root = document.getElementById("desktop-toolbar-actions");
    if (!root) return;
    Toolbar._root = root;
    root.innerHTML = "";

    Toolbar._actions.forEach(action => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "cad-tool-button";
        button.dataset.toolId = action.id;
        button.title = action.title;
        button.setAttribute("aria-label", action.title);
        button.innerHTML = `<span class="cad-tool-icon">${action.icon}</span><span class="cad-tool-label">${action.label}</span>`;
        button.addEventListener("click", () => {
            Toolbar.SetActive(action.id);
            action.onExecute();
            Toolbar.RefreshActiveStates();
        });
        root.appendChild(button);
    });

    Toolbar.RefreshActiveStates();
};

Toolbar.SetActive = function (id) {
    if (!Toolbar._root) return;
    Toolbar._root.querySelectorAll(".cad-tool-button").forEach(button => {
        button.classList.toggle("active", button.dataset.toolId === id);
    });
};

Toolbar.RefreshActiveStates = function () {
    if (!Toolbar._root) return;
    Toolbar._actions.forEach(action => {
        if (!action.isActive) return;
        const button = Toolbar._root.querySelector(`[data-tool-id="${action.id}"]`);
        if (button) button.classList.toggle("active", !!action.isActive());
    });
};

Toolbar.Init = function () {
    Toolbar.Render();
};

document.addEventListener("DOMContentLoaded", Toolbar.Init);
