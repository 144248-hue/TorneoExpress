// =======================================================
// 1. ⚙️ SETUP & DEPENDENCIAS
// =======================================================
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { MongoClient } = require('mongodb');

// --- Variables de Conexión a MongoDB ---
const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);

// Variables para acceder a las colecciones una vez conectados
let tablaCollection;
let historialCollection;

async function connectToDB() {
    try {
        await client.connect();
        // Usamos una base de datos llamada 'TorneoDB'
        const db = client.db('TorneoDB');
        
        // Asignamos las colecciones a nuestras variables globales
        tablaCollection = db.collection('tablaGeneral');
        historialCollection = db.collection('historialPartidas');
        
        console.log('✅ Conexión a MongoDB Atlas exitosa.');
    } catch (e) {
        console.error('❌ Error al conectar a MongoDB:', e);
        // Si no se conecta a la DB, terminamos el proceso.
        process.exit(1); 
    }
}

function isAuthenticated(req, res, next) {
    if (req.session.isOrganizer) {
        next();
    } else {
        res.redirect('/login');
    }
}

const app = express();
const port = process.env.PORT || 3001; 

// Middleware
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// =======================================================
// 2. 🧱 CORE LOGIC (Reglas del Negocio)
// =======================================================

async function registrarPartida(ganador, perdedor) {
    // 1. Actualizar al Ganador:
    await tablaCollection.updateOne(
        { _id: ganador }, 
        { 
            $inc: { puntos: 3, ganadas: 1 }, 
            $set: { nombre: ganador } 
        },
        { upsert: true } // Crea el jugador si no existe (aunque debería existir)
    );

    // 2. Actualizar al Perdedor:
    await tablaCollection.updateOne(
        { _id: perdedor },
        { 
            $inc: { puntos: 1 },
            $set: { nombre: perdedor }
        },
        { upsert: true }
    );

    // 3. Registrar la partida en el historial
    await historialCollection.insertOne({
        ganador: ganador,
        perdedor: perdedor,
        fecha: new Date()
    });
}

async function deshacerPartida() {
    // 1. Buscar la última partida (la más reciente)
    const ultimaPartida = await historialCollection.findOne(
        {}, 
        { sort: { fecha: -1 } } // Ordenar por fecha (más reciente primero)
    );

    if (ultimaPartida) {
        const ganador = ultimaPartida.ganador;
        const perdedor = ultimaPartida.perdedor;

        // 2. Revertir puntos al Ganador
        await tablaCollection.updateOne(
            { _id: ganador },
            { $inc: { puntos: -3, ganadas: -1 } }
        );

        // 3. Revertir puntos al Perdedor
        await tablaCollection.updateOne(
            { _id: perdedor },
            { $inc: { puntos: -1 } }
        );

        // 4. Eliminar el registro de la partida
        await historialCollection.deleteOne({ _id: ultimaPartida._id });
        
        console.log("Deshaciendo partida:", ultimaPartida);
    }
}

// =======================================================
// 3. 🛠️ FUNCIÓN AUXILIAR (HTML Wrapper)
// =======================================================

