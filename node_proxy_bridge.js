const express = require('express');
const axios = require('axios');
const xml2js = require('xml2js');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

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
            headers: {
                'Content-Type': 'text/xml; charset=utf-8'
            },
            timeout: 30000
        });

        const parser = new xml2js.Parser({
            explicitArray: false,
            tagNameProcessors: [xml2js.processors.stripPrefix]
        });

        const result = await parser.parseStringPromise(response.data);

        // Robust access even if Soap/Envelope/Body/BlackboxResponse is structured slightly differently
        const envelope = result.Envelope || result;
        const body = envelope.Body || envelope;
        const blackboxResponse = body.BlackboxResponse || body.BLACKBOXResponse || body;

        // The Documentation says: AUSGABE > RESULTATE > RESULTAT
        let ausgabe = blackboxResponse.AUSGABE || blackboxResponse.ausgabe || blackboxResponse;
        let rawResults = ausgabe.RESULTATE || ausgabe.resultate || ausgabe.results || ausgabe;

        let fans = [];
        if (rawResults && (rawResults.RESULTAT || rawResults.resultat)) {
            const list = rawResults.RESULTAT || rawResults.resultat;
            const items = Array.isArray(list) ? list : [list];

            fans = items.map(item => ({
                TYPE: item.TYP || item.typ || "N/A",
                ARTICLE_NO: item.BEZEICHNUNG || item.bezeichnung || "N/A",
                DESCRIPTION: item.BEZEICHNUNG || item.bezeichnung || "",
                V: parseFloat(item.V || item.v || 0),
                DPFA_X: parseFloat(item.DPFA_X || item.dpfa_x || 0),
                DREHZAHL: parseFloat(item.DREHZAHL || item.drehzahl || 0),
                PW: parseFloat(item.PW || item.pw || 0),
                BRAND: 'Gebhardt'
            }));
        }

        res.json(fans); // Return array directly to match App expectations
    } catch (error) {
        console.error("Error en Puente Gebhardt:", error.message);
        res.status(502).json({ error: "Error conectando a Gebhardt: " + error.message });
    }
});

app.get('/', (req, res) => {
    res.send('<h1>Puente Activo (ZA + Gebhardt) 🚀</h1>');
});

app.listen(PORT, () => {
    console.log(`Servidor Puente corriendo en puerto ${PORT}`);
});
