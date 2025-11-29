// =======================================================
// 1. ⚙️ SETUP & DEPENDENCIAS
// =======================================================
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { MongoClient, ObjectId } = require('mongodb');

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

async function registrarPartida(ganador, mar1, perdedor, mar2) {

    // 🛡️ VALIDACIÓN DE MARCADOR
    // Verificamos que ambos marcadores sean números válidos
    if (isNaN(mar1) || isNaN(mar2)) {
        const errorContent = `
            <h2>⚠️ Marcador inválido</h2>
            <p>Por favor ingresa solo números en las carambolas.</p>
            <a href="/" class="button">Volver</a>
        `;
        return res.send(wrapHTML(errorContent));
    }
    // 1. Actualizar al Ganador 🏆
    await tablaCollection.updateOne(
        { _id: ganador }, 
        { 
            $inc: { 
                puntos: 3, 
                ganadas: 1,
                totalCarambolas: parseInt(mar1), // Aseguramos que sea número
                partidasJugadas: 1
            }, 
            $set: { nombre: ganador } 
        },
        { upsert: true }
    );

    // 2. Actualizar al Perdedor 🐢
    await tablaCollection.updateOne(
        { _id: perdedor },
        { 
            $inc: { 
                puntos: 1, 
                // ganadas: 0, (No es necesario ponerlo)
                totalCarambolas: parseInt(mar2),
                partidasJugadas: 1
            },
            $set: { nombre: perdedor }
        },
        { upsert: true }
    );

    // 3. Registrar en el Historial 📜
    await historialCollection.insertOne({
        ganador: ganador,
        marcadorGanador: mar1,
        perdedor: perdedor,
        marcadorPerdedor: mar2,
        fecha: new Date()
    });
}

async function deshacerPartida() {
    // 1. Buscar la última partida
    const ultimaPartida = await historialCollection.findOne(
        {}, 
        { sort: { fecha: -1 } } 
    );

    if (ultimaPartida) {
        const ganador = ultimaPartida.ganador;
        const perdedor = ultimaPartida.perdedor;
        
        // 👇 RECUPERAMOS LOS MARCADORES ORIGINALES
        // (Si son undefined por ser partida antigua, usamos 0 para no romper la resta)
        const ptsGanador = ultimaPartida.marcadorGanador || 0;
        const ptsPerdedor = ultimaPartida.marcadorPerdedor || 0;

        // 2. Revertir al Ganador ⏪
        await tablaCollection.updateOne(
            { _id: ganador },
            { 
                $inc: { 
                    puntos: -3, 
                    ganadas: -1,
                    partidasJugadas: -1,          // Restamos la partida
                    totalCarambolas: -ptsGanador  // Restamos sus carambolas
                } 
            }
        );

        // 3. Revertir al Perdedor ⏪
        await tablaCollection.updateOne(
            { _id: perdedor },
            { 
                $inc: { 
                    puntos: -1, 
                    partidasJugadas: -1,          // Restamos la partida
                    totalCarambolas: -ptsPerdedor // Restamos sus carambolas
                } 
            }
        );

        // 4. Eliminar el registro
        await historialCollection.deleteOne({ _id: ultimaPartida._id });
        
        console.log(`Deshaciendo partida: ${ganador} (${ptsGanador}) vs ${perdedor} (${ptsPerdedor})`);
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
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>🏆 Torneo Navideño Club Andresito! </title>
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
    const nombresOptions = jugadores.map(jugador => 
        `<option value="${jugador.nombre}">${jugador.nombre}</option>`
    ).join('');

    const content = `
        <h1>Registrar Partida 🎱</h1>
        <form action="/registrar-partida" method="POST">
    
    <h3>🏆 El Ganador</h3>
    <select name="ganador" class="button" required>
        <option value="" disabled selected>Selecciona al Ganador</option>
        ${nombresOptions}
    </select>
    <input type="tel" name="mar1" placeholder="Marcador del Ganador" required />

    <hr> <h3>🐢 El Perdedor</h3>
    <select name="perdedor" class="button" required>
        <option value="" disabled selected>Selecciona al Perdedor</option>
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
         let promedio = 0;

    if (jugador.partidasJugadas > 0) {

       promedio=  (jugador.totalCarambolas/jugador.partidasJugadas).toFixed(2)

    }

        return `
            <tr>
                <td>${index + 1}</td>
                <td>${jugador.nombre}</td>
                <td>${jugador.puntos}</td>
                <td>${jugador.partidasJugadas}</td>
                <td>${promedio}</td> </tr>
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
                    <th>Jugadas</th>
                    <th>Promedio General</th>
                </tr>
            </thead>
            <tbody>
                ${filasHTML}
            </tbody>
        </table>

        <div style="margin-top: 20px; padding: 15px; background-color: #fff3cd; border: 1px solid #ffeeba; border-radius: 5px; color: #856404; max-width: 90%;">
            <strong>⚠️ REGLA DE CLASIFICACIÓN:</strong>
            <p style="margin: 5px 0; font-weight: bold;">
                "Calificarán únicamente los 8 mejores puntajes que tengan más de 40 partidas o los 8 con más partidas."
            </p>
        </div>
        
        <br>
        <a href="/" class ="button">Volver al registro</a>
    `;

    res.send(wrapHTML(tablaContent));
});

// LOGIN
app.get('/login', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
             <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
                <p><a href="/tabla" class = "button">🏆 Ir a la Tabla General</a></p>
                <p><a href="/buscar" class = "button">🔍 Buscar Jugador</a></p>
            </div>
        </body>
        </html>
    `);
});

