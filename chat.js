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
