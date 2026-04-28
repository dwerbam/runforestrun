- Web Bluetooth API 
- Protocolo: Bluetooth GATT.
- Service UUID del FTMS: 0x1826 (Fitness Machine Service).
- Characteristic UUID (Datos de carrera): 0x2ACD (Treadmill Data). Esta característica envía paquetes de datos que incluyen velocidad, inclinación, distancia, etc.
- Characteristic UUID (Control): 0x2AD9 (Fitness Machine Control Point). Sirve para enviar comandos desde tu app a la cinta (ej: "Sube la inclinación a 5%").

### Comandos de Control (Fitness Machine Control Point - 0x2AD9)
Para enviar comandos a la cinta (como la Domyos T900D), se debe escribir un arreglo de bytes (`Uint8Array`) en la característica `0x2AD9`.
**Regla importante:** Siempre se debe enviar el comando "Tomar Control" (`0x00`) antes de enviar instrucciones de movimiento. Además, es necesario habilitar las Notificaciones/Indicaciones en esta característica para recibir el acuse de recibo de la cinta.

| Acción | Comando (Array de Bytes) | Descripción |
| :--- | :--- | :--- |
| **Tomar Control** | `[0x00]` | Obligatorio antes de enviar otros comandos. |
| **Iniciar / Continuar** | `[0x07]` | Arranca el motor de la cinta. |
| **Parar** | `[0x08, 0x01]` | Detiene la cinta de manera definitiva. |
| **Pausar** | `[0x08, 0x02]` | Pausa el motor y la sesión actual en la cinta. |
| **Fijar Velocidad** | `[0x02, LSB, MSB]` | Resolución: 0.01 km/h. Formato: Little Endian. Ej: 6.5 km/h = 650 = `[0x02, 0x8A, 0x02]`. |
| **Fijar Inclinación** | `[0x03, LSB, MSB]` | Resolución: 0.1%. Formato: Little Endian. Ej: 3.0% = 30 = `[0x03, 0x1E, 0x00]`. |
| **Resetear** | `[0x01]` | Resetea el estado de la máquina. |