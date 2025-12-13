const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Permitir acceso desde cualquier origen (CORS)
app.use(cors());
app.use(express.json());

app.post('/api/bridge', async (req, res) => {
    // URL Web API de Ziehl-Abegg
    const targetUrl = "https://fanselect.ziehl-abegg.com/api/webdll.php";
    
    console.log("--> Recibiendo petición...");

    try {
        const response = await axios.post(targetUrl, req.body, {
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (NodeBridge v2.0)'
            },
            // AUMENTADO A 60 SEGUNDOS PARA EVITAR ERRORES DE "COLD START"
            timeout: 60000 
        });

        console.log("<-- Respuesta recibida con éxito");
        res.json(response.data);

    } catch (error) {
        console.error("Error en el puente:", error.message);
        
        if (error.code === 'ECONNABORTED') {
            res.status(504).json({ error: "El servidor tardó demasiado en responder (Timeout)." });
        } else if (error.response) {
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({ error: "Error del Puente: " + error.message });
        }
    }
});

app.get('/', (req, res) => {
    res.send('<h1>Puente Activo v2 (Timeout 60s) 🚀</h1>');
});

app.listen(PORT, () => {
    console.log(`Servidor Puente corriendo en puerto ${PORT}`);
});