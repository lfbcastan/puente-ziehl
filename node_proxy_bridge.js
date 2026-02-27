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
    console.log(">>> [v6] Petición Gebhardt recibida:", JSON.stringify(req.body));
    const input = req.body;
    const qv = input.qv || 0;
    const psf = input.psf || 0;
    const temperature = input.temperature || 20;
    const unit_system = input.unit_system || 'm';

    // Usando estructura EXACTA de la documentación: BLACKBOX > EINGABE
    const xmlRequest = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:geb="http://tempuri.org/geb.xsd"> 
 <SOAP-ENV:Body> 
  <geb:BLACKBOX> 
   <EINGABE> 
      <ANTRIEBART>DIR_FU_FREI</ANTRIEBART> 
      <V>${qv}</V>
      <V_EINHEIT>${unit_system === 'i' ? 'ft3/min' : 'm3/h'}</V_EINHEIT>
      <DPFA>${psf}</DPFA> 
      <P_EINHEIT>${unit_system === 'i' ? 'inch wg' : 'PA'}</P_EINHEIT>
      <T>${temperature}</T>
      <T_EINHEIT>${unit_system === 'i' ? 'F' : 'C'}</T_EINHEIT>
      <EINBAUART>A</EINBAUART> 
      <SPRACHE>ES</SPRACHE>
      <WEBSERVICE_VER>4.16</WEBSERVICE_VER>
   </EINGABE> 
  </geb:BLACKBOX> 
 </SOAP-ENV:Body> 
</SOAP-ENV:Envelope>`;

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

        function findKey(obj, target) {
            if (!obj || typeof obj !== 'object') return null;
            const targetUpper = target.toUpperCase();
            for (let key in obj) {
                if (key.toUpperCase() === targetUpper) return obj[key];
            }
            for (let key in obj) {
                const found = findKey(obj[key], target);
                if (found) return found;
            }
            return null;
        }

        const blackboxResponse = findKey(result, 'BlackboxResponse') || findKey(result, 'AUSGABE') || result;
        const rawResults = findKey(blackboxResponse, 'RESULTATE') || findKey(blackboxResponse, 'results');

        if (!rawResults) {
            // Si el status es ERROR, intentamos ver qué hay en Header o Body para diagnosticar
            return res.status(500).json({
                error: "Sin resultados o estructura inválida",
                status_error: findKey(result, 'STATUS'),
                anzahl_result: findKey(result, 'ANZAHLRESULT'),
                full_debug: JSON.stringify(result).substring(0, 1000)
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
    res.send('<h1>Puente Activo (ZA + Gebhardt) v6 🚀</h1>');
});

app.listen(PORT, () => {
    console.log(`Servidor Puente corriendo en puerto ${PORT}`);
});
