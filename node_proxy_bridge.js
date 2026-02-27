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
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:geb="http://tempuri.org/geb.xsd"> 
 <SOAP-ENV:Body> 
  <geb:BLACKBOX> 
   <EINGABE> 
      <ANTRIEBART>DIR_FU_AUS</ANTRIEBART> <BAUREIHE>COPRA</BAUREIHE> <AUSFUEHRUNG>PA</AUSFUEHRUNG> 
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

        if (!rawResults) return res.json([]);

        const resultats = rawResults.RESULTAT || rawResults.resultat;
        const items = Array.isArray(resultats) ? resultats : [resultats];

        const getRawVal = (item, key) => {
            const val = findKey(item, key);
            if (val === null || val === undefined) return null;
            if (typeof val === 'object' && val._) return val._;
            return val;
        };

        const getVal = (item, key) => {
            const val = getRawVal(item, key);
            if (val === null) return 0;
            const parsed = parseFloat(val);
            return isNaN(parsed) ? 0 : parsed;
        };

        const fans = items.map(item => {
            // MAPPING SEGÚN SOLICITUD DEL USUARIO
            const baugrRaw = getRawVal(item, 'BAUGROESSE') || "";
            const baugrNum = baugrRaw.match(/\d+/) ? parseFloat(baugrRaw.match(/\d+/)[0]) : 0;

            const valV = getVal(item, 'V');
            const valPsf = getVal(item, 'DPFA_X');
            const valN = getVal(item, 'DREHZAHL');
            const valNvMax = getVal(item, 'NV_MAX');
            const valP1S = getVal(item, 'P1S'); // Potencia Eléctrica Total (kW)
            const valPW = getVal(item, 'PW');   // Potencia Eje (kW)
            const valStrom = getVal(item, 'STROM'); // Corriente (A)

            // Eficiencias (Eje)
            const etaFa = getVal(item, 'ETA_FA'); // Static efficiency at shaft
            const etaT = getVal(item, 'ETA_T');   // Total efficiency at shaft

            // Eficiencias (Sistema/Global)
            const etaFas = getVal(item, 'ETA_FAS'); // System Static efficiency
            const etaTs = getVal(item, 'ETA_TS') || getVal(item, 'ETA_T_SYS'); // System Total efficiency

            const noise = getVal(item, 'LWA_DRUCK');
            const motorRating = getVal(item, 'NENNLEISTUNG');
            const nomSpeed = getVal(item, 'NENNDREHZAHL');

            return {
                TYPE: findKey(item, 'TYP') || "COPRA",
                ARTICLE_NO: findKey(item, 'BEZEICHNUNG') || "N/A",
                DESCRIPTION: findKey(item, 'BEZEICHNUNG') || "",
                BRAND: 'Gebhardt',

                // Mapeo para Componentes de la UI (prefijo ZA_)
                ZA_BG: baugrNum,      // Fan Size
                ZA_QV: valV,          // Flow
                ZA_PSF: valPsf,       // Pressure
                ZA_N: valN,           // Operating RPM
                ZA_NMAX: valNvMax,    // Max RPM
                ZA_I: valStrom,       // Current
                ZA_ETASF: etaFa,      // Static Efficiency (Shaft)
                ZA_ETAF: etaT,        // Total Efficiency (Shaft)
                ZA_ETASF_SYS: etaFas, // Static Efficiency (System)
                ZA_ETAF_SYS: etaTs,   // Total Efficiency (System)
                ZA_LWA6: noise,       // Noise
                ZA_P1: (valP1S > 0 ? valP1S : valPW) * 1000, // En Watios (preferimos consumo total)
                ZA_PW: valPW,         // Shaft power (kW)

                // Motor Data
                motor_power_kw: motorRating,
                nominal_speed: nomSpeed,

                // Respaldo
                V: valV,
                DPFA_X: valPsf,
                DREHZAHL: valN,
                PW: valPW,
                P1S: valP1S
            };
        });

        res.json(fans);

    } catch (error) {
        res.status(502).json({ error: "Error v17: " + error.message });
    }
});

app.get('/', (req, res) => { res.send('<h1>Puente Activo v17 🚀</h1>'); });
app.listen(PORT, () => { console.log(`Servidor Puente corriendo en puerto ${PORT}`); });
