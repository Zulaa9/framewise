// Diccionario de textos (es/en) y utilidades de traducción — compartido por popup, options,
// content y background. No depende de nada más, así que se carga antes que settings.js en
// manifest.json y en los <script> de popup.html/options.html.
//
// "es" es el idioma por defecto histórico de la extensión (nunca cambia para quien no toque nada
// — ver "lang" en SYNC_DEFAULTS, settings.js). "{clave}" dentro de un string se sustituye vía el
// segundo argumento de T(); ver ejemplos de uso en popup.js/options.js/content.js.
const STRINGS = {
  es: {
    // ---------- Popup: cabecera y avisos ----------
    "popup.pauseBtn.off": "Desactivar los atajos de teclado de Framewise en este sitio (por si chocan con los del sitio)",
    "popup.pauseBtn.on": "Reactivar los atajos de teclado de Framewise en este sitio",
    "popup.floatBtn.title": "Superponer: flota por encima de todo, incluida la pestaña del vídeo",
    "popup.detachBtn.title": "Abrir en ventana aparte (se queda abierta hagas clic donde hagas clic)",
    "popup.openOptions.title": "Configurar atajos",
    "popup.pausedHint": "⏸ Atajos de teclado desactivados en este sitio",
    "popup.noVideo.message": "No se encontró vídeo en esta pestaña.",
    "popup.retryBtn": "🔄 Buscar de nuevo",
    "popup.reloadTabBtn": "↻ Recargar la pestaña y reintentar",
    "popup.pickVideoBtn": "🎯 Marcar vídeo manualmente",

    // ---------- Popup: controles ----------
    "popup.frameBack.title": "Retroceder 1 fotograma",
    "popup.frameBack.label": "⏮ Fotograma",
    "popup.togglePlay.title": "Play / Pausa",
    "popup.frameForward.title": "Avanzar 1 fotograma",
    "popup.frameForward.label": "Fotograma ⏭",
    "popup.seekBack.title": "Retroceder {n} segundos",
    "popup.toggleMute.title": "Silenciar",
    "popup.seekForward.title": "Avanzar {n} segundos",
    "popup.toggleLoop.title": "Bucle",
    "popup.togglePip.title": "Picture-in-Picture",
    "popup.togglePip.label": "🗔 PiP",
    "popup.screenshot.title": "Capturar fotograma",
    "popup.recordClip.title.idle": "Grabar clip de vídeo (vuelve a pulsar para detener y guardar)",
    "popup.recordClip.title.recording": "Detener la grabación y guardar el clip",
    "popup.recordClip.label.idle": "⏺ Rec",
    "popup.recordClip.label.recording": "⏹ Stop",

    "popup.speed.sectionLabel": "Velocidad",
    "popup.speed.hint": "(escalonado hasta 2x · más arriba con los botones)",
    "popup.volume.sectionLabel": "Volumen de la extensión",
    "popup.volume.hint": "(hasta {max}% · independiente del volumen del reproductor)",
    "popup.volumeReset.title": "Volumen normal (100%)",
    "popup.fps.sectionLabel": "FPS de este sitio",
    "popup.fpsInfo.detecting": "detectando…",
    "popup.fpsInfo.fixed": "{fps} fps (fijado para este sitio)",
    "popup.fpsInfo.detected": "~{fps} fps (detectado)",
    "popup.fpsInfo.global": "usando global ({fps} fps)",
    "popup.useDetectedFps.label": "Usar aquí",
    "popup.useDetectedFps.title": "Usar el FPS detectado para este dominio",

    "popup.footer.domainOptions": "⚙ Atajos de este sitio",
    "popup.footer.globalOptions": "Opciones globales",

    "popup.state.paused": "⏸ Pausa",
    "popup.state.playing": "▶ Reproduciendo",

    "popup.cap.pip": "Picture-in-Picture no disponible en este vídeo",
    "popup.cap.screenshot": "No se puede capturar: vídeo protegido (DRM) — el navegador bloquea leer sus fotogramas",
    "popup.cap.recordClip": "Grabación no disponible en este vídeo (navegador sin soporte de captureStream)",
    "popup.cap.loopBroken": "El bucle falló antes en este vídeo (el inicio ya no está cargado) — puedes reintentarlo",
    "popup.floatUnsupported": "Tu navegador no soporta ventanas superpuestas (Document Picture-in-Picture). Hace falta Chrome/Edge 116 o superior.",

    // ---------- Options: título de página y secciones ----------
    "options.title": "Framewise — Opciones",
    "options.lang.label": "Idioma",

    "options.frames.h2": "Fotogramas",
    "options.fps.label": "FPS global (para el paso de 1 fotograma, cuando el sitio no tiene FPS propio ni se detecta en vivo)",
    "options.fpsPreset.placeholder": "Presets comunes…",
    "options.fpsPreset.24": "24 (cine)",
    "options.fpsPreset.23976": "23.976 (cine/anime NTSC)",
    "options.multiFrameCount.label": 'Nº de fotogramas para "Retroceder/Avanzar {n} fotogramas"',

    "options.speed.h2": "Velocidad",
    "options.speedStep.label": "Incremento cuando no hay siguiente preset (x)",
    "options.speedPresets.label": "Presets de velocidad (los botones rápidos del popup)",
    "options.presetStepDown.title": "Quita el más alto de la escala de 0.25 (ignora valores añadidos a mano)",
    "options.presetStepUp.title": "Añade el siguiente en la escala de 0.25, sin contar valores añadidos a mano",
    "options.newPresetValue.placeholder": "añadir a mano, ej: 1.6",
    "options.addPresetBtn": "＋ Añadir",
    "options.resetPresets": "Restaurar presets por defecto",
    "options.rememberSpeedPerDomain.label": "Recordar la última velocidad usada en cada sitio y aplicarla al cargar un vídeo nuevo",
    "options.wheelSpeedControl.label": "Cambiar velocidad con Ctrl + rueda del ratón sobre el vídeo (sin Ctrl, el scroll de la página funciona con normalidad)",

    "options.volume.h2": "Volumen de la extensión",
    "options.volume.hint": 'Es una capa de volumen <strong>aparte</strong> del propio reproductor del sitio — no se sincronizan entre sí. 100% aquí significa "no toco nada"; el resto se aplica como un multiplicador independiente por encima de lo que sea que tengas puesto en el reproductor (0% lo silencia solo desde la extensión, 300% lo triplica).',
    "options.volumeMax.label": "Volumen máximo de la extensión (%)",
    "options.volumeMax.hint": "Amplificar mucho por encima de 100% puede distorsionar el audio si la fuente ya va alta de volumen — es una limitación del propio audio, no de la extensión.",
    "options.volumeStep.label": "Incremento por pulsación de subir/bajar volumen (%)",
    "options.rememberVolumePerDomain.label": "Recordar el último volumen de la extensión usado en cada sitio (solo el valor neutro 100% se restaura automáticamente al cargar — cualquier otro requiere un toque manual para evitar quedarse en silencio)",

    "options.playback.h2": "Reproducción",
    "options.seekSeconds.label": 'Segundos para "Retroceder/Avanzar {n} segundos"',
    "options.showOverlay.label": "Mostrar aviso en pantalla al usar un atajo (incluye pausa/reanudación con timestamp)",
    "options.frameStepAudio.label": 'Reproducir sonido real al pasar de fotograma a fotograma (reproduce brevemente el vídeo en vez de saltar en silencio; al avanzar es exacto, al retroceder se oye un "tic" de confirmación porque los navegadores no soportan audio en reversa)',

    "options.shortcuts.h2": "Atajos de teclado",
    "options.shortcuts.hint": "Los atajos son <strong>globales</strong> por defecto (se aplican en todas las páginas). Si un sitio ya usa esa misma tecla para otra cosa, cambia el ámbito abajo a ese dominio y define un atajo distinto (o bórralo) solo para él — el override de dominio siempre gana sobre el global.",
    "options.scopeSelect.label": "Ámbito:",
    "options.newDomainInput.placeholder": "ej: www.crunchyroll.com",
    "options.addDomainBtn": "＋ Añadir dominio",
    "options.removeDomainBtn": "Eliminar este dominio",
    "options.scopeSelect.global": "Global (todos los sitios)",
    "options.override.singular": "override",
    "options.override.plural": "overrides",
    "options.scopeSelect.paused": "⏸ pausado",

    "options.backup.h2": "Copia de seguridad",
    "options.exportBtn": "⬇ Exportar configuración",
    "options.importBtn": "⬆ Importar configuración",
    "options.backup.hint": "Incluye atajos globales, overrides por dominio, presets de velocidad y FPS fijados por sitio.",

    "options.reset.h2": "Restablecer",
    "options.reset.hint": "Borra todos los atajos personalizados, overrides por dominio, presets de velocidad y demás ajustes, dejándolo todo como recién instalado. Esta acción no se puede deshacer — pulsa el botón dos veces para confirmar.",
    "options.resetAllBtn": "♻ Restaurar todo a valores por defecto",
    "options.resetAllBtn.confirm": "⚠ Pulsa de nuevo para confirmar el borrado",

    "options.save": "Guardar cambios",
    "options.savedMsg": "✔ Guardado",
    "options.savedMsg.reset": "✔ Restaurado a valores por defecto",

    "options.footer.web": "Web",
    "options.footer.github": "GitHub",

    // ---------- Options: strings dinámicos (JS) ----------
    "options.alert.invalidSpeed": "Escribe un número de velocidad válido, ej: 1.6",
    "options.alert.speedRange": "La velocidad debe estar entre {min}x y {max}x — es el rango real que admite la extensión.",
    "options.alert.invalidDomain": "Escribe un dominio válido, ej: www.crunchyroll.com",
    "options.presetChip.remove.title": "Quitar {label}x",
    "options.keycap.recording": "Pulsa una tecla…",
    "options.keycap.empty": "sin atajo",
    "options.tag.overridden": "personalizado aquí",
    "options.tag.inherited": "heredado de global",
    "options.recordBtn": "Grabar",
    "options.clearBtn": "Borrar",
    "options.clearBtn.title.global": "Deja esta acción sin atajo global",
    "options.clearBtn.title.domain": "Desactiva esta acción solo en este dominio (sin heredar del global)",
    "options.inheritBtn": "Heredar de global",
    "options.warn.clashHere": '⚠ "{combo}" ya estaba asignado aquí — considera cambiarlo',
    "options.warn.clashDomain": '⚠ "{combo}" ya está en uso aquí por "{label}" ({source}) — considera cambiarlo',
    "options.warn.source.ownOverride": "personalizado en este dominio",
    "options.warn.source.inherited": "heredado del global",
    "options.alert.importInvalidFile": "Archivo inválido: {msg}",
    "options.alert.importFailed": "No se pudo importar la configuración: {error}",
    "options.alert.importSuccess": 'Configuración importada. Pulsa "Guardar cambios" para aplicarla.',
    "options.confirm.removeDomain": '¿Eliminar todos los overrides de "{domain}"?',
    "options.err.notObject": "el archivo no contiene un objeto de configuración.",
    "options.err.speedPresetsType": '"speedPresets" debería ser una lista de números.',
    "options.err.shortcutsType": '"shortcuts" debería ser un objeto (acción → atajo).',
    "options.err.actionsType": '"actions" debería ser un objeto de acciones.',
    "options.err.domainOverridesType": '"domainOverrides" debería ser un objeto (dominio → atajos).',
    "options.err.domainMapType": '"{field}" debería ser un objeto (dominio → valor).',

    // ---------- Acciones (atajos) ----------
    "action.frameBack": "Retroceder 1 fotograma",
    "action.frameForward": "Avanzar 1 fotograma",
    "action.frameBackMulti": "Retroceder {n} fotogramas",
    "action.frameForwardMulti": "Avanzar {n} fotogramas",
    "action.speedUp": "Subir velocidad (siguiente preset)",
    "action.speedDown": "Bajar velocidad (preset anterior)",
    "action.speedReset": "Velocidad normal (1x)",
    "action.togglePlay": "Play / Pausa",
    "action.seekBack": "Retroceder {n} segundos",
    "action.seekForward": "Avanzar {n} segundos",
    "action.toggleLoop": "Activar/desactivar bucle",
    "action.togglePip": "Picture-in-Picture",
    "action.toggleMute": "Silenciar / Activar audio",
    "action.screenshot": "Capturar fotograma actual (PNG)",
    "action.recordClip": "Grabar / detener clip de vídeo",
    "action.volumeUp": "Subir volumen",
    "action.volumeDown": "Bajar volumen",
    "action.volumeReset": "Volumen normal (100%)",

    // ---------- Overlay en pantalla (content.js) ----------
    "overlay.volumeUnavailable": "⚠ El volumen de la extensión no está disponible en este vídeo",
    "overlay.volume": "🔊 Volumen (extensión): {percent}%",
    "overlay.loadingSegment": "⏳ Cargando ese tramo…",
    "overlay.seekBlocked": "⚠ No se puede retroceder más allá de lo cargado en este punto",
    "overlay.frameStep": "{dir} {sign}{frames} fotograma  ·  {time}",
    "overlay.speed": "Velocidad: {speed}x",
    "overlay.seek": "{icon} {secs}s  ·  {time}",
    "overlay.loopRestarted": "🔁 Bucle: reiniciado desde el principio",
    "overlay.loopOn": "🔁 Bucle activado",
    "overlay.loopOff": "🔁 Bucle desactivado",
    "overlay.muted": "🔇 Silenciado",
    "overlay.unmuted": "🔊 Audio activado",
    "overlay.pipUnavailable": "⚠ Picture-in-Picture no disponible",
    "overlay.frameCaptured": "📸 Fotograma capturado",
    "overlay.captureFailed": "⚠ No se pudo capturar (¿vídeo protegido/DRM?)",
    "overlay.recordingEmpty": "⚠ La grabación quedó vacía — no se guardó nada",
    "overlay.clipSaved": "💾 Clip guardado",
    "overlay.recordingFailed": "⚠ No se puede grabar este vídeo (¿protegido por DRM o sin soporte del navegador?)",
    "overlay.recording": "⏺ Grabando clip…",
    "overlay.stoppingRecording": "⏹ Deteniendo grabación…",
    "overlay.noVideoAtPoint": "⚠ No se encontró ningún <video> ahí — prueba a marcar directamente sobre la imagen del vídeo",
    "overlay.videoPicked": "✅ Vídeo marcado — vuelve a abrir el panel de la extensión",
    "overlay.pickerBanner": "🎯 Haz clic sobre el vídeo que quieres controlar (Esc para cancelar)",
    "overlay.nativePause": "⏸ Pausa · {time}",
    "overlay.nativePlay": "▶ {time}",
    "overlay.holdFrame": "▶ fotograma · {time}"
  },

  en: {
    "popup.pauseBtn.off": "Disable Framewise's keyboard shortcuts on this site (in case they clash with the site's own)",
    "popup.pauseBtn.on": "Re-enable Framewise's keyboard shortcuts on this site",
    "popup.floatBtn.title": "Float: stays on top of everything, including the video's own tab",
    "popup.detachBtn.title": "Open in a separate window (stays open no matter where you click)",
    "popup.openOptions.title": "Configure shortcuts",
    "popup.pausedHint": "⏸ Keyboard shortcuts disabled on this site",
    "popup.noVideo.message": "No video found in this tab.",
    "popup.retryBtn": "🔄 Search again",
    "popup.reloadTabBtn": "↻ Reload the tab and retry",
    "popup.pickVideoBtn": "🎯 Manually pick video",

    "popup.frameBack.title": "Step back 1 frame",
    "popup.frameBack.label": "⏮ Frame",
    "popup.togglePlay.title": "Play / Pause",
    "popup.frameForward.title": "Step forward 1 frame",
    "popup.frameForward.label": "Frame ⏭",
    "popup.seekBack.title": "Seek back {n} seconds",
    "popup.toggleMute.title": "Mute",
    "popup.seekForward.title": "Seek forward {n} seconds",
    "popup.toggleLoop.title": "Loop",
    "popup.togglePip.title": "Picture-in-Picture",
    "popup.togglePip.label": "🗔 PiP",
    "popup.screenshot.title": "Capture frame",
    "popup.recordClip.title.idle": "Record video clip (press again to stop and save)",
    "popup.recordClip.title.recording": "Stop recording and save the clip",
    "popup.recordClip.label.idle": "⏺ Rec",
    "popup.recordClip.label.recording": "⏹ Stop",

    "popup.speed.sectionLabel": "Speed",
    "popup.speed.hint": "(stepped up to 2x · higher with the buttons)",
    "popup.volume.sectionLabel": "Extension volume",
    "popup.volume.hint": "(up to {max}% · independent of the player's own volume)",
    "popup.volumeReset.title": "Normal volume (100%)",
    "popup.fps.sectionLabel": "FPS for this site",
    "popup.fpsInfo.detecting": "detecting…",
    "popup.fpsInfo.fixed": "{fps} fps (fixed for this site)",
    "popup.fpsInfo.detected": "~{fps} fps (detected)",
    "popup.fpsInfo.global": "using global ({fps} fps)",
    "popup.useDetectedFps.label": "Use here",
    "popup.useDetectedFps.title": "Use the detected FPS for this domain",

    "popup.footer.domainOptions": "⚙ Shortcuts for this site",
    "popup.footer.globalOptions": "Global options",

    "popup.state.paused": "⏸ Paused",
    "popup.state.playing": "▶ Playing",

    "popup.cap.pip": "Picture-in-Picture not available on this video",
    "popup.cap.screenshot": "Can't capture: protected video (DRM) — the browser blocks reading its frames",
    "popup.cap.recordClip": "Recording not available on this video (browser lacks captureStream support)",
    "popup.cap.loopBroken": "Loop failed earlier on this video (the start is no longer buffered) — you can retry",
    "popup.floatUnsupported": "Your browser doesn't support overlay windows (Document Picture-in-Picture). Chrome/Edge 116 or newer is required.",

    "options.title": "Framewise — Options",
    "options.lang.label": "Language",

    "options.frames.h2": "Frames",
    "options.fps.label": "Global FPS (for the 1-frame step, when the site has no FPS of its own and none is detected live)",
    "options.fpsPreset.placeholder": "Common presets…",
    "options.fpsPreset.24": "24 (film)",
    "options.fpsPreset.23976": "23.976 (film/anime NTSC)",
    "options.multiFrameCount.label": 'Number of frames for "Step back/forward {n} frames"',

    "options.speed.h2": "Speed",
    "options.speedStep.label": "Increment when there's no next preset (x)",
    "options.speedPresets.label": "Speed presets (the popup's quick buttons)",
    "options.presetStepDown.title": "Removes the highest on the 0.25 scale (ignores manually added values)",
    "options.presetStepUp.title": "Adds the next on the 0.25 scale, not counting manually added values",
    "options.newPresetValue.placeholder": "add manually, e.g. 1.6",
    "options.addPresetBtn": "＋ Add",
    "options.resetPresets": "Restore default presets",
    "options.rememberSpeedPerDomain.label": "Remember the last speed used on each site and apply it when a new video loads",
    "options.wheelSpeedControl.label": "Change speed with Ctrl + mouse wheel over the video (without Ctrl, page scrolling works normally)",

    "options.volume.h2": "Extension volume",
    "options.volume.hint": 'This is a volume layer <strong>separate</strong> from the site\'s own player — the two don’t sync with each other. 100% here means "not touching anything"; anything else applies as an independent multiplier on top of whatever the player is already set to (0% mutes it only from the extension, 300% triples it).',
    "options.volumeMax.label": "Extension's maximum volume (%)",
    "options.volumeMax.hint": "Amplifying well above 100% can distort the audio if the source is already loud — that's a limitation of the audio itself, not of the extension.",
    "options.volumeStep.label": "Increment per volume up/down press (%)",
    "options.rememberVolumePerDomain.label": "Remember the extension's last volume used on each site (only the neutral 100% value restores automatically on load — any other value needs one manual touch, to avoid muting the tab outright)",

    "options.playback.h2": "Playback",
    "options.seekSeconds.label": 'Seconds for "Seek back/forward {n} seconds"',
    "options.showOverlay.label": "Show an on-screen notice when using a shortcut (includes pause/resume with timestamp)",
    "options.frameStepAudio.label": 'Play real sound when stepping frame by frame (briefly plays the video instead of jumping silently; forward is exact, backward plays a confirmation "tick" because browsers don’t support reverse audio)',

    "options.shortcuts.h2": "Keyboard shortcuts",
    "options.shortcuts.hint": "Shortcuts are <strong>global</strong> by default (they apply on every page). If a site already uses that same key for something else, switch the scope below to that domain and define a different shortcut (or clear it) just for it — a domain override always wins over the global one.",
    "options.scopeSelect.label": "Scope:",
    "options.newDomainInput.placeholder": "e.g.: www.crunchyroll.com",
    "options.addDomainBtn": "＋ Add domain",
    "options.removeDomainBtn": "Remove this domain",
    "options.scopeSelect.global": "Global (all sites)",
    "options.override.singular": "override",
    "options.override.plural": "overrides",
    "options.scopeSelect.paused": "⏸ paused",

    "options.backup.h2": "Backup",
    "options.exportBtn": "⬇ Export configuration",
    "options.importBtn": "⬆ Import configuration",
    "options.backup.hint": "Includes global shortcuts, per-domain overrides, speed presets and FPS fixed per site.",

    "options.reset.h2": "Reset",
    "options.reset.hint": "Clears every customized shortcut, domain override, speed preset and other setting, leaving everything as freshly installed. This can't be undone — press the button twice to confirm.",
    "options.resetAllBtn": "♻ Restore everything to defaults",
    "options.resetAllBtn.confirm": "⚠ Press again to confirm the reset",

    "options.save": "Save changes",
    "options.savedMsg": "✔ Saved",
    "options.savedMsg.reset": "✔ Restored to defaults",

    "options.footer.web": "Website",
    "options.footer.github": "GitHub",

    "options.alert.invalidSpeed": "Enter a valid speed number, e.g. 1.6",
    "options.alert.speedRange": "Speed must be between {min}x and {max}x — that's the real range the extension supports.",
    "options.alert.invalidDomain": "Enter a valid domain, e.g. www.crunchyroll.com",
    "options.presetChip.remove.title": "Remove {label}x",
    "options.keycap.recording": "Press a key…",
    "options.keycap.empty": "no shortcut",
    "options.tag.overridden": "customized here",
    "options.tag.inherited": "inherited from global",
    "options.recordBtn": "Record",
    "options.clearBtn": "Clear",
    "options.clearBtn.title.global": "Leaves this action without a global shortcut",
    "options.clearBtn.title.domain": "Disables this action only on this domain (without inheriting the global one)",
    "options.inheritBtn": "Inherit from global",
    "options.warn.clashHere": '⚠ "{combo}" was already assigned here — consider changing it',
    "options.warn.clashDomain": '⚠ "{combo}" is already in use here by "{label}" ({source}) — consider changing it',
    "options.warn.source.ownOverride": "customized on this domain",
    "options.warn.source.inherited": "inherited from global",
    "options.alert.importInvalidFile": "Invalid file: {msg}",
    "options.alert.importFailed": "Couldn't import the configuration: {error}",
    "options.alert.importSuccess": 'Configuration imported. Press "Save changes" to apply it.',
    "options.confirm.removeDomain": 'Remove all overrides for "{domain}"?',
    "options.err.notObject": "the file doesn't contain a configuration object.",
    "options.err.speedPresetsType": '"speedPresets" should be a list of numbers.',
    "options.err.shortcutsType": '"shortcuts" should be an object (action → shortcut).',
    "options.err.actionsType": '"actions" should be an object of actions.',
    "options.err.domainOverridesType": '"domainOverrides" should be an object (domain → shortcuts).',
    "options.err.domainMapType": '"{field}" should be an object (domain → value).',

    "action.frameBack": "Step back 1 frame",
    "action.frameForward": "Step forward 1 frame",
    "action.frameBackMulti": "Step back {n} frames",
    "action.frameForwardMulti": "Step forward {n} frames",
    "action.speedUp": "Increase speed (next preset)",
    "action.speedDown": "Decrease speed (previous preset)",
    "action.speedReset": "Normal speed (1x)",
    "action.togglePlay": "Play / Pause",
    "action.seekBack": "Seek back {n} seconds",
    "action.seekForward": "Seek forward {n} seconds",
    "action.toggleLoop": "Toggle loop",
    "action.togglePip": "Picture-in-Picture",
    "action.toggleMute": "Mute / Unmute",
    "action.screenshot": "Capture current frame (PNG)",
    "action.recordClip": "Record / stop video clip",
    "action.volumeUp": "Volume up",
    "action.volumeDown": "Volume down",
    "action.volumeReset": "Normal volume (100%)",

    "overlay.volumeUnavailable": "⚠ The extension's volume isn't available on this video",
    "overlay.volume": "🔊 Volume (extension): {percent}%",
    "overlay.loadingSegment": "⏳ Loading that part…",
    "overlay.seekBlocked": "⚠ Can't seek further back than what's loaded at this point",
    "overlay.frameStep": "{dir} {sign}{frames} frame  ·  {time}",
    "overlay.speed": "Speed: {speed}x",
    "overlay.seek": "{icon} {secs}s  ·  {time}",
    "overlay.loopRestarted": "🔁 Loop: restarted from the beginning",
    "overlay.loopOn": "🔁 Loop on",
    "overlay.loopOff": "🔁 Loop off",
    "overlay.muted": "🔇 Muted",
    "overlay.unmuted": "🔊 Audio on",
    "overlay.pipUnavailable": "⚠ Picture-in-Picture not available",
    "overlay.frameCaptured": "📸 Frame captured",
    "overlay.captureFailed": "⚠ Couldn't capture (protected/DRM video?)",
    "overlay.recordingEmpty": "⚠ The recording came out empty — nothing was saved",
    "overlay.clipSaved": "💾 Clip saved",
    "overlay.recordingFailed": "⚠ Can't record this video (protected by DRM, or no browser support?)",
    "overlay.recording": "⏺ Recording clip…",
    "overlay.stoppingRecording": "⏹ Stopping recording…",
    "overlay.noVideoAtPoint": "⚠ No <video> found there — try clicking directly on the video image",
    "overlay.videoPicked": "✅ Video marked — reopen the extension panel",
    "overlay.pickerBanner": "🎯 Click the video you want to control (Esc to cancel)",
    "overlay.nativePause": "⏸ Paused · {time}",
    "overlay.nativePlay": "▶ {time}",
    "overlay.holdFrame": "▶ frame · {time}"
  }
};

