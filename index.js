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

app.use((req, res, next) => {
    console.log(`\n🔔 PETICIÓN ENTRANTE: [${req.method}] ${req.url}`);
    next(); // Deja pasar a la siguiente función
});

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

// ==========================================
// 1. RUTA DE REGISTRO (Lógica de Negocio)
// ==========================================
app.post('/api/auth/registro', async (req, res) => {
    const { nombre, telefono, password, rolSeleccionado, claveActivacion } = req.body;

    // A. Validaciones básicas
    if (!telefono || !password || !nombre) {
        return res.status(400).json({ error: 'Faltan datos obligatorios.' });
    }

    // B. Verificar duplicados
    const existe = await usuariosCollection.findOne({ telefono });
    if (existe) {
        return res.status(400).json({ error: 'Este teléfono ya está registrado.' });
    }

    // C. DEFINICIÓN DEL ROL
    let rolFinal = 'jugador'; // Por defecto

    // TU NÚMERO DE TELÉFONO (Poder Supremo) 👑
    // Reemplaza esto con tu número real
    const MI_TELEFONO_ADMIN = '4432180296'; 

    if (telefono === MI_TELEFONO_ADMIN) {
        rolFinal = 'admin'; // Tú no necesitas clave, entras directo como dios.
    } else if (rolSeleccionado === 'organizador') {
        // Si un mortal quiere ser organizador, PIDE CLAVE 💰
        if (!claveActivacion) {
            return res.status(400).json({ error: 'Se requiere Clave de Activación para ser Organizador.' });
        }
        
        // Verificar la clave en la BD
        const claveValida = await db.collection('claves').findOne({ clave: claveActivacion, usada: false });
        
        if (!claveValida) {
            return res.status(400).json({ error: 'Clave inválida o ya utilizada.' });
        }

        // Quemar la clave (marcarla como usada)
        await db.collection('claves').updateOne(
            { _id: claveValida._id },
            { $set: { usada: true, usadaPor: telefono, fechaUso: new Date() } }
        );
        
        rolFinal = 'organizador';
    }

    // D. Crear el usuario
    const nuevoUsuario = {
        nombre,
        telefono,
        password: await bcrypt.hash(password, 10),
        rol: rolFinal,
        rfidTag: null, // 🔮 Preparado para el futuro (Fase 3.0)
        activo: true,
        fechaRegistro: new Date()
    };

    await usuariosCollection.insertOne(nuevoUsuario);

    // Crear su tabla de puntos inicial
    await tablaCollection.insertOne({
        nombre: nombre,
        telefono: telefono,
        puntos: 0,
        ganadas: 0,
        partidasJugadas: 0,
        rol: rolFinal
    });

    res.json({ message: 'Usuario registrado con éxito', rol: rolFinal });
});

// ==========================================
// 2. RUTA DE LOGIN (CORREGIDA)
// ==========================================
app.post('/api/auth/login', async (req, res) => {
    const { telefono, password } = req.body;

    const usuario = await usuariosCollection.findOne({ telefono });
    if (!usuario) {
        return res.status(400).json({ error: 'Usuario no encontrado' });
    }

    const passCorrecto = await bcrypt.compare(password, usuario.password);
    if (!passCorrecto) {
        return res.status(400).json({ error: 'Contraseña incorrecta' });
    }

    // Generar Token con la llave CORRECTA (JWT_SECRET)
    const token = jwt.sign(
        { id: usuario._id, nombre: usuario.nombre, rol: usuario.rol }, 
        JWT_SECRET, // <--- AQUÍ ESTABA EL ERROR, AHORA COINCIDE CON EL PORTERO
        { expiresIn: '1h' }
    );

    res.json({ 
        token, 
        nombre: usuario.nombre, 
        rol: usuario.rol 
    });
});

