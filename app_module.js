// =========================================
// IMPORTS: Traemos funciones de otros archivos
// =========================================
import { detectGestureFromKeypoints } from './classify.js';
import { GestureLogger } from './logger.js';

// Mapa de conexiones: ¿Qué punto se une con cuál? (Ej: Muñeca con Pulgar)
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], // Pulgar
  [0, 5], [5, 6], [6, 7], [7, 8], // Índice
  [0, 9], [9,10], [10,11], [11,12], // Medio
  [0,13], [13,14], [14,15], [15,16], // Anular
  [0,17], [17,18], [18,19], [19,20] // Meñique
];

// Variables globales (estado de la app)
let video = null;
let canvas = null;
let ctx = null;      // Contexto de dibujo (el pincel)
let detector = null; // La IA cargada
let running = false; // Interruptor ON/OFF

// Variables para suavizar la detección (evitar parpadeos)
let gestureWindow = []; // Guarda los últimos 7 gestos
const VOTE_WINDOW = 7;
const MIN_CONFIRM_MS = 300; // Tiempo mínimo entre acciones (cooldown)
let lastConfirmed = { name: null, since: 0 };
let inferenceTimes = []; // Para calcular FPS

// =========================================
// 1. CONECTAR CON HTML
// =========================================
function bindDOMElements() {
  video = document.getElementById('video');
  canvas = document.getElementById('output');

  if (!canvas || !video) {
    console.error('ERROR: Falta video o canvas en HTML');
    return false;
  }
  ctx = canvas.getContext('2d'); // Preparamos el pincel 2D
  return true;
}

// =========================================
// 2. ENCENDER CÁMARA
// =========================================
// =========================================
// 2. CÁMARA (Con solicitud de permisos mejorada)
// =========================================
async function startCamera() {
  // 1. Verificamos si el navegador soporta cámaras
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("Tu navegador no soporta acceso a la cámara. Prueba con Chrome o Firefox.");
    throw new Error('API de cámara no soportada');
  }

  try {
    // 2. AQUÍ es donde el navegador muestra la ventanita de "Permitir"
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { 
        width: 640, 
        height: 480,
        facingMode: 'user' // Intenta usar la cámara frontal (selfie)
      }
    });

    // 3. Si el usuario dio "Permitir", conectamos el video
    video.srcObject = stream;
    
    return new Promise((resolve) => {
      video.onloadedmetadata = () => {
        video.play();
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        resolve();
      };
    });

  } catch (err) {
    // 4. Manejo de errores (Si el usuario dice "Bloquear")
    console.error("Error de cámara:", err);

    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      alert("⚠️ ACCESO DENEGADO: Has bloqueado la cámara.\n\nPara usar la app, haz clic en el icono de candado 🔒 o cámara 📹 en la barra de dirección y selecciona 'Permitir'.");
    } else if (err.name === 'NotFoundError') {
      alert("⚠️ NO SE ENCONTRÓ CÁMARA: Asegúrate de tener una webcam conectada.");
    } else {
      alert("Error al acceder a la cámara: " + err.message);
    }
    
    throw err; // Detenemos la ejecución
  }
}

function stopCamera() {
  running = false; // ¡IMPORTANTE! Detiene el bucle infinito
  
  // Apagamos la luz de la cámara
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
  // Limpiamos el dibujo
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  updateUIStatus("Cámara detenida");
}

