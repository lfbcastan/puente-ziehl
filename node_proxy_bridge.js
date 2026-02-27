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
    console.log(">>> Petición Gebhardt recibida:", JSON.stringify(req.body));
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
        console.log(">>> Enviando XML a Gebhardt...");
        const response = await axios.post(GEBHARDT_URL, xmlRequest, {
            headers: { 'Content-Type': 'text/xml; charset=utf-8' },
            timeout: 30000
        });

        console.log(">>> Respuesta de Gebhardt recibida (longitud:", response.data.length, ")");

        const parser = new xml2js.Parser({
            explicitArray: false,
            tagNameProcessors: [xml2js.processors.stripPrefix]
        });

        const result = await parser.parseStringPromise(response.data);

        // --- NAVEGACIÓN SEGURA ULTRA-ROBUSTA ---
        const getNested = (obj, keys) => {
            return keys.reduce((acc, key) => {
                if (!acc) return null;
                // Intentar exacto, luego mayúsculas, luego minúsculas
                return acc[key] || acc[key.toUpperCase()] || acc[key.toLowerCase()] || null;
            }, obj);
        };

        const blackboxResponse = getNested(result, ['Envelope', 'Body', 'BlackboxResponse']);

        if (!blackboxResponse) {
            console.error(">>> ERROR: No se encontró BlackboxResponse en el XML.");
            return res.status(500).json({
                error: "Estructura XML inesperada",
                raw_keys: Object.keys(result),
                debug_envelope: result.Envelope ? Object.keys(result.Envelope) : "no envelope"
            });
        }

        const ausgabe = blackboxResponse.AUSGABE || blackboxResponse.ausgabe || blackboxResponse;
        const rawResults = ausgabe.RESULTATE || ausgabe.resultate || ausgabe.results || ausgabe;

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
                console.log(">>> INFO: Sin coincidencias para PA-C/COPRA. Devolviendo debug info.");
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
        } else {
            console.log(">>> INFO: No se encontraron RESULTAT en RESULTATE.");
        }

        res.json(fans);
    } catch (error) {
        console.error(">>> ERROR en Puente Gebhardt:", error.message);
        res.status(502).json({
            error: "Error en el puente: " + error.message,
            stack: error.stack
        });
    }
});

app.get('/', (req, res) => {
    res.send('<h1>Puente Activo (ZA + Gebhardt) v4 🚀</h1>');
});

app.listen(PORT, () => {
    console.log(`Servidor Puente corriendo en puerto ${PORT}`);
});
