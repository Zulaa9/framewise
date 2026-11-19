# Checklist manual (lo que las pruebas automáticas no cubren)

Estado: **no ejecutada**. Las pruebas automáticas (`npm test`) corren en Chromium sin interfaz,
en Linux, sobre páginas locales con vídeos generados. Esto queda fuera de su alcance y hay que
comprobarlo a mano antes de publicar.

Preparación: cargar la carpeta del repositorio como extensión descomprimida (o el ZIP de
`npm run pack` descomprimido) en un perfil con ajustes ya guardados por la 1.0.0 de la tienda.

## Actualización desde la 1.0.0
- [ ] Con la 1.0.0 de la tienda instalada y personalizada (atajos, overrides por dominio, pausa en un
      sitio, velocidad/volumen recordados), actualizar a esta versión: todo sigue igual.
- [ ] Pestañas abiertas antes de actualizar: funcionan sin recargar (reinyección) y la consola de la
      página no muestra errores de Framewise.

## Sitios reales (Chrome y Edge)
- [ ] YouTube: j/k/l, paso de fotograma, velocidad recordada al pasar al siguiente vídeo de una
      lista (autoplay), Ctrl+rueda, captura y clip, Picture-in-Picture.
- [ ] YouTube: escribir j, k o l en el buscador y en un comentario no controla el vídeo.
- [ ] Crunchyroll (reproductor en iframe, DRM): el popup encuentra el vídeo; pasados >30 s sin tocar
      nada, sigue encontrándolo; paso de fotograma y saltos; captura y clip deshabilitados con su
      motivo; un salto a un tramo no cargado revierte con aviso.
- [ ] Twitch o Vimeo: detección, velocidad y overlay.
- [ ] Un sitio con vídeos en bucle propios (p. ej. vídeos cortos tipo GIF en una red social): siguen
      repitiéndose solos con la extensión instalada.
- [ ] Pantalla completa del reproductor del sitio y pantalla completa nativa del `<video>`: el aviso
      en pantalla se ve encima.

## Plataformas
- [ ] Edge (Windows): carga sin errores en edge://extensions, popup, Opciones, ventana aparte y
      ventana flotante (📌).
- [ ] macOS: Ctrl+Shift+↑/↓ (volumen), atajos con Ctrl (no Cmd), Ctrl+rueda.
- [ ] Teclado español: Ctrl+Shift+, y Ctrl+Shift+. (N fotogramas) y Ctrl+Shift+\ (volumen 100 %)
      funcionan; escribir @, € o # con AltGr en un campo de texto no dispara nada.

## Novedades de la 1.2.0
- [ ] Teclado español en Windows: en Opciones aparece destacado el aviso de atajos alternativos;
      tras pulsarlo y guardar, Ctrl+Shift+← / → cambian la velocidad, Ctrl+Shift+Intro la vuelve a 1x y
      Ctrl+Shift+Retroceso pone el volumen al 100 %, en YouTube y en un vídeo normal.
- [ ] Ctrl+Shift+← / → dentro de un campo de texto siguen seleccionando palabras (no tocan el vídeo).
- [ ] Volumen recordado al 200 % en un sitio: al recargar, el vídeo suena normal hasta el primer clic
      y, tras él, sube al 200 % sin cortes ni silencio.
- [ ] Grabar un clip en YouTube y navegar a otro vídeo sin parar: se abre "Clips recuperados" en
      segundo plano, el clip se descarga y se reproduce en VLC/Chrome.
- [ ] Grabar y cerrar la pestaña; grabar y cerrar el navegador entero (al volver a abrirlo debe
      aparecer la página de recuperación).
- [ ] Podcast o radio web con `<audio>` (sin vídeo): el popup lo encuentra, j/k/l, velocidad y
      volumen funcionan; los botones de fotograma, captura, clip y PiP salen deshabilitados.
- [ ] Gmail (atajos propios j/k) con sonidos de notificación: Framewise no se queda las teclas.
- [ ] Crunchyroll: pulsar l tres veces seguidas salta 3 veces; un salto a un tramo no cargado
      revierte y no deja saltos pendientes.

## Audio
- [ ] Abrir una pestaña con vídeo, sin hacer clic en ella, y subir el volumen desde el popup: aparece
      el aviso de "haz clic una vez en la página" y el vídeo **sigue sonando**. Tras un clic, el
      volumen ya se puede amplificar.
- [ ] Volumen al 200 % en un vídeo y pasar al siguiente de una lista: sigue sonando.

## Lectores de pantalla (opcional)
- [ ] NVDA/VoiceOver en el popup: los botones de icono se anuncian por su función; los sliders,
      con su nombre y valor.
