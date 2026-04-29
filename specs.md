# Especificaciones Técnicas - RunTracker (FTMS Web App)

## Arquitectura Base
- **Frontend:** Vanilla HTML, CSS (Tailwind vía CDN), JavaScript.
- **Tipografía:** Google Fonts (Montserrat) para UI tipo fitness-tech premium.
- **Iconografía:** SVGs integrados.
- **Mapa:** MapLibre GL JS (sin API Key, usa fuentes Open Source).
- **Gráficos:** Chart.js (CDN).

## 1. Conexión Bluetooth (BLE)
- **API:** Web Bluetooth API (`navigator.bluetooth.requestDevice`).
- **Servicio:** Fitness Machine Service (FTMS - UUID: `0x1826`).
- **Lectura de Datos (Treadmill Data - `0x2ACD`):**
  - Requiere suscripción a notificaciones (`startNotifications()`).
  - Formato: Little Endian. Primeros 16 bits (Flags) definen los campos presentes.
  - Campos parseados: Velocidad (0.01 km/h), Distancia Total (metros), Inclinación (0.1%), Elapsed Time (segundos), Calorías.
- **Comandos de Control (Control Point - `0x2AD9`):**
  - Requiere suscripción a Indicaciones antes de enviar comandos.
  - **Regla importante:** Siempre se debe enviar el comando "Tomar Control" (`[0x00]`) primero.
  - Iniciar: `[0x07]` | Parar: `[0x08, 0x01]` | Pausar: `[0x08, 0x02]`.
  - Set Velocidad: `[0x02, LSB, MSB]` (0.01 km/h).
  - Set Inclinación: `[0x03, LSB, MSB]` (0.1%).

## 2. Visor 3D y Mapas (MapLibre GL JS)
- **Tiles Base:** Esri World Imagery (Satélite hiperrealista).
- **Topografía 3D (DEM):** AWS Mapzen Terrarium (exageración Z = 2.5x).
- **Edificios 3D:** Vector Tiles de OpenStreetMap (extruidos vía `fill-extrusion`).
- **Cámara:** 3 Modos (2D, Bird's Eye, First Person 80° Pitch).
- **Avatar y Ruta:** 
  - La ruta se traza con GeoJSON LineString (Color Azul = Planeada, Color Rojo = Recorrida).
  - El corredor es un GeoJSON Point inyectado a nivel WebGL (evita problemas de z-index de HTML Markers).

## 3. Lógica de Entrenamiento y Simulación (Gamificación)
- **Motor Matemático (training.js):** 3 Modos (`Endurance`, `Dynamic Hills`, `Fartlek`). Genera arreglos de velocidad basados en la altimetría del archivo GPX.
- **Auto-Incline:** El mapa lee la altitud del GPX 150m hacia el futuro y manda señales a la cinta. Tiene un *Cooldown* de 60s para no quemar el motor físico.
- **Auto-Speed:** Igual que el incline, manda comandos de velocidad a la cinta respetando los modos de entrenamiento (Ej: Baja la velocidad al subir pendientes pronunciadas).
- **Coach Motivacional:** Un HUD gigante muestra cuenta regresiva (3,2,1,GO) y avisa sobre cambios de terreno inminentes (Lookahead de 30m). Incluye sintetizador WebAudio. Soporta Inglés, Español y "Mudo" (guardado en LocalStorage).

## 4. UI Premium (Glassmorphism & Fullscreen)
- **Carga de GPX:** Overlay de Drag & Drop y botones para Cargar rutas locales pre-construidas.
- **Controles (iPad Friendly):** Botones masivos, Slider vertical de velocidades en el lateral derecho (+/- 0.1 y accesos directos escalonados por tamaño para seguridad).
- **Modo Cine (Inmersivo):** Botón del "Ojo" dispara la Web Fullscreen API y esconde todos los paneles laterales (HUDs) para disfrutar el paisaje satelital.
- **Gráfico en Vivo (Profile):** Chart.js muestra la montaña (azul) y la velocidad (verde). Usa un Custom Plugin (`verticalLinePlugin`) para dibujar un escáner láser rojo que sigue el progreso físico del corredor a través del mapa.