// =========================================
// 3. CARGAR CEREBRO IA (MediaPipe)
// =========================================
// =========================================
// 3. DETECTOR IA (Versión Blindada)
// =========================================
async function createDetector() {
  // 1. Verificación: ¿Existe la variable global?
  if (!window.handPoseDetection) {
    console.error("❌ ERROR CRÍTICO: La librería 'handPoseDetection' no existe en window.");
    alert("Error: Librería de IA no cargada. Revisa tu conexión o el index.html");
    return;
  }

  // 2. Verificación: ¿Tiene SupportedModels? (Aquí fallaba antes)
  if (!window.handPoseDetection.SupportedModels) {
    console.error("❌ ERROR: 'handPoseDetection' existe pero no tiene 'SupportedModels'.", window.handPoseDetection);
    return;
  }

  const model = window.handPoseDetection.SupportedModels.MediaPipeHands;
  const detectorConfig = {
    runtime: 'mediapipe', 
    solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/hands',
    modelType: 'full'
  };

  try {
    detector = await window.handPoseDetection.createDetector(model, detectorConfig);
    console.log("✅ Detector creado correctamente. ¡Listo para usar!");
    updateUIStatus("IA Cargada. Lista.");
  } catch (error) {
    console.error("❌ Falló al crear el detector:", error);
    alert("Error al iniciar la IA. Mira la consola (F12).");
  }
}
// =========================================
// 4. BUCLE PRINCIPAL (Se repite 30-60 veces por seg)
// =========================================
async function processFrame() {
  // Si nos dieron orden de parar, salimos
  if (!running) return;

  // Si la cámara o la IA no están listas, intentamos en el siguiente frame
  if (!detector || video.readyState < 2) {
    requestAnimationFrame(processFrame);
    return;
  }

  const t0 = performance.now(); // Inicio cronómetro
  
  let hands = [];
  try {
    // PREGUNTA A LA IA: ¿Dónde están las manos en esta imagen?
    // flipHorizontal: false porque ya lo volteamos con CSS
    hands = await detector.estimateHands(video, { flipHorizontal: false });
  } catch (e) {
    console.error(e);
    running = false; // Parada de emergencia si falla
    return;
  }

  // Cálculo de FPS
  const t1 = performance.now();
  inferenceTimes.push(t1 - t0);
  if (inferenceTimes.length > 30) inferenceTimes.shift();

  // Limpiamos el canvas anterior
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Si encontró manos...
  if (hands.length > 0) {
    const keypoints = hands[0].keypoints;
    
    // 1. DIBUJAR ESQUELETO
    drawLandmarks(keypoints);

    // 2. CLASIFICAR GESTO (Llama a classify.js)
    // Pasamos el ancho/alto para calcular distancias en píxeles
    const g = detectGestureFromKeypoints(keypoints, canvas.width, canvas.height);
    
    // 3. SISTEMA DE VOTACIÓN (Suavizado)
    // Agregamos el gesto actual a la ventana
    gestureWindow.push(g);
    if (gestureWindow.length > VOTE_WINDOW) gestureWindow.shift();
    
    // Contamos votos: ¿Cuál gesto aparece más veces en los últimos 7 frames?
    const counts = {};
    gestureWindow.forEach(x => counts[x.name] = (counts[x.name] || 0) + 1);
    const bestName = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
    
    // 4. CONFIRMACIÓN Y ACCIÓN
    const now = performance.now();
    // Solo actuamos si el gesto cambió Y pasó el tiempo de espera
    if (bestName !== lastConfirmed.name && (now - lastConfirmed.since > MIN_CONFIRM_MS)) {
      lastConfirmed = { name: bestName, since: now };
      onGestureConfirmed(bestName);
    }

    // 5. REGISTRAR EN LOG
    GestureLogger.add({ gesture: g.name, conf: g.score });
    updateLogPreview();
  }

  updateUIStatus();
  
  // Solicita al navegador ejecutar esto de nuevo lo antes posible
  requestAnimationFrame(processFrame);
}

