/**
 * ============================================================================
 * 🎱 SISTEMA GESTIÓN DE TORNEOS (Backend Híbrido Web + API Móvil)
 * ============================================================================
 * * Este servidor maneja dos mundos:
 * 1. La Web Clásica (HTML) para los organizadores actuales.
 * 2. La API REST (JSON) para la futura App Móvil en React Native.
 */

// ----------------------------------------------------------------------------
// 1. CONFIGURACIÓN E IMPORTACIONES
// ----------------------------------------------------------------------------
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

// INICIALIZAMOS LA APP (Esto debe ir antes de los middlewares)
const app = express();
const port = process.env.PORT || 3001;

// Configuración de Seguridad
const JWT_SECRET = process.env.JWT_SECRET || 'secreto_super_seguro_para_mi_torneo_2025';

// ----------------------------------------------------------------------------
// 2. MIDDLEWARES (Los "Porteros" del Servidor)
// ----------------------------------------------------------------------------

// Permite conexiones desde otros dominios (Vital para React/Móvil)
app.use(cors());

// Permite leer datos JSON (Para la App Móvil)
app.use(express.json());

// Permite leer datos de Formularios HTML (Para la Web Vieja)
app.use(express.urlencoded({ extended: true }));

// Sirve archivos estáticos (CSS, Imágenes)
app.use(express.static('public'));

// Configuración de Sesión (Solo para la Web HTML)
app.use(session({
    secret: process.env.SESSION_SECRET || 'secreto_temporal',
    resave: false,
    saveUninitialized: false
}));

// ----------------------------------------------------------------------------
// 3. BASE DE DATOS (MongoDB Atlas)
// ----------------------------------------------------------------------------

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);

// Variables Globales para las Colecciones
let db;
let tablaCollection;        // Web Antigua (Tabla General)
let historialCollection;    // Web Antigua (Historial)
let usuariosCollection;     // App Nueva (Usuarios/Login)
let torneosCollection;      // App Nueva (Torneos)
let participacionesCollection; // App Nueva (Relación Jugador-Torneo)

async function connectToDB() {
    try {
        await client.connect();
        db = client.db('TorneoDB');
        
        // Asignamos las colecciones a las variables
        tablaCollection = db.collection('tablaGeneral');
        historialCollection = db.collection('historialPartidas');
        usuariosCollection = db.collection('usuarios');
        torneosCollection = db.collection('torneos');
        participacionesCollection = db.collection('participaciones');
        
        console.log('✅ Conexión a MongoDB Atlas exitosa.');
    } catch (e) {
        console.error('❌ Error al conectar a MongoDB:', e);
        process.exit(1); 
    }
}

// ----------------------------------------------------------------------------
// 4. FUNCIONES DE SEGURIDAD (Middlewares Personalizados)
// ----------------------------------------------------------------------------

/**
 * Middleware para proteger rutas WEB (HTML)
 * Verifica si existe una sesión de organizador activa.
 */
function isAuthenticated(req, res, next) {
    if (req.session.isOrganizer) {
        next();
    } else {
        res.redirect('/login');
    }
}

/**
 * Middleware para proteger rutas API (Móvil)
 * Verifica si el Token JWT es válido.
 */
const verificarToken = (req, res, next) => {
    const cabecera = req.headers['authorization'];
    
    if (!cabecera) {
        return res.status(403).json({ error: 'Acceso denegado: No hay token.' });
    }

    // Limpiamos el prefijo "Bearer " si viene
    const token = cabecera.replace('Bearer ', '');

    try {
        const decodificado = jwt.verify(token, JWT_SECRET);
        req.usuario = decodificado; // Guardamos datos del usuario para usarlos luego
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Token inválido o expirado.' });
    }
};

// ----------------------------------------------------------------------------
// 5. RUTAS API (Backend para App Móvil / React)
// ----------------------------------------------------------------------------

// --- A. AUTENTICACIÓN ---

