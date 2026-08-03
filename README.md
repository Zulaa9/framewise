# Frame & Speed Controller

Extensión de navegador (Chrome / Edge, Manifest V3) para controlar cualquier `<video>` HTML5 con precisión de fotograma: avanzar/retroceder frame a frame, controlar la velocidad de reproducción con presets configurables, y definir tus propios atajos de teclado — globales o específicos por sitio web.

Nació para resolver un caso concreto (Crunchyroll no expone forma de ir frame a frame en su reproductor), pero funciona sobre cualquier página con un elemento `<video>` estándar.

## Características

### Control de fotogramas
- **Avanzar / retroceder 1 frame** con audio real: al avanzar, reproduce ese fotograma de verdad (no salta en silencio), así que se oye exactamente igual que una reproducción normal.
- **Mantener pulsada la tecla de avanzar** entra en reproducción continua real (como pulsar play) en vez de encadenar saltos discretos — al soltar, pausa y encaja automáticamente en el fotograma exacto más cercano.
- **Retroceder** incluye un "tic" de audio de confirmación (los navegadores no permiten reproducción con audio en reversa, es una limitación de la plataforma web, no de la extensión).
- Salto de **N frames** configurable (por defecto 5), con atajo propio.
- **FPS detectado automáticamente** en vivo (via `requestVideoFrameCallback`) para que el paso de frame sea preciso sin tener que configurarlo a mano; también se puede fijar un FPS manual, global o por dominio.
- Protección anti-bloqueo: si intentas retroceder más allá de lo que el sitio tiene cargado (típico en streaming con DRM), la extensión lo detecta, avisa en pantalla y **nunca deja el reproductor colgado** — vuelve automáticamente a la última posición válida.

### Velocidad de reproducción
- Presets de velocidad totalmente configurables (por defecto de 0.1x a 4x en pasos de 0.25).
- Popup con slider **escalonado** (solo se detiene en presets reales, sin valores "muertos" intermedios) hasta 2x, y botones de preset para el resto.
- `Ctrl` + rueda del ratón sobre el vídeo para subir/bajar de preset en preset (activable/desactivable; sin Ctrl el scroll de la página funciona normal).
- Recuerda la última velocidad usada en cada dominio y la aplica sola al cargar un vídeo nuevo.
- Badge en el icono de la barra de herramientas mostrando la velocidad activa.

### Volumen de la extensión
- Capa de volumen **independiente del propio reproductor del sitio** — no se sincronizan entre sí. 100% significa "no toco nada"; el resto es un multiplicador aparte por encima de lo que sea que tengas puesto en el reproductor, desde 0% hasta un máximo configurable (300% por defecto), usando amplificación real con la Web Audio API (`GainNode`) para superar el límite nativo del `<video>`.
- Slider y botones +/- en el popup, con reset rápido a 100%.
- Recuerda el último volumen de extensión usado por dominio (la restauración automática al cargar solo aplica al valor neutro 100%; cualquier otro requiere un toque manual, para evitar que el vídeo se quede en silencio por las políticas de autoplay del navegador).
- Si el vídeo es de origen cruzado sin cabeceras CORS, este ajuste no es posible (limitación del navegador) — la extensión lo detecta y avisa en vez de fallar en silencio.

### Atajos de teclado configurables
- Todas las acciones tienen un atajo por defecto, pero se pueden reasignar libremente desde la página de Opciones (clic en "Grabar" y pulsar la combinación deseada).
- **Atajos por dominio**: además del atajo global, se puede definir un atajo distinto (o desactivarlo) para un sitio concreto — útil si esa web ya usa esa misma tecla para otra cosa. El override de dominio siempre gana sobre el global.

