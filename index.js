// =======================================================
// 1. ⚙️ SETUP & DEPENDENCIAS
// =======================================================
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const session = require('express-session');

function isAuthenticated(req, res, next) {
    // Verificamos si la propiedad 'isOrganizer' existe en la sesión
    if (req.session.isOrganizer) {
        // ✅ SÍ está logueado, pasa al código de la ruta original
        next();
    } else {
        // ❌ NO está logueado, lo enviamos al formulario de acceso
        res.redirect('/login');
    }
}

const app = express();
const port = process.env.PORT || 3001; 

// Middleware para procesar formularios (URL encoded) y servir archivos estáticos (CSS)
app.use(session({
    secret: process.env.SESSION_SECRET, // ¡CORREGIDO!
    resave: false,
    saveUninitialized: false
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));



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
    // 1. Obtenemos la contraseña que el usuario escribió en el formulario
    const submittedPassword = req.body.password;

    // 2. Obtenemos la contraseña segura del archivo .env
    const adminPassword = process.env.ADMIN_PASSWORD;

    // 3. Hacemos la comparación simple
    if (submittedPassword === adminPassword) {
        // Contraseña correcta: ¡Establecemos la sesión!
        // Creamos una propiedad en la sesión que indica que está autorizado
        req.session.isOrganizer = true;
        res.redirect('/'); // Enviamos al organizador a la página principal
    } else {
        // Contraseña incorrecta
        res.send('Contraseña incorrecta. <a href="/login">Intentar de nuevo</a>');
    }
});
// =======================================================
// 2. 💾 DATOS GLOBALES
// =======================================================
let tablaGeneral = {};      
let historialPartidas = []; 


// =======================================================
// 3. 🗃️ PERSISTENCIA (Carga y Guardado de datos.json)
// =======================================================

function cargarDatos() {
    try {
        const resultado = fs.readFileSync('datos.json', 'utf-8');
        const paquete = JSON.parse(resultado);
        tablaGeneral = paquete.tabla || {}; 
        historialPartidas = paquete.historial || [];
    } catch (error) {
        // Si hay error de lectura o parseo, inicializa con arrays/objetos vacíos
        tablaGeneral = {};
        historialPartidas = [];
    }
}

function guardarDatos() {
    const paquete = {
        tabla: tablaGeneral,
        historial: historialPartidas
    };
    const datos = JSON.stringify(paquete);
    fs.writeFileSync('datos.json', datos);
}

// Inicializamos los datos al arrancar el servidor
cargarDatos();


// =======================================================
// 4. 🧱 CORE LOGIC (Reglas del Negocio)
// =======================================================

function registrarPartida(ganador, perdedor) {
    // Aseguramos que el jugador exista antes de sumar puntos
    if (tablaGeneral[ganador] === undefined) {
        // Inicializamos con 0 puntos, 0 ganadas. No ponemos 'telefono' aquí, 
        // ya que debe agregarse vía /agregar-jugador
        tablaGeneral[ganador] = { puntos: 0, ganadas: 0 };
    }
    if (tablaGeneral[perdedor] === undefined) {
        tablaGeneral[perdedor] = { puntos: 0, ganadas: 0 };
    }

    tablaGeneral[ganador].puntos += 3;
    tablaGeneral[ganador].ganadas += 1;
    tablaGeneral[perdedor].puntos += 1;

    historialPartidas.push({
        ganador: ganador,
        perdedor: perdedor,
        fecha: new Date()
    });
}   


function deshacerPartida() {
    const partidaBorrada = historialPartidas.pop(); 
    
    if (partidaBorrada) {
        const ganador = partidaBorrada.ganador;
        const perdedor = partidaBorrada.perdedor;

        // Verificación de seguridad en caso de que el jugador haya sido borrado
        if (tablaGeneral[ganador]) {
            tablaGeneral[ganador].puntos -= 3;
            tablaGeneral[ganador].ganadas -= 1;
        }
        if (tablaGeneral[perdedor]) {
            tablaGeneral[perdedor].puntos -= 1;
        }

        console.log("Deshaciendo partida:", partidaBorrada);
    }
}


// =======================================================
// 5. 🛠️ FUNCIÓN AUXILIAR (Para evitar repetir el HTML)
// =======================================================

// Esta función envuelve CUALQUIER contenido HTML en la estructura base (incluyendo el CSS)
const wrapHTML = (content) => {
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
};


// =======================================================
// 6. 🔗 RUTAS (ENDPOINTS)
// =======================================================

// --- GET (Mostrar Vistas) ---

