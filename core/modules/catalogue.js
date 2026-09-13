/* PERMA ENGINE — Module: Catalogue
   Etapa 9: logica catalogului este mutată din app.js în modulul dedicat.
   catalogue.json rămâne sursă externă și poate fi înlocuit/importat.
*/
Core.Modules.Catalogue = Core.Modules.Catalogue || {};

const Catalogue = Core.Modules.Catalogue;

let catalogueItems = [];
let speciesConfig = {};

function catalogueUniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort((a, b) =>
        String(a).localeCompare(String(b), "ro", { sensitivity: "base" })
    );
}

function catalogueGetCategory(item) {
    return item.categorie || item.subcategorie || item.tip || "Alte plante";
}

function catalogueGetSpecies(item) {
    return item.specie || item.nume || "Necunoscut";
}

function catalogueGetVariety(item) {
    return item.soi || item.nume || "Fără soi";
}

function catalogueGetSelectedItem() {
    const select = document.getElementById("variety-select");
    if (!select) return null;
    return catalogueItems.find(item => item.id === select.value) || null;
}

function catalogueFlatten(jsonData) {
    const flat = [];

    if (Array.isArray(jsonData)) {
        jsonData.forEach(entry => {
            if (!entry || typeof entry !== "object") return;

            const nested = entry.subcategorii || entry.articole || entry.items;
            if (Array.isArray(nested)) {
                nested.forEach(item => {
                    flat.push({ ...item, _group: entry.categorie || entry.nume || "General" });
                });
            } else {
                flat.push({ ...entry });
            }
        });
    } else if (jsonData && typeof jsonData === "object") {
        Object.entries(jsonData).forEach(([key, value]) => {
            if (!Array.isArray(value)) return;
            value.forEach(item => flat.push({ ...item, _group: key }));
        });
    }

    return flat.filter(item => item.id);
}

function catalogueBuildSpeciesConfig() {
    speciesConfig = {};

    catalogueItems.forEach(item => {
        const ec = item.cerinte_ecologice || {};
        const dim = item.dimensiuni_maturitate || {};
        const species = catalogueGetSpecies(item);
        const variety = catalogueGetVariety(item);

        speciesConfig[item.id] = {
            id: item.id,
            species,
            variety,
            category: catalogueGetCategory(item),
            name: `${species} — ${variety}`,
            color: item.culoare_harta || "#2e7d32",
            defaultCrown: Number(dim.diametru_coroana_m) || 4,
            defaultHeight: Number(dim.inaltime_m) || 3,
            minDistance: Number(item.distanta_minima_plantare_m) || 4,
            kb:
                `<b>Categorie:</b> ${escapeHtml(catalogueGetCategory(item))}<br>` +
                `<b>Expunere:</b> ${escapeHtml(ec.expunere_soare || "Nespecificat")}<br>` +
                `<b>Poziționare:</b> ${escapeHtml(ec.pozitionare_recomandata || "Nespecificat")}<br>` +
                `<b>Vânt:</b> ${escapeHtml(ec.sensibilitate_vant || "Nespecificat")}<br>` +
                `<b>Distanță minimă:</b> ${escapeHtml(item.distanta_minima_plantare_m ?? "Nespecificat")} m<br>` +
                `<b>Îngrijire:</b> ${escapeHtml(item.tratamente_si_ingrijire || "Nespecificat")}`
        };
    });
}

function cataloguePopulateCategorySelect() {
    const select = document.getElementById("category-select");
    if (!select) return;
    const previous = select.value;

    select.innerHTML = `<option value="">Toate categoriile</option>`;

    catalogueUniqueSorted(catalogueItems.map(catalogueGetCategory)).forEach(category => {
        const option = document.createElement("option");
        option.value = category;
        option.textContent = category;
        select.appendChild(option);
    });

    if ([...select.options].some(o => o.value === previous)) select.value = previous;
}

function cataloguePopulateSpeciesSelect() {
    const category = document.getElementById("category-select")?.value || "";
    const select = document.getElementById("species-select");
    if (!select) return;
    const previous = select.value;

    const species = catalogueUniqueSorted(
        catalogueItems
            .filter(item => !category || catalogueGetCategory(item) === category)
            .map(catalogueGetSpecies)
    );

    select.innerHTML = `<option value="">1. Alege specia</option>`;
    species.forEach(name => {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = `${name} (${catalogueItems.filter(i => catalogueGetSpecies(i) === name && (!category || catalogueGetCategory(i) === category)).length})`;
        select.appendChild(option);
    });

    if (species.includes(previous)) select.value = previous;
    cataloguePopulateVarietySelect();
}

