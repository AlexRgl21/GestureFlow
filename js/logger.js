export const GestureLogger = {
  logs: [], // Aquí se guarda todo en memoria RAM

  // Función para agregar una fila nueva
  add(entry) {
    const iso = (new Date()).toISOString();
    // Guardamos fecha + los datos que nos pasen
    this.logs.push(Object.assign({ recorded_at: iso }, entry));
    
    // IMPORTANTE: Si pasa de 2000 registros, borramos los viejos para no saturar la memoria
    if (this.logs.length > 2000) this.logs.shift();
  },

  // Función para descargar el archivo JSON
  exportJSON(filename = 'gesture_logs.json') {
    // Convierte el array JS a texto
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.logs, null, 2));
    
    // Crea un link invisible <a> y le hace clic automáticamente
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
};