// Idioma del navegador (Chrome/Edge), no el del sistema operativo — es lo único a lo que
// chrome.i18n da acceso, pero coincide con el del SO en la inmensa mayoría de instalaciones (el
// navegador hereda el idioma del SO salvo que se haya cambiado a mano en sus propios ajustes).
// Disponible en todos los contextos de la extensión (popup, opciones, content scripts,
// background) sin permisos extra. Solo se admiten "es"/"en", así que cualquier variante de inglés
// ("en-US", "en-GB"…) cae en "en" y cualquier otra cosa cae en "es".
function detectBrowserLang() {
  try {
    const raw = (typeof chrome !== "undefined" && chrome.i18n && chrome.i18n.getUILanguage)
      ? chrome.i18n.getUILanguage()
      : "";
    return raw.toLowerCase().startsWith("en") ? "en" : "es";
  } catch (e) {
    return "es";
  }
}

// Idioma efectivo: el elegido explícitamente por el usuario (ES/EN en el popup u Opciones) si lo
// hay; si nunca lo ha tocado (settings.lang es null, el default de fábrica — ver SYNC_DEFAULTS en
// settings.js), se sigue el idioma del navegador en cada momento, sin quedar fijado la primera vez
// que se detecta: si el usuario cambia el idioma de Chrome más adelante, la extensión lo sigue,
// hasta que elija uno a mano, momento en el que ese sí queda fijo.
function currentLang(settings) {
  if (settings && settings.lang === "en") return "en";
  if (settings && settings.lang === "es") return "es";
  return detectBrowserLang();
}

function T(lang, key, vars) {
  const dict = STRINGS[lang] || STRINGS.es;
  let str = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : (STRINGS.es[key] || key);
  if (vars) {
    Object.keys(vars).forEach((k) => {
      str = str.split("{" + k + "}").join(vars[k]);
    });
  }
  return str;
}

// Rellena todo lo marcado con data-i18n* dentro de root con el idioma dado. Se llama entera cada
// vez que cambia el idioma o se repinta una lista generada por JS — no hay tantos nodos como para
// que recalcularlo todo de golpe sea un problema real de rendimiento.
function applyI18n(lang, root) {
  root = root || document;
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = T(lang, el.getAttribute("data-i18n"));
  });
  root.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = T(lang, el.getAttribute("data-i18n-html"));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = T(lang, el.getAttribute("data-i18n-title"));
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = T(lang, el.getAttribute("data-i18n-placeholder"));
  });
  (root.ownerDocument || root).documentElement.lang = lang;
}
