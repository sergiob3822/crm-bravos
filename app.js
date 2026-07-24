(function () {
  'use strict';

  var LANG_KEY = 'bravos:lang';

  /* --- Estado ------------------------------------------------------------ */
  var state = {
    lang: 'es',
    page: 'home',
    content: null,
  };

  /* --- Utilidades -------------------------------------------------------- */
  function deepClone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* Resuelve una ruta tipo "home.features.2.title" sobre el contenido. */
  function nodeAt(path, root) {
    var parts = String(path).split('.');
    var node = root || state.content;
    for (var i = 0; i < parts.length; i++) {
      if (node == null) return undefined;
      node = node[parts[i]];
    }
    return node;
  }

  /* Lee un texto i18n en el idioma actual. */
  function t(path) {
    var node = nodeAt(path);
    if (node == null) return '';
    if (typeof node === 'string') return node;
    var v = node[state.lang];
    if (v == null) v = node.es;
    return v == null ? '' : v;
  }

  /* Escribe un texto i18n en el idioma actual. */
  function setText(path, value) {
    var parts = String(path).split('.');
    var last = parts.pop();
    var parent = nodeAt(parts.join('.'));
    if (!parent) return false;
    var leaf = parent[last];
    if (leaf && typeof leaf === 'object' && !Array.isArray(leaf)) {
      leaf[state.lang] = value;
    } else {
      parent[last] = value;
    }
    return true;
  }

  /* Marca un nodo como editable: data-edit="ruta" */
  function E(path) {
    return ' data-edit="' + esc(path) + '"';
  }

  /* Texto editable ya escapado + su ruta. */
  function ed(path) {
    return E(path) + '>' + esc(t(path));
  }

  /* --- Mini-formato para textos largos ----------------------------------- */
  /* Un markdown reducido y SEGURO. Regla de oro: primero escapamos TODO el
     texto (esc), y recién después transformamos los tokens en etiquetas
     propias. Como el texto ya viene escapado, no puede colarse HTML del
     usuario; las únicas etiquetas que aparecen son las que generamos acá.
     Los colores salen por clase (no por style=""), así funciona con la CSP.

       **negrita**        _cursiva_
       ## Subtítulo       (línea que arranca con ##)
       - ítem de lista    (líneas que arrancan con -)
       [green]texto[/green]  (colores: green, teal, amber, blue, ink, muted)
       línea en blanco = párrafo nuevo    salto simple = <br> */
  var FMT_COLORS = { green: 1, teal: 1, amber: 1, blue: 1, ink: 1, muted: 1 };

  function fmtInline(s) {
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/_([^_\n]+)_/g, '<em>$1</em>');
    s = s.replace(/\[(green|teal|amber|blue|ink|muted)\]([\s\S]*?)\[\/\1\]/g,
      function (m, color, inner) { return '<span class="fmt-c-' + color + '">' + inner + '</span>'; });
    return s;
  }

  /* Imagen o video de una línea "![alt](url)". El texto ya viene escapado, así
     que la URL no puede tener <>&"'; además solo aceptamos assets/… o https://
     (cualquier otra cosa cae a texto literal). El src de img/video no ejecuta JS
     y una URL externa la corta la CSP, así que es seguro. */
  function mediaTag(url, alt) {
    url = String(url).trim();
    /* Local: solo un archivo dentro de assets/, sin subcarpetas ni "..".
       Externo: solo https. Cualquier otra cosa (javascript:, traversal, etc.)
       cae a null → se muestra como texto literal. */
    var okLocal = /^assets\/[A-Za-z0-9._-]+$/.test(url);
    var okHttps = /^https:\/\/[^\s]+$/.test(url) && url.indexOf('..') === -1;
    if (!okLocal && !okHttps) return null;
    if (/\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i.test(url)) {
      return '<video class="fmt-media" src="' + url + '" controls preload="metadata"></video>';
    }
    return '<img class="fmt-media" src="' + url + '" alt="' + alt + '">';
  }

  function fmt(raw) {
    var text = esc(raw == null ? '' : String(raw)).replace(/\r\n?/g, '\n');
    var lines = text.split('\n');
    var html = '', para = [], list = [];
    function flushPara() {
      if (para.length) { html += '<p class="fmt-p">' + para.join('<br>') + '</p>'; para = []; }
    }
    function flushList() {
      if (list.length) {
        html += '<ul class="fmt-ul">' +
          list.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';
        list = [];
      }
    }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line.trim()) { flushPara(); flushList(); continue; }
      var media = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line);
      var h = /^\s*##\s+(.*)$/.exec(line);
      var li = /^\s*-\s+(.*)$/.exec(line);
      var mtag = media ? mediaTag(media[2], media[1]) : null;
      if (mtag) { flushPara(); flushList(); html += mtag; }
      else if (h) { flushPara(); flushList(); html += '<h4 class="fmt-h">' + fmtInline(h[1]) + '</h4>'; }
      else if (li) { flushPara(); list.push(fmtInline(li[1])); }
      else { flushList(); para.push(fmtInline(line)); }
    }
    flushPara(); flushList();
    return html;
  }

  /* Campo editable con mini-formato: el editor lo trata aparte (data-rich). */
  function edRich(path) {
    return E(path) + ' data-rich="1">' + fmt(t(path));
  }

  var TONES = ['green', 'teal', 'blue', 'cyan', 'purple', 'pink', 'red', 'orange', 'amber', 'gray'];
  function toneClass(tone) {
    return TONES.indexOf(tone) === -1 ? 'green' : tone;
  }

  /* --- Contenido ---------------------------------------------------------- */
  /* Dos estructuras cambiaron de forma con el tiempo. Esto acepta la vieja y la
     nueva (por si queda un content.js o un borrador viejo) y deja todo normalizado:
       chips:   {es,en}  →  {label:{es,en}, tip:{es,en}}
       changes: {es,en}  →  {t:{es,en}}  (+ desc opcional) */
  function normalize(c) {
    if (c && c.home && Array.isArray(c.home.chips)) {
      c.home.chips = c.home.chips.map(function (ch) {
        if (ch && ch.label) return { label: ch.label, tip: ch.tip || { es: '', en: '' } };
        return { label: { es: (ch && ch.es) || '', en: (ch && ch.en) || '' }, tip: { es: '', en: '' } };
      });
    }
    if (c && Array.isArray(c.versions)) {
      c.versions.forEach(function (v) {
        if (Array.isArray(v.changes)) {
          v.changes = v.changes.map(function (ch) {
            if (ch && ch.t) return ch;
            return { t: { es: (ch && ch.es) || '', en: (ch && ch.en) || '' } };
          });
        }
        /* Una etiqueta {tag,tone,glow} → un array de etiquetas tags[]. */
        if (!Array.isArray(v.tags)) {
          v.tags = [{
            label: v.tag || { es: '', en: '' },
            tone: v.tone || 'green',
            glow: !!v.glow,
          }];
          delete v.tag; delete v.tone; delete v.glow;
        }
      });
    }
    if (c && Array.isArray(c.working)) {
      c.working.forEach(function (w) {
        if (!Array.isArray(w.items)) w.items = [];
      });
    }
    return c;
  }

  /* La página muestra content.js y nada más. Es la única fuente de verdad. */
  function loadContent() {
    return normalize(deepClone(window.BRAVOS_CONTENT));
  }

  /* --- Bloques reutilizables --------------------------------------------- */
  function logoMark() {
    return '<div class="logo-mark"><i></i></div>';
  }

  function header() {
    var c = state.content;
    var pg = state.page;
    return '' +
      '<header class="site-header">' +
        '<div class="shell">' +
          '<button class="brand-btn" data-go="#/" aria-label="' + esc(c.brand.name + c.brand.suffix) + '">' +
            logoMark() +
            '<div class="logo-text">' + esc(c.brand.name) +
              '<span>' + esc(c.brand.suffix) + '</span>' +
            '</div>' +
          '</button>' +
          /* El selector de idioma es hermano del nav (no hijo) para que en
             mobile pueda quedar arriba junto al logo y los links pasen abajo. */
          '<nav class="header-nav">' +
            '<button class="nav-btn' + (pg === 'versions' ? ' is-active' : '') + '" data-go="#/versions"' + ed('nav.versions') + '</button>' +
            '<button class="nav-btn' + (pg === 'working' ? ' is-active' : '') + '" data-go="#/working"' + ed('nav.coming') + '</button>' +
            '<button class="nav-btn' + (pg === 'terms' ? ' is-active' : '') + '" data-go="#/terms-of-service"' + ed('nav.terms') + '</button>' +
          '</nav>' +
          '<div class="lang-switch">' +
            '<button class="lang-pill' + (state.lang === 'es' ? ' is-active' : '') + '" data-lang="es" aria-label="Español">ES</button>' +
            '<button class="lang-pill' + (state.lang === 'en' ? ' is-active' : '') + '" data-lang="en" aria-label="English">EN</button>' +
          '</div>' +
        '</div>' +
      '</header>';
  }

  function footer() {
    var c = state.content;
    return '' +
      '<footer class="site-footer">' +
        '<div class="shell">' +
          '<div class="footer-brand">' +
            logoMark() +
            '<div class="footer-brand-name">' + esc(c.brand.name + c.brand.suffix) + '</div>' +
          '</div>' +
          '<div class="footer-nav">' +
            '<button class="footer-link" data-go="#/versions"' + ed('nav.versions') + '</button>' +
            '<button class="footer-link" data-go="#/working"' + ed('nav.coming') + '</button>' +
            '<button class="footer-link" data-go="#/terms-of-service"' + ed('nav.terms') + '</button>' +
          '</div>' +
          '<div class="footer-rights">' + esc(c.brand.copyright) + ' — ' +
            '<span' + ed('footer.rights') + '</span>' +
          '</div>' +
        '</div>' +
      '</footer>';
  }

  /* --- Página: Home ------------------------------------------------------ */
  function homePage() {
    var c = state.content;

    var chips = c.home.chips.map(function (_, i) {
      var tip = t('home.chips.' + i + '.tip');
      var tipAttr = tip.trim() ? ' data-tip="' + esc(tip) + '"' : '';
      return '<span class="chip"' + tipAttr + ed('home.chips.' + i + '.label') + '</span>';
    }).join('');

    var bubbles = c.home.chat.map(function (m, i) {
      var isOut = m.side === 'out';
      var meta = isOut
        ? '<div class="bubble-meta-out">' +
            '<span class="time">' + esc(m.time) + '</span>' +
            '<span class="ticks">✓✓</span>' +
          '</div>'
        : '<div class="bubble-meta-in">' + esc(m.time) + '</div>';
      return '' +
        '<div class="bubble ' + (isOut ? 'bubble-out' : 'bubble-in') + '">' +
          '<div class="bubble-text"' + ed('home.chat.' + i + '.t') + '</div>' +
          meta +
        '</div>';
    }).join('');

    var features = c.home.features.map(function (_, i) {
      return '' +
        '<div class="feature-card">' +
          '<div class="feature-title"' + ed('home.features.' + i + '.title') + '</div>' +
          '<div class="feature-desc"' + ed('home.features.' + i + '.desc') + '</div>' +
        '</div>';
    }).join('');

    return '' +
      '<section class="hero">' +
        '<div class="shell">' +
          '<div>' +
            '<span class="eyebrow"><span' + ed('home.eyebrow') + '</span></span>' +
            '<h1' + ed('home.heading') + '</h1>' +
            '<p class="hero-sub"' + ed('home.sub') + '</p>' +
            '<div class="chip-row">' + chips + '</div>' +
          '</div>' +
          '<div class="phone">' +
            '<div class="phone-top">' +
              '<div class="phone-avatar">' + esc(c.brand.initial) + '</div>' +
              '<div class="phone-ident">' +
                '<div class="phone-name">' + esc(c.brand.name + c.brand.suffix) + '</div>' +
                '<div class="phone-status"' + ed('home.online') + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="phone-body">' + bubbles + '</div>' +
            '<div class="phone-compose">' +
              '<div class="compose-field"' + ed('home.compose') + '</div>' +
              '<div class="compose-send">➤</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>' +
      '<section class="features">' +
        '<div class="shell">' +
          '<h2' + ed('home.featuresTitle') + '</h2>' +
          '<p class="features-sub"' + ed('home.featuresSub') + '</p>' +
          '<div class="feature-grid">' + features + '</div>' +
        '</div>' +
      '</section>';
  }

  /* --- Página: Versiones ------------------------------------------------- */
  /* Lista de versiones apiladas (títulos). Al hacer clic en una, se abre un
     modal ancho con el detalle. Los modales se rinden ocultos junto a la lista
     para que la edición inline del changelog siga funcionando en el editor. */
  /* Todas las etiquetas de una versión como badges (con su color y flúor). */
  function versionBadges(x, i) {
    return (x.tags || []).map(function (tg, k) {
      return '<span class="badge badge--' + toneClass(tg.tone) + (tg.glow ? ' is-glow' : '') + '">' +
        esc(t('versions.' + i + '.tags.' + k + '.label')) + '</span>';
    }).join('');
  }

  function versionsPage() {
    var c = state.content;
    var changesWord = state.lang === 'es' ? 'cambios' : 'changes';
    var changeWord = state.lang === 'es' ? 'cambio' : 'change';

    /* data-mirror: la fila muestra tag/fecha en modo lectura. Si en el editor se
       editan inline dentro del modal, el editor refresca estos nodos para que la
       fila no quede desactualizada. */
    var rows = c.versions.map(function (x, i) {
      var n = x.changes.length;
      return '' +
        '<button type="button" class="ver-row" data-modal="ver-' + i + '">' +
          '<span class="ver-row-v">' + esc(x.v) + '</span>' +
          '<span class="ver-row-tags">' + versionBadges(x, i) + '</span>' +
          '<span class="ver-row-date" data-mirror="versions.' + i + '.date">' + esc(t('versions.' + i + '.date')) + '</span>' +
          '<span class="ver-row-count">' + n + ' ' + (n === 1 ? changeWord : changesWord) + '</span>' +
          '<span class="ver-row-arrow" aria-hidden="true">&rsaquo;</span>' +
        '</button>';
    }).join('');

    var modals = c.versions.map(function (x, i) {
      /* Cada cambio es una "nota": título con ✓ y, si tiene descripción, se
         despliega al hacer clic (flechita a la derecha para plegar/desplegar). */
      var changes = x.changes.map(function (ch, j) {
        var base = 'versions.' + i + '.changes.' + j;
        var hasDesc = !!(ch.desc && t(base + '.desc').trim());
        if (!hasDesc) {
          return '<div class="chg"><div class="chg-head chg-head--plain">' +
            '<span class="chg-check" aria-hidden="true">✓</span>' +
            '<span class="chg-title"' + ed(base + '.t') + '</span>' +
            '</div></div>';
        }
        return '' +
          '<div class="chg chg--expandable">' +
            '<div class="chg-head" data-chg-toggle>' +
              '<span class="chg-check" aria-hidden="true">✓</span>' +
              '<span class="chg-title"' + ed(base + '.t') + '</span>' +
              '<button type="button" class="chg-arrow" data-chg-toggle aria-expanded="false" aria-label="Ver descripción">&rsaquo;</button>' +
            '</div>' +
            '<div class="chg-desc"><div class="chg-desc-inner"' + edRich(base + '.desc') + '</div></div>' +
          '</div>';
      }).join('');
      return '' +
        '<div class="ver-modal" id="ver-' + i + '">' +
          '<div class="ver-modal-backdrop" data-modal-close></div>' +
          '<div class="ver-modal-panel" role="dialog" aria-modal="true" aria-label="' + esc(x.v) + '">' +
            /* La cruz vive en la cabecera fija (fuera del área que scrollea),
               así queda siempre visible por más que bajes en la lista. */
            '<button type="button" class="ver-modal-close" data-modal-close aria-label="Cerrar">&times;</button>' +
            '<div class="ver-modal-top">' +
              '<div class="ver-modal-head">' +
                '<span class="tl-v">' + esc(x.v) + '</span>' +
                '<span class="ver-modal-tags">' + versionBadges(x, i) + '</span>' +
                '<span class="ver-modal-date"' + ed('versions.' + i + '.date') + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="ver-modal-body">' +
              '<div class="ver-modal-changes tl-changes">' + changes + '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
    }).join('');

    return '' +
      '<section class="subpage">' +
        '<div class="versions-shell">' +
          '<span class="kicker"' + ed('versionsPage.kicker') + '</span>' +
          '<h1' + ed('versionsPage.title') + '</h1>' +
          '<p class="subpage-sub"' + ed('versionsPage.sub') + '</p>' +
          '<div class="ver-list">' + rows + '</div>' +
        '</div>' +
        modals +
      '</section>';
  }

  /* Color de la barra según el porcentaje (rojo → verde oscuro). */
  function barColor(pct) {
    if (pct <= 25) return 'red';
    if (pct <= 38) return 'orange';
    if (pct <= 56) return 'yellow';
    if (pct <= 78) return 'lime';
    return 'green';
  }

  /* --- Página: Próximamente ---------------------------------------------- */
  /* Cada proyecto es un bloque (estilo Versiones): estado + título + descripción
     breve + barra de progreso. La barra se colorea según el %, muestra
     "x% Completado" automático, y al pasar el mouse/tocarla despliega los ítems
     ya logrados (con ✓). Al llegar a 100% lanza confeti. */
  function workingPage() {
    var c = state.content;
    var doneWord = state.lang === 'es' ? 'Completado' : 'complete';

    var blocks = c.working.map(function (w, i) {
      var pct = Math.max(0, Math.min(100, Number(w.progress) || 0));
      var items = (w.items || []);
      var itemsHtml = items.length
        ? '<div class="work-items">' +
            '<div class="work-items-title">' + (state.lang === 'es' ? 'Ya implementado' : 'Already done') + '</div>' +
            '<ul>' + items.map(function (_, k) {
              return '<li><span class="work-item-check" aria-hidden="true">✓</span>' +
                '<span' + ed('working.' + i + '.items.' + k + '.t') + '</span></li>';
            }).join('') + '</ul>' +
          '</div>'
        : '';
      var hasItems = items.length > 0;
      return '' +
        '<div class="work-block">' +
          '<div class="work-block-head">' +
            '<span class="badge badge--' + toneClass(w.tone) + (w.glow ? ' is-glow' : '') + '"' + ed('working.' + i + '.status') + '</span>' +
            '<h3 class="work-block-title"' + ed('working.' + i + '.title') + '</h3>' +
            '<span class="work-code">' + esc(w.code) + '</span>' +
          '</div>' +
          '<div class="work-block-desc"' + edRich('working.' + i + '.desc') + '</div>' +
          '<div class="work-progress' + (hasItems ? ' has-items' : '') + '"' + (hasItems ? ' data-progress-toggle tabindex="0"' : '') + '>' +
            '<div class="work-bar-track">' +
              '<div class="work-bar-fill work-bar--' + barColor(pct) + '" data-bar="' + pct + '" data-key="w' + i + '"></div>' +
            '</div>' +
            '<div class="work-progress-label">' + pct + '% ' + doneWord + '</div>' +
            itemsHtml +
          '</div>' +
        '</div>';
    }).join('');

    return '' +
      '<section class="subpage">' +
        '<div class="working-shell">' +
          '<span class="kicker"' + ed('workingPage.kicker') + '</span>' +
          '<h1' + ed('workingPage.title') + '</h1>' +
          '<p class="subpage-sub"' + ed('workingPage.sub') + '</p>' +
          '<div class="work-list">' + blocks + '</div>' +
        '</div>' +
      '</section>';
  }

  /* --- Página: Términos -------------------------------------------------- */
  function termsPage() {
    var c = state.content;
    var items = c.terms.map(function (_, i) {
      return '' +
        '<div class="terms-item">' +
          '<div class="terms-n">' + String(i + 1).padStart(2, '0') + '</div>' +
          '<div>' +
            '<h3' + ed('terms.' + i + '.h') + '</h3>' +
            '<p' + ed('terms.' + i + '.p') + '</p>' +
          '</div>' +
        '</div>';
    }).join('');

    /* La nota es opcional: si termsPage.note está vacío, el cartel no se dibuja. */
    var note = t('termsPage.note').trim()
      ? '<div class="terms-note"><span' + ed('termsPage.note') + '</span></div>'
      : '';

    return '' +
      '<section class="subpage subpage--white">' +
        '<div class="terms-shell">' +
          '<span class="kicker"' + ed('termsPage.kicker') + '</span>' +
          '<h1' + ed('termsPage.title') + '</h1>' +
          '<div class="terms-updated"' + ed('termsPage.updated') + '</div>' +
          note +
          '<div class="terms-list">' + items + '</div>' +
        '</div>' +
      '</section>';
  }

  /* --- Página: Login del editor online ----------------------------------- */
  function loginPage() {
    return '' +
      '<section class="subpage subpage--white login-page">' +
        '<div class="login-card">' +
          '<div class="login-lock" aria-hidden="true">' + logoMark() + '</div>' +
          '<h1 class="login-title">Editor de contenido</h1>' +
          '<p class="login-sub">Ingresá con tu clave de administrador para editar el sitio en vivo.</p>' +
          '<form class="login-form" data-login>' +
            '<input class="login-input" type="password" name="password" placeholder="Contraseña de administrador" autocomplete="current-password" required autofocus>' +
            '<button class="login-btn" type="submit">Entrar al editor</button>' +
          '</form>' +
          '<div class="login-error" data-login-error role="alert"></div>' +
        '</div>' +
      '</section>';
  }

  /* --- Render ------------------------------------------------------------ */
  var PAGES = {
    home: homePage,
    versions: versionsPage,
    working: workingPage,
    terms: termsPage,
    login: loginPage,
  };

  /* El título de la pestaña sale del contenido, no está escrito acá: así sigue
     a la marca y a los textos que edites, en los dos idiomas. */
  var TITLE_NAV = {
    versions: 'nav.versions',
    working: 'nav.coming',
    terms: 'nav.terms',
  };

  function pageTitle() {
    var b = state.content.brand.name + state.content.brand.suffix;
    if (state.page === 'login') return 'Editor · ' + b;
    if (state.page === 'home') return b + ' — ' + t('home.eyebrow');
    return t(TITLE_NAV[state.page]) + ' · ' + b;
  }

  /* Los anchos de las barras se aplican por CSSOM (no los bloquea la CSP,
     a diferencia de un atributo style="" en el HTML). */
  /* Recordamos qué barras ya festejaron el 100%, y las re-armamos si bajan,
     para no lanzar confeti en cada re-render (p. ej. al tipear en el editor). */
  var celebrated = {};

  function applyBars(root) {
    var bars = root.querySelectorAll('[data-bar]');
    for (var i = 0; i < bars.length; i++) {
      var bar = bars[i];
      var pct = Number(bar.getAttribute('data-bar')) || 0;
      bar.style.width = pct + '%';
      var key = bar.getAttribute('data-key') || ('b' + i);
      if (pct >= 100) {
        if (!celebrated[key]) { celebrated[key] = true; celebrate(bar); }
      } else {
        delete celebrated[key];
      }
    }
  }

  /* --- Confeti (al 100%) -------------------------------------------------- */
  function celebrate(anchor) {
    /* Diferido para que la barra ya esté ubicada en pantalla. */
    setTimeout(function () { confettiBurst(anchor); }, 70);
  }

  function confettiBurst(anchor) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var rect = anchor.getBoundingClientRect();
    if (!rect.width) return;
    var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    var colors = ['#25D366', '#F0B429', '#EF4444', '#2E7FD1', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316'];
    var layer = document.createElement('div');
    layer.className = 'confetti-layer';
    document.body.appendChild(layer);
    for (var i = 0; i < 90; i++) {
      var p = document.createElement('i');
      p.className = 'confetti-piece';
      var ang = Math.random() * Math.PI * 2;
      var vel = 120 + Math.random() * 240;
      p.style.left = cx + 'px';
      p.style.top = cy + 'px';
      p.style.background = colors[i % colors.length];
      p.style.setProperty('--dx', (Math.cos(ang) * vel).toFixed(1) + 'px');
      p.style.setProperty('--dy', (Math.sin(ang) * vel - (120 + Math.random() * 140)).toFixed(1) + 'px');
      p.style.setProperty('--rot', Math.round(Math.random() * 900 - 450) + 'deg');
      p.style.animationDelay = (Math.random() * 0.06).toFixed(3) + 's';
      if (Math.random() < 0.5) p.style.borderRadius = '50%';
      layer.appendChild(p);
    }
    setTimeout(function () { layer.remove(); }, 1700);
  }

  function render() {
    var root = document.getElementById('app');
    if (!root) return;
    /* Fuera de Próximamente re-armamos el confeti, así al volver vuelve a lanzarse. */
    if (state.page !== 'working') celebrated = {};
    root.innerHTML =
      '<div class="page">' +
        header() +
        '<main>' + (PAGES[state.page] || homePage)() + '</main>' +
        footer() +
      '</div>';
    applyBars(root);

    document.documentElement.lang = state.lang;
    document.title = pageTitle();

    var descEl = document.querySelector('meta[name="description"]');
    if (descEl) descEl.setAttribute('content', t('home.sub'));

    /* Cada render arranca sin modal abierto (al navegar/re-render se cierran),
       así no queda el scroll del fondo bloqueado ni referencias a nodos muertos. */
    document.body.classList.remove('ver-modal-open');
    activeModal = null;
    modalTrigger = null;

    window.dispatchEvent(new CustomEvent('bravos:rendered'));
  }

  /* --- Modales ----------------------------------------------------------- */
  /* Solo puede haber UN modal abierto. Guardamos cuál y quién lo abrió, para
     cerrar el correcto y devolverle el foco a la fila al salir. */
  var activeModal = null;
  var modalTrigger = null;

  function focusables(root) {
    return [].slice.call(root.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable]'
    )).filter(function (el) { return el.offsetParent !== null || el === document.activeElement; });
  }

  function openModal(id, trigger) {
    var m = document.getElementById(id);
    if (!m) return;
    if (activeModal && activeModal !== m) closeModal(activeModal, true);
    modalTrigger = trigger || null;
    activeModal = m;
    m.classList.add('is-open');
    document.body.classList.add('ver-modal-open');
    var close = m.querySelector('.ver-modal-close');
    if (close) close.focus();
  }

  function closeModal(m, keepLock) {
    if (!m) m = activeModal || document.querySelector('.ver-modal.is-open');
    if (!m) return;
    m.classList.remove('is-open');
    if (m === activeModal) activeModal = null;
    /* El scroll del fondo se libera solo si ya no queda ningún modal abierto. */
    if (!keepLock && !document.querySelector('.ver-modal.is-open')) {
      document.body.classList.remove('ver-modal-open');
    }
    if (!keepLock && modalTrigger && document.contains(modalTrigger)) {
      modalTrigger.focus();
      modalTrigger = null;
    }
  }

  /* Focus trap: con el modal abierto, Tab no se escapa al fondo. */
  function trapFocus(e) {
    if (e.key !== 'Tab' || !activeModal || !activeModal.classList.contains('is-open')) return;
    var f = focusables(activeModal);
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || !activeModal.contains(document.activeElement))) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !activeModal.contains(document.activeElement))) {
      e.preventDefault(); first.focus();
    }
  }

  /* Despliega / pliega una nota del changelog. */
  function toggleChange(head) {
    var box = head.closest('.chg');
    if (!box) return;
    var open = box.classList.toggle('is-open');
    var arrow = box.querySelector('.chg-arrow');
    if (arrow) arrow.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  /* --- Router ------------------------------------------------------------ */
  function pageFromHash() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    if (h === 'versions') return 'versions';
    if (h === 'working') return 'working';
    if (h === 'terms-of-service' || h === 'terms') return 'terms';
    if (h === 'login' || h === 'login/') return 'login';
    return 'home';
  }

  function onHash() {
    var next = pageFromHash();
    var changed = next !== state.page;
    state.page = next;
    render();
    if (changed) window.scrollTo({ top: 0 });
  }

  function navigate(hash) {
    if (location.hash === hash) onHash();
    else location.hash = hash;
  }

  function setLang(lang) {
    if (lang !== 'es' && lang !== 'en') return;
    state.lang = lang;
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
    render();
  }

  /* --- Eventos ----------------------------------------------------------- */
  function bindGlobalClicks() {
    document.addEventListener('click', function (e) {
      /* Tocar la barra de progreso despliega/oculta los ítems (para touch).
         En desktop también se muestran al pasar el mouse (CSS). No cuenta si el
         clic fue dentro de la lista de ítems. */
      var pt = e.target.closest('[data-progress-toggle]');
      if (pt && !e.target.closest('.work-items')) {
        pt.classList.toggle('is-open');
        return;
      }
      var chg = e.target.closest('[data-chg-toggle]');
      if (chg) {
        e.preventDefault();
        toggleChange(chg);
        return;
      }
      var closeM = e.target.closest('[data-modal-close]');
      if (closeM) {
        e.preventDefault();
        closeModal(closeM.closest('.ver-modal'));
        return;
      }
      var openM = e.target.closest('[data-modal]');
      if (openM) {
        e.preventDefault();
        openModal(openM.getAttribute('data-modal'), openM);
        return;
      }
      if (e.target.closest('[data-logout]')) {
        e.preventDefault();
        doLogout();
        return;
      }
      var go = e.target.closest('[data-go]');
      if (go) {
        e.preventDefault();
        navigate(go.getAttribute('data-go'));
        return;
      }
      var lang = e.target.closest('[data-lang]');
      if (lang) {
        e.preventDefault();
        setLang(lang.getAttribute('data-lang'));
      }
    });

    /* Envío del formulario de login (editor online). */
    document.addEventListener('submit', function (e) {
      var form = e.target.closest('[data-login]');
      if (!form) return;
      e.preventDefault();
      var input = form.querySelector('input[name="password"]');
      var errEl = document.querySelector('[data-login-error]');
      var btn = form.querySelector('.login-btn');
      if (errEl) errEl.textContent = '';
      btn.disabled = true; btn.textContent = 'Entrando…';
      fetch('api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: input.value }),
      }).then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (j) {
          btn.disabled = false; btn.textContent = 'Entrar al editor';
          if (j && j.ok) { startOnlineEditor(); navigate('#/'); }
          else if (errEl) errEl.textContent = (j && j.error) || 'No se pudo entrar.';
        })
        .catch(function () {
          btn.disabled = false; btn.textContent = 'Entrar al editor';
          if (errEl) errEl.textContent = 'Error de conexión.';
        });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        /* Cierra el que está realmente abierto (no el primero del DOM). */
        var open = activeModal || document.querySelector('.ver-modal.is-open');
        if (open) closeModal(open);
        return;
      }
      trapFocus(e);
    });
  }

  /* --- API pública -------------------------------------------------------- */
  window.Bravos = {
    state: state,
    render: render,
    navigate: navigate,
    setLang: setLang,
    t: t,
    setText: setText,
    nodeAt: nodeAt,
    deepClone: deepClone,
    esc: esc,
    normalize: normalize,
    logout: doLogout,
  };

  /* --- Editor online ----------------------------------------------------- */
  /* La cookie bx_on (legible) es solo una pista de "hay sesión". El poder real
     lo da la cookie firmada bx_sess (HttpOnly), que /api/save verifica del lado
     del servidor. Cargar el editor sin sesión válida no permite guardar nada. */
  function hasOnlineCookie() {
    return /(?:^|;\s*)bx_on=1(?:;|$)/.test(document.cookie || '');
  }

  function startOnlineEditor() {
    if (window.BX_ONLINE) return;
    window.BX_ONLINE = true;
    var s = document.createElement('script');
    s.src = 'editor.js';
    document.body.appendChild(s);
  }

  function doLogout() {
    fetch('api/logout', { method: 'POST' }).catch(function () {})
      .then(function () { location.href = location.pathname + '#/login'; location.reload(); });
  }

  /* --- Arranque ---------------------------------------------------------- */
  function boot() {
    state.content = loadContent();
    try {
      var savedLang = localStorage.getItem(LANG_KEY);
      if (savedLang === 'es' || savedLang === 'en') state.lang = savedLang;
    } catch (e) {}

    state.page = pageFromHash();
    bindGlobalClicks();
    window.addEventListener('hashchange', onHash);
    render();
    /* Si ya hay una sesión abierta, levantamos el editor online solo. */
    if (hasOnlineCookie()) startOnlineEditor();
    window.dispatchEvent(new CustomEvent('bravos:ready'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
