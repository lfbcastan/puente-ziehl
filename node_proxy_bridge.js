const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Permitir que tu hosting y tu navegador se conecten a este puente
app.use(cors());
app.use(express.json());

// Endpoint del puente
app.post('/api/bridge', async (req, res) => {
    // URL Fija de Ziehl-Abegg
    const targetUrl = "https://fanselect.ziehl-abegg.com/api/webdll.php";
    
    console.log("--> Recibiendo petición...");

    try {
        // El puente hace la petición a Ziehl-Abegg
        const response = await axios.post(targetUrl, req.body, {
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (NodeBridge v1.0)' // Disfraz de navegador
            },
            timeout: 15000 // 15 segundos timeout
        });

        // Devolvemos la respuesta exacta al origen (Hostgator)
        console.log("<-- Respuesta recibida con éxito");
        res.json(response.data);

    } catch (error) {
        console.error("Error en el puente:", error.message);
        
        if (error.response) {
            // El servidor destino respondió con error (ej: 401, 500)
            res.status(error.response.status).json(error.response.data);
        } else {
            // Error de conexión
            res.status(500).json({ error: "Error del Puente: " + error.message });
        }
    }
});

app.get('/', (req, res) => {
    res.send('<h1>Puente Activo 🚀</h1><p>El servidor proxy está funcionando. Usa POST /api/bridge</p>');
});

app.listen(PORT, () => {
    console.log(`Servidor Puente corriendo en puerto ${PORT}`);
});