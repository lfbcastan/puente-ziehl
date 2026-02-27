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
    const input = req.body;
    const qv = input.qv || 3500;
    const psf = input.psf || 500;
    const temperature = input.temperature || 20;
    const unit_system = input.unit_system || 'm';

    console.log(`>>> [v9] Buscando Gebhardt: Qv=${qv}, Psf=${psf}, T=${temperature}`);

    const generateXml = (antrieb) => `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:geb="http://tempuri.org/geb.xsd"> 
 <SOAP-ENV:Body> 
  <geb:BLACKBOX> 
   <EINGABE> 
      <ANTRIEBART>${antrieb}</ANTRIEBART> 
      <BAUREIHE>COPRA</BAUREIHE> 
      <T>${temperature}</T><T_EINHEIT>C</T_EINHEIT>
      <V>${qv}</V><V_EINHEIT>m3/h</V_EINHEIT>
      <DPFA>${psf}</DPFA><P_EINHEIT>PA</P_EINHEIT>
      <ATEX>ID_KEIN</ATEX><ENTRAUCH_KLASSE>ID_KEIN</ENTRAUCH_KLASSE>
      <EINBAUART>A</EINBAUART><RHO1>1.2</RHO1><RHO_EINHEIT>kg/m^3</RHO_EINHEIT>
      <SUCH_MIN>0.9</SUCH_MIN><SUCH_MAX>1.4</SUCH_MAX>
      <FREQU_SP_STROM>3-400-50</FREQU_SP_STROM>
      <ZUBEHOER>NEIN</ZUBEHOER><ZUBEHOER_ALLES>NEIN</ZUBEHOER_ALLES>
      <MOTORAUFBAU>1</MOTORAUFBAU><DREHRICHTUNG>L</DREHRICHTUNG><GEHAEUSESTELLUNG>90</GEHAEUSESTELLUNG>
   </EINGABE> 
  </geb:BLACKBOX> 
 </SOAP-ENV:Body> 
</SOAP-ENV:Envelope>`;

    try {
        // Probamos con DIR_FU_AUS primero
        let response = await axios.post(GEBHARDT_URL, generateXml("DIR_FU_AUS"), {
            headers: { 'Content-Type': 'text/xml; charset=utf-8' },
            timeout: 30000
        });

        const parser = new xml2js.Parser({ explicitArray: false, tagNameProcessors: [xml2js.processors.stripPrefix] });
        let result = await parser.parseStringPromise(response.data);

        function findKey(obj, target) {
            if (!obj || typeof obj !== 'object') return null;
            const targetUpper = target.toUpperCase();
            for (let key in obj) { if (key.toUpperCase() === targetUpper) return obj[key]; }
            for (let key in obj) { const found = findKey(obj[key], target); if (found) return found; }
            return null;
        }

        let blackboxResponse = findKey(result, 'BlackboxResponse') || findKey(result, 'AUSGABE') || result;
        let rawResults = findKey(blackboxResponse, 'RESULTATE') || findKey(blackboxResponse, 'results');

        // Si no hay resultados, devolvemos un objeto de diagnóstico para saber POR QUÉ
        if (!rawResults) {
            const status = findKey(result, 'STATUS') || "UNKNOWN";
            const anzahl = findKey(result, 'ANZAHLRESULT') || "0";

            return res.json([{
                TYPE: "DIAGNOSTIC",
                ARTICLE_NO: "EMPTY_RESULT",
                DESCRIPTION: `API Status: ${status} | Count: ${anzahl} | Keys: ${Object.keys(blackboxResponse).join(',')}`,
                BRAND: 'Gebhardt-DEBUG'
            }]);
        }

        let fans = [];
        const resultats = rawResults.RESULTAT || rawResults.resultat;
        if (resultats) {
            const items = Array.isArray(resultats) ? resultats : [resultats];
            fans = items.map(item => ({
                TYPE: item.TYP || "N/A",
                ARTICLE_NO: item.BEZEICHNUNG || "N/A",
                DESCRIPTION: item.BEZEICHNUNG || "",
                V: parseFloat(item.V || 0),
                DPFA_X: parseFloat(item.DPFA_X || 0),
                DREHZAHL: parseFloat(item.DREHZAHL || 0),
                PW: parseFloat(item.PW || 0),
                BRAND: 'Gebhardt'
            }));
        }

        res.json(fans);
    } catch (error) {
        console.error(">>> ERROR:", error.message);
        res.status(502).json({ error: "Error v9: " + error.message });
    }
});

app.get('/', (req, res) => { res.send('<h1>Puente Activo v9 🚀</h1>'); });
app.listen(PORT, () => { console.log(`Servidor Puente corriendo en puerto ${PORT}`); });