// =========================================
// UTILIDADES DE DIBUJO
// =========================================
function drawLandmarks(keypoints) {
  ctx.strokeStyle = "#00eaff"; // Color líneas (cian)
  ctx.lineWidth = 2;
  ctx.fillStyle = "#ff0055";   // Color puntos (rosa)

  // Dibujar huesos
  for (const [s, e] of HAND_CONNECTIONS) {
    const a = keypoints[s]; const b = keypoints[e];
    ctx.beginPath();
    ctx.moveTo(a.x * canvas.width, a.y * canvas.height); // Escalar coordenadas (0-1) a píxeles
    ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
    ctx.stroke();
  }
  // Dibujar articulaciones
  for (const kp of keypoints) {
    ctx.beginPath();
    ctx.arc(kp.x * canvas.width, kp.y * canvas.height, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Actualiza el texto inferior con FPS
function updateUIStatus(msg) {
  const el = document.getElementById('statusLine');
  if (!el) return;
  if (msg) { el.innerText = msg; return; }
  
  // Promedio matemático de FPS
  const fps = inferenceTimes.length ? (1000 / (inferenceTimes.reduce((a,b)=>a+b,0)/inferenceTimes.length)).toFixed(1) : 0;
  el.innerText = `Gesto: ${lastConfirmed.name || '-'} | FPS: ${fps}`;
}

// Muestra el log en el panel lateral
function updateLogPreview() {
  const el = document.getElementById('logPreview');
  const last = GestureLogger.logs[GestureLogger.logs.length-1];
  if (el && last) {
    const div = document.createElement('div');
    div.innerText = `> ${last.gesture} (${(last.confidence || 0).toFixed(2)})`;
    div.style.borderBottom = "1px solid #333";
    el.prepend(div); // Añadir al principio (arriba)
    if(el.children.length > 20) el.lastChild.remove(); // Mantener lista corta
  }
}
// =========================================
// GESTOR DE ACCIONES MULTIMEDIA
// =========================================

// Lista de canciones para simular "Siguiente/Anterior"
const PLAYLIST = [
  "./musica/chase_the_pace.mp3",
  "./musica/short_light.mp3",
  "./musica/sunshine_monday.mp3" 
];
let currentTrackIndex = 0;

function controlMedia(action) {
  const player = document.getElementById('audioPlayer');
  const title = document.getElementById('trackTitle');
  
  if (!player) return;

  switch (action) {
    case 'PLAY_PAUSE':
      if (player.paused) {
        player.play();
        updateUIStatus("▶️ REPRODUCIENDO");
      } else {
        player.pause();
        updateUIStatus("⏸️ PAUSADO");
      }
      break;

    case 'NEXT':
      currentTrackIndex = (currentTrackIndex + 1) % PLAYLIST.length;
      player.src = PLAYLIST[currentTrackIndex];
      title.innerText = `Canción Demo ${currentTrackIndex + 1}`;
      player.play();
      updateUIStatus("⏭️ SIGUIENTE CANCIÓN");
      break;

    case 'PREV':
      // Si está avanzado, reinicia. Si está al inicio, va a la anterior.
      if (player.currentTime > 3) {
        player.currentTime = 0;
        updateUIStatus("⏮️ REINICIAR");
      } else {
        currentTrackIndex = (currentTrackIndex - 1 + PLAYLIST.length) % PLAYLIST.length;
        player.src = PLAYLIST[currentTrackIndex];
        title.innerText = `Canción Demo ${currentTrackIndex + 1}`;
        player.play();
        updateUIStatus("⏮️ ANTERIOR CANCIÓN");
      }
      break;
  }
}

// =========================================
// GESTOR DE ACCIONES (VERSIÓN DINÁMICA)
// =========================================

// Esta función averigua qué acción quiere el usuario para cada gesto
function getActionForGesture(gestureName) {
  let selectId = '';

  // 1. Identificamos qué menú mirar según el gesto detectado
  if (gestureName === 'puño') {
    selectId = 'action_fist';
  } 
  else if (gestureName === 'mano_abierta') {
    selectId = 'action_open';
  } 
  else if (gestureName === 'apuntar') {
    selectId = 'action_point';
  }
  
  // 2. Buscamos el elemento en el HTML
  const selectElement = document.getElementById(selectId);
  
  // 3. Devolvemos el valor seleccionado (ej: "NEXT", "PLAY_PAUSE")
  return selectElement ? selectElement.value : 'NONE';
}

function onGestureConfirmed(name) {
  // 1. Averiguamos qué acción corresponde a este gesto AHORA MISMO
  const actionToExecute = getActionForGesture(name);

  // Si el usuario eligió "Ninguna", no hacemos nada
  if (actionToExecute === 'NONE') return;

  // 2. Feedback visual (Toast)
  const toast = document.getElementById('actionToast');
  if (toast) {
    // Mostramos el nombre de la acción en español para que se vea bonito
    let actionText = actionToExecute;
    if(actionText === 'PLAY_PAUSE') actionText = "PLAY / PAUSE";
    if(actionText === 'NEXT') actionText = "SIGUIENTE";
    if(actionText === 'PREV') actionText = "ANTERIOR";

    toast.innerText = `GESTO: ${name.toUpperCase()} → ${actionText}`;
    toast.style.display = 'block';
    setTimeout(() => toast.style.display = 'none', 1500);
  }

  // 3. Ejecutar la acción en el reproductor
  controlMedia(actionToExecute);
}
// Función de arranque
async function init() {
  if (running) return;
  if (!bindDOMElements()) return;
  
  updateUIStatus("Iniciando cámara...");
  await startCamera();
  
  updateUIStatus("Cargando IA...");
  if (!detector) await createDetector();
  
  running = true;
  processFrame(); // ¡Arranca el bucle!
}

// Event Listeners: Espera a que el HTML cargue para asignar botones
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('startBtn')?.addEventListener('click', init);
  document.getElementById('stopBtn')?.addEventListener('click', stopCamera);
  document.getElementById('exportBtn')?.addEventListener('click', () => GestureLogger.exportJSON());
});

// python -m http.server //