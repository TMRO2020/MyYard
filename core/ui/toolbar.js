/* PERMA ENGINE — UI Toolbar
   Etapa 13B: toolbar desktop + command panels.
   Toolbar-ul nu cunoaște implementarea modulelor; primește acțiuni și conținut
   de panel prin RegisterAction().
*/
Core.UI.Toolbar = Core.UI.Toolbar || {};

const Toolbar = Core.UI.Toolbar;
Toolbar._actions = Toolbar._actions || new Map();
Toolbar._root = null;
Toolbar._panel = null;
Toolbar._panelActionId = null;

Toolbar.RegisterAction = function (config) {
    if (!config || !config.id || typeof config.onExecute !== "function") return;

    Toolbar._actions.set(config.id, {
        id: config.id,
        label: config.label || config.id,
        icon: config.icon || "",
        title: config.title || config.label || config.id,
        onExecute: config.onExecute,
        isActive: typeof config.isActive === "function" ? config.isActive : null,
        renderPanel: typeof config.renderPanel === "function" ? config.renderPanel : null
    });

    Toolbar.Render();
};

Toolbar.RemoveAction = function (id) {
    if (Toolbar._panelActionId === id) Toolbar.ClosePanel();
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

        button.addEventListener("click", event => {
            event.stopPropagation();
            Toolbar.SetActive(action.id);
            action.onExecute();
            Toolbar.RefreshActiveStates();
            if (action.renderPanel) Toolbar.TogglePanel(action.id);
            else Toolbar.ClosePanel();
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

Toolbar._positionPanel = function () {
    if (!Toolbar._panel || !Toolbar._root || !Toolbar._panelActionId) return;

    const button = Toolbar._root.querySelector(`[data-tool-id="${Toolbar._panelActionId}"]`);
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const panelWidth = Math.min(330, Math.max(260, Toolbar._panel.offsetWidth || 300));
    const viewportPadding = 8;

    let left = rect.left;
    if (left + panelWidth > window.innerWidth - viewportPadding) {
        left = window.innerWidth - panelWidth - viewportPadding;
    }
    left = Math.max(viewportPadding, left);

    Toolbar._panel.style.left = `${left}px`;
    Toolbar._panel.style.top = `${rect.bottom + 7}px`;
};

Toolbar.OpenPanel = function (id) {
    const action = Toolbar._actions.get(id);
    if (!action?.renderPanel) return;

    Toolbar.ClosePanel();

    const panel = document.createElement("section");
    panel.id = "cad-command-panel";
    panel.className = "cad-command-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", `${action.label} — opțiuni`);
    panel.addEventListener("click", event => event.stopPropagation());

    document.body.appendChild(panel);
    Toolbar._panel = panel;
    Toolbar._panelActionId = id;

    action.renderPanel(panel);
    Toolbar._positionPanel();

    const button = Toolbar._root?.querySelector(`[data-tool-id="${id}"]`);
    button?.classList.add("panel-open");
};

Toolbar.ClosePanel = function () {
    if (Toolbar._panel) Toolbar._panel.remove();
    if (Toolbar._root && Toolbar._panelActionId) {
        const button = Toolbar._root.querySelector(`[data-tool-id="${Toolbar._panelActionId}"]`);
        button?.classList.remove("panel-open");
    }
    Toolbar._panel = null;
    Toolbar._panelActionId = null;
};

Toolbar.TogglePanel = function (id) {
    if (Toolbar._panelActionId === id && Toolbar._panel) {
        Toolbar.ClosePanel();
        return;
    }
    Toolbar.OpenPanel(id);
};

Toolbar.Init = function () {
    Toolbar.Render();

    document.addEventListener("click", () => Toolbar.ClosePanel());
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") Toolbar.ClosePanel();
    });

    window.addEventListener("resize", () => Toolbar._positionPanel());
    window.addEventListener("scroll", () => Toolbar._positionPanel(), true);
};

document.addEventListener("DOMContentLoaded", Toolbar.Init);
