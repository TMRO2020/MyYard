/* PERMA ENGINE — UI Toolbar
   Etapa 13B: Contextual Command Toolbar.
   Toolbar-ul principal rămâne compact; comenzile contextuale apar într-o a doua
   bară orizontală și rămân disponibile cât timp instrumentul este selectat.
*/
Core.UI.Toolbar = Core.UI.Toolbar || {};

const Toolbar = Core.UI.Toolbar;
Toolbar._actions = Toolbar._actions || new Map();
Toolbar._root = null;
Toolbar._contextRoot = null;
Toolbar._contextActionId = null;

Toolbar.RegisterAction = function (config) {
    if (!config || !config.id || typeof config.onExecute !== "function") return;

    Toolbar._actions.set(config.id, {
        id: config.id,
        label: config.label || config.id,
        icon: config.icon || "",
        title: config.title || config.label || config.id,
        onExecute: config.onExecute,
        isActive: typeof config.isActive === "function" ? config.isActive : null,
        renderContext: typeof config.renderContext === "function" ? config.renderContext : null
    });

    Toolbar.Render();
};

Toolbar.RemoveAction = function (id) {
    if (Toolbar._contextActionId === id) Toolbar.CloseContext();
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

            // Dacă același instrument este deja selectat și bara contextuală
            // este vizibilă, al doilea click înseamnă „m-am răzgândit”.
            // Închidem contextul fără să relansăm comanda instrumentului.
            if (Toolbar._contextActionId === action.id && Toolbar._contextRoot?.classList.contains("is-visible")) {
                Toolbar.CloseContext();
                Toolbar.SetActive(null);
                return;
            }

            Toolbar.SetActive(action.id);
            action.onExecute();
            Toolbar.RefreshActiveStates();

            if (action.renderContext) Toolbar.OpenContext(action.id);
            else Toolbar.CloseContext();
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

Toolbar._ensureContextRoot = function () {
    if (Toolbar._contextRoot?.isConnected) return Toolbar._contextRoot;

    const toolbar = document.getElementById("desktop-toolbar");
    if (!toolbar) return null;

    const root = document.createElement("div");
    root.id = "desktop-context-toolbar";
    root.className = "desktop-context-toolbar";
    root.setAttribute("aria-label", "Comenzi contextuale");
    toolbar.insertAdjacentElement("afterend", root);

    Toolbar._contextRoot = root;
    return root;
};

Toolbar.OpenContext = function (id) {
    const action = Toolbar._actions.get(id);
    if (!action?.renderContext) {
        Toolbar.CloseContext();
        return;
    }

    const root = Toolbar._ensureContextRoot();
    if (!root) return;

    Toolbar._contextActionId = id;
    root.innerHTML = "";
    root.classList.add("is-visible");
    document.body.classList.add("context-toolbar-open");

    const inner = document.createElement("div");
    inner.className = "desktop-context-toolbar-inner";
    root.appendChild(inner);
    action.renderContext(inner);
    Toolbar.SetActive(id);
};

Toolbar.RefreshContext = function () {
    if (!Toolbar._contextActionId) return;
    Toolbar.OpenContext(Toolbar._contextActionId);
};

Toolbar.CloseContext = function () {
    if (Toolbar._contextRoot) {
        Toolbar._contextRoot.classList.remove("is-visible");
        Toolbar._contextRoot.innerHTML = "";
    }
    Toolbar._contextActionId = null;
    document.body.classList.remove("context-toolbar-open");
};

Toolbar.Init = function () {
    Toolbar.Render();

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") Toolbar.CloseContext();
    });

    window.addEventListener("resize", () => {
        if (Toolbar._contextActionId) Toolbar.RefreshContext();
    });
};

document.addEventListener("DOMContentLoaded", Toolbar.Init);