app.get('/', isAuthenticated, (req, res) => {
    const nombres = Object.keys(tablaGeneral);
    const opcionesHTML = nombres.map(nombre => `<option value="${nombre}">${nombre}</option>`).join('');

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

// 🏆 RUTA DE TABLA CORREGIDA (SOLO UNA DEFINICIÓN) 🏆
app.get('/tabla', (req, res) => {
    let tablaPublica = []; 
    const nombres = Object.keys(tablaGeneral);

    // 1. Llenamos y ordenamos el array tablaPublica
    for (const nombre of nombres) {
        tablaPublica.push({
            nombre: nombre,
            puntos: tablaGeneral[nombre].puntos,
            ganadas: tablaGeneral[nombre].ganadas
        });
    }

    // Ordenamiento: puntos (desc), luego ganadas (desc)
    tablaPublica.sort((a, b) => {
        if (a.puntos !== b.puntos) {
            return b.puntos - a.puntos;
        }
        return b.ganadas - a.ganadas; 
    });

    // 2. 🧱 GENERACIÓN DE FILAS HTML 
    const filasHTML = tablaPublica.map((jugador, index) => {
        return `
            <tr>
                <td>${index + 1}</td>
                <td>${jugador.nombre}</td>
                <td>${jugador.puntos}</td>
                <td>${jugador.ganadas}</td>
            </tr>
        `;
    }).join(''); 

    // 3. Construimos el contenido final de la tabla
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

    // 4. Enviamos el contenido envuelto en el diseño principal
    res.send(wrapHTML(tablaContent));
});
// ❌ La ruta /tabla ya no está anidada ni duplicada 


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

app.get('/resultados', (req, res) => {
    const telefonoBuscado = req.query.telefono;
    let nombreEncontrado = null;
    const nombres = Object.keys(tablaGeneral);

    for (let i = 0; i < nombres.length; i++) {
        const nombre = nombres[i];
        
        // Corregido: Usamos encadenamiento opcional para prevenir errores 
        // si el jugador no tiene la propiedad 'telefono' (jugadores antiguos)
        if (tablaGeneral[nombre]?.telefono === telefonoBuscado) {
            nombreEncontrado = nombre;
            break;
        }
    }

    if (!nombreEncontrado) {
        const errorContent = `<h2>No encontré ningún jugador con el teléfono ${telefonoBuscado}</h2><a href="/buscar">Intentar de nuevo</a>`;
        return res.send(wrapHTML(errorContent));
    }

    const misPartidas = historialPartidas.filter(partida => 
        partida.ganador === nombreEncontrado || partida.perdedor === nombreEncontrado
    );

    let listaHTML = '';
    misPartidas.reverse().forEach(partida => {
        const resultado = (partida.ganador === nombreEncontrado) ? "GANASTE 🎉" : "PERDISTE ❌";
        const rival = (partida.ganador === nombreEncontrado) ? partida.perdedor : partida.ganador;
        listaHTML += `<li>${resultado} contra <b>${rival}</b></li>`;
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

app.post('/registrar', isAuthenticated,  (req, res) => {
    const ganador = req.body.ganador;
    const perdedor = req.body.perdedor;

    if (ganador === perdedor) {
        const errorContent = `<h2>Error: Ganador ${ganador} no puede ser igual a Perdedor ${perdedor}.</h2><a href="/">Volver</a>`;
        return res.send(wrapHTML(errorContent)); // Usamos wrapHTML para que el error se vea bien
    }
    
    registrarPartida(ganador, perdedor);
    guardarDatos();
    const successContent = `<h2>Partida registrada: ${ganador} ganó a ${perdedor}.</h2><a href="/tabla">Ver tabla</a> | <a href="/">Volver</a>`;
    res.send(wrapHTML(successContent));
});

app.post('/agregar-jugador', isAuthenticated,  (req, res) => {
    const nombre = req.body.nombre;
    const telefono = req.body.telefono;
    
    tablaGeneral[nombre] = { puntos: 0, ganadas: 0, telefono };
    guardarDatos();
    const successContent = `<h2>Jugador Registrado: ${nombre} con número ${telefono}.</h2><a href="/">Volver</a>`;
    res.send(wrapHTML(successContent));
});


app.post('/deshacer', isAuthenticated, (req, res)=> {
    deshacerPartida();
    guardarDatos();
    res.redirect('/');
});


// =======================================================
// 7. ▶️ INICIALIZACIÓN
// =======================================================

app.listen(port, () => {
    console.log(`Servidor corriendo en http://localhost:${port}`);
});