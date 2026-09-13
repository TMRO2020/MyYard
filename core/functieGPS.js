/* =========================================================
   PERMA ENGINE — functieGPS
   Etapa 2: prima funcționalitate migrată din app.js.

   Compatibility:
   - getGPSLocation() din app.js rămâne wrapper public.
   - UI-ul existent nu este schimbat.
   ========================================================= */

Core.functieGPS = Core.functieGPS || {};

Core.functieGPS.GetCurrentLocation = function () {
    if (!navigator.geolocation) {
        return Promise.reject(new Error("Acest browser nu oferă geolocație."));
    }

    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
            resolve,
            reject,
            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 0
            }
        );
    });
};

Core.functieGPS.GetLatitude = function () {
    const input = document.getElementById("lat-input");
    return input ? parseFloat(input.value) : null;
};

Core.functieGPS.GetLongitude = function () {
    const input = document.getElementById("lng-input");
    return input ? parseFloat(input.value) : null;
};

Core.functieGPS.ActiveazaGPS = function () {
    return Core.functieGPS.GetCurrentLocation()
        .then(position => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;

            if (typeof map !== "undefined" && map) {
                map.setView([lat, lng], Math.max(19, map.getZoom()));
            }

            const latInput = document.getElementById("lat-input");
            const lngInput = document.getElementById("lng-input");

            if (latInput) latInput.value = lat.toFixed(7);
            if (lngInput) lngInput.value = lng.toFixed(7);

            if (typeof updateMicroclimateLayers === "function") {
                updateMicroclimateLayers();
            }

            return position;
        })
        .catch(error => {
            alert(
                error?.message === "Acest browser nu oferă geolocație."
                    ? error.message
                    : "Eroare GPS: " + error.message
            );
            return null;
        });
};
