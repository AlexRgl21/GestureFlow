// =========================================
// classify.js
// =========================================

export function toPx(kp, canvasW, canvasH) {
  return {
    x: (kp.x !== undefined ? kp.x : kp[0]) * canvasW,
    y: (kp.y !== undefined ? kp.y : kp[1]) * canvasH,
    z: kp.z || 0
  };
}

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function palmSizePx(landmarks, canvasW, canvasH) {
  if (!landmarks || landmarks.length < 10) return 1;
  const wrist = toPx(landmarks[0], canvasW, canvasH);
  const indexMCP = toPx(landmarks[5], canvasW, canvasH);
  const middleMCP = toPx(landmarks[9], canvasW, canvasH);
  return Math.max(1, (dist(wrist, indexMCP) + dist(wrist, middleMCP)) / 2);
}

export function detectGestureFromKeypoints(landmarks, canvasW, canvasH) {
  if (!landmarks || landmarks.length < 21) return { name: 'none', score: 0 };

  const p = i => landmarks[i];
  
  // Puntos clave
  const wrist = toPx(p(0), canvasW, canvasH);
  const indexTip = toPx(p(8), canvasW, canvasH);
  const middleTip = toPx(p(12), canvasW, canvasH);
  const ringTip = toPx(p(16), canvasW, canvasH);
  const pinkyTip = toPx(p(20), canvasW, canvasH);

  const palmSize = palmSizePx(landmarks, canvasW, canvasH);
  
  // Distancias de cada dedo a la muñeca
  const dIndex = dist(indexTip, wrist);
  const dMiddle = dist(middleTip, wrist);
  const dRing = dist(ringTip, wrist);
  const dPinky = dist(pinkyTip, wrist);

  // Promedio de los 4 dedos (para puño y mano abierta)
  const tipDistAvg = (dIndex + dMiddle + dRing + dPinky) / 4;
  
  // Promedio de los "otros" dedos (medio, anular, meñique) para "Apuntar"
  const othersDistAvg = (dMiddle + dRing + dPinky) / 3;


  // ==================================================
  // LÓGICA DE DETECCIÓN AJUSTADA
  // ==================================================

  // 1. PUÑO ✊
  // Si el promedio de todos los dedos es corto (dedos cerrados)
  if (tipDistAvg / palmSize < 1.1) {
    return { name: 'puño', score: 0.9 };
  }

  // 2. MANO ABIERTA ✋
  // Si el promedio es muy largo (todos estirados)
  if (tipDistAvg / palmSize > 1.5) {
    return { name: 'mano_abierta', score: 0.9 };
  }

  // 3. APUNTAR 👉 (MEJORADO)
  // Lógica: 
  // A. El índice debe estar razonablemente lejos de la muñeca ( > 1.3 veces la palma)
  // B. El índice debe estar MUCHO más lejos que los otros 3 dedos.
  
  const indexRatio = dIndex / palmSize;
  const othersRatio = othersDistAvg / palmSize;

  // Si el índice es largo...
  if (indexRatio > 1.3) {
    // ...y los otros dedos son notablemente más cortos que el índice
    // (El índice debe sobresalir al menos un 30% más que el promedio de los otros)
    if (indexRatio > (othersRatio + 0.3)) {
       return { name: 'apuntar', score: 0.85 };
    }
  }

  return { name: 'neutral', score: 0.5 };
}