function cataloguePopulateVarietySelect() {
    const category = document.getElementById("category-select")?.value || "";
    const species = document.getElementById("species-select")?.value || "";
    const select = document.getElementById("variety-select");
    if (!select) return;
    const previous = select.value;

    const items = catalogueItems.filter(item =>
        (!category || catalogueGetCategory(item) === category) &&
        (!species || catalogueGetSpecies(item) === species)
    );

    select.innerHTML = `<option value="">2. Alege soiul</option>`;

    items
        .slice()
        .sort((a, b) => catalogueGetVariety(a).localeCompare(catalogueGetVariety(b), "ro"))
        .forEach(item => {
            const option = document.createElement("option");
            option.value = item.id;
            option.textContent = `${catalogueGetVariety(item)} · coroană ${item.dimensiuni_maturitate?.diametru_coroana_m || "?"} m`;
            select.appendChild(option);
        });

    if (items.some(item => item.id === previous)) select.value = previous;
}

function catalogueUpdateSummary() {
    const summary = document.getElementById("catalogue-summary");
    if (!summary) return;

    const speciesCount = catalogueUniqueSorted(catalogueItems.map(catalogueGetSpecies)).length;
    const categoryCount = catalogueUniqueSorted(catalogueItems.map(catalogueGetCategory)).length;

    summary.innerHTML =
        `<b>${catalogueItems.length}</b> poziții în catalog · ` +
        `<b>${speciesCount}</b> specii · <b>${categoryCount}</b> categorii`;
}

function catalogueParseAndLoad(jsonData) {
    catalogueItems = catalogueFlatten(jsonData);
    catalogueBuildSpeciesConfig();

    cataloguePopulateCategorySelect();
    cataloguePopulateSpeciesSelect();
    cataloguePopulateVarietySelect();
    catalogueUpdateSummary();

    if (Core.Modules.Plants?.UpdateCounters) {
        Core.Modules.Plants.UpdateCounters();
    }

    return catalogueItems.length;
}

async function catalogueFetchDefault() {
    try {
        const response = await fetch("catalogue.json", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return catalogueParseAndLoad(await response.json());
    } catch (error) {
        console.error("Nu am putut încărca catalogue.json:", error);
        const summary = document.getElementById("catalogue-summary");
        if (summary) {
            summary.textContent =
                "catalogue.json nu a putut fi încărcat. Poți folosi butonul „Încarcă alt catalog JSON”.";
        }
        return 0;
    }
}

function catalogueImportJSON(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = e => {
        try {
            catalogueParseAndLoad(JSON.parse(e.target.result));
            alert("Catalog încărcat. Acum alegerea este: categorie → specie → soi.");
        } catch (error) {
            alert("Eroare catalog JSON: " + error.message);
        }
        event.target.value = "";
    };
    reader.readAsText(file);
}

/* -------------------- API publică -------------------- */
Catalogue.GetItems = function () {
    return catalogueItems.slice();
};

Catalogue.GetItem = function (id) {
    return catalogueItems.find(item => item.id === id) || null;
};

Catalogue.GetConfig = function (id) {
    return speciesConfig[id] || null;
};

Catalogue.GetSelectedItem = function () {
    return catalogueGetSelectedItem();
};

Catalogue.GetCategory = function (item) {
    return catalogueGetCategory(item);
};

Catalogue.GetSpecies = function (item) {
    return catalogueGetSpecies(item);
};

Catalogue.GetVariety = function (item) {
    return catalogueGetVariety(item);
};

Catalogue.Load = function (jsonData) {
    return catalogueParseAndLoad(jsonData);
};

Catalogue.LoadDefault = function () {
    return catalogueFetchDefault();
};

Catalogue.ImportJSON = function (event) {
    return catalogueImportJSON(event);
};

Catalogue.PopulateCategorySelect = function () {
    return cataloguePopulateCategorySelect();
};

Catalogue.PopulateSpeciesSelect = function () {
    return cataloguePopulateSpeciesSelect();
};

Catalogue.PopulateVarietySelect = function () {
    return cataloguePopulateVarietySelect();
};

Catalogue.GetCount = function () {
    return catalogueItems.length;
};
