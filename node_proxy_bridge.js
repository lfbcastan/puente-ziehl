const express = require('express');
const axios = require('axios');
const xml2js = require('xml2js');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// --- RUTA: ZIEHL-ABEGG ---
app.post('/api/bridge', async (req, res) => {
    const targetUrl = "https://fanselect.ziehl-abegg.com/api/webdll.php";
    try {
        const response = await axios.post(targetUrl, req.body, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (NodeBridge v2.0)'
            },
            timeout: 60000
        });
        res.json(response.data);
    } catch (error) {
        console.error("Error en puente ZA:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// --- RUTA: GEBHARDT PROSELECTA2 ---
const GEBHARDT_URL = "https://www.nicotra-gebhardt.com:8095/WebServiceGH";

app.post('/api/gebhardt-search', async (req, res) => {
    console.log(">>> [v5] Petición Gebhardt recibida:", JSON.stringify(req.body));
    const input = req.body;
    const qv = input.qv || 0;
    const psf = input.psf || 0;
    const temperature = input.temperature || 20;
    const unit_system = input.unit_system || 'm';

    const xmlRequest = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:geb="http://www.nicotra-gebhardt.com:8092/WebServiceGH">
   <soap:Header/>
   <soap:Body>
      <geb:Blackbox>
         <geb:ANTRIEBART>DIR_FU_FREI</geb:ANTRIEBART>
         <geb:T>${temperature}</geb:T>
         <geb:T_EINHEIT>${unit_system === 'i' ? 'F' : 'C'}</geb:T_EINHEIT>
         <geb:V>${qv}</geb:V>
         <geb:V_EINHEIT>${unit_system === 'i' ? 'ft3/min' : 'm3/h'}</geb:V_EINHEIT>
         <geb:DPFA>${psf}</geb:DPFA>
         <geb:P_EINHEIT>${unit_system === 'i' ? 'inch wg' : 'PA'}</geb:P_EINHEIT>
         <geb:EINBAUART>A</geb:EINBAUART>
         <geb:SPRACHE>ES</geb:SPRACHE>
         <geb:WEBSERVICE_VER>4.16</geb:WEBSERVICE_VER>
      </geb:Blackbox>
   </soap:Body>
</soap:Envelope>`;

    try {
        const response = await axios.post(GEBHARDT_URL, xmlRequest, {
            headers: { 'Content-Type': 'text/xml; charset=utf-8' },
            timeout: 30000
        });

        const parser = new xml2js.Parser({
            explicitArray: false,
            tagNameProcessors: [xml2js.processors.stripPrefix]
        });

        const result = await parser.parseStringPromise(response.data);

        // --- BÚSQUEDA RECURSIVA DE KEY (Case Insensitive) ---
        function findKey(obj, target) {
            if (!obj || typeof obj !== 'object') return null;
            const targetUpper = target.toUpperCase();

            // Buscar en las llaves del nivel actual
            for (let key in obj) {
                if (key.toUpperCase() === targetUpper) return obj[key];
            }

            // Buscar en niveles inferiores
            for (let key in obj) {
                const found = findKey(obj[key], target);
                if (found) return found;
            }
            return null;
        }

        // Buscamos directamente la respuesta o la salida
        const blackboxResponse = findKey(result, 'BlackboxResponse') || findKey(result, 'AUSGABE') || result;

        // Buscamos RESULTATE esté donde esté dentro de lo que encontramos
        const rawResults = findKey(blackboxResponse, 'RESULTATE') || findKey(blackboxResponse, 'results');

        if (!rawResults) {
            console.error(">>> ERROR: No se encontró RESULTATE en la respuesta XML.");
            return res.status(500).json({
                error: "Estructura XML inesperada o vacía",
                debug_keys: Object.keys(result),
                full_result_keys: JSON.stringify(result).substring(0, 500)
            });
        }

        let fans = [];
        const resultats = rawResults.RESULTAT || rawResults.resultat;

        if (resultats) {
            const items = Array.isArray(resultats) ? resultats : [resultats];
            const filteredFans = items.filter(item => {
                const name = (item.BEZEICHNUNG || "").toUpperCase();
                const type = (item.TYP || "").toUpperCase();
                return name.includes("PA-C") || name.includes("COPRA") || type.includes("PA-C") || type.includes("COPRA");
            });

            if (filteredFans.length > 0) {
                fans = filteredFans.map(item => ({
                    TYPE: item.TYP || item.typ || "N/A",
                    ARTICLE_NO: item.BEZEICHNUNG || item.bezeichnung || "N/A",
                    DESCRIPTION: item.BEZEICHNUNG || item.bezeichnung || "",
                    V: parseFloat(item.V || item.v || 0),
                    DPFA_X: parseFloat(item.DPFA_X || item.dpfa_x || 0),
                    DREHZAHL: parseFloat(item.DREHZAHL || item.drehzahl || 0),
                    PW: parseFloat(item.PW || item.pw || 0),
                    BRAND: 'Gebhardt'
                }));
            } else {
                fans = items.slice(0, 5).map(item => ({
                    TYPE: item.TYP || item.typ || "N/A",
                    ARTICLE_NO: item.BEZEICHNUNG || "DEBUG_NO_FILTER_MATCH",
                    DESCRIPTION: `DEBUG: total=${items.length} | first_name=${item.BEZEICHNUNG}`,
                    V: parseFloat(item.V || item.v || 0),
                    DPFA_X: parseFloat(item.DPFA_X || item.dpfa_x || 0),
                    DREHZAHL: parseFloat(item.DREHZAHL || item.drehzahl || 0),
                    PW: parseFloat(item.PW || item.pw || 0),
                    BRAND: 'Gebhardt-DEBUG'
                }));
            }
        }

        res.json(fans);
    } catch (error) {
        console.error(">>> ERROR en Puente Gebhardt:", error.message);
        res.status(502).json({
            error: "Error en el puente: " + error.message,
            json_detail: error.response ? error.response.data : null
        });
    }
});

app.get('/', (req, res) => {
    res.send('<h1>Puente Activo (ZA + Gebhardt) v5 🚀</h1>');
});

app.listen(PORT, () => {
    console.log(`Servidor Puente corriendo en puerto ${PORT}`);
});