// ==========================================
// 🛠️ RUTA: AUDITORÍA Y EDICIÓN (SOLO ADMIN)
// ==========================================
app.get('/editar', isAuthenticated, async (req, res) => {
    // 1. Recuperamos la lista actualizada de jugadores
    const jugadores = await tablaCollection.find().sort({ nombre: 1 }).toArray();
    
    // 2. Generamos las opciones del select
    const nombresOptions = jugadores.map(j => `<option value="${j._id}">${j.nombre}</option>`).join('');

    const content = `
        <h2 style="color: #d9534f;">🛠️ Modo Edición / Auditoría</h2>
        <p>Selecciona un jugador para corregir o eliminar partidas específicas.</p>
        
        <form action="/resultados-editar" method="GET">
            <label>Jugador a auditar:</label>
            <br>
            <select name="jugador" class="button" required>
                <option value="" disabled selected>Selecciona un Jugador</option>
                ${nombresOptions}
            </select>
            <br><br>
            <button type="submit" class="button" style="background-color: #d9534f;">Buscar para Editar</button>
        </form>
        <br>
        <a href="/" class="button">🏠 Volver al inicio</a>
    `;

    res.send(wrapHTML(content));
});

// ==========================================
// 📄 RUTA: RESULTADOS PARA EDICIÓN
// ==========================================
app.get('/resultados-editar', isAuthenticated, async (req, res) => {
    const jugadorId = req.query.jugador;

    // Búsqueda con $or: ¿Ganó O Perdió?
    const partidas = await historialCollection.find({
        $or: [
            { ganador: jugadorId },
            { perdedor: jugadorId }
        ]
    }).sort({ fecha: -1 }).toArray();

    if (partidas.length === 0) {
        return res.send(wrapHTML(`
            <h2>El jugador ${jugadorId} no tiene partidas registradas.</h2>
            <a href="/editar" class="button">Volver a intentar</a>
        `));
    }

    const listaHTML = partidas.map(p => {
        const esGanador = p.ganador === jugadorId;
        const resultadoTexto = esGanador ? "🏆 GANÓ" : "🐢 PERDIÓ";
        const colorFondo = esGanador ? "#d4edda" : "#f8d7da";
        const rival = esGanador ? p.perdedor : p.ganador;
        const marcador = `${p.marcadorGanador || 0} - ${p.marcadorPerdedor || 0}`;
        const fechaFormateada = new Date(p.fecha).toLocaleString();

        // Botón rojo que apunta a la eliminación específica
        return `
            <div style="background-color: ${colorFondo}; border: 1px solid #ccc; padding: 15px; margin: 10px auto; max-width: 500px; border-radius: 8px;">
                <p><strong>${resultadoTexto}</strong> contra <strong>${rival}</strong></p>
                <p style="font-size: 1.2em;">🎱 Marcador: ${marcador}</p>
                <p><small>📅 ${fechaFormateada}</small></p>
                
                <form action="/eliminar-especifica" method="POST" onsubmit="return confirm('⚠️ ¿Borrar esta partida? Se restarán los puntos a ambos.');">
                    <input type="hidden" name="idPartida" value="${p._id}">
                    <button type="submit" style="background-color: #dc3545; color: white; border: none; padding: 8px 15px; border-radius: 4px; cursor: pointer;">
                        🗑️ Borrar esta partida
                    </button>
                </form>
            </div>
        `;
    }).join('');

    res.send(wrapHTML(`
        <h2 style="color: #d9534f;">Editando a: ${jugadorId}</h2>
        ${listaHTML}
        <br>
        <a href="/editar" class="button">🔍 Auditar otro</a>
        <a href="/" class="button">🏠 Inicio</a>
    `));
});


