/* ============================================================================
   Bravos CRM — motor del sitio
   Renderiza todo desde window.BRAVOS_CONTENT (ver content.js).
   Router por hash: #/ , #/versions , #/working , #/terms-of-service
   ========================================================================== */
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
      var h = /^\s*##\s+(.*)$/.exec(line);
      var li = /^\s*-\s+(.*)$/.exec(line);
      if (h) { flushPara(); flushList(); html += '<h4 class="fmt-h">' + fmtInline(h[1]) + '</h4>'; }
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

  var TONES = ['green', 'blue', 'amber'];
  function toneClass(tone) {
    return TONES.indexOf(tone) === -1 ? 'green' : tone;
  }

  /* --- Contenido ---------------------------------------------------------- */
  /* Los chips pasaron de {es,en} a {label:{es,en}, tip:{es,en}}. Esto acepta
     las dos formas (por si queda un content.js viejo) y deja todo en la nueva. */
  function normalizeChips(c) {
    if (c && c.home && Array.isArray(c.home.chips)) {
      c.home.chips = c.home.chips.map(function (ch) {
        if (ch && ch.label) return { label: ch.label, tip: ch.tip || { es: '', en: '' } };
        return { label: { es: (ch && ch.es) || '', en: (ch && ch.en) || '' }, tip: { es: '', en: '' } };
      });
    }
    return c;
  }

  /* La página muestra content.js y nada más. Es la única fuente de verdad. */
  function loadContent() {
    return normalizeChips(deepClone(window.BRAVOS_CONTENT));
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
  function versionsPage() {
    var c = state.content;
    var changesWord = state.lang === 'es' ? 'cambios' : 'changes';
    var changeWord = state.lang === 'es' ? 'cambio' : 'change';

    var rows = c.versions.map(function (x, i) {
      var n = x.changes.length;
      return '' +
        '<button type="button" class="ver-row" data-modal="ver-' + i + '">' +
          '<span class="ver-row-v">' + esc(x.v) + '</span>' +
          '<span class="badge badge--' + toneClass(x.tone) + '">' + esc(t('versions.' + i + '.tag')) + '</span>' +
          '<span class="ver-row-date">' + esc(t('versions.' + i + '.date')) + '</span>' +
          '<span class="ver-row-count">' + n + ' ' + (n === 1 ? changeWord : changesWord) + '</span>' +
          '<span class="ver-row-arrow" aria-hidden="true">&rsaquo;</span>' +
        '</button>';
    }).join('');

    var modals = c.versions.map(function (x, i) {
      var changes = x.changes.map(function (_, j) {
        return '<div class="tl-change"><span' + ed('versions.' + i + '.changes.' + j) + '</span></div>';
      }).join('');
      return '' +
        '<div class="ver-modal" id="ver-' + i + '">' +
          '<div class="ver-modal-backdrop" data-modal-close></div>' +
          '<div class="ver-modal-panel" role="dialog" aria-modal="true" aria-label="' + esc(x.v) + '">' +
            '<button type="button" class="ver-modal-close" data-modal-close aria-label="Cerrar">&times;</button>' +
            '<div class="ver-modal-head">' +
              '<span class="tl-v">' + esc(x.v) + '</span>' +
              '<span class="badge badge--' + toneClass(x.tone) + '"' + ed('versions.' + i + '.tag') + '</span>' +
              '<span class="ver-modal-date"' + ed('versions.' + i + '.date') + '</span>' +
            '</div>' +
            '<div class="ver-modal-changes tl-changes">' + changes + '</div>' +
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

  /* --- Página: Próximamente ---------------------------------------------- */
  function workingPage() {
    var c = state.content;
    var items = c.working.map(function (w, i) {
      /* El ancho va en data-bar y lo aplica applyBars() por JS: así no queda
         ningún style="" inline y la CSP puede prohibir 'unsafe-inline'. */
      var pct = Math.max(0, Math.min(100, Number(w.progress) || 0));
      var bar = pct > 0
        ? '<div class="work-bar-wrap">' +
            '<div class="work-bar-track">' +
              '<div class="work-bar-fill" data-bar="' + pct + '"></div>' +
            '</div>' +
            '<div class="work-progress-label"' + ed('working.' + i + '.progressLabel') + '</div>' +
          '</div>'
        : '';
      return '' +
        '<div class="work-card">' +
          '<div class="work-head">' +
            '<span class="badge badge--' + toneClass(w.tone) + '"' + ed('working.' + i + '.status') + '</span>' +
            '<span class="work-code">' + esc(w.code) + '</span>' +
          '</div>' +
          '<div class="work-title"' + ed('working.' + i + '.title') + '</div>' +
          '<div class="work-desc"' + edRich('working.' + i + '.desc') + '</div>' +
          bar +
        '</div>';
    }).join('');

    return '' +
      '<section class="subpage">' +
        '<div class="working-shell">' +
          '<span class="kicker"' + ed('workingPage.kicker') + '</span>' +
          '<h1' + ed('workingPage.title') + '</h1>' +
          '<p class="subpage-sub"' + ed('workingPage.sub') + '</p>' +
          '<div class="work-grid">' + items + '</div>' +
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

  /* --- Render ------------------------------------------------------------ */
  var PAGES = {
    home: homePage,
    versions: versionsPage,
    working: workingPage,
    terms: termsPage,
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
    if (state.page === 'home') return b + ' — ' + t('home.eyebrow');
    return t(TITLE_NAV[state.page]) + ' · ' + b;
  }

  /* Los anchos de las barras se aplican por CSSOM (no los bloquea la CSP,
     a diferencia de un atributo style="" en el HTML). */
  function applyBars(root) {
    var bars = root.querySelectorAll('[data-bar]');
    for (var i = 0; i < bars.length; i++) {
      bars[i].style.width = bars[i].getAttribute('data-bar') + '%';
    }
  }

  function render() {
    var root = document.getElementById('app');
    if (!root) return;
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
       así no queda el scroll del fondo bloqueado. */
    document.body.classList.remove('ver-modal-open');

    window.dispatchEvent(new CustomEvent('bravos:rendered'));
  }

  /* --- Modales ----------------------------------------------------------- */
  function openModal(id) {
    var m = document.getElementById(id);
    if (!m) return;
    m.classList.add('is-open');
    document.body.classList.add('ver-modal-open');
    var close = m.querySelector('.ver-modal-close');
    if (close) close.focus();
  }

  function closeModal(m) {
    if (!m) m = document.querySelector('.ver-modal.is-open');
    if (!m) return;
    m.classList.remove('is-open');
    document.body.classList.remove('ver-modal-open');
  }

  /* --- Router ------------------------------------------------------------ */
  function pageFromHash() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    if (h === 'versions') return 'versions';
    if (h === 'working') return 'working';
    if (h === 'terms-of-service' || h === 'terms') return 'terms';
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
      var closeM = e.target.closest('[data-modal-close]');
      if (closeM) {
        e.preventDefault();
        closeModal(closeM.closest('.ver-modal'));
        return;
      }
      var openM = e.target.closest('[data-modal]');
      if (openM) {
        e.preventDefault();
        openModal(openM.getAttribute('data-modal'));
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

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var open = document.querySelector('.ver-modal.is-open');
        if (open) closeModal(open);
      }
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
    normalizeChips: normalizeChips,
  };

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
    window.dispatchEvent(new CustomEvent('bravos:ready'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
