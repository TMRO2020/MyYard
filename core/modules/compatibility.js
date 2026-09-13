/* PERMA ENGINE — Module: Compatibility
   Etapa 12: logica existentă pentru analiza de compatibilitate este mutată
   incremental din app.js în modulul dedicat.
   Comportamentul existent este păstrat: analiza este momentan un placeholder
   și NU emite alerte.
*/
Core.Modules.Compatibility = Core.Modules.Compatibility || {};

const Compatibility = Core.Modules.Compatibility;

/**
 * Analiză de compatibilitate a mediului — placeholder existent.
 *
 * Păstrează exact comportamentul anterior: colectează distanțele față de
 * ceilalți pomi și referințele către straturile solar/vânt, dar momentan
 * NU emite alerte și nu modifică starea aplicației.
 */
Compatibility.AnalyzeEnvironment = function (lat, lng, currentTreeObj) {
    const distanteFataDeAltiPomi = treeObjects
        .filter(obj => obj !== currentTreeObj)
        .map(obj => ({
            id: obj.id,
            specie: obj.treeData.species,
            soi: obj.treeData.variety,
            distanta_m: map.distance(
                [lat, lng],
                obj.marker.getLatLng()
            )
        }));

    const liniiUmbrire = solarGroup;
    const liniiVant = windGroup;

    // TODO:
    // 1. verifică distanța minimă specifică soiului;
    // 2. verifică suprapunerea coroanelor la maturitate;
    // 3. verifică incompatibilități precum nuc → plante sensibile;
    // 4. verifică expunerea la soare și umbra sezonieră;
    // 5. verifică zonele de vânt/Crivăț;
    // 6. returnează alerte explicabile utilizatorului.
    void lat; void lng; void currentTreeObj;
    void distanteFataDeAltiPomi; void liniiUmbrire; void liniiVant;
};

/* API publică intuitivă */
Compatibility.Analyze = function (lat, lng, currentTreeObj) {
    return Compatibility.AnalyzeEnvironment(lat, lng, currentTreeObj);
};

Compatibility.IsReady = function () {
    return true;
};