function wrapHTML(content) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>🏆 Torneo Local</title>
        <link rel="stylesheet" href="/styles.css"> 
    </head>
    <body>
        <div class="container">
            ${content}
        </div>
    </body>
    </html>
    `;
}

// =======================================================
// 4. 🔗 RUTAS (ENDPOINTS) - ¡AQUÍ ESTÁN TODOS LOS CAMBIOS!
// =======================================================

// --- GET (Mostrar Vistas) ---

// HOME - Lista de Jugadores para los Dropdowns
app.get('/', isAuthenticated, async (req, res) => { // ⬅️ AHORA ES ASYNC
    // 1. Obtener todos los jugadores de MongoDB y ordenarlos alfabéticamente
    const jugadores = await tablaCollection.find({}, { projection: { nombre: 1 } })
                                           .sort({ nombre: 1 })
                                           .toArray();

    // 2. Crear las opciones HTML
    const opcionesHTML = jugadores.map(jugador => 
        `<option value="${jugador.nombre}">${jugador.nombre}</option>`
    ).join('');

    const content = `
        <h1>Registrar Partida 🎱</h1>
        <form action="/registrar" method="POST">
            <label>Ganador:</label>
            <select name="ganador" required>
                <option value="" disabled selected>Selecciona un jugador</option>
                ${opcionesHTML} 
            </select>
            <br><br>
            <label>Perdedor:</label>
            <select name="perdedor" required>
                <option value="" disabled selected>Selecciona un jugador</option>
                ${opcionesHTML}
            </select>
            <br><br>
            <button type="submit">Registrar Partida</button>
        </form>
        
        <br>
        <div class="navigation-buttons">
            <a href="/agregar-jugador" class="button">👤 Agregar Nuevo Jugador</a>
            <a href="/tabla" class="button">🏆 Ver Tabla de Posiciones</a>
            <a href="/buscar" class="button">🔍 Buscar Jugador</a>
        </div>

        <form action="/deshacer" method="POST">
            <br>
            <button type="submit" style="background-color: red; color: white;">
                Deshacer Última Partida ⏪
            </button>
        </form>
    `;
    res.send(wrapHTML(content));
});

// TABLA DE POSICIONES
app.get('/tabla', async (req, res) => { // ⬅️ AHORA ES ASYNC
    // 1. Obtener todos los jugadores de MongoDB
    const jugadores = await tablaCollection.find().toArray(); 

    // 2. Ordenamiento: puntos (desc), luego ganadas (desc)
    jugadores.sort((a, b) => {
        if (a.puntos !== b.puntos) {
            return b.puntos - a.puntos;
        }
        return b.ganadas - a.ganadas; 
    });

    // 3. GENERACIÓN DE FILAS HTML 
    const filasHTML = jugadores.map((jugador, index) => {
        return `
            <tr>
                <td>${index + 1}</td>
                <td>${jugador.nombre}</td>
                <td>${jugador.puntos}</td>
                <td>${jugador.ganadas}</td>
            </tr>
        `;
    }).join(''); 

    // 4. Construimos el contenido final de la tabla
    const tablaContent = `
        <h1>🏆 Tabla de Posiciones</h1>
        <table class="leaderboard">
            <thead>
                <tr>
                    <th>#</th>
                    <th>Jugador</th>
                    <th>Puntos</th>
                    <th>Ganadas</th>
                </tr>
            </thead>
            <tbody>
                ${filasHTML}
            </tbody>
        </table>
        <br>
        <a href="/">Volver al registro</a>
    `;

    res.send(wrapHTML(tablaContent));
});

// LOGIN
app.get('/login', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>Iniciar Sesión</title>
            <link rel="stylesheet" href="/styles.css">
        </head>
        <body>
            <div class="container">
                <h1>🚪 Iniciar Sesión de Organizador</h1>
                <form action="/login" method="POST">
                    <label for="password">Contraseña:</label>
                    <input type="password" id="password" name="password" required>
                    <button type="submit" class="button">Acceder</button>
                </form>
                <p><a href="/tabla">🏆 Ir a la Tabla General</a></p>
                <p><a href="/buscar">🔍 Buscar Jugador</a></p>
            </div>
        </body>
        </html>
    `);
});

app.post('/login', (req, res) => {
    const submittedPassword = req.body.password;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (submittedPassword === adminPassword) {
        req.session.isOrganizer = true;
        res.redirect('/');
    } else {
        res.send('Contraseña incorrecta. <a href="/login">Intentar de nuevo</a>');
    }
});

// FORMULARIO AGREGAR JUGADOR
app.get('/agregar-jugador', isAuthenticated, (req, res) => {
    const content = `
        <h1>Agregar Nuevo Jugador 👤</h1>
        <form action="/agregar-jugador" method="POST">
            <input type="text" name="nombre" placeholder="Nombre del Jugador" required />
            <input type="text" name="telefono" placeholder="Teléfono" required />
            <button type="submit">Guardar Jugador</button>
        </form>
        <a href="/">Volver al inicio</a>
    `;
    res.send(wrapHTML(content));
});