// ==========================================
// 🗑️ RUTA: ELIMINAR PARTIDA ESPECÍFICA
// ==========================================
app.post('/eliminar-especifica', isAuthenticated, async (req, res) => {
    const idPartida = req.body.idPartida;

    try {
        // 1. Buscamos la partida antes de borrarla para saber qué restar
        const partida = await historialCollection.findOne({ _id: new ObjectId(idPartida) });

        if (!partida) {
            return res.send(wrapHTML('<h2>Error: No se encontró la partida.</h2><a href="/editar" class="button">Volver</a>'));
        }

        const { ganador, perdedor, marcadorGanador, marcadorPerdedor } = partida;

        // 2. Restamos los puntos al GANADOR
        await tablaCollection.updateOne(
            { _id: ganador },
            { 
                $inc: { 
                    puntos: -3, 
                    ganadas: -1, 
                    partidasJugadas: -1,
                    totalCarambolas: -marcadorGanador // Restamos sus carambolas exactas
                } 
            }
        );

        // 3. Restamos los puntos al PERDEDOR
        await tablaCollection.updateOne(
            { _id: perdedor },
            { 
                $inc: { 
                    puntos: -1, 
                    partidasJugadas: -1,
                    totalCarambolas: -marcadorPerdedor 
                } 
            }
        );

        // 4. Finalmente, eliminamos el registro del historial
        await historialCollection.deleteOne({ _id: new ObjectId(idPartida) });

        // 5. Confirmación
        const successContent = `
            <h2 style="color: #dc3545;">🗑️ Partida eliminada correctamente</h2>
            <p>Se han revertido los puntos de <strong>${ganador}</strong> y <strong>${perdedor}</strong>.</p>
            <br>
            <a href="/resultados-editar?jugador=${ganador}" class="button">Seguir editando a ${ganador}</a>
            <a href="/editar" class="button">🔍 Buscar otro</a>
        `;
        res.send(wrapHTML(successContent));

    } catch (error) {
        console.error(error);
        res.send(wrapHTML('<h2>Ocurrió un error técnico al intentar borrar.</h2><a href="/editar" class="button">Volver</a>'));
    }
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
            <input type="tel" name="telefono" placeholder="Teléfono" required />
            <button type="submit">Guardar Jugador</button>
        </form>
        <a href="/" class ="button">Volver al inicio</a>
    `;
    res.send(wrapHTML(content));
});

// FORMULARIO BUSCAR
app.get('/buscar', (req, res) => {
    const content = `
        <h1>🔍 Buscar Historial de Jugador</h1>
        <form action="/resultados" method="GET">
            <label>Ingresa tu número de teléfono:</label>
            <input type="tel" name="telefono" required placeholder="Ej: 5512345678">
            <button type="submit">Ver mis partidas</button>
        </form>
        <br>
        <a href="/" class ="button">🏠 Volver al inicio</a>
    `;
    res.send(wrapHTML(content));
});

// RESULTADOS DE BÚSQUEDA
app.get('/resultados', async (req, res) => { // ⬅️ AHORA ES ASYNC
    const telefonoBuscado = req.query.telefono;
    
    // 1. Buscar al jugador por teléfono en MongoDB
    const jugador = await tablaCollection.findOne({ telefono: telefonoBuscado });

    if (!jugador) {
        const errorContent = `<h2>No encontré ningún jugador con el teléfono ${telefonoBuscado}</h2><a href="/buscar" class ="button">Intentar de nuevo</a>`;
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
        <a href="/buscar" class ="button">🔍 Buscar otro</a> | <a href="/" class ="button">🏠 Inicio</a>
    `;
    res.send(wrapHTML(content));
});