app.post('/api/auth/registro', async (req, res) => {
    const { telefono, password, nombre } = req.body;

    if (!telefono || !password || !nombre) {
        return res.status(400).json({ error: 'Faltan datos obligatorios.' });
    }

    const usuarioExistente = await usuariosCollection.findOne({ telefono });

    if (usuarioExistente) {
        // Si existe y es provisional, lo activamos
        if (usuarioExistente.es_provisional) {
            const hashedPassword = await bcrypt.hash(password, 10);
            await usuariosCollection.updateOne(
                { telefono },
                { $set: { password: hashedPassword, nombre: nombre, es_provisional: false } }
            );
            return res.json({ mensaje: 'Cuenta recuperada y activada.' });
        } else {
            return res.status(400).json({ error: 'El teléfono ya está registrado.' });
        }
    }

    // Crear usuario nuevo
    const hashedPassword = await bcrypt.hash(password, 10);
    await usuariosCollection.insertOne({
        telefono,
        password: hashedPassword,
        nombre,
        rol: 'jugador',
        fechaRegistro: new Date(),
        es_provisional: false
    });

    res.json({ mensaje: 'Usuario registrado exitosamente.' });
});

app.post('/api/auth/login', async (req, res) => {
    const { telefono, password } = req.body;

    const usuario = await usuariosCollection.findOne({ telefono });

    if (!usuario) return res.status(400).json({ error: 'Usuario no encontrado.' });
    if (usuario.es_provisional) return res.status(400).json({ error: 'Cuenta no activada.' });

    const passwordValida = await bcrypt.compare(password, usuario.password);
    if (!passwordValida) return res.status(400).json({ error: 'Contraseña incorrecta.' });

    // Generar Token
    const token = jwt.sign(
        { id: usuario._id, telefono: usuario.telefono, rol: usuario.rol }, 
        JWT_SECRET
    );

    res.json({ token, nombre: usuario.nombre, rol: usuario.rol });
});

// --- B. TORNEOS ---

app.post('/api/torneos/crear', verificarToken, async (req, res) => {
    const { nombre, lugar, reglas } = req.body;
    const organizadorId = req.usuario.id;

    if (!nombre || !reglas) return res.status(400).json({ error: 'Faltan datos.' });

    const nuevoTorneo = {
        nombre,
        lugar: lugar || 'Sede Principal',
        organizador_id: new ObjectId(organizadorId),
        fecha_creacion: new Date(),
        activo: true,
        reglas: {
            puntos_ganar: reglas.puntos_ganar || 3,
            puntos_perder: reglas.puntos_perder || 1,
            limite_partidas: reglas.limite_partidas || 32,
            top_clasificados: reglas.top_clasificados || 8,
            reemplazos: reglas.reemplazos || 2,
            tipo_juego: reglas.tipo_juego || 'Bola 8'
        },
        jugadores_inscritos: []
    };

    const resultado = await torneosCollection.insertOne(nuevoTorneo);
    res.json({ mensaje: 'Torneo creado.', torneoId: resultado.insertedId, reglas: nuevoTorneo.reglas });
});

app.post('/api/torneos/inscribir', verificarToken, async (req, res) => {
    const { torneoId, usuarioId, alias } = req.body;

    if (!torneoId || !usuarioId) return res.status(400).json({ error: 'Faltan IDs.' });

    const existe = await participacionesCollection.findOne({
        torneo_id: new ObjectId(torneoId),
        usuario_id: new ObjectId(usuarioId)
    });

    if (existe) return res.status(400).json({ error: 'El jugador ya está inscrito.' });

    const usuario = await usuariosCollection.findOne({ _id: new ObjectId(usuarioId) });
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const resultado = await participacionesCollection.insertOne({
        torneo_id: new ObjectId(torneoId),
        usuario_id: new ObjectId(usuarioId),
        nombre_display: alias || usuario.nombre,
        fecha_inscripcion: new Date(),
        stats: { puntos: 0, partidasJugadas: 0, ganadas: 0, perdidas: 0, totalCarambolas: 0 }
    });

    res.json({ mensaje: 'Inscrito exitosamente.', participacionId: resultado.insertedId });
});