// FORMULARIO BUSCAR
app.get('/buscar', (req, res) => {
    const content = `
        <h1>🔍 Buscar Historial de Jugador</h1>
        <form action="/resultados" method="GET">
            <label>Ingresa tu número de teléfono:</label>
            <input type="text" name="telefono" required placeholder="Ej: 5512345678">
            <button type="submit">Ver mis partidas</button>
        </form>
        <br>
        <a href="/">🏠 Volver al inicio</a>
    `;
    res.send(wrapHTML(content));
});

// RESULTADOS DE BÚSQUEDA
app.get('/resultados', async (req, res) => { // ⬅️ AHORA ES ASYNC
    const telefonoBuscado = req.query.telefono;
    
    // 1. Buscar al jugador por teléfono en MongoDB
    const jugador = await tablaCollection.findOne({ telefono: telefonoBuscado });

    if (!jugador) {
        const errorContent = `<h2>No encontré ningún jugador con el teléfono ${telefonoBuscado}</h2><a href="/buscar">Intentar de nuevo</a>`;
        return res.send(wrapHTML(errorContent));
    }
    
    const nombreEncontrado = jugador.nombre;

    // 2. Buscar solo las partidas donde el jugador participó (ganó O perdió)
    const misPartidas = await historialCollection.find({
        $or: [
            { ganador: nombreEncontrado }, 
            { perdedor: nombreEncontrado }
        ]
    }).sort({ fecha: -1 }).toArray(); // Ordenamos por fecha descendente

    let listaHTML = '';
    misPartidas.forEach(partida => {
        const resultado = (partida.ganador === nombreEncontrado) ? "GANASTE 🎉" : "PERDISTE ❌";
        const rival = (partida.ganador === nombreEncontrado) ? partida.perdedor : partida.ganador;
        // Formateamos la fecha a un formato legible
        const fechaLegible = partida.fecha.toLocaleDateString('es-MX', { 
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' 
        });
        listaHTML += `<li>${fechaLegible}: ${resultado} contra <b>${rival}</b></li>`;
    });

    const content = `
        <h1>Historial de ${nombreEncontrado} 📜</h1>
        <p>Teléfono: ${telefonoBuscado}</p>
        <h3>Has jugado ${misPartidas.length} partidas:</h3>
        <ul>
            ${listaHTML}
        </ul>
        <br>
        <a href="/buscar">🔍 Buscar otro</a> | <a href="/">🏠 Inicio</a>
    `;
    res.send(wrapHTML(content));
});

// --- POST (Procesar Datos) ---

// REGISTRAR PARTIDA
app.post('/registrar', isAuthenticated, async (req, res) => {
    const ganador = req.body.ganador;
    const perdedor = req.body.perdedor;

    if (ganador === perdedor) {
        const errorContent = `<h2>Error: Ganador ${ganador} no puede ser igual a Perdedor ${perdedor}.</h2><a href="/">Volver</a>`;
        return res.send(wrapHTML(errorContent));
    }
    
    await registrarPartida(ganador, perdedor); 

    const successContent = `<h2>Partida registrada: ${ganador} ganó a ${perdedor}.</h2><a href="/tabla">Ver tabla</a> | <a href="/">Volver</a>`;
    res.send(wrapHTML(successContent));
});

// AGREGAR JUGADOR
app.post('/agregar-jugador', isAuthenticated, async (req, res) => {
    const nombre = req.body.nombre;
    const telefono = req.body.telefono;
    
    await tablaCollection.insertOne({
        _id: nombre, 
        nombre: nombre,
        puntos: 0,
        ganadas: 0,
        telefono: telefono
    });

    const successContent = `<h2>Jugador Registrado: ${nombre} con número ${telefono}.</h2><a href="/">Volver</a>`;
    res.send(wrapHTML(successContent));
});

// DESHACER PARTIDA
app.post('/deshacer', isAuthenticated, async (req, res)=> {
    await deshacerPartida(); 
    res.redirect('/');
});

// =======================================================
// 5. ▶️ INICIALIZACIÓN
// =======================================================

// Conectar a la DB y luego iniciar el servidor
connectToDB().then(() => {
    app.listen(port, () => {
        console.log(`🚀 Servidor corriendo en http://localhost:${port}`);
    });
});