// --- C. RUTA DE DUEÑO (Generar Claves) ---
app.post('/api/admin/generar-clave', verificarToken, async (req, res) => {
    // 1. Verificamos que sea admin (CORREGIDO: 'admin' en minúsculas)
    if (req.usuario.rol !== 'admin') {
        return res.status(403).json({ error: 'No eres el Dueño.' });
    }

    // 2. Generamos clave aleatoria (Ej: K9X-2PL)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let nuevaClave = '';
    for (let i = 0; i < 6; i++) {
        nuevaClave += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    // 3. Guardamos en BD (CORREGIDO: Usamos db.collection directo)
    try {
        await db.collection('claves').insertOne({ 
            clave: nuevaClave, 
            usada: false, 
            creadaEn: new Date(),
            creadaPor: req.usuario.nombre
        });

        res.json({ message: 'Clave generada', clave: nuevaClave });
    } catch (error) {
        console.error('Error al generar clave:', error);
        res.status(500).json({ error: 'Error interno al guardar la clave' });
    }
});



// --- B. TORNEOS ---

// ==========================================
// RUTA API: CREAR TORNEO (CON REGLAS DE PUNTOS Y CLASIFICACIÓN) 🏆
// ==========================================
app.post('/api/torneos/crear', verificarToken, async (req, res) => {
    try {
        console.log('📡 RECIBIENDO TORNEO COMPLETO...');
        
        // 1. Recibimos todos los datos nuevos
        const { 
            nombre, sede, precio, 
            juegos, carambolas, 
            fechaInicio, fechaFin,
            puntosGanar, puntosPerder, clasificados 
        } = req.body;

        // 2. Validaciones
        if (!nombre || !sede || precio === undefined || precio === '') {
            return res.status(400).json({ error: 'Faltan datos obligatorios.' });
        }

        // 3. Procesar Fechas
        let inicio = new Date();
        if (fechaInicio) inicio = new Date(fechaInicio);

        // 4. Armar el objeto FINAL para la Base de Datos
        const nuevoTorneo = {
            nombre: nombre,
            lugar: sede,
            precio: parseFloat(precio),
            esAmistoso: parseFloat(precio) === 0,
            
            // --- AQUÍ ESTÁN LAS REGLAS NUEVAS ---
            reglas: {
                juegosPorEnfrentamiento: parseInt(juegos) || 1,
                carambolasMeta: parseInt(carambolas) || 30,
                
                // Sistema de Puntos
                puntos_ganar: parseInt(puntosGanar) || 3,  // Ej: 3 pts por ganar
                puntos_perder: parseInt(puntosPerder) || 0, // Ej: 0 pts por perder
                
                // Clasificación
                top_clasificados: parseInt(clasificados) || 8 // Ej: Pasan los mejores 8
            },
            
            fechas: {
                inicio: inicio,
                fin: fechaFin ? new Date(fechaFin) : null
            },

            organizador_id: new ObjectId(req.usuario.id),
            organizador_nombre: req.usuario.nombre,
            estado: 'abierto',
            jugadores_inscritos: [],
            creadoEn: new Date()
        };

        const resultado = await torneosCollection.insertOne(nuevoTorneo);
        
        console.log('✅ Torneo configurado y creado. ID:', resultado.insertedId);
        res.json({ message: 'Torneo creado exitosamente', torneoId: resultado.insertedId });

    } catch (error) {
        console.error('🔥 Error al crear torneo:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});


// --- C. REGISTRO DE PARTIDAS Y TABLA ---

// ==========================================
// RUTA ACTUALIZADA: REGISTRAR PARTIDO Y SUMAR PUNTOS
// (Sustituye a tu antigua ruta /api/partidas/registrar)
// ==========================================
// index.js - REGISTRO DE PARTIDAS CORREGIDO
app.post('/api/partidos/registrar-manual', verificarToken, async (req, res) => {
    try {
        const { torneoId, jugador1Id, jugador2Id, puntaje1, puntaje2 } = req.body;

        // 1. VALIDACIÓN ANTISUICIDIO: No jugar contra sí mismo
        if (jugador1Id === jugador2Id) {
            return res.status(400).json({ error: 'Un jugador no puede jugar contra sí mismo.' });
        }

        if (!torneoId || !jugador1Id || !jugador2Id) {
            return res.status(400).json({ error: 'Faltan datos de los jugadores o torneo.' });
        }

        const p1 = parseInt(puntaje1) || 0;
        const p2 = parseInt(puntaje2) || 0;
        
        let ganadorId = null;
        if (p1 > p2) ganadorId = jugador1Id;
        if (p2 > p1) ganadorId = jugador2Id;

        const nuevaPartida = {
            torneo_id: new ObjectId(torneoId),
            jugador1: jugador1Id, 
            jugador2: jugador2Id,
            puntaje1: p1,
            puntaje2: p2,
            ganadorId: ganadorId,
            fecha: new Date(),
            tipo: 'manual'
        };

        // ✅ CORRECCIÓN: Usamos historialCollection (que es la variable correcta)
        await historialCollection.insertOne(nuevaPartida);

        // Definimos la función interna para actualizar estadísticas
        const actualizarJugador = async (idJugador, puntosGanados, carambolasHechas, esGanador) => {
            await torneosCollection.updateOne(
                { _id: new ObjectId(torneoId), "jugadores_inscritos.id": idJugador },
                { 
                    $inc: { 
                        "jugadores_inscritos.$.partidosJugados": 1,
                        "jugadores_inscritos.$.puntos": puntosGanados,
                        "jugadores_inscritos.$.carambolas": carambolasHechas,
                        "jugadores_inscritos.$.victorias": (esGanador ? 1 : 0),
                        "jugadores_inscritos.$.derrotas": (!esGanador ? 1 : 0)
                    }
                }
            );
        };

        // REGLAS DE PUNTOS: (3 al ganador, 1 por perder)
        const puntosGanador = 3;
        const puntosPerdedor = 1; 

        if (ganadorId) {
            // Hubo un ganador definido
            await actualizarJugador(jugador1Id, (jugador1Id === ganadorId ? puntosGanador : puntosPerdedor), p1, (jugador1Id === ganadorId));
            await actualizarJugador(jugador2Id, (jugador2Id === ganadorId ? puntosGanador : puntosPerdedor), p2, (jugador2Id === ganadorId));
        } else {
            // Fue Empate (1 punto a cada uno)
            await actualizarJugador(jugador1Id, 1, p1, false);
            await actualizarJugador(jugador2Id, 1, p2, false);
        }

        res.json({ message: 'Partido registrado y tabla actualizada.', partida: nuevaPartida });

    } catch (error) {
        console.error('🔥 ERROR CRÍTICO:', error);
        res.status(500).json({ error: 'Error interno: Revisa la consola del servidor.' });
    }
});


// ==========================================
// RUTA FALTANTE: OBTENER PARTIDOS DE UN TORNEO 📋
// ==========================================

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


// 👇 PEGA ESTO EN LA SECCIÓN DE API (Antes de las rutas Web)

app.get('/api/tabla-general', async (req, res) => {
    try {
        // Obtenemos los datos de la colección "vieja" (Web)
        const jugadores = await tablaCollection.find().toArray();
        
        // Ordenamos por puntos (Mayor a menor)
        jugadores.sort((a, b) => (b.puntos || 0) - (a.puntos || 0));

        res.json(jugadores);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener la tabla' });
    }
});


// ==========================================
// RUTA: CREAR TORNEO (ACTUALIZADA CON HANDICAP)
// ==========================================
app.post('/api/torneos/crear', verificarToken, async (req, res) => {
    try {
        const { 
            nombre, sede, precio, tipo, 
            juegos, carambolas, puntosGanar, puntosPerder,
            mesasDisponibles, formatoFinal, clasificados, porcentajeMinimo,
            usaHandicap, 
            ventajaPorRango, // <--- NUEVO CAMPO (Ej: 2)
            maxPagos
        } = req.body;

        if (!nombre || !sede || !tipo) return res.status(400).json({ error: 'Datos incompletos.' });

        const nuevoTorneo = {
            nombre, lugar: sede, precio: parseFloat(precio) || 0, tipo, esAmistoso: parseFloat(precio) === 0,
            
            configuracion: {
                mesas: parseInt(mesasDisponibles) || 0,
                formatoFinal: formatoFinal || 'snake',
            },

            reglas: {
                juegosPorEnfrentamiento: parseInt(juegos) || 1,
                carambolasMeta: parseInt(carambolas) || 30,
                puntos_ganar: parseInt(puntosGanar) || 3,
                puntos_perder: parseInt(puntosPerder) || 0,
                top_clasificados: parseInt(clasificados) || 8,
                
                usaHandicap: usaHandicap || false,
                ventajaPorRango: usaHandicap ? (parseInt(ventajaPorRango) || 2) : 0, // Guardamos la regla (2 carambolas)
                
                minimoPartidasPorcentaje: tipo === 'liga_sorteo' ? parseFloat(porcentajeMinimo) : null,
                maxPartidasPagadas: parseInt(maxPagos) || 0 
            },
            
            fechas: { inicio: new Date(), fin: null },
            organizador_id: new ObjectId(req.usuario.id),
            estado: 'abierto',
            jugadores_inscritos: [],
            creadoEn: new Date()
        };

        const resultado = await torneosCollection.insertOne(nuevoTorneo);
        res.json({ message: 'Torneo creado.', torneoId: resultado.insertedId });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error interno.' });
    }
});

// ==========================================
// NUEVA RUTA: EL "BOTÓN DE PÁNICO" (EDITAR REGLAS EN VIVO) 🛠️
// ==========================================
app.post('/api/torneos/editar-reglas', verificarToken, async (req, res) => {
    try {
        if (req.usuario.rol !== 'organizador') return res.status(403).json({ error: 'No autorizado' });

        const { torneoId, nuevoPorcentaje, nuevosClasificados } = req.body;

        // Solo permitimos editar cosas críticas para salvar el torneo
        const updateData = {};
        if (nuevoPorcentaje) updateData['reglas.minimoPartidasPorcentaje'] = parseFloat(nuevoPorcentaje);
        if (nuevosClasificados) updateData['reglas.top_clasificados'] = parseInt(nuevosClasificados);

        await torneosCollection.updateOne(
            { _id: new ObjectId(torneoId) },
            { $set: updateData }
        );

        res.json({ message: 'Reglas actualizadas correctamente.' });
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar reglas' });
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


// ==========================================
// 6. GESTIÓN INTEGRAL: TORNEOS, PARTIDOS E INSCRIPCIONES
// ==========================================

// A. LISTAR MIS TORNEOS (Filtro por Rol)
app.get('/api/torneos/mis-torneos', verificarToken, async (req, res) => {
    try {
        let filtro = {};
        if (req.usuario.rol === 'organizador' || req.usuario.rol === 'admin') {
            filtro = { organizador_id: new ObjectId(req.usuario.id) };
        } else {
            filtro = { "jugadores_inscritos.id": req.usuario.id };
        }
        const torneos = await torneosCollection.find(filtro).sort({ creadoEn: -1 }).toArray();
        res.json(torneos);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener torneos' });
    }
});

// B. LISTA GENERAL (Para el Dashboard Principal)
app.get('/api/torneos', async (req, res) => {
    try {
        const torneos = await torneosCollection.find().sort({ _id: -1 }).toArray();
        res.json(torneos);
    } catch (error) {
        res.status(500).json({ error: 'Error cargando torneos' });
    }
});

// ==========================================
// RUTA MEJORADA: OBTENER PARTIDOS (VERSIÓN DEBUG) 🐛
// ==========================================
app.get('/api/torneos/:id/partidos', async (req, res) => {
    try {
        const torneoId = req.params.id;
        console.log(`\n🔍 APP PIDE PARTIDOS DEL TORNEO: ${torneoId}`);

        // 1. Buscamos las partidas en el HISTORIAL
        const partidas = await historialCollection
            .find({ torneo_id: new ObjectId(torneoId) })
            .sort({ fecha: -1 })
            .toArray();
            
        console.log(`✅ ENCONTRADAS EN DB: ${partidas.length} partidas.`);

        // 2. Buscamos el torneo para obtener el "Diccionario de Nombres"
        const torneo = await torneosCollection.findOne({ _id: new ObjectId(torneoId) });
        
        const nombresMap = {};
        if (torneo && torneo.jugadores_inscritos) {
            torneo.jugadores_inscritos.forEach(j => {
                // Guardamos el ID como string para asegurar coincidencia
                nombresMap[String(j.id)] = j.nombre;
            });
        }

        // 3. "Hidratamos" las partidas
        const partidasConNombres = partidas.map(p => {
            // Convertimos a string para buscar en el mapa sin errores de tipo
            const idJ1 = String(p.jugador1);
            const idJ2 = String(p.jugador2);

            return {
                ...p, 
                // Si no encuentra el nombre, pone el ID para que al menos veamos algo
                jugador1: { id: p.jugador1, nombre: nombresMap[idJ1] || '⚠️ ' + idJ1.slice(-4) },
                jugador2: { id: p.jugador2, nombre: nombresMap[idJ2] || '⚠️ ' + idJ2.slice(-4) }
            };
        });

        console.log(`📤 ENVIANDO ${partidasConNombres.length} DATOS A LA APP.\n`);
        res.json(partidasConNombres);

    } catch (error) {
        console.error('🔥 ERROR CRÍTICO AL LEER PARTIDOS:', error);
        res.status(500).json({ error: 'Error al cargar los partidos.' });
    }
});

// D. INSCRIBIR JUGADOR (Con Validación Anti-Duplicados)
app.post('/api/torneos/inscribir', verificarToken, async (req, res) => {
    try {
        let { torneoId, nombre, telefono } = req.body;

        const torneo = await torneosCollection.findOne({ _id: new ObjectId(torneoId) });
        if (!torneo) return res.status(404).json({ error: 'Torneo no encontrado.' });

        // Validación: ¿Ya existe el teléfono en este torneo?
        const yaInscrito = torneo.jugadores_inscritos && torneo.jugadores_inscritos.some(j => j.telefono === telefono);
        if (yaInscrito) {
            return res.status(400).json({ error: 'Este jugador ya está inscrito en el torneo.' });
        }

        // Si viene solo teléfono, buscamos el nombre en usuarios
        if (!nombre && telefono) {
            const usuarioExistente = await usuariosCollection.findOne({ telefono });
            if (usuarioExistente) {
                nombre = usuarioExistente.nombre;
            } else {
                return res.status(400).json({ error: 'El número no está registrado. Ingresa un nombre.' });
            }
        }

        if (!torneoId || !nombre || !telefono) {
            return res.status(400).json({ error: 'Faltan datos obligatorios.' });
        }

        const nuevoJugador = {
            id: new ObjectId().toString(),
            nombre: nombre,
            telefono: telefono,
            puntos: 0,
            partidosJugados: 0,
            victorias: 0, // Unificamos nombres de campos (victorias vs ganados)
            derrotas: 0,
            carambolas: 0,
            inscritoEn: new Date()
        };

        await torneosCollection.updateOne(
            { _id: new ObjectId(torneoId) },
            { $push: { jugadores_inscritos: nuevoJugador } }
        );

        res.json({ message: 'Inscripción exitosa.', nuevoJugador });

    } catch (error) {
        console.error("Error en inscripción:", error);
        res.status(500).json({ error: 'Error interno al inscribir.' });
    }
});


// RUTA PARA MIGRAR DATOS (Versión simplificada para correr hoy)
app.get('/api/admin/migrar-datos/:torneoId', async (req, res) => {
    // ⚠️ ELIMINAMOS LA VERIFICACIÓN DE ROL POR AHORA
    // (Ya no usamos req.usuario.rol para que no te de error)

    try {
        const { torneoId } = req.params;

        console.log("Iniciando migración para torneo:", torneoId);

        // 1. Traemos TODOS los datos de la tabla de la web
        const jugadoresViejos = await tablaCollection.find({}).toArray();

        if (jugadoresViejos.length === 0) {
            return res.json({ message: "No se encontraron jugadores en la tabla vieja para migrar." });
        }

        // 2. Los transformamos
        const jugadoresMapeados = jugadoresViejos.map(j => ({
            id: new ObjectId().toString(), 
            nombre: j.nombre,
            telefono: j.telefono || '0000000000',
            puntos: parseInt(j.puntos) || 0,
            partidosJugados: parseInt(j.jugados) || 0,
            victorias: parseInt(j.ganadas) || 0,
            carambolas: 0
        }));

        // 3. Los insertamos
        await torneosCollection.updateOne(
            { _id: new ObjectId(torneoId) },
            { $set: { jugadores_inscritos: jugadoresMapeados } }
        );

        res.json({ 
            message: `¡Migración exitosa! ${jugadoresMapeados.length} jugadores copiados.`,
            estado: "Revisa tu App Móvil, los datos deben aparecer ahora."
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error en la migración: ' + error.message });
    }
});

// index.js

// =======================================================
// RUTA CORREGIDA: MIGRAR HISTORIAL (Web Clásica -> App Móvil)
// =======================================================
app.get('/api/admin/migrar-historial-partidas/:torneoId', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ error: "Base de datos no conectada." });

        const { torneoId } = req.params;
        const torneoObjectId = new ObjectId(torneoId);

        // 1. Obtenemos el torneo para el diccionario de IDs
        const torneo = await torneosCollection.findOne({ _id: torneoObjectId });
        if (!torneo) return res.status(404).json({ error: "Torneo no encontrado" });

        const mapaJugadores = {};
        if (torneo.jugadores_inscritos) {
            torneo.jugadores_inscritos.forEach(j => {
                if (j.nombre) mapaJugadores[j.nombre.toLowerCase().trim()] = j.id;
            });
        }

        // 2. CORRECCIÓN: Buscamos en 'historialPartidas' (tu colección real)
        // Filtramos solo las partidas viejas (las que no tienen torneo_id asociado)
        const partidasViejas = await db.collection('historialPartidas')
            .find({ torneo_id: { $exists: false } }) 
            .toArray();
        
        let partidasImportadas = 0;
        let errores = 0;

        for (const p of partidasViejas) {
            // 3. CORRECCIÓN: Mapeamos tus campos viejos (ganador/perdedor)
            // En tu web vieja guardas: { ganador: "Nombre", perdedor: "Nombre", marcadorGanador: 10, ... }
            const nombreGanador = p.ganador;
            const nombrePerdedor = p.perdedor;

            if (!nombreGanador || !nombrePerdedor) continue;

            const idGanador = mapaJugadores[nombreGanador.toLowerCase().trim()];
            const idPerdedor = mapaJugadores[nombrePerdedor.toLowerCase().trim()];

            // Solo migramos si ambos existen en el torneo nuevo
            if (idGanador && idPerdedor) {
                const puntosGanador = parseInt(p.marcadorGanador) || 0;
                const puntosPerdedor = parseInt(p.marcadorPerdedor) || 0;

                const nuevaPartida = {
                    torneo_id: torneoObjectId,
                    jugador1: idGanador, // Asumimos J1 como Ganador para el registro
                    jugador2: idPerdedor,
                    puntaje1: puntosGanador,
                    puntaje2: puntosPerdedor,
                    ganadorId: idGanador, // Ya sabemos quién ganó
                    fecha: p.fecha ? new Date(p.fecha) : new Date(),
                    tipo: 'migracion_historica'
                };

                await historialCollection.insertOne(nuevaPartida);
                partidasImportadas++;
            } else {
                errores++;
            }
        }

        res.json({
            message: "Migración finalizada.",
            total_partidas_viejas_encontradas: partidasViejas.length,
            importadas_a_la_app: partidasImportadas,
            no_coincidieron_nombres: errores,
            nota: "Si 'no_coincidieron' es alto, revisa que los nombres en la App sean idénticos a la Web."
        });

    } catch (error) {
        console.error("Error migración:", error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 🧮 RECALCULAR ESTADÍSTICAS (MODO BILLAR: SIN EMPATES)
// Reglas: Ganar = 3 pts, Perder = 1 pt.
// ==========================================
app.get('/api/admin/recalcular-stats/:torneoId', async (req, res) => {
    try {
        const { torneoId } = req.params;
        const torneoObjectId = new ObjectId(torneoId);

        // 1. Obtener datos
        const torneo = await torneosCollection.findOne({ _id: torneoObjectId });
        if (!torneo) return res.status(404).json({ error: "Torneo no encontrado" });

        const partidas = await historialCollection.find({ torneo_id: torneoObjectId }).toArray();

        // 2. Reiniciar contadores (Eliminamos la columna 'empates')
        const stats = {};
        if (torneo.jugadores_inscritos) {
            torneo.jugadores_inscritos.forEach(j => {
                stats[j.id] = {
                    ...j, 
                    puntos: 0,          
                    carambolas: 0,      
                    partidosJugados: 0,
                    victorias: 0,
                    derrotas: 0
                    // Ya no existe 'empates'
                };
            });
        }

        // 3. Procesar lógica estricta (Ganar o Perder)
        partidas.forEach(p => {
            const id1 = String(p.jugador1);
            const id2 = String(p.jugador2);
            const score1 = parseInt(p.puntaje1) || 0;
            const score2 = parseInt(p.puntaje2) || 0;

            // Solo procesamos si los jugadores existen en la lista de inscritos
            if (stats[id1] && stats[id2]) {
                
                // CASO 1: JUGADOR 1 GANA
                if (score1 > score2) {
                    // J1 Gana
                    stats[id1].partidosJugados++;
                    stats[id1].carambolas += score1;
                    stats[id1].victorias++;
                    stats[id1].puntos += 3; // 🏆 3 Puntos

                    // J2 Pierde
                    stats[id2].partidosJugados++;
                    stats[id2].carambolas += score2;
                    stats[id2].derrotas++;
                    stats[id2].puntos += 1; // 💀 1 Punto
                } 
                // CASO 2: JUGADOR 2 GANA
                else if (score2 > score1) {
                    // J2 Gana
                    stats[id2].partidosJugados++;
                    stats[id2].carambolas += score2;
                    stats[id2].victorias++;
                    stats[id2].puntos += 3; // 🏆 3 Puntos

                    // J1 Pierde
                    stats[id1].partidosJugados++;
                    stats[id1].carambolas += score1;
                    stats[id1].derrotas++;
                    stats[id1].puntos += 1; // 💀 1 Punto
                }
                // SI SON IGUALES (score1 === score2) NO HACEMOS NADA
                // Esto evita errores si se guardó un 0-0 por accidente.
            }
        });

        // 4. Guardar cambios en la base de datos
        const jugadoresActualizados = Object.values(stats);
        
        // Ordenamos la tabla de una vez (Por Puntos, luego por Carambolas)
        jugadoresActualizados.sort((a, b) => {
            if (b.puntos !== a.puntos) return b.puntos - a.puntos;
            return b.carambolas - a.carambolas;
        });

        await torneosCollection.updateOne(
            { _id: torneoObjectId },
            { $set: { jugadores_inscritos: jugadoresActualizados } }
        );

        res.json({
            message: "Estadísticas Billar Recalculadas (Sin Empates).",
            total_partidas: partidas.length,
            tabla_posiciones: jugadoresActualizados.map(j => ({
                nombre: j.nombre,
                pts: j.puntos,
                pj: j.partidosJugados,
                g: j.victorias,
                p: j.derrotas
            }))
        });

    } catch (error) {
        console.error("Error recalculando:", error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 🧹 HERRAMIENTA DE LIMPIEZA: BORRAR DUPLICADOS
// ==========================================
app.get('/api/admin/limpiar-duplicados/:torneoId', async (req, res) => {
    try {
        const { torneoId } = req.params;
        const torneoObjectId = new ObjectId(torneoId);

        // 1. Traer TODAS las partidas del torneo
        const partidas = await historialCollection.find({ torneo_id: torneoObjectId }).toArray();
        
        const firmasVistas = new Set();
        let duplicadosEncontrados = 0;
        let partidasBorradas = 0;

        for (const p of partidas) {
            // Creamos una "firma única" para cada partida basada en sus datos clave
            // Usamos J1, J2, Puntajes y Fecha (convertida a string para comparar)
            const firma = `${p.jugador1}-${p.jugador2}-${p.puntaje1}-${p.puntaje2}-${new Date(p.fecha).getTime()}`;

            if (firmasVistas.has(firma)) {
                // 🚨 ¡Es un duplicado! Ya vimos esta firma antes.
                // Lo borramos de la base de datos
                await historialCollection.deleteOne({ _id: p._id });
                duplicadosEncontrados++;
                partidasBorradas++;
            } else {
                // Es la primera vez que vemos esta partida, la guardamos en el Set
                firmasVistas.add(firma);
            }
        }

        res.json({
            message: "Limpieza completada.",
            total_partidas_analizadas: partidas.length,
            duplicados_eliminados: partidasBorradas,
            partidas_unicas_restantes: partidas.length - partidasBorradas,
            instruccion: "AHORA EJECUTA LA RUTA DE 'RECALCULAR-STATS' PARA CORREGIR LA TABLA."
        });

    } catch (error) {
        console.error("Error limpieza:", error);
        res.status(500).json({ error: error.message });
    }
});


// ==========================================
// 🕵️ DETECTIVE DE PUNTOS: AUDITORÍA PASO A PASO
// ==========================================
app.get('/api/debug/auditar-jugador/:torneoId/:nombreJugador', async (req, res) => {
    try {
        const { torneoId, nombreJugador } = req.params;
        const torneoObjectId = new ObjectId(torneoId);

        // 1. Buscar las partidas de ese jugador
        // Usamos Regex para buscar el nombre sin importar mayúsculas
        const torneo = await torneosCollection.findOne({ _id: torneoObjectId });
        
        // Buscar el ID del jugador basado en el nombre que escribiste
        const jugador = torneo.jugadores_inscritos.find(j => 
            j.nombre.toLowerCase().includes(nombreJugador.toLowerCase())
        );

        if (!jugador) return res.status(404).json({ error: "Jugador no encontrado con ese nombre." });

        const partidas = await historialCollection.find({
            torneo_id: torneoObjectId,
            $or: [{ jugador1: jugador.id }, { jugador2: jugador.id }]
        }).toArray();

        // 2. Simulación de la suma paso a paso
        let auditoria = [];
        let sumaPuntosLiga = 0;   // Puntos para la tabla (PJ, PG, etc)
        let sumaCarambolas = 0;   // Puntos anotados en el juego

        partidas.forEach((p, index) => {
            const soyJ1 = String(p.jugador1) === String(jugador.id);
            
            // Convertimos a número para evitar errores de texto
            const misPuntos = parseInt(soyJ1 ? p.puntaje1 : p.puntaje2) || 0;
            const rivalPuntos = parseInt(soyJ1 ? p.puntaje2 : p.puntaje1) || 0;
            
            let resultado = "";
            let puntosGanadosEstaPartida = 0;

            if (misPuntos > rivalPuntos) {
                resultado = "VICTORIA";
                puntosGanadosEstaPartida = 3; // <--- OJO AQUÍ: ¿ESTO ES LO QUE QUIERES?
            } else if (misPuntos === rivalPuntos) {
                resultado = "EMPATE";
                puntosGanadosEstaPartida = 1;
            } else {
                resultado = "DERROTA";
                puntosGanadosEstaPartida = 0;
            }

            sumaPuntosLiga += puntosGanadosEstaPartida;
            sumaCarambolas += misPuntos;

            auditoria.push({
                partida: index + 1,
                rival: soyJ1 ? "vs J2" : "vs J1",
                marcador: `${misPuntos} - ${rivalPuntos}`,
                resultado: resultado,
                calculo: `Suma ${puntosGanadosEstaPartida} pts a la tabla.`
            });
        });

        res.json({
            jugador: jugador.nombre,
            resumen_actual_en_db: {
                puntos_registrados: jugador.puntos,
                carambolas_registradas: jugador.carambolas
            },
            resumen_calculado_ahora: {
                puntos_segun_auditoria: sumaPuntosLiga,
                carambolas_segun_auditoria: sumaCarambolas
            },
            DETALLE_PASO_A_PASO: auditoria
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});



// =======================================================
// 8. ▶️ INICIALIZACIÓN DEL SERVIDOR
// =======================================================

connectToDB().then(() => {
    // '0.0.0.0' permite que te conectes desde el celular (externo)
    app.listen(port, '0.0.0.0', () => {
        console.log(`🚀 Servidor corriendo en http://localhost:${port}`);
        console.log(`📡 Accesible en red: http://192.168.100.6:${port}`);
    });
});
