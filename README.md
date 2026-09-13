# PERMA ENGINE

Planner web pentru permacultură și grădinărit, construit cu **HTML, CSS și JavaScript vanilla**, folosind Leaflet, SunCalc și un catalog extern `catalogue.json`.

## Principiu de dezvoltare

PERMA ENGINE este migrat **incremental** din aplicația existentă. `app.js` rămâne momentan sursa executabilă a logicii aplicației. Structura `core/` este introdusă ca schelet, fără a muta agresiv funcționalități și fără a schimba comportamentul existent.

> Regula de bază: **structura nouă se adaptează aplicației existente, nu aplicația este rescrisă pentru structură.**

## Structura proiectului

```text
PERMA/
├── index.html
├── perma.css
├── catalogue.json
├── app.js
├── README.md
│
└── core/
    ├── core.js
    ├── functieGPS.js
    ├── functieHarta.js
    ├── functieGeometry.js
    ├── functieStorage.js
    │
    ├── ui/
    │   ├── toolbar.js
    │   ├── statusbar.js
    │   └── sidebar.js
    │
    └── modules/
        ├── perimeter.js
        ├── grid.js
        ├── snap.js
        ├── plants.js
        ├── planting-lines.js
        ├── catalogue.js
        ├── solar.js
        ├── wind.js
        └── compatibility.js
```

## Rolul Core

`core/core.js` creează namespace-ul global:

```javascript
Core.functieGPS
Core.functieHarta
Core.functieGeometry
Core.functieStorage
Core.UI
Core.Modules
```

Core va deține în timp funcțiile fundamentale și starea comună. În această etapă namespace-urile sunt doar infrastructură; nu se mută logică din `app.js`.

## Unde se modifică fiecare funcționalitate

| Funcționalitate | Fișier țintă |
|---|---|
| GPS / geolocation | `core/functieGPS.js` |
| Hartă / inițializare Leaflet | `core/functieHarta.js` |
| Calcule geometrice | `core/functieGeometry.js` |
| Salvare / încărcare / storage | `core/functieStorage.js` |
| Toolbar desktop | `core/ui/toolbar.js` |
| Status bar desktop | `core/ui/statusbar.js` |
| Sidebar | `core/ui/sidebar.js` |
| Perimetru | `core/modules/perimeter.js` |
| Grid | `core/modules/grid.js` |
| Snap | `core/modules/snap.js` |
| Plante | `core/modules/plants.js` |
| Planting Lines | `core/modules/planting-lines.js` |
| Catalog | `core/modules/catalogue.js` + `catalogue.json` |
| Solar | `core/modules/solar.js` |
| Vânt | `core/modules/wind.js` |
| Compatibilitate | `core/modules/compatibility.js` |
| Aspect vizual | `perma.css` |

## API-ul modular dorit

Pe măsură ce funcționalitățile sunt migrate, API-ul public va urma denumiri simple și consistente:

```javascript
Core.functieGPS.ActiveazaGPS()
Core.functieGPS.GetCurrentLocation()
Core.functieGPS.GetLatitude()
Core.functieGPS.GetLongitude()

Core.Modules.Perimeter.Start()
Core.Modules.Perimeter.Stop()
Core.Modules.Perimeter.Clear()
Core.Modules.Perimeter.GetSuprafataTotala_Mp()

Core.Modules.Grid.SetSize()
Core.Modules.Snap.SetMode()
Core.Modules.Plants.Add()
Core.Modules.PlantingLines.Start()
```

Implementarea reală a acestor API-uri se adaugă numai în etapele de migrare corespunzătoare.

## Cum se adaugă un modul nou

1. Se creează un fișier în `core/modules/`.
2. Modulul își expune API-ul prin `Core.Modules.NumeModul`.
3. Nu accesează direct variabilele interne ale altui modul.
4. Pentru comunicare se folosesc API-uri publice Core sau evenimente.
5. Se adaugă scriptul în `index.html`, înainte de `app.js`.
6. Funcționalitatea existentă este verificată înainte și după migrare.
7. `app.js` poate rămâne temporar compatibility/bootstrap layer până când migrarea este completă.

## Regula pentru modificări incrementale

La fiecare etapă documentăm:

```text
FILES MODIFIED
- ...

FILES NEW
- ...

FILES DELETED
- ...
```

Se modifică numai fișierele necesare etapei respective.

## Starea acestei etape

Aceasta este **Etapa 1 — schelet GitHub / PERMA ENGINE**.

- Structura `core/`, `core/ui/` și `core/modules/` există.
- Namespace-ul `Core` există.
- Modulele și componentele UI au fișiere-placeholder.
- Logica existentă nu a fost mutată.
- `catalogue.json` rămâne extern.
- `app.js` rămâne sursa executabilă a funcționalității existente.
