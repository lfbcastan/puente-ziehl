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
            headers: { 'Content-Type': 'application/json' },
            timeout: 60000
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- RUTA: GEBHARDT PROSELECTA2 ---
const GEBHARDT_URL = "https://www.nicotra-gebhardt.com:8095/WebServiceGH";

app.post('/api/gebhardt-search', async (req, res) => {
    const input = req.body;
    const qv = input.qv || 3500;
    const psf = input.psf || 500;
    const temperature = input.temperature || 20;

    const xmlRequest = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope 
xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" 
xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/" 
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
xmlns:xsd="http://www.w3.org/2001/XMLSchema" 
xmlns:geb="http://tempuri.org/geb.xsd"> 
 <SOAP-ENV:Body> 
  <geb:BLACKBOX> 
   <EINGABE> 
      <ANTRIEBART>DIR_FU_AUS</ANTRIEBART> 
      <BAUREIHE>COPRA</BAUREIHE> 
      <AUSFUEHRUNG>PA</AUSFUEHRUNG> 
      <T>${temperature}</T><T_EINHEIT>C</T_EINHEIT>
      <V>${qv}</V><V_EINHEIT>m3/h</V_EINHEIT>
      <DPFA>${psf}</DPFA><P_EINHEIT>PA</P_EINHEIT>
      <ATEX>ID_KEIN</ATEX><ENTRAUCH_KLASSE>ID_KEIN</ENTRAUCH_KLASSE>
      <EINBAUART>A</EINBAUART><RHO1>1.2</RHO1><RHO_EINHEIT>kg/m^3</RHO_EINHEIT>
      <SUCH_MIN>0.9</SUCH_MIN><SUCH_MAX>1.4</SUCH_MAX>
      <FREQU_SP_STROM>3-400-50/60</FREQU_SP_STROM>
      <ZUBEHOER>NEIN</ZUBEHOER><ZUBEHOER_ALLES>NEIN</ZUBEHOER_ALLES>
      <MOTORAUFBAU>1</MOTORAUFBAU><DREHRICHTUNG>L</DREHRICHTUNG><GEHAEUSESTELLUNG>90</GEHAEUSESTELLUNG>
   </EINGABE> 
  </geb:BLACKBOX> 
 </SOAP-ENV:Body> 
</SOAP-ENV:Envelope>`;

    try {
        const response = await axios.post(GEBHARDT_URL, xmlRequest, {
            headers: { 'Content-Type': 'text/xml; charset=utf-8' },
            timeout: 30000
        });

        const parser = new xml2js.Parser({ explicitArray: false, tagNameProcessors: [xml2js.processors.stripPrefix] });
        const result = await parser.parseStringPromise(response.data);

        function findKey(obj, target) {
            if (!obj || typeof obj !== 'object') return null;
            const targetUpper = target.toUpperCase();
            for (let key in obj) { if (key.toUpperCase() === targetUpper) return obj[key]; }
            for (let key in obj) { const found = findKey(obj[key], target); if (found) return found; }
            return null;
        }

        const blackboxResponse = findKey(result, 'BlackboxResponse') || findKey(result, 'AUSGABE') || result;
        const rawResults = findKey(blackboxResponse, 'RESULTATE') || findKey(blackboxResponse, 'results');

        if (!rawResults) {
            return res.json([]);
        }

        let fans = [];
        const resultats = rawResults.RESULTAT || rawResults.resultat;

        if (resultats) {
            const items = Array.isArray(resultats) ? resultats : [resultats];

            // Función auxiliar para obtener valores numéricos de forma robusta
            const getVal = (item, key) => {
                const val = findKey(item, key);
                if (val === null || val === undefined) return 0;
                // Si xml2js devuelve un objeto {_: 'val'} por atributos
                if (typeof val === 'object' && val._) return parseFloat(val._);
                return parseFloat(val);
            };

            fans = items.map((item, index) => {
                const mapped = {
                    TYPE: findKey(item, 'TYP') || "N/A",
                    ARTICLE_NO: findKey(item, 'BEZEICHNUNG') || "N/A",
                    DESCRIPTION: findKey(item, 'BEZEICHNUNG') || "",
                    V: getVal(item, 'V'),
                    DPFA_X: getVal(item, 'DPFA_X'),
                    DREHZAHL: getVal(item, 'DREHZAHL'),
                    PW: getVal(item, 'PW'),
                    BRAND: 'Gebhardt'
                };

                // Agregamos el item original al primero para debuggear llaves reales
                if (index === 0) {
                    mapped.DEBUG_RAW_KEYS = Object.keys(item).join(',');
                    mapped.DEBUG_FULL_ITEM = JSON.stringify(item).substring(0, 500);
                }

                return mapped;
            });
        }
        res.json(fans);

    } catch (error) {
        res.status(502).json({ error: "Error v14: " + error.message });
    }
});

app.get('/', (req, res) => { res.send('<h1>Puente Activo v14 🚀</h1>'); });
app.listen(PORT, () => { console.log(`Servidor Puente corriendo en puerto ${PORT}`); });