// --- POST (Procesar Datos) ---

// REGISTRAR PARTIDA
app.post('/registrar-partida', isAuthenticated, async (req, res) => {
    const ganador = req.body.ganador;
    const perdedor = req.body.perdedor;
    // 1. 👇 ¡IMPORTANTE! Recibir los marcadores del formulario
    const mar1 = req.body.mar1; 
    const mar2 = req.body.mar2;

    // 2. 🛡️ VALIDACIÓN DE MARCADOR (Lo movemos aquí para proteger antes de actuar)
    if (isNaN(mar1) || isNaN(mar2)) {
        const errorContent = `
            <h2>⚠️ Marcador inválido</h2>
            <p>Por favor ingresa solo números en las carambolas.</p>
            <a href="/" class="button">Volver</a>
        `;
        return res.send(wrapHTML(errorContent));
    }

    // 3. Validar que no juegue contra sí mismo
    if (ganador === perdedor) {
        const errorContent = `<h2>Error: No puedes jugar contra ti mismo.</h2><a href="/" class="button">Volver</a>`;
        return res.send(wrapHTML(errorContent));
    }

    // 4. 🛡️ EL GUARDIÁN: Verificar historial
    const partidasJugadas = await historialCollection.countDocuments({
        $or: [
            { ganador: ganador, perdedor: perdedor },
            { ganador: perdedor, perdedor: ganador }
        ]
    });

    if (partidasJugadas >= 2) {
        const errorContent = `
            <h2>⚠️ Límite alcanzado</h2>
            <p>Estos jugadores ya completaron sus 2 enfrentamientos.</p>
            <a href="/" class="button">Volver</a>
        `;
        return res.send(wrapHTML(errorContent));
    }

    // 5. 👇 ¡LA PIEZA PERDIDA! Aquí es donde realmente guardamos en la DB
    await registrarPartida(ganador, mar1, perdedor, mar2);

    const successContent = `<h2>Partida registrada: ${ganador} ganó a ${perdedor}.</h2><a href="/tabla" class ="button">Ver tabla</a> | <a href="/" class = "button">Volver</a>`;
    res.send(wrapHTML(successContent));
});
// AGREGAR JUGADOR
app.post('/agregar-jugador', isAuthenticated, async (req, res) => {
    const nombre = req.body.nombre;
    const telefono = req.body.telefono;
    if (telefono.length !== 10 || isNaN(telefono)) {
    // Aquí va la acción de error
    return res.send(wrapHTML(`<h2>Error: El número de teléfono debe tener 10 dígitos.
        </h2><a href="/agregar-jugador" class ="button">Volver</a>`));
}

    await tablaCollection.insertOne({
        _id: nombre, 
        nombre: nombre,
        puntos: 0,
        ganadas: 0,
        telefono: telefono
    });

    const successContent = `<h2>Jugador Registrado: ${nombre} con número ${telefono}.</h2><a href="/" class = "button">Volver</a>`;
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