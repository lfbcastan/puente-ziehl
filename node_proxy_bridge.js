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
      <ZUBEHOER>JA</ZUBEHOER><ZUBEHOER_ALLES>JA</ZUBEHOER_ALLES>
      <KENNFELD_IMAGE>JA</KENNFELD_IMAGE><MASSBILD_IMAGE>JA</MASSBILD_IMAGE><MASSBILD_DXF_IMAGE>JA</MASSBILD_DXF_IMAGE>
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

        const fans = items.map((item, idx) => {
            const baugrRaw = getRawVal(item, 'BAUGROESSE') || "";
            const baugrNum = baugrRaw.match(/\d+/) ? parseFloat(baugrRaw.match(/\d+/)[0]) : 0;

            const valV = getVal(item, 'V');
            const valPsf = getVal(item, 'DPFA_X');
            const valN = getVal(item, 'DREHZAHL');
            const valNvMax = getVal(item, 'NV_MAX');
            const valP1S = getVal(item, 'P1S');
            const valPW = getVal(item, 'PW');
            const valStrom = getVal(item, 'STROM');
            const etaFa = getVal(item, 'ETA_FA');
            const etaT = getVal(item, 'ETA_T');
            const etaFas = getVal(item, 'ETA_FAS');
            const etaTs = getVal(item, 'ETA_TS') || getVal(item, 'ETA_T_SYS');
            const noise = getVal(item, 'LWA_DRUCK');
            const sfp = getVal(item, 'SFP');
            const iMax = getVal(item, 'I_MAX');

            // Nominal fallbacks
            let motorRating = getVal(item, 'NENNLEISTUNG');
            if (motorRating === 0) motorRating = getVal(item, 'MAX_PM');

            let nomSpeed = getVal(item, 'NENNDREHZAHL');
            if (nomSpeed === 0) nomSpeed = getVal(item, 'NV_MAX');

            // ErP Data
            const erpData = findKey(item, 'ERP_DATEN_IM_EFFIZIENZOPTIMUM');
            const erpEff = erpData ? getVal(erpData, 'ETA_S_OPT') : 0;
            const erpGrade = erpData ? getVal(erpData, 'N_IST') : 0;

            // Asset Construction
            const assetBase = "https://www.nicotra-gebhardt.com:8095/html/htmltemp/";
            const extractFilename = (path) => {
                if (!path || typeof path !== 'string') return null;
                const parts = path.split('\\');
                return parts[parts.length - 1];
            };

            const imgFile = extractFilename(getRawVal(item, 'MASSBILD_IMAGE'));
            const curveFile = extractFilename(getRawVal(item, 'KENNFELD_IMAGE'));
            const dxfFile = extractFilename(getRawVal(item, 'MASSBILD_DXF_IMAGE'));

            const mapped = {
                TYPE: findKey(item, 'TYP') || "COPRA",
                ARTICLE_NO: findKey(item, 'BEZEICHNUNG') || "N/A",
                DESCRIPTION: findKey(item, 'BEZEICHNUNG') || "",
                BRAND: 'Gebhardt',
                ZA_BG: baugrNum,
                ZA_QV: valV,
                ZA_PSF: valPsf,
                ZA_N: valN,
                ZA_NMAX: valNvMax,
                ZA_I: valStrom,
                ZA_ETASF: etaFa,
                ZA_ETAF: etaT,
                ZA_ETASF_SYS: etaFas,
                ZA_ETAF_SYS: etaTs,
                ZA_LWA6: noise,
                ZA_P1: (valP1S > 0 ? valP1S : valPW) * 1000,
                ZA_PW: valPW,
                motor_power_kw: motorRating,
                nominal_speed: nomSpeed,
                nominal_current: iMax,
                sfp: sfp,
                efficiency_static: etaFas,
                erp_efficiency: erpEff,
                erp_grade: erpGrade,
                image_url: imgFile ? assetBase + imgFile : null,
                curve_url: curveFile ? assetBase + curveFile : null,
                drawing_url: dxfFile ? assetBase + dxfFile : null,
                V: valV,
                DPFA_X: valPsf,
                DREHZAHL: valN,
                PW: valPW,
                P1S: valP1S
            };

            // Solo incluimos la respuesta cruda en el primer item para no saturar
            if (idx === 0) {
                mapped.DEBUG_RAW_GEBHARDT = JSON.stringify(item);
            }

            return mapped;
        });

        res.json(fans);

    } catch (error) {
        res.status(502).json({ error: "Error v18: " + error.message });
    }
});

app.get('/', (req, res) => { res.send('<h1>Puente Activo v18 🚀</h1>'); });
app.listen(PORT, () => { console.log(`Servidor Puente corriendo en puerto ${PORT}`); });
