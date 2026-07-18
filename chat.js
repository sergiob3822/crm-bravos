/* ============================================================================
   BravosCRM — widget de chat (Chatwoot)

   Carga el SDK de Chatwoot desde el propio CRM (api.bravos.com.ar) y engancha
   la burbuja de chat a la web. Es el mismo snippet oficial de Chatwoot, movido
   a un archivo aparte para no llevar <script> inline en el HTML (así la CSP del
   sitio puede seguir prohibiendo 'unsafe-inline').

   Para que funcione, la CSP de vercel.json le abre la puerta a api.bravos.com.ar
   en script-src / connect-src / frame-src / img-src.

   El websiteToken NO es un secreto: es un identificador público pensado para ir
   embebido en el sitio. No expone nada sensible.
   ========================================================================== */

window.chatwootSettings = { position: 'right', type: 'standard', launcherTitle: '' };

(function (d, t) {
  var BASE_URL = 'https://api.bravos.com.ar';
  var g = d.createElement(t), s = d.getElementsByTagName(t)[0];
  g.src = BASE_URL + '/packs/js/sdk.js';
  g.async = true;
  s.parentNode.insertBefore(g, s);
  g.onload = function () {
    window.chatwootSDK.run({
      websiteToken: 'GLhMvzA8oiojHqyWiDJoVhyN',
      baseUrl: BASE_URL
    });
  };
})(document, 'script');
