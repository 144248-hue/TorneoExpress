// BackEnd/generarClaves.js
const { MongoClient } = require('mongodb');

// TU CADENA DE CONEXIÓN
const uri = "mongodb+srv://144248_db_user:DztPsPwp5EVghI9L@cluster0.25uevze.mongodb.net/TorneoDB?appName=Cluster0";

async function generar() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db('TorneoDB');
        const clavesCollection = db.collection('claves');

        // Generamos 3 claves aleatorias
        const nuevasClaves = [];
        for (let i = 0; i < 3; i++) {
            nuevasClaves.push({
                clave: Math.random().toString(36).substring(2, 8).toUpperCase(),
                usada: false,
                creadaEn: new Date()
            });
        }

        await clavesCollection.insertMany(nuevasClaves);
        
        console.log("✅ 3 Claves generadas exitosamente:");
        nuevasClaves.forEach(c => console.log(`👉 ${c.clave}`));

    } finally {
        await client.close();
    }
}

generar();