### Otras utilidades
- Play/pausa, silenciar, Picture-in-Picture.
- **Bucle** implementado a mano (no con el atributo `loop` nativo, que puede colgar el reproductor si el navegador intenta saltar solo a un tramo ya no cargado): usa el mismo mecanismo seguro que el retroceso, así que si falla, avisa en vez de romper la reproducción.
- Capturar el fotograma actual como PNG.
- **Detección de capacidades por vídeo**: Picture-in-Picture y la captura de frame se deshabilitan automáticamente en el popup si no son técnicamente posibles en ese vídeo concreto (p. ej. captura bloqueada por DRM), en vez de dejar que falles al intentarlo.
- Overlay en pantalla que confirma cada acción (activable/desactivable), incluyendo pausa/reanudación con timestamp exacto — funciona también si pausas con los controles nativos del propio sitio, no solo con la extensión.
- Tiempo de reproducción sincronizado en vivo en el popup mientras lo tienes abierto, sin necesidad de interactuar.
- Exportar/importar toda la configuración como JSON (atajos, presets, overrides por dominio).
- Botón de "restaurar todo a valores por defecto" con doble confirmación para evitar borrados accidentales.
- Botón 🗗 para abrir el panel en una ventana aparte que se queda abierta hagas clic donde hagas clic (el popup normal de cualquier extensión se cierra al perder el foco — eso no se puede evitar, pero sí abrir una ventanita independiente en su lugar).
- Botón 📌 (dentro de la ventana aparte) para convertirla en una ventana **flotante de verdad**, superpuesta por encima de todo incluso al cambiar de pestaña, usando la Document Picture-in-Picture API (Chrome/Edge 116+). La ventana original se minimiza automáticamente y se restaura sola al cerrar la flotante.

### Detección de vídeo robusta
- Funciona aunque el reproductor esté dentro de un **iframe**, y también si hay **varios vídeos reproduciéndose a la vez en frames distintos** — se dirige siempre al que esté activo (o al de mayor tamaño visible si ninguno se reproduce).
- Detecta vídeos nuevos automáticamente en páginas de una sola página (SPA) como YouTube, incluso al pasar al siguiente vídeo de una lista de reproducción sin recargar la página.
- Reintentos automáticos si el popup se abre justo cuando la página todavía está cargando.

## Instalación (modo desarrollador)

1. Clona o descarga este repositorio.
2. Abre `chrome://extensions` (o `edge://extensions` en Edge).
3. Activa **"Modo de desarrollador"** (arriba a la derecha).
4. Clic en **"Cargar descomprimida"** y selecciona la carpeta del proyecto.
5. Listo — el icono aparecerá en la barra de herramientas.

## Uso

- Abre cualquier página con un vídeo reproduciéndose y usa los atajos por defecto:

| Acción | Atajo por defecto |
|---|---|
| Retroceder 1 frame | `,` |
| Avanzar 1 frame | `.` |
| Subir velocidad (siguiente preset) | `]` |
| Bajar velocidad (preset anterior) | `[` |
| Velocidad normal (1x) | `\` |
| Play / Pausa | `k` |
| Retroceder N segundos | `j` |
| Avanzar N segundos | `l` |

- Clic en el icono de la extensión para el panel rápido (velocidad, frame a frame, play/pausa, capturas, etc.).
- Clic en el engranaje ⚙ (o "Atajos de este sitio" desde el popup) para configurar atajos, presets, FPS y overrides por dominio.

## Estructura del proyecto

```
manifest.json     Manifest V3
settings.js       Configuración por defecto y utilidades compartidas
content.js        Lógica principal: control del <video>, atajos, overlay, detección de FPS
background.js     Service worker: badge del icono y resolución de en qué frame de la pestaña está el vídeo
popup.html/js/css Panel rápido de la barra de herramientas
options.html/js/css  Página de configuración completa
overlay.css       Estilos del aviso en pantalla
icons/            Iconos del toolbar (16/48/128px)
```

La configuración se guarda en `chrome.storage.sync` (atajos, presets, overrides por dominio — viaja contigo entre equipos) y `chrome.storage.local` (velocidad/FPS recordados por dominio — no tiene sentido sincronizarlos y evita agotar la cuota de `sync`).

## Limitaciones conocidas

- **Retroceder más allá de lo cargado por el propio reproductor del sitio** no siempre es posible: en streaming con DRM (Widevine, etc.), el `<video>` no puede descargar contenido por su cuenta — solo el JavaScript propio de cada sitio decide qué cargar y cuándo. La extensión detecta esta situación y te avisa sin romper la reproducción, pero no puede forzar la carga de un tramo que el sitio no quiere servir.
- El sonido en retroceso frame a frame es un "tic" aproximado, no audio real en reversa (no soportado por los navegadores).
- La captura de fotograma (PNG) puede fallar en vídeos con DRM, ya que el navegador bloquea la lectura del `<canvas>` sobre contenido protegido.
- La amplificación de volumen por encima de 100% puede no ser posible en vídeo de origen cruzado sin cabeceras CORS (poco frecuente en streaming vía MSE como YouTube/Crunchyroll).
- La ventana flotante (📌) requiere Chrome/Edge 116+ (Document Picture-in-Picture API); en navegadores sin soporte, el botón simplemente no aparece.

## Licencia

MIT — ver [LICENSE](LICENSE).