// --- C. REGISTRO DE PARTIDAS Y TABLA ---

app.post('/api/partidas/registrar', verificarToken, async (req, res) => {
    const { torneoId, ganadorId, perdedorId, marcadorGanador, marcadorPerdedor } = req.body;

    if (!torneoId || !ganadorId || !perdedorId) return res.status(400).json({ error: 'Faltan datos.' });

    try {
        const torneo = await torneosCollection.findOne({ _id: new ObjectId(torneoId) });
        if (!torneo) return res.status(404).json({ error: 'Torneo no encontrado.' });

        const ptsGanar = torneo.reglas?.puntos_ganar || 3;
        const ptsPerder = torneo.reglas?.puntos_perder || 1;

        // Actualizar Ganador
        await participacionesCollection.updateOne(
            { _id: new ObjectId(ganadorId) },
            { $inc: { 
                "stats.puntos": ptsGanar, 
                "stats.partidasJugadas": 1, 
                "stats.ganadas": 1, 
                "stats.totalCarambolas": parseInt(marcadorGanador || 0) 
            }}
        );

        // Actualizar Perdedor
        await participacionesCollection.updateOne(
            { _id: new ObjectId(perdedorId) },
            { $inc: { 
                "stats.puntos": ptsPerder, 
                "stats.partidasJugadas": 1, 
                "stats.perdidas": 1, 
                "stats.totalCarambolas": parseInt(marcadorPerdedor || 0) 
            }}
        );

        // Guardar Historial
        await historialCollection.insertOne({
            torneo_id: new ObjectId(torneoId),
            ganador_participacion_id: new ObjectId(ganadorId),
            perdedor_participacion_id: new ObjectId(perdedorId),
            marcadorGanador: parseInt(marcadorGanador),
            marcadorPerdedor: parseInt(marcadorPerdedor),
            fecha: new Date(),
            registrado_por: req.usuario.id
        });

        res.json({ mensaje: 'Partida registrada correctamente.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

app.get('/api/torneos/tabla/:id', verificarToken, async (req, res) => {
    const torneoId = req.params.id;

    try {
        const torneo = await torneosCollection.findOne({ _id: new ObjectId(torneoId) });
        if (!torneo) return res.status(404).json({ error: 'Torneo no encontrado' });

        const { limite_partidas, top_clasificados, reemplazos } = torneo.reglas;
        const limite = limite_partidas || 32;
        const corte = top_clasificados || 8;
        const rep = reemplazos || 2;

        let participantes = await participacionesCollection.find({ torneo_id: new ObjectId(torneoId) }).toArray();

        // Función de ordenamiento
        const ordenarPorPuntos = (a, b) => {
            const statsA = a.stats || {};
            const statsB = b.stats || {};
            if (statsB.puntos !== statsA.puntos) return (statsB.puntos || 0) - (statsA.puntos || 0);
            return (statsB.ganadas || 0) - (statsA.ganadas || 0);
        };

        // Clasificación por capas
        let elegibles = participantes.filter(p => (p.stats?.partidasJugadas || 0) >= limite);
        let resto = participantes.filter(p => (p.stats?.partidasJugadas || 0) < limite);

        elegibles.sort(ordenarPorPuntos);
        resto.sort(ordenarPorPuntos);

        const grupoClasificados = elegibles.slice(0, corte);
        const grupoReemplazos = elegibles.slice(corte, corte + rep);
        const grupoSobrantes = elegibles.slice(corte + rep);

        const rankingFinal = [...grupoClasificados, ...grupoReemplazos, ...grupoSobrantes, ...resto];

        // Mapeamos para enviar JSON limpio
        const respuesta = rankingFinal.map((p, index) => ({
            posicion: index + 1,
            nombre: p.nombre_display,
            puntos: p.stats.puntos,
            jugadas: p.stats.partidasJugadas,
            ganadas: p.stats.ganadas,
            promedio: p.stats.partidasJugadas > 0 
                ? (p.stats.totalCarambolas / p.stats.partidasJugadas).toFixed(2) 
                : "0.00",
            esClasificado: index < corte,
            esReemplazo: index >= corte && index < (corte + rep)
        }));

        res.json({
            torneo: torneo.nombre,
            reglas: { limite, corte, corteReemplazos: corte + rep },
            ranking: respuesta
        });

    } catch (e) {
        res.status(500).json({ error: 'Error al obtener tabla.' });
    }
});

// ----------------------------------------------------------------------------
// 6. RUTAS WEB CLÁSICAS (HTML / EJS Manual)
// ----------------------------------------------------------------------------

// Ruta: Inicio (Formulario + Menú)
app.get('/', isAuthenticated, async (req, res) => {
    const jugadores = await tablaCollection.find({}, { projection: { nombre: 1 } }).sort({ nombre: 1 }).toArray();
    const nombresOptions = jugadores.map(j => `<option value="${j.nombre}">${j.nombre}</option>`).join('');

    const content = `
        <h1>Registrar Partida 🎱</h1>
        <form action="/registrar-partida" method="POST">
            <h3>🏆 El Ganador</h3>
            <select name="ganador" class="buscador-select" data-placeholder="Selecciona al Ganador" required>
                <option></option>
                ${nombresOptions}
            </select>
            <input type="tel" name="mar1" placeholder="Marcador del Ganador" required />

            <hr> 
            <h3>🐢 El Perdedor</h3>
            <select name="perdedor" class="buscador-select" data-placeholder="Selecciona al Perdedor" required>
                <option></option>
                ${nombresOptions}
            </select>
            <input type="tel" name="mar2" placeholder="Marcador del Perdedor" required />
            
            <br><br>
            <button type="submit" class="button" style="background-color: #28a745;">Registrar Resultado ✅</button>
        </form>

        <br>
        <div class="navigation-buttons">
            <a href="/agregar-jugador" class="button">👤 Agregar Nuevo Jugador</a>
            <a href="/tabla" class="button">🏆 Ver Tabla de Posiciones</a>
            <a href="/editar" class="button" style="background-color: #d9534f;">🛠️ Editar Partidas</a>
            <a href="/buscar" class="button" style="background-color: #17a2b8;">🔍 Buscar Historial</a>
        </div>
        
        <form action="/deshacer" method="POST">
            <br>
            <button type="submit" style="background-color: red; color: white;">Deshacer Última Partida ⏪</button>
        </form>
    `;
    res.send(wrapHTML(content));
});

// Ruta: Tabla de Posiciones
app.get('/tabla', async (req, res) => {
    let todos = await tablaCollection.find().toArray();

    const ordenarPorPuntos = (a, b) => {
        if (b.puntos !== a.puntos) return b.puntos - a.puntos;
        return (b.ganadas || 0) - (a.ganadas || 0);
    };

    let elegibles = todos.filter(j => (j.partidasJugadas || 0) >= 32);
    let resto = todos.filter(j => (j.partidasJugadas || 0) < 32);

    elegibles.sort(ordenarPorPuntos);
    resto.sort(ordenarPorPuntos);

    let top8 = elegibles.slice(0, 8);
    let reemplazos = elegibles.slice(8, 10);
    let sobranElegibles = elegibles.slice(10);
    let rankingFinal = [...top8, ...reemplazos, ...sobranElegibles, ...resto];

    const filasTabla = rankingFinal.map((jugador, index) => {
        let promedio = 0;
        if (jugador.partidasJugadas > 0) {
           promedio = (jugador.totalCarambolas / jugador.partidasJugadas).toFixed(2);
        }

        let estiloExtra = '';
        if (index === 7) estiloExtra = 'border-bottom: 3px solid #d9534f;'; 
        else if (index === 9) estiloExtra = 'border-bottom: 3px solid #28a745;'; 

        return `
            <tr style="${estiloExtra}">
                <td>${index + 1}</td>
                <td>${jugador.nombre}</td>
                <td>${jugador.puntos}</td>
                <td>${jugador.partidasJugadas || 0}</td>
                <td>${promedio}</td>
            </tr>
        `;
    }).join('');

    const content = `
        <h2>🏆 Tabla General</h2>
        <table class="leaderboard">
            <thead>
                <tr>
                    <th>Pos</th>
                    <th>Nombre</th>
                    <th>Pts</th>
                    <th>Jugadas</th>
                    <th>Promedio</th>
                </tr>
            </thead>
            <tbody>
                ${filasTabla}
            </tbody>
        </table>

        <div style="margin-top: 20px; padding: 15px; background-color: #d4edda; border: 1px solid #c3e6cb; border-radius: 5px; color: #155724; max-width: 90%;">
            <strong>⚠️ REGLAS:</strong>
            <ul style="margin-top: 5px; padding-left: 20px;">
                <li>🔴 <strong>Línea Roja (1-8):</strong> Clasificados Finales.</li>
                <li>🟢 <strong>Línea Verde (9-10):</strong> Reemplazos.</li>
            </ul>
        </div>
        <br>
        <a href="/" class="button">🏠 Volver al inicio</a>
    `;
    res.send(wrapHTML(content));
});

// Ruta: Login
app.get('/login', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link rel="stylesheet" href="/styles.css">
            <title>Login</title>
        </head>
        <body>
            <div class="container">
                <h1>🚪 Iniciar Sesión</h1>
                <form action="/login" method="POST">
                    <label>Contraseña:</label>
                    <input type="password" name="password" required>
                    <button type="submit" class="button">Acceder</button>
                </form>
                <p><a href="/tabla" class="button">🏆 Ver Tabla</a></p>
                <a href="/buscar" class="button" style="background-color: #17a2b8;">🔍 Buscar Historial</a>
            </div>
        </body>
        </html>
    `);
});

app.post('/login', (req, res) => {
    if (req.body.password === process.env.ADMIN_PASSWORD) {
        req.session.isOrganizer = true;
        res.redirect('/');
    } else {
        res.send('Contraseña incorrecta. <a href="/login">Intentar de nuevo</a>');
    }
});

// Ruta: Buscar Jugador (Formulario)
app.get('/buscar', (req, res) => {
    const content = `
        <h1>🔍 Buscar Historial de Jugador</h1>
        <form action="/resultados" method="GET">
            <label>Ingresa el número de teléfono:</label>
            <input type="tel" name="telefono" required placeholder="Ej: 5512345678">
            <button type="submit" class="button">Ver Partidas</button>
        </form>
        <br>
        <a href="/" class ="button">🏠 Volver al inicio</a>
    `;
    res.send(wrapHTML(content));
});

// Ruta: Resultados de Búsqueda
app.get('/resultados', async (req, res) => {
    const telefonoBuscado = req.query.telefono;
    
    // Buscar al jugador por teléfono
    const jugador = await tablaCollection.findOne({ telefono: telefonoBuscado });

    if (!jugador) {
        return res.send(wrapHTML(`
            <h2>❌ No encontré ningún jugador con el teléfono ${telefonoBuscado}</h2>
            <a href="/buscar" class="button">Intentar de nuevo</a>
            <a href="/" class="button">🏠 Inicio</a>
        `));
    }
    
    const nombreEncontrado = jugador.nombre;

    // Buscar partidas
    const misPartidas = await historialCollection.find({
        $or: [
            { ganador: nombreEncontrado }, 
            { perdedor: nombreEncontrado }
        ]
    }).sort({ fecha: -1 }).toArray();

    let listaHTML = '';
    misPartidas.forEach(partida => {
        const esGanador = partida.ganador === nombreEncontrado;
        const resultado = esGanador ? "🏆 GANASTE" : "❌ PERDISTE";
        const rival = esGanador ? partida.perdedor : partida.ganador;
        const color = esGanador ? "#d4edda" : "#f8d7da";
        
        const fechaLegible = partida.fecha.toLocaleDateString('es-MX', { 
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' 
        });

        listaHTML += `
            <li style="background-color: ${color}; padding: 8px; margin-bottom: 5px; border-radius: 4px; list-style: none;">
                <strong>${fechaLegible}</strong>: ${resultado} vs <b>${rival}</b>
                <br>🎱 ${partida.marcadorGanador || 0} - ${partida.marcadorPerdedor || 0}
            </li>`;
    });

    const content = `
        <h1>Historial de ${nombreEncontrado} 📜</h1>
        <p>Teléfono: ${telefonoBuscado}</p>
        <h3>Partidas jugadas: ${misPartidas.length}</h3>
        <ul style="padding: 0;">
            ${listaHTML}
        </ul>
        <br>
        <a href="/buscar" class="button">🔍 Buscar otro</a> | <a href="/" class="button">🏠 Inicio</a>
    `;
    res.send(wrapHTML(content));
});

// Ruta: Editar (Selector)
app.get('/editar', isAuthenticated, async (req, res) => {
    const jugadores = await tablaCollection.find().sort({ nombre: 1 }).toArray();
    const nombresOptions = jugadores.map(j => `<option value="${j._id}">${j.nombre}</option>`).join('');
    
    res.send(wrapHTML(`
        <h2 style="color: #d9534f;">🛠️ Modo Edición</h2>
        <form action="/resultados-editar" method="GET">
            <label>Selecciona un Jugador:</label><br>
            <select name="jugador" class="buscador-select" data-placeholder="Selecciona un Jugador" required>
                <option></option>
                ${nombresOptions}
            </select>
            <br><br>
            <button type="submit" class="button" style="background-color: #d9534f;">Buscar Partidas</button>
        </form>
        <br>
        <a href="/" class="button">🏠 Inicio</a>
    `));
});

// Ruta: Editar (Resultados)
app.get('/resultados-editar', isAuthenticated, async (req, res) => {
    const jugadorId = req.query.jugador;
    
    // Buscar partidas donde aparezca como ganador O perdedor
    const partidas = await historialCollection.find({
        $or: [
            { ganador: jugadorId },
            { perdedor: jugadorId }
        ]
    }).sort({ fecha: -1 }).toArray();

    if (partidas.length === 0) {
        return res.send(wrapHTML(`<h2>El jugador ${jugadorId} no tiene partidas registradas.</h2><a href="/editar" class="button">Volver</a>`));
    }

    const listaHTML = partidas.map(p => {
        const esGanador = p.ganador === jugadorId;
        const colorFondo = esGanador ? "#d4edda" : "#f8d7da";
        
        return `
            <div style="background-color: ${colorFondo}; border: 1px solid #ccc; padding: 10px; margin: 10px auto; border-radius: 8px; display: flex; align-items: center;">
                <div style="margin-right: 15px;">
                    <input type="checkbox" name="idsPartidas" value="${p._id}" style="transform: scale(1.5);">
                </div>
                <div style="flex-grow: 1;">
                    <p><strong>${esGanador ? "🏆 GANÓ" : "🐢 PERDIÓ"}</strong> vs <strong>${esGanador ? p.perdedor : p.ganador}</strong></p>
                    <p>🎱 ${p.marcadorGanador || 0} - ${p.marcadorPerdedor || 0}</p>
                    <small>${new Date(p.fecha).toLocaleString()}</small>
                </div>
            </div>
        `;
    }).join('');

    res.send(wrapHTML(`
        <h2 style="color: #d9534f;">Editando a: ${jugadorId}</h2>
        <form action="/eliminar-multiples" method="POST" onsubmit="return confirm('⚠️ ¿Estás seguro de que deseas borrar las partidas seleccionadas?');">
            <input type="hidden" name="jugadorOriginal" value="${jugadorId}">
            ${listaHTML}
            <br>
            <button type="submit" class="button" style="background-color: #dc3545;">🗑️ Borrar Seleccionados</button>
        </form>
        <br>
        <a href="/editar" class="button">🔍 Buscar Otro</a>
        <a href="/" class="button">🏠 Inicio</a>
    `));
});

// Ruta: Eliminar Múltiples
app.post('/eliminar-multiples', isAuthenticated, async (req, res) => {
    let idsPartidas = req.body.idsPartidas;
    const jugadorOriginal = req.body.jugadorOriginal;

    if (!idsPartidas) {
        return res.redirect(`/resultados-editar?jugador=${jugadorOriginal}`);
    }

    if (!Array.isArray(idsPartidas)) {
        idsPartidas = [idsPartidas];
    }

    try {
        for (let i = 0; i < idsPartidas.length; i++) {
            const id = idsPartidas[i];
            const partida = await historialCollection.findOne({ _id: new ObjectId(id) });

            if (partida) {
                const { ganador, perdedor, marcadorGanador, marcadorPerdedor } = partida;

                // Restar al Ganador
                await tablaCollection.updateOne({ _id: ganador }, { 
                    $inc: { puntos: -3, ganadas: -1, partidasJugadas: -1, totalCarambolas: -marcadorGanador } 
                });

                // Restar al Perdedor
                await tablaCollection.updateOne({ _id: perdedor }, { 
                    $inc: { puntos: -1, partidasJugadas: -1, totalCarambolas: -marcadorPerdedor } 
                });

                // Eliminar registro
                await historialCollection.deleteOne({ _id: new ObjectId(id) });
            }
        }

        const successContent = `
            <h2 style="color: #dc3545;">🗑️ Partidas eliminadas</h2>
            <p>Se han borrado ${idsPartidas.length} registros y actualizado los puntos.</p>
            <br>
            <a href="/resultados-editar?jugador=${jugadorOriginal}" class="button">Seguir editando a ${jugadorOriginal}</a>
        `;
        res.send(wrapHTML(successContent));

    } catch (error) {
        console.error(error);
        res.send(wrapHTML('<h2>Error técnico al borrar múltiples.</h2><a href="/editar" class="button">Volver</a>'));
    }
});

// Ruta: Agregar Jugador
app.get('/agregar-jugador', isAuthenticated, (req, res) => {
    res.send(wrapHTML(`
        <h1>Nuevo Jugador 👤</h1>
        <form action="/agregar-jugador" method="POST">
            <input type="text" name="nombre" placeholder="Nombre Completo" required />
            <br><br>
            <input type="tel" name="telefono" placeholder="Teléfono (10 dígitos)" required />
            <br><br>
            <button type="submit" class="button">Guardar Jugador</button>
        </form>
        <br>
        <a href="/" class="button">🏠 Inicio</a>
    `));
});

app.post('/agregar-jugador', isAuthenticated, async (req, res) => {
    const { nombre, telefono } = req.body;

    if (telefono.length !== 10 || isNaN(telefono)) {
        return res.send(wrapHTML(`<h2>Error: El número de teléfono debe tener 10 dígitos.</h2><a href="/agregar-jugador" class="button">Volver</a>`));
    }

    await tablaCollection.insertOne({
        _id: nombre, 
        nombre: nombre,
        puntos: 0,
        ganadas: 0,
        telefono: telefono
    });

    res.send(wrapHTML(`<h2>Jugador Registrado: ${nombre}</h2><a href="/" class="button">Volver</a>`));
});

// Ruta: Registrar Partida (Clásica)
app.post('/registrar-partida', isAuthenticated, async (req, res) => {
    const { ganador, perdedor, mar1, mar2 } = req.body;

    if (isNaN(mar1) || isNaN(mar2)) {
        return res.send(wrapHTML(`<h2>⚠️ Error: Los marcadores deben ser números.</h2><a href="/" class="button">Volver</a>`));
    }
    
    if (ganador === perdedor) {
        return res.send(wrapHTML(`<h2>⚠️ Error: No puedes jugar contra ti mismo.</h2><a href="/" class="button">Volver</a>`));
    }
    
    // Verificar límite de 2 juegos
    const enfrentamientos = await historialCollection.countDocuments({
        $or: [
            { ganador: ganador, perdedor: perdedor },
            { ganador: perdedor, perdedor: ganador }
        ]
    });

    if (enfrentamientos >= 2) {
        return res.send(wrapHTML(`
            <h2>⚠️ Límite Alcanzado</h2>
            <p>Estos jugadores ya se han enfrentado 2 veces.</p>
            <a href="/" class="button">Volver</a>
        `));
    }

    // Actualizar Ganador
    await tablaCollection.updateOne(
        { _id: ganador },
        { 
            $inc: { puntos: 3, ganadas: 1, totalCarambolas: parseInt(mar1), partidasJugadas: 1 },
            $set: { nombre: ganador }
        },
        { upsert: true }
    );

    // Actualizar Perdedor
    await tablaCollection.updateOne(
        { _id: perdedor },
        { 
            $inc: { puntos: 1, totalCarambolas: parseInt(mar2), partidasJugadas: 1 },
            $set: { nombre: perdedor }
        },
        { upsert: true }
    );

    // Guardar Historial
    await historialCollection.insertOne({
        ganador: ganador,
        marcadorGanador: mar1,
        perdedor: perdedor,
        marcadorPerdedor: mar2,
        fecha: new Date()
    });

    res.send(wrapHTML(`
        <h2>✅ Partida registrada: ${ganador} ganó a ${perdedor}.</h2>
        <a href="/tabla" class="button">🏆 Ver tabla</a> | <a href="/" class="button">🏠 Inicio</a>
    `));
});

// Ruta: Deshacer
app.post('/deshacer', isAuthenticated, async (req, res) => {
    // Buscar la última partida registrada
    const ultimaPartida = await historialCollection.findOne({}, { sort: { fecha: -1 } });

    if (ultimaPartida) {
        const { ganador, perdedor, marcadorGanador, marcadorPerdedor } = ultimaPartida;

        // Restar stats al ganador
        await tablaCollection.updateOne(
            { _id: ganador },
            { $inc: { puntos: -3, ganadas: -1, partidasJugadas: -1, totalCarambolas: -(marcadorGanador || 0) } }
        );

        // Restar stats al perdedor
        await tablaCollection.updateOne(
            { _id: perdedor },
            { $inc: { puntos: -1, partidasJugadas: -1, totalCarambolas: -(marcadorPerdedor || 0) } }
        );

        // Eliminar del historial
        await historialCollection.deleteOne({ _id: ultimaPartida._id });
    }
    
    res.redirect('/');
});

// ----------------------------------------------------------------------------
// 7. FUNCIONES AUXILIARES
// ----------------------------------------------------------------------------

function wrapHTML(content) {
    return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Torneo Billar</title>
        <link rel="stylesheet" href="/styles.css">
        <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet" />
        <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>
        <script>
            $(document).ready(function() {
                $('.buscador-select').select2({
                    width: '100%',
                    allowClear: true
                });
            });
        </script>
    </head>
    <body>
        <div class="container">
            ${content}
        </div>
    </body>
    </html>
    `;
}

// ----------------------------------------------------------------------------
// 8. INICIAR SERVIDOR
// ----------------------------------------------------------------------------

// Conectamos a BD y luego iniciamos el servidor para evitar errores
connectToDB().then(() => {
    app.listen(port, () => {
        console.log(`🚀 Servidor corriendo en http://localhost:${port}`);
    });
});