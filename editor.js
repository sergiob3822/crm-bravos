/* ============================================================================
   Bravos CRM — Editor en vivo
   ----------------------------------------------------------------------------
   Se activa SOLO con ?edit=1 en la URL. Un visitante normal nunca lo ve
   y este archivo no hace absolutamente nada.

   Qué hace:
   · Clic sobre cualquier texto del sitio → lo editás ahí mismo.
   · Panel lateral → agregar/quitar/mover features, versiones, roadmap, términos.
   · Guarda solo en TU navegador (localStorage). No toca el servidor.
   · "Descargar content.js" → reemplazás el archivo y hacés deploy.
   ========================================================================== */
(function () {
  'use strict';

  var B = window.Bravos;
  if (!B) return;

  var STORE_KEY = 'bravos:content';

  var panel = null;
  var saveTimer = null;
  var dirty = false;
  /* content.js cambió desde que se guardó el borrador, así que lo descartamos
     y arrancamos del archivo. Se avisa en el panel. */
  var draftDiscarded = false;
  /* Idioma con el que se construyeron los campos del panel. Si el usuario
     cambia el idioma desde el switch del SITIO, el panel queda mostrando el
     idioma viejo mientras escribiría en el nuevo → hay que reconstruirlo. */
  var panelLang = null;

  /* --- Acceso a valores crudos (números, enums, strings no i18n) ---------- */
  function getRaw(path) {
    return B.nodeAt(path);
  }

  function setRaw(path, value) {
    var parts = String(path).split('.');
    var last = parts.pop();
    var parent = B.nodeAt(parts.join('.'));
    if (!parent) return;
    parent[last] = value;
  }

  /* --- Borrador ----------------------------------------------------------- */
  /* El borrador vive SOLO acá, en el editor: app.js no lo conoce y la página
     publicada no tiene una línea de este código. Un visitante muestra
     content.js y punto — no hay un `if` que pueda fallar.

     Se guarda junto a una huella (djb2) del content.js con el que se empezó a
     editar. Si el archivo cambia (lo exportaste y lo reemplazaste, o lo
     editaste a mano), la huella no coincide y el borrador viejo se tira: gana
     siempre el archivo del proyecto. */
  function stampOf(obj) {
    var s = JSON.stringify(obj);
    var h = 5381;
    for (var i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return (h >>> 0) + '-' + s.length;
  }

  var baseStamp = stampOf(window.BRAVOS_CONTENT);

  function loadDraft() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var saved = JSON.parse(raw);
      if (saved && saved.content && saved.stamp === baseStamp) return B.normalize(saved.content);
      localStorage.removeItem(STORE_KEY);
      draftDiscarded = true;
    } catch (e) {
      /* localStorage bloqueado o JSON roto: seguimos con content.js */
    }
    return null;
  }

  function saveDraft() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        stamp: baseStamp,
        content: B.state.content,
      }));
      return true;
    } catch (e) {
      return false;
    }
  }

  function resetDraft() {
    try {
      localStorage.removeItem(STORE_KEY);
    } catch (e) {}
    B.state.content = B.deepClone(window.BRAVOS_CONTENT);
    draftDiscarded = false;
    B.render();
  }

  /* --- Guardado ---------------------------------------------------------- */
  function markDirty() {
    dirty = true;
    updateStatus('Cambios sin exportar…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      updateStatus(saveDraft()
        ? 'Guardado en este navegador · falta exportar'
        : '⚠ No se pudo guardar (localStorage bloqueado)');
    }, 350);
  }

  function updateStatus(msg) {
    var el = document.getElementById('bx-status');
    if (el) el.textContent = msg;
  }

  function initialStatus() {
    if (dirty) return 'Guardado en este navegador · falta exportar';
    /* content.js cambió respecto del borrador: gana el archivo del proyecto. */
    if (draftDiscarded) return '↻ content.js cambió — arranqué desde el archivo';
    return 'Sin cambios';
  }

  /* --- Edición inline ---------------------------------------------------- */
  /* 'plaintext-only' evita que se pegue HTML dentro del sitio. Firefox recién
     lo soporta desde la v136, así que caemos a 'true' si no está. */
  var CE_MODE = (function () {
    var probe = document.createElement('div');
    probe.setAttribute('contenteditable', 'plaintext-only');
    return probe.contentEditable === 'plaintext-only' ? 'plaintext-only' : 'true';
  })();

  function enableInline() {
    /* Los campos con formato (data-rich) NO se editan sobre la página: su HTML
       es formato renderizado, no texto plano. Se editan desde el panel, con la
       barra de formato. Acá se saltean. */
    var nodes = document.querySelectorAll('#app [data-edit]:not([data-rich])');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      el.setAttribute('contenteditable', CE_MODE);
      el.setAttribute('spellcheck', 'false');
      el.classList.add('bx-editable');
    }
  }

  function onInlineInput(e) {
    var el = e.target.closest('#app [data-edit]');
    if (!el) return;
    var path = el.getAttribute('data-edit');
    B.setText(path, el.innerText.replace(/\n+$/, ''));
    var mirror = panel && panel.querySelector('[data-path="' + cssEsc(path) + '"]');
    if (mirror && document.activeElement !== mirror) mirror.value = el.innerText;
    /* Hay textos que además se muestran en otro lado en modo lectura (p. ej. el
       tag/fecha de la fila de versión). Se refrescan acá para que no queden
       desactualizados: la edición inline no re-renderiza la página. */
    var mirrors = document.querySelectorAll('#app [data-mirror="' + cssEsc(path) + '"]');
    for (var i = 0; i < mirrors.length; i++) mirrors[i].textContent = el.innerText;
    markDirty();
  }

  function onInlineKeydown(e) {
    var el = e.target.closest('#app [data-edit]');
    if (!el) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      el.blur();
    }
    if (e.key === 'Escape') el.blur();
  }

  /* Evita que editar un botón de navegación dispare la navegación.
     Para cambiar de página en modo edición está el selector del panel. */
  function onInlineClick(e) {
    if (e.target.closest('#app [data-edit]')) {
      e.stopPropagation();
      e.preventDefault();
    }
  }

  /* Con el fallback contenteditable="true" hay que forzar pegado sin formato. */
  function onInlinePaste(e) {
    var el = e.target.closest('#app [data-edit]');
    if (!el) return;
    e.preventDefault();
    var text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text.replace(/\s*\n\s*/g, ' '));
  }

  function cssEsc(s) {
    return String(s).replace(/"/g, '\\"');
  }

  /* --- Operaciones estructurales ----------------------------------------- */
  function listAt(path) {
    var l = B.nodeAt(path);
    return Array.isArray(l) ? l : null;
  }

  function addItem(listPath, factory) {
    var list = listAt(listPath);
    if (!list) return;
    list.push(factory(list.length));
    afterStructuralChange();
  }

  function removeItem(listPath, index) {
    var list = listAt(listPath);
    /* Etiquetas e ítems pueden quedar en 0. El resto de las listas conserva
       al menos un elemento. */
    var allowEmpty = /\.(tags|items)$/.test(listPath);
    if (!list || (!allowEmpty && list.length <= 1)) {
      alert('Tiene que quedar al menos un elemento.');
      return;
    }
    if (!confirm('¿Eliminar este elemento?')) return;
    list.splice(index, 1);
    afterStructuralChange();
  }

  function moveItem(listPath, index, delta) {
    var list = listAt(listPath);
    if (!list) return;
    var to = index + delta;
    if (to < 0 || to >= list.length) return;
    var item = list.splice(index, 1)[0];
    list.splice(to, 0, item);
    afterStructuralChange();
  }

  /* Enciende/apaga la descripción de una nota del changelog. Apagarla borra el
     texto, así que si hay algo escrito se pide confirmación. */
  function toggleDesc(path, on) {
    var item = B.nodeAt(path);
    if (!item) return;
    if (on) {
      if (!item.desc) item.desc = { es: '', en: '' };
    } else {
      var hasText = item.desc && ((item.desc.es || '').trim() || (item.desc.en || '').trim());
      if (hasText && !confirm('Esta nota tiene una descripción escrita. Si la apagás, se borra. ¿Seguir?')) {
        return false;
      }
      delete item.desc;
    }
    afterStructuralChange();
    return true;
  }

  function afterStructuralChange() {
    saveDraft();
    B.render();
    buildPanel();
    dirty = true;
    updateStatus('Guardado en este navegador · falta exportar');
  }

  /* --- Fábricas de items nuevos ------------------------------------------ */
  function i18n(es, en) {
    return { es: es, en: en };
  }

  var FACTORIES = {
    chips: function () { return { label: i18n('Nuevo', 'New'), tip: i18n('', '') }; },
    chat: function () {
      return { side: 'in', time: '10:30', t: i18n('Nuevo mensaje', 'New message') };
    },
    features: function () {
      return { title: i18n('Nueva función', 'New feature'), desc: i18n('Descripción de la función.', 'Feature description.') };
    },
    versions: function () {
      return {
        v: 'v1.0',
        date: i18n('Mes 2026', 'Month 2026'),
        tags: [{ label: i18n('Novedad', 'New'), tone: 'green', glow: false }],
        changes: [{ t: i18n('Nuevo cambio.', 'New change.') }],
      };
    },
    /* Nota nueva: solo título. La descripción se agrega con el switch. */
    changes: function () { return { t: i18n('Nuevo cambio.', 'New change.') }; },
    tag: function () { return { label: i18n('Etiqueta', 'Tag'), tone: 'green', glow: false }; },
    working: function (n) {
      return {
        code: 'RD-' + String(n + 1).padStart(2, '0'),
        tone: 'blue', progress: 0,
        status: i18n('Planeado', 'Planned'),
        title: i18n('Nuevo proyecto', 'New project'),
        desc: i18n('En qué consiste este proyecto.', 'What this project is about.'),
        items: [],
      };
    },
    workingItem: function () { return { t: i18n('Nuevo ítem', 'New item') }; },
    terms: function () {
      return { h: i18n('Nueva cláusula', 'New clause'), p: i18n('Texto de la cláusula.', 'Clause text.') };
    },
  };

  /* --- Construcción de campos del panel ---------------------------------- */
  function fieldText(label, path, multiline) {
    var val = B.t(path);
    var input = multiline
      ? '<textarea class="bx-input" rows="3" data-path="' + cssEsc(path) + '" data-kind="i18n">' + B.esc(val) + '</textarea>'
      : '<input class="bx-input" type="text" data-path="' + cssEsc(path) + '" data-kind="i18n" value="' + B.esc(val) + '">';
    return '<label class="bx-field"><span class="bx-label">' + B.esc(label) + '</span>' + input + '</label>';
  }

  function fieldRaw(label, path) {
    var val = getRaw(path);
    return '<label class="bx-field"><span class="bx-label">' + B.esc(label) + '</span>' +
      '<input class="bx-input" type="text" data-path="' + cssEsc(path) + '" data-kind="raw" value="' + B.esc(val) + '"></label>';
  }

  /* Campo con barra de formato (para textos largos con negrita, cursiva,
     subtítulos, listas y colores). Se edita acá, no sobre la página. */
  function fieldRich(label, path) {
    var val = B.t(path);
    var color = function (c, name) {
      return '<button type="button" class="bx-tbtn bx-tcolor bx-tc-' + c + '" data-fmt="color:' + c + '" title="' + name + '"></button>';
    };
    return '<div class="bx-field bx-rich">' +
      '<span class="bx-label">' + B.esc(label) + '</span>' +
      '<div class="bx-toolbar">' +
        '<button type="button" class="bx-tbtn" data-fmt="bold" title="Negrita"><b>B</b></button>' +
        '<button type="button" class="bx-tbtn" data-fmt="italic" title="Cursiva"><i>I</i></button>' +
        '<button type="button" class="bx-tbtn" data-fmt="h" title="Subtítulo">H</button>' +
        '<button type="button" class="bx-tbtn" data-fmt="list" title="Lista">&#8801;</button>' +
        '<span class="bx-tsep"></span>' +
        color('green', 'Verde') + color('teal', 'Teal') + color('amber', 'Ámbar') + color('blue', 'Azul') +
        '<span class="bx-tsep"></span>' +
        '<button type="button" class="bx-tbtn bx-tmedia" data-fmt="media" title="Imagen o video">🖼</button>' +
      '</div>' +
      '<textarea class="bx-input bx-rich-ta" rows="9" data-path="' + cssEsc(path) + '" data-kind="i18n" spellcheck="false">' + B.esc(val) + '</textarea>' +
      '<p class="bx-rich-help">Seleccioná texto y tocá un botón. A mano: <code>**negrita**</code>, <code>_cursiva_</code>, <code>## subtítulo</code>, <code>- lista</code>. El 🖼 sube una imagen/video. Doble Enter = párrafo nuevo.</p>' +
      '</div>';
  }

  /* --- Barra de formato: inserta el markup en el textarea ----------------- */
  function wrapSelection(ta, before, after) {
    var s = ta.selectionStart, e = ta.selectionEnd, val = ta.value;
    var sel = val.slice(s, e) || 'texto';
    ta.value = val.slice(0, s) + before + sel + after + val.slice(e);
    var inner = s + before.length;
    ta.setSelectionRange(inner, inner + sel.length);
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function lineOp(ta, fn) {
    var val = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    var ls = val.lastIndexOf('\n', s - 1) + 1;
    var le = val.indexOf('\n', e); if (le === -1) le = val.length;
    var block = val.slice(ls, le).split('\n').map(fn).join('\n');
    ta.value = val.slice(0, ls) + block + val.slice(le);
    ta.setSelectionRange(ls, ls + block.length);
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function applyFmt(action, ta) {
    if (action === 'bold') return wrapSelection(ta, '**', '**');
    if (action === 'italic') return wrapSelection(ta, '_', '_');
    if (action.indexOf('color:') === 0) {
      var c = action.slice(6);
      return wrapSelection(ta, '[' + c + ']', '[/' + c + ']');
    }
    if (action === 'media') return pickMedia(ta);
    if (action === 'h') return lineOp(ta, function (l) { return l.trim() ? '## ' + l.replace(/^#{1,6}\s*/, '') : l; });
    if (action === 'list') return lineOp(ta, function (l) { return l.trim() ? '- ' + l.replace(/^[-*]\s*/, '') : l; });
  }

  /* --- Imágenes / videos (guardado local vía dev.js) ---------------------- */
  /* Las imágenes se reescalan en el navegador a un ancho cómodo para web antes
     de subir; los videos van tal cual (con tope de tamaño). El archivo queda
     en assets/ y se inserta el token ![media](assets/…) en la descripción. */
  function resizeImage(file, maxW, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, maxW / img.width);
        var w = Math.max(1, Math.round(img.width * scale));
        var h = Math.max(1, Math.round(img.height * scale));
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        var out = canvas.toDataURL('image/webp', 0.85);
        if (out.indexOf('image/webp') === -1) out = canvas.toDataURL('image/jpeg', 0.85);
        cb(out);
      };
      img.onerror = function () { cb(null); };
      img.src = reader.result;
    };
    reader.onerror = function () { cb(null); };
    reader.readAsDataURL(file);
  }

  function uploadMedia(ext, base64, cb) {
    fetch('media', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ext: ext, dataBase64: base64 }),
    }).then(function (r) { return r.json(); }).then(cb)
      .catch(function () { cb({ ok: false, error: 'no hay servidor (abrí con el .bat)' }); });
  }

  function insertMedia(ta, res) {
    if (!res || !res.ok) { updateStatus('⚠ ' + ((res && res.error) || 'no se pudo subir')); return; }
    var token = '\n![media](' + res.url + ')\n';
    var s = ta.selectionStart;
    ta.value = ta.value.slice(0, s) + token + ta.value.slice(ta.selectionEnd);
    var pos = s + token.length;
    ta.setSelectionRange(pos, pos);
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    updateStatus('✓ Media agregada (' + Math.round(res.bytes / 1024) + ' KB)');
  }

  function pickMedia(ta) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      if (/^video\//.test(file.type)) {
        if (file.size > 25 * 1024 * 1024) {
          alert('El video pesa más de 25 MB. Usá un clip más corto (los videos van al repo).');
          return;
        }
        updateStatus('Subiendo video…');
        var vr = new FileReader();
        vr.onload = function () {
          var b64 = String(vr.result).split(',')[1] || '';
          var ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
          uploadMedia(ext, b64, function (res) { insertMedia(ta, res); });
        };
        vr.readAsDataURL(file);
      } else {
        updateStatus('Procesando imagen…');
        resizeImage(file, 1280, function (dataUrl) {
          if (!dataUrl) { updateStatus('⚠ no pude procesar la imagen'); return; }
          var m = /^data:image\/(\w+);base64,(.*)$/.exec(dataUrl);
          if (!m) { updateStatus('⚠ imagen no válida'); return; }
          uploadMedia(m[1], m[2], function (res) { insertMedia(ta, res); });
        });
      }
    };
    input.click();
  }

  function fieldNumber(label, path, min, max) {
    var val = Number(getRaw(path)) || 0;
    return '<label class="bx-field"><span class="bx-label">' + B.esc(label) + ' <b class="bx-num">' + val + '%</b></span>' +
      '<input class="bx-range" type="range" min="' + min + '" max="' + max + '" value="' + val + '" data-path="' + cssEsc(path) + '" data-kind="number"></label>';
  }

  function fieldSelect(label, path, options) {
    var val = String(getRaw(path));
    var opts = options.map(function (o) {
      return '<option value="' + B.esc(o.value) + '"' + (o.value === val ? ' selected' : '') + '>' + B.esc(o.label) + '</option>';
    }).join('');
    return '<label class="bx-field"><span class="bx-label">' + B.esc(label) + '</span>' +
      '<select class="bx-input" data-path="' + cssEsc(path) + '" data-kind="raw">' + opts + '</select></label>';
  }

  var TONE_OPTIONS = [
    { value: 'green', label: 'Verde' },
    { value: 'teal', label: 'Teal' },
    { value: 'blue', label: 'Azul' },
    { value: 'cyan', label: 'Cian' },
    { value: 'purple', label: 'Violeta' },
    { value: 'pink', label: 'Rosa' },
    { value: 'red', label: 'Rojo' },
    { value: 'orange', label: 'Naranja' },
    { value: 'amber', label: 'Ámbar' },
    { value: 'gray', label: 'Gris' },
  ];

  /* Switch de sí/no atado a un valor booleano crudo (glow, etc.). */
  function switchField(label, path) {
    var on = !!getRaw(path);
    return '<label class="bx-switch bx-switch--field">' +
      '<input type="checkbox" data-bool-toggle="' + cssEsc(path) + '"' + (on ? ' checked' : '') + '>' +
      '<span class="bx-switch-track"><span class="bx-switch-dot"></span></span>' +
      '<span class="bx-switch-label">' + B.esc(label) + '</span>' +
      '</label>';
  }

  function itemHeader(title, listPath, index) {
    return '<div class="bx-item-head">' +
      '<span class="bx-item-title">' + B.esc(title) + '</span>' +
      '<span class="bx-item-tools">' +
        '<button class="bx-icon" data-move="' + listPath + '" data-index="' + index + '" data-delta="-1" title="Subir">↑</button>' +
        '<button class="bx-icon" data-move="' + listPath + '" data-index="' + index + '" data-delta="1" title="Bajar">↓</button>' +
        '<button class="bx-icon bx-icon--danger" data-remove="' + listPath + '" data-index="' + index + '" title="Eliminar">✕</button>' +
      '</span></div>';
  }

  function accordion(id, title, count, body) {
    return '<details class="bx-acc" data-acc="' + id + '"' + (openSections[id] ? ' open' : '') + '>' +
      '<summary class="bx-summary">' + B.esc(title) +
        (count != null ? '<span class="bx-count">' + count + '</span>' : '') +
      '</summary>' +
      '<div class="bx-acc-body">' + body + '</div></details>';
  }

  var openSections = { home: true };

  /* --- Secciones del panel ----------------------------------------------- */
  function sectionHome() {
    var c = B.state.content;
    var body =
      fieldText('Etiqueta superior', 'home.eyebrow') +
      fieldText('Título principal', 'home.heading', true) +
      fieldText('Descripción', 'home.sub', true) +
      '<div class="bx-sub">Chips bajo la descripción</div>' +
      c.home.chips.map(function (_, i) {
        return '<div class="bx-item">' +
          itemHeader(B.t('home.chips.' + i + '.label') || 'Chip ' + (i + 1), 'home.chips', i) +
          fieldText('Texto', 'home.chips.' + i + '.label') +
          fieldText('Descripción (aparece al pasar el mouse)', 'home.chips.' + i + '.tip', true) +
          '</div>';
      }).join('') +
      '<button class="bx-add" data-add="home.chips" data-factory="chips">+ Agregar chip</button>';
    return accordion('home', 'Inicio · Portada', null, body);
  }

  function sectionChat() {
    var c = B.state.content;
    var body =
      fieldText('Estado del contacto', 'home.online') +
      fieldText('Placeholder del campo de texto', 'home.compose') +
      '<div class="bx-sub">Mensajes del mockup</div>' +
      c.home.chat.map(function (m, i) {
        return '<div class="bx-item">' +
          itemHeader('Mensaje ' + (i + 1), 'home.chat', i) +
          fieldSelect('Lado', 'home.chat.' + i + '.side', [
            { value: 'in', label: 'Recibido (izquierda)' },
            { value: 'out', label: 'Enviado (derecha)' },
          ]) +
          fieldRaw('Hora', 'home.chat.' + i + '.time') +
          fieldText('Texto', 'home.chat.' + i + '.t', true) +
          '</div>';
      }).join('') +
      '<button class="bx-add" data-add="home.chat" data-factory="chat">+ Agregar mensaje</button>';
    return accordion('chat', 'Inicio · Mockup de chat', c.home.chat.length, body);
  }

  function sectionFeatures() {
    var c = B.state.content;
    var body =
      fieldText('Título de la sección', 'home.featuresTitle') +
      fieldText('Subtítulo', 'home.featuresSub') +
      c.home.features.map(function (_, i) {
        return '<div class="bx-item">' +
          itemHeader(B.t('home.features.' + i + '.title') || 'Función ' + (i + 1), 'home.features', i) +
          fieldText('Título', 'home.features.' + i + '.title') +
          fieldText('Descripción', 'home.features.' + i + '.desc', true) +
          '</div>';
      }).join('') +
      '<button class="bx-add" data-add="home.features" data-factory="features">+ Agregar función</button>';
    return accordion('features', 'Inicio · Funciones', c.home.features.length, body);
  }

  function sectionVersions() {
    var c = B.state.content;
    var body =
      fieldText('Kicker', 'versionsPage.kicker') +
      fieldText('Título', 'versionsPage.title') +
      fieldText('Descripción', 'versionsPage.sub', true) +
      c.versions.map(function (x, i) {
        var changes = x.changes.map(function (ch, j) {
          var base = 'versions.' + i + '.changes.' + j;
          var on = !!ch.desc;
          /* Título de la nota + switch "¿Descripción?" a la derecha. Si está
             encendido, abajo aparece el bloque de descripción (con formato). */
          return '<div class="bx-note">' +
            '<div class="bx-row">' +
              '<textarea class="bx-input" rows="2" data-path="' + base + '.t" data-kind="i18n">' + B.esc(B.t(base + '.t')) + '</textarea>' +
              '<button class="bx-icon bx-icon--danger" data-remove="versions.' + i + '.changes" data-index="' + j + '" title="Eliminar">✕</button>' +
            '</div>' +
            '<label class="bx-switch">' +
              '<input type="checkbox" data-desc-toggle="' + base + '"' + (on ? ' checked' : '') + '>' +
              '<span class="bx-switch-track"><span class="bx-switch-dot"></span></span>' +
              '<span class="bx-switch-label">¿Descripción?</span>' +
            '</label>' +
            (on ? fieldRich('Descripción de la nota', base + '.desc') : '') +
            '</div>';
        }).join('');
        var tags = (x.tags || []).map(function (tg, k) {
          var tbase = 'versions.' + i + '.tags.' + k;
          return '<div class="bx-item bx-tag-item">' +
            itemHeader('Etiqueta ' + (k + 1), 'versions.' + i + '.tags', k) +
            fieldText('Texto', tbase + '.label') +
            fieldSelect('Color', tbase + '.tone', TONE_OPTIONS) +
            switchField('Iluminar (flúor)', tbase + '.glow') +
            '</div>';
        }).join('');
        return '<div class="bx-item">' +
          itemHeader(x.v || 'Versión ' + (i + 1), 'versions', i) +
          fieldRaw('Número de versión', 'versions.' + i + '.v') +
          fieldText('Fecha', 'versions.' + i + '.date') +
          '<div class="bx-sub">Etiquetas</div>' + tags +
          '<button class="bx-add" data-add="versions.' + i + '.tags" data-factory="tag">+ Agregar etiqueta</button>' +
          '<div class="bx-sub">Cambios</div>' + changes +
          '<button class="bx-add" data-add="versions.' + i + '.changes" data-factory="changes">+ Agregar cambio</button>' +
          '</div>';
      }).join('') +
      '<button class="bx-add" data-add="versions" data-factory="versions">+ Agregar versión</button>';
    return accordion('versions', 'Versiones (changelog)', c.versions.length, body);
  }

  function sectionWorking() {
    var c = B.state.content;
    var body =
      fieldText('Kicker', 'workingPage.kicker') +
      fieldText('Título', 'workingPage.title') +
      fieldText('Descripción', 'workingPage.sub', true) +
      c.working.map(function (w, i) {
        var wItems = (w.items || []).map(function (_, k) {
          var ibase = 'working.' + i + '.items.' + k;
          return '<div class="bx-row">' +
            '<textarea class="bx-input" rows="2" data-path="' + ibase + '.t" data-kind="i18n">' + B.esc(B.t(ibase + '.t')) + '</textarea>' +
            '<button class="bx-icon bx-icon--danger" data-remove="working.' + i + '.items" data-index="' + k + '" title="Eliminar">✕</button></div>';
        }).join('');
        return '<div class="bx-item">' +
          itemHeader(B.t('working.' + i + '.title') || 'Proyecto ' + (i + 1), 'working', i) +
          fieldRaw('Código', 'working.' + i + '.code') +
          fieldText('Estado', 'working.' + i + '.status') +
          fieldSelect('Color del estado', 'working.' + i + '.tone', TONE_OPTIONS) +
          switchField('Iluminar (flúor)', 'working.' + i + '.glow') +
          fieldText('Título', 'working.' + i + '.title') +
          fieldRich('Descripción breve', 'working.' + i + '.desc') +
          fieldNumber('Progreso', 'working.' + i + '.progress', 0, 100) +
          '<p class="bx-hint">El "X% Completado" se muestra solo. La barra se colorea según el % y al llegar a 100% lanza confeti.</p>' +
          '<div class="bx-sub">Ítems ya logrados (aparecen al pasar el mouse por la barra)</div>' + wItems +
          '<button class="bx-add" data-add="working.' + i + '.items" data-factory="workingItem">+ Agregar ítem</button>' +
          '</div>';
      }).join('') +
      '<button class="bx-add" data-add="working" data-factory="working">+ Agregar proyecto</button>';
    return accordion('working', 'Próximamente (roadmap)', c.working.length, body);
  }

  function sectionTerms() {
    var c = B.state.content;
    var body =
      fieldText('Kicker', 'termsPage.kicker') +
      fieldText('Título', 'termsPage.title') +
      fieldText('Última actualización', 'termsPage.updated') +
      fieldText('Nota destacada', 'termsPage.note', true) +
      c.terms.map(function (_, i) {
        return '<div class="bx-item">' +
          itemHeader(B.t('terms.' + i + '.h') || 'Cláusula ' + (i + 1), 'terms', i) +
          fieldText('Título', 'terms.' + i + '.h') +
          fieldText('Texto', 'terms.' + i + '.p', true) +
          '</div>';
      }).join('') +
      '<button class="bx-add" data-add="terms" data-factory="terms">+ Agregar cláusula</button>';
    return accordion('terms', 'Términos y Condiciones', c.terms.length, body);
  }

  function sectionBrand() {
    var body =
      fieldRaw('Nombre', 'brand.name') +
      fieldRaw('Sufijo (gris)', 'brand.suffix') +
      fieldRaw('Inicial del avatar', 'brand.initial') +
      fieldRaw('Copyright del footer', 'brand.copyright') +
      fieldText('Texto de derechos', 'footer.rights') +
      '<div class="bx-sub">Navegación</div>' +
      fieldText('Versiones', 'nav.versions') +
      fieldText('Próximamente', 'nav.coming') +
      fieldText('Términos', 'nav.terms');
    return accordion('brand', 'Marca, nav y footer', null, body);
  }

  /* --- Pestañas del editor ----------------------------------------------- */
  /* Cada pestaña muestra SOLO sus bloques (no todos juntos). Las 4 primeras
     además navegan el sitio a esa página; "General" es solo del editor. */
  var PAGE_TABS = [
    { tab: 'home', hash: '#/', label: 'Inicio' },
    { tab: 'versions', hash: '#/versions', label: 'Versiones' },
    { tab: 'working', hash: '#/working', label: 'Próximamente' },
    { tab: 'terms', hash: '#/terms-of-service', label: 'Términos' },
    { tab: 'general', hash: '', label: 'General' },
  ];

  var editorTab = 'home';

  function sectionsFor(tab) {
    if (tab === 'versions') return sectionVersions();
    if (tab === 'working') return sectionWorking();
    if (tab === 'terms') return sectionTerms();
    if (tab === 'general') return sectionBrand();
    return sectionHome() + sectionChat() + sectionFeatures();
  }

  function pageSwitcher() {
    return PAGE_TABS.map(function (p) {
      var on = editorTab === p.tab ? ' is-on' : '';
      return '<button class="bx-pagetab' + on + '" data-edittab="' + p.tab + '" data-editpage="' + p.hash + '">' + p.label + '</button>';
    }).join('');
  }

  /* --- Panel ------------------------------------------------------------- */
  function buildPanel() {
    if (!panel) {
      panel = document.createElement('aside');
      panel.id = 'bx-panel';
      document.body.appendChild(panel);
    }
    rememberOpenSections();

    /* Guardamos la posición del scroll: al reconstruir el panel (agregar/quitar/
       mover un bloque) el navegador la resetea a 0 y el menú "saltaba" arriba. */
    var prevBody = panel.querySelector('.bx-body');
    var prevScroll = prevBody ? prevBody.scrollTop : 0;

    var lang = B.state.lang;
    panelLang = lang;
    panel.innerHTML =
      '<div class="bx-resize" title="Arrastrá para cambiar el ancho"></div>' +
      '<div class="bx-head">' +
        '<div class="bx-head-top">' +
          '<div class="bx-title">Editor de contenido</div>' +
          '<button class="bx-close" id="bx-collapse" title="Ocultar panel">→</button>' +
        '</div>' +
        '<div class="bx-langbar">' +
          '<span class="bx-langlabel">Editando en</span>' +
          '<div class="bx-langpills">' +
            '<button class="bx-langpill' + (lang === 'es' ? ' is-on' : '') + '" data-editlang="es">Español</button>' +
            '<button class="bx-langpill' + (lang === 'en' ? ' is-on' : '') + '" data-editlang="en">English</button>' +
          '</div>' +
        '</div>' +
        '<div class="bx-pagebar">' + pageSwitcher() + '</div>' +
        '<div class="bx-status" id="bx-status">' + B.esc(initialStatus()) + '</div>' +
      '</div>' +
      '<div class="bx-body">' +
        '<p class="bx-tip">Podés escribir directo sobre el sitio: hacé clic en cualquier texto resaltado y editalo.</p>' +
        sectionsFor(editorTab) +
      '</div>' +
      '<div class="bx-foot">' +
        (window.BX_ONLINE
          ? '<button class="bx-btn bx-btn--primary" id="bx-save">🚀 Publicar cambios</button>' +
            '<div class="bx-foot-row">' +
              '<button class="bx-btn" id="bx-export">Descargar copia</button>' +
              '<button class="bx-btn" id="bx-import">Importar</button>' +
              '<button class="bx-btn bx-btn--ghost" data-logout>Salir</button>' +
            '</div>' +
            '<p class="bx-hint">"Publicar" commitea al repo; el sitio en vivo se actualiza en ~30 s.</p>'
          : '<button class="bx-btn bx-btn--primary" id="bx-save">💾 Guardar en content.js</button>' +
            '<div class="bx-foot-row">' +
              '<button class="bx-btn" id="bx-export">Descargar copia</button>' +
              '<button class="bx-btn" id="bx-import">Importar</button>' +
              '<button class="bx-btn bx-btn--ghost" id="bx-reset">Restablecer</button>' +
            '</div>' +
            '<p class="bx-hint">"Guardar" escribe los cambios y deja una copia en <code>updates/</code> lista para subir al repo.</p>') +
      '</div>';

    /* Restauramos el scroll donde estaba (queda sobre el bloque que tocaste,
       no arriba de todo). */
    var newBody = panel.querySelector('.bx-body');
    if (newBody) newBody.scrollTop = prevScroll;

    document.documentElement.classList.add('bx-on');
  }

  function rememberOpenSections() {
    if (!panel) return;
    var accs = panel.querySelectorAll('[data-acc]');
    for (var i = 0; i < accs.length; i++) {
      openSections[accs[i].getAttribute('data-acc')] = accs[i].open;
    }
  }

  /* --- Eventos del panel ------------------------------------------------- */
  /* --- Redimensionar el panel (arrastrar el borde izquierdo) -------------- */
  var WIDTH_KEY = 'bravos:editorWidth';
  function setPanelWidth(px) {
    var w = Math.max(380, Math.min(window.innerWidth * 0.72, px));
    document.documentElement.style.setProperty('--bx-w', Math.round(w) + 'px');
  }
  function bindResize() {
    var dragging = false;
    document.addEventListener('pointerdown', function (e) {
      if (!e.target.closest || !e.target.closest('.bx-resize')) return;
      dragging = true;
      document.documentElement.classList.add('bx-resizing');
      e.preventDefault();
    });
    document.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      setPanelWidth(window.innerWidth - e.clientX);
    });
    document.addEventListener('pointerup', function () {
      if (!dragging) return;
      dragging = false;
      document.documentElement.classList.remove('bx-resizing');
      try { localStorage.setItem(WIDTH_KEY, document.documentElement.style.getPropertyValue('--bx-w')); } catch (e) {}
    });
    /* Restaurar el ancho elegido. */
    try {
      var saved = localStorage.getItem(WIDTH_KEY);
      if (saved) document.documentElement.style.setProperty('--bx-w', saved);
    } catch (e) {}
  }

  function bindPanel() {
    bindResize();
    document.addEventListener('change', function (e) {
      if (!e.target.closest) return;
      /* Switch "¿Descripción?" de cada nota del changelog. */
      var sw = e.target.closest('#bx-panel [data-desc-toggle]');
      if (sw) {
        var ok = toggleDesc(sw.getAttribute('data-desc-toggle'), sw.checked);
        if (ok === false) sw.checked = true; /* canceló el borrado: vuelve a ON */
        return;
      }
      /* Switch booleano genérico (p. ej. "Iluminar" del tag). */
      var bt = e.target.closest('#bx-panel [data-bool-toggle]');
      if (bt) {
        setRaw(bt.getAttribute('data-bool-toggle'), bt.checked);
        B.render();
        enableInline();
        markDirty();
      }
    });

    document.addEventListener('input', function (e) {
      var el = e.target;
      if (!el.matches || !el.matches('#bx-panel [data-path]')) return;
      var path = el.getAttribute('data-path');
      var kind = el.getAttribute('data-kind');

      if (kind === 'number') {
        var n = Math.max(0, Math.min(100, Number(el.value) || 0));
        setRaw(path, n);
        var numEl = el.parentElement.querySelector('.bx-num');
        if (numEl) numEl.textContent = n + '%';
      } else if (kind === 'raw') {
        setRaw(path, el.value);
      } else {
        B.setText(path, el.value);
      }

      B.render();
      enableInline();
      markDirty();
    });

    document.addEventListener('click', function (e) {
      var fb = e.target.closest('#bx-panel [data-fmt]');
      if (fb) {
        e.preventDefault();
        var wrap = fb.closest('.bx-rich');
        var ta = wrap && wrap.querySelector('textarea');
        if (ta) applyFmt(fb.getAttribute('data-fmt'), ta);
        return;
      }
      var add = e.target.closest('#bx-panel [data-add]');
      if (add) {
        e.preventDefault();
        addItem(add.getAttribute('data-add'), FACTORIES[add.getAttribute('data-factory')]);
        return;
      }
      var rm = e.target.closest('#bx-panel [data-remove]');
      if (rm) {
        e.preventDefault();
        removeItem(rm.getAttribute('data-remove'), Number(rm.getAttribute('data-index')));
        return;
      }
      var mv = e.target.closest('#bx-panel [data-move]');
      if (mv) {
        e.preventDefault();
        moveItem(mv.getAttribute('data-move'), Number(mv.getAttribute('data-index')), Number(mv.getAttribute('data-delta')));
        return;
      }
      var el = e.target.closest('#bx-panel [data-editlang]');
      if (el) {
        e.preventDefault();
        /* setLang() re-renderiza; onRendered reconstruye el panel al ver
           que cambió el idioma. */
        B.setLang(el.getAttribute('data-editlang'));
        return;
      }
      var pg = e.target.closest('#bx-panel [data-edittab]');
      if (pg) {
        e.preventDefault();
        editorTab = pg.getAttribute('data-edittab');
        var hash = pg.getAttribute('data-editpage');
        /* Las 4 páginas navegan el sitio; "General" solo cambia el panel. */
        if (hash) B.navigate(hash);
        buildPanel();
        return;
      }
      if (e.target.closest('#bx-collapse')) {
        document.documentElement.classList.toggle('bx-collapsed');
        return;
      }
      if (e.target.closest('#bx-save')) { saveToDisk(); return; }
      if (e.target.closest('#bx-export')) { exportContent(); return; }
      if (e.target.closest('#bx-import')) { importContent(); return; }
      if (e.target.closest('#bx-reset')) {
        if (confirm('Se borran todos tus cambios y vuelve el contenido original de content.js. ¿Seguir?')) {
          resetDraft();
          dirty = false;
          enableInline();
          buildPanel();
          updateStatus('Restablecido');
        }
      }
    });
  }

  /* --- Exportar / importar ----------------------------------------------- */
  /* Mismo encabezado que el content.js del repo: el archivo exportado tiene que
     ser indistinguible de uno escrito a mano, sin rastros de la herramienta. */
  var HEADER = [
    '/* ============================================================================',
    '   BravosCRM — contenido del sitio',
    '',
    '   Todos los textos de la página viven acá. Cada uno lleva su version en',
    '   español ("es") y en inglés ("en"); el selector del header alterna entre las',
    '   dos. Para cambiar un texto, editá lo que está entre comillas y desplegá.',
    '   ========================================================================== */',
    '',
    'window.BRAVOS_CONTENT = ',
  ].join('\n');

  /* Extrae el objeto de contenido de un .js exportado o de un .json pelado.
     Ojo: no alcanza con buscar el primer '{' del archivo, porque los
     comentarios de cabecera pueden contener llaves. */
  function parseContentFile(text) {
    var start = -1;
    var assign = /BRAVOS_CONTENT\s*=\s*/.exec(text);
    if (assign) start = text.indexOf('{', assign.index + assign[0].length);
    if (start === -1) start = text.indexOf('{');
    var end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) {
      throw new Error('No encontré el objeto de contenido en el archivo.');
    }
    return JSON.parse(text.slice(start, end + 1));
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* Texto completo del content.js, idéntico al que se comitea. */
  function contentFileText() {
    return HEADER + JSON.stringify(B.state.content, null, 2) + ';\n';
  }

  function exportContent() {
    download('content.js', contentFileText(), 'text/javascript');
    dirty = false;
    updateStatus('✓ Descargado — reemplazá content.js y desplegá');
  }

  /* Guarda el contenido.
     · Online (window.BX_ONLINE): POST /api/save → commit al repo de GitHub,
       Vercel redespliega solo y el sitio en vivo se actualiza.
     · Local (dev.js): POST /save → escribe content.js y copia a updates/.
     · Sin servidor: cae a la descarga del archivo. */
  function saveToDisk() {
    var btn = document.getElementById('bx-save');
    if (btn) btn.disabled = true;

    if (window.BX_ONLINE) {
      updateStatus('Publicando…');
      fetch('api/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: contentFileText() }),
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j }; });
      }).then(function (res) {
        if (btn) btn.disabled = false;
        if (res.j && res.j.ok) {
          baseStamp = stampOf(B.state.content);
          saveDraft();
          dirty = false; draftDiscarded = false;
          updateStatus('✓ Publicado — el sitio se actualiza en ~30 s');
        } else if (res.status === 401) {
          updateStatus('⚠ Sesión vencida. Redirigiendo al login…');
          setTimeout(function () { location.href = location.pathname + '#/login'; location.reload(); }, 1200);
        } else {
          updateStatus('⚠ ' + ((res.j && res.j.error) || 'no se pudo publicar'));
        }
      }).catch(function () {
        if (btn) btn.disabled = false;
        updateStatus('⚠ Error de conexión al publicar.');
      });
      return;
    }

    updateStatus('Guardando…');
    fetch('save', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: contentFileText(),
    }).then(function (r) {
      return r.json().catch(function () { throw new Error('respuesta no válida'); });
    }).then(function (res) {
      if (btn) btn.disabled = false;
      if (res.ok) {
        /* El archivo ahora coincide con lo editado: realineamos el sello del
           borrador para que un reload no lo tire como "content.js cambió". */
        baseStamp = stampOf(B.state.content);
        saveDraft();
        dirty = false;
        draftDiscarded = false;
        updateStatus(res.updates
          ? '✓ Guardado — también en updates/ para subir'
          : '✓ Guardado en content.js (' + res.bytes + ' bytes)');
      } else {
        updateStatus('⚠ ' + (res.error || 'no se pudo guardar'));
      }
    }).catch(function () {
      if (btn) btn.disabled = false;
      /* No hay servidor con /save (p. ej. abriste el HTML sin dev.js). */
      updateStatus('Sin servidor para guardar — descargo el archivo…');
      exportContent();
    });
  }

  function importContent() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.js,.json,application/json,text/javascript';
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = parseContentFile(String(reader.result));
          if (!data.home || !data.versions || !data.working || !data.terms) {
            throw new Error('Le faltan secciones (home / versions / working / terms).');
          }
          B.state.content = data;
          saveDraft();
          B.render();
          enableInline();
          buildPanel();
          updateStatus('✓ Contenido importado');
        } catch (err) {
          alert('No pude leer ese archivo. Tiene que ser un content.js o .json exportado desde acá.\n\n' + err.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  /* --- Estilos del editor (solo se inyectan en modo edición) -------------- */
  var CSS = `
  html.bx-on { --bx-w: 520px; }
  html.bx-on body { margin-right: var(--bx-w); }
  html.bx-on.bx-collapsed body { margin-right: 0; }
  html.bx-on.bx-collapsed #bx-panel { transform: translateX(calc(100% - 38px)); }
  html.bx-on.bx-collapsed #bx-collapse { transform: rotate(180deg); }

  #bx-panel {
    position: fixed; top: 0; right: 0; bottom: 0;
    width: var(--bx-w); z-index: 9999;
    background:
      radial-gradient(120% 60% at 100% 0%, rgba(37,211,102,.06), transparent 60%),
      linear-gradient(180deg, #1a2130, #10151f);
    color: #EAF0F5;
    border-left: 1px solid #2A3648;
    display: flex; flex-direction: column;
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    box-shadow: -30px 0 70px -34px rgba(0,0,0,.9);
    transition: transform .2s ease;
  }
  #bx-panel * { box-sizing: border-box; }

  /* Barra para arrastrar y agrandar/achicar el panel. */
  .bx-resize {
    position: absolute; left: -3px; top: 0; bottom: 0; width: 10px;
    cursor: ew-resize; z-index: 3; touch-action: none;
  }
  .bx-resize::before {
    content: ''; position: absolute; left: 3px; top: 0; bottom: 0; width: 3px;
    background: transparent; transition: background .15s;
  }
  .bx-resize:hover::before, html.bx-resizing .bx-resize::before { background: #25D366; }
  html.bx-resizing { cursor: ew-resize; user-select: none; }

  .bx-head {
    padding: 20px 22px 16px; background: rgba(9,13,19,.72);
    border-bottom: 1px solid #253345;
    box-shadow: 0 1px 0 rgba(37,211,102,.16);
  }
  .bx-head-top { display: flex; align-items: center; justify-content: space-between; }
  .bx-title {
    font-weight: 800; font-size: 15.5px; letter-spacing: -.01em;
    display: flex; align-items: center; gap: 9px;
  }
  .bx-title::before {
    content: ''; width: 9px; height: 9px; border-radius: 50%;
    background: #25D366; box-shadow: 0 0 10px 1px rgba(37,211,102,.6);
  }
  .bx-close {
    width: 30px; height: 30px; border-radius: 9px;
    border: 1px solid #2C3F4A; background: #16242C; color: #9FB3BF;
    cursor: pointer; font-size: 13px; line-height: 1;
    display: flex; align-items: center; justify-content: center;
    transition: transform .2s ease, background .15s;
  }
  .bx-close:hover { background: #1D3039; color: #fff; }

  .bx-langbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 16px; }
  .bx-langlabel { font-size: 12px; color: #8AA0AE; }
  .bx-langpills { display: flex; gap: 3px; padding: 3px; background: #182634; border-radius: 9px; }
  .bx-langpill {
    padding: 6px 13px; border: none; border-radius: 7px;
    background: transparent; color: #9BB1BF;
    font-size: 12px; font-weight: 600; font-family: inherit; cursor: pointer;
    transition: background .14s, color .14s;
  }
  .bx-langpill.is-on { background: #25D366; color: #06231A; font-weight: 700; }

  .bx-pagebar {
    display: flex; flex-wrap: wrap; gap: 4px; margin-top: 14px;
    padding: 4px; background: #131E2A; border: 1px solid #223040; border-radius: 11px;
  }
  .bx-pagetab {
    flex: 1 1 auto; padding: 8px 10px; border: none; border-radius: 8px;
    background: transparent; color: #9BB1BF;
    font-size: 12px; font-weight: 600; font-family: inherit; cursor: pointer;
    white-space: nowrap; transition: background .14s, color .14s;
  }
  .bx-pagetab:hover { background: #1E2E3C; color: #EAF1F5; }
  .bx-pagetab.is-on {
    background: linear-gradient(180deg, #2BA45A, #1F8C4A);
    color: #fff; font-weight: 700;
    box-shadow: 0 4px 12px -5px rgba(37,211,102,.7);
  }

  .bx-status {
    margin-top: 14px; font-size: 11.5px; color: #7E95A3; min-height: 15px;
    display: flex; align-items: center; gap: 6px;
  }

  .bx-body { flex: 1; overflow-y: auto; padding: 20px 22px 24px; }
  .bx-body::-webkit-scrollbar { width: 10px; }
  .bx-body::-webkit-scrollbar-thumb { background: #26343F; border-radius: 9px; border: 2px solid transparent; background-clip: padding-box; }
  .bx-body::-webkit-scrollbar-thumb:hover { background: #33465A; background-clip: padding-box; }

  .bx-tip {
    margin: 0 0 16px; padding: 12px 14px;
    background: rgba(37,211,102,.09); border: 1px solid rgba(37,211,102,.28);
    border-radius: 11px; font-size: 12px; line-height: 1.55; color: #A8DFC0;
  }

  .bx-acc {
    border: 1px solid #2B3A4B; border-radius: 15px; margin-bottom: 14px;
    background: #1B2635; overflow: hidden;
    box-shadow: 0 3px 14px -8px rgba(0,0,0,.6);
  }
  .bx-summary {
    padding: 17px 18px; cursor: pointer; list-style: none;
    font-size: 14px; font-weight: 700; color: #EAF1F6;
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    transition: background .14s;
  }
  .bx-summary::-webkit-details-marker { display: none; }
  .bx-summary::after {
    content: '⌄'; margin-left: auto; font-size: 15px; color: #7E95A3;
    transition: transform .2s ease;
  }
  .bx-acc[open] .bx-summary::after { transform: rotate(180deg); }
  .bx-summary:hover { background: #1A2836; }
  .bx-acc[open] .bx-summary { border-bottom: 1px solid #2B3A4B; color: #fff; }
  .bx-count {
    background: rgba(37,211,102,.16); color: #6FE39B; border-radius: 999px;
    padding: 3px 9px; font-size: 11px; font-weight: 700; margin-left: auto;
  }
  .bx-acc-body { padding: 18px; }

  .bx-field { display: block; margin-bottom: 13px; }
  .bx-label { display: block; font-size: 11.5px; font-weight: 600; color: #8AA0AE; margin-bottom: 6px; }
  .bx-num { color: #25D366; }
  .bx-input {
    width: 100%; padding: 10px 12px;
    background: #0A1219; border: 1px solid #2C3D49; border-radius: 9px;
    color: #EAF0F4; font-size: 13px; font-family: inherit;
    line-height: 1.5; resize: vertical;
    transition: border-color .14s, box-shadow .14s;
  }
  .bx-input::placeholder { color: #5C7482; }
  .bx-input:focus { outline: none; border-color: #25D366; box-shadow: 0 0 0 3px rgba(37,211,102,.16); }
  select.bx-input { cursor: pointer; }
  .bx-range { width: 100%; accent-color: #25D366; }

  /* Campo con formato + su barra */
  .bx-rich { display: block; margin-bottom: 10px; }
  .bx-toolbar {
    display: flex; align-items: center; gap: 3px; flex-wrap: wrap;
    padding: 5px; margin-bottom: 5px;
    background: #0B141A; border: 1px solid #2A3B45;
    border-radius: 7px;
  }
  .bx-tbtn {
    min-width: 24px; height: 24px; padding: 0 5px;
    border: 1px solid #2A3B45; border-radius: 5px;
    background: #16242C; color: #D6E3EA;
    font-size: 12px; font-family: inherit; line-height: 1; cursor: pointer;
  }
  .bx-tbtn:hover { background: #1D3039; border-color: #3A5160; }
  .bx-tbtn i { font-style: italic; }
  .bx-tsep { width: 1px; height: 18px; background: #2A3B45; margin: 0 3px; }
  .bx-tcolor { width: 24px; padding: 0; }
  .bx-tc-green { background: #25D366; } .bx-tc-green:hover { background: #25D366; }
  .bx-tc-teal  { background: #128C7E; } .bx-tc-teal:hover  { background: #128C7E; }
  .bx-tc-amber { background: #D69E2E; } .bx-tc-amber:hover { background: #D69E2E; }
  .bx-tc-blue  { background: #2E7FD1; } .bx-tc-blue:hover  { background: #2E7FD1; }
  .bx-rich-ta { display: block; }
  .bx-rich-help { font-size: 10px; line-height: 1.5; color: #5E7684; margin: 5px 0 0; }
  .bx-rich-help code { background: #16242C; padding: 0 3px; border-radius: 3px; color: #8FA6B3; }

  /* Nota del changelog: título + switch de descripción */
  .bx-note {
    border: 1px solid #22323B; border-radius: 9px;
    padding: 9px; margin-bottom: 8px; background: #0B141A;
  }
  .bx-note .bx-row { margin-bottom: 0; }
  .bx-switch {
    display: flex; align-items: center; gap: 8px;
    margin-top: 8px; cursor: pointer; user-select: none;
  }
  .bx-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
  .bx-switch-track {
    position: relative; width: 34px; height: 19px; flex: none;
    background: #2A3B45; border-radius: 999px; transition: background .16s;
  }
  .bx-switch-dot {
    position: absolute; top: 2.5px; left: 2.5px;
    width: 14px; height: 14px; border-radius: 50%;
    background: #7E96A4; transition: transform .16s, background .16s;
  }
  .bx-switch input:checked + .bx-switch-track { background: rgba(37,211,102,.35); }
  .bx-switch input:checked + .bx-switch-track .bx-switch-dot { transform: translateX(15px); background: #25D366; }
  .bx-switch input:focus-visible + .bx-switch-track { box-shadow: 0 0 0 2px rgba(37,211,102,.4); }
  .bx-switch-label { font-size: 11.5px; font-weight: 600; color: #8FA6B3; }
  .bx-switch input:checked ~ .bx-switch-label { color: #D6E3EA; }
  .bx-switch--field { margin: 2px 0 13px; }
  .bx-note .bx-rich { margin-top: 9px; margin-bottom: 0; }

  .bx-row { display: flex; gap: 6px; align-items: flex-start; margin-bottom: 6px; }
  .bx-row .bx-input { flex: 1; }

  .bx-sub {
    font-size: 10.5px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .09em; color: #5E7684; margin: 14px 0 7px;
  }

  .bx-item { border: 1px solid #2A3849; border-radius: 12px; padding: 15px; margin-bottom: 14px; background: #131C28; }
  .bx-item-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 11px; }
  .bx-item-title {
    font-size: 12.5px; font-weight: 700; color: #C6D6E0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .bx-item-tools { display: flex; gap: 4px; flex: none; }
  .bx-icon {
    width: 26px; height: 26px; border-radius: 7px;
    border: 1px solid #2A3B45; background: #17242E; color: #93A9B7;
    cursor: pointer; font-size: 12px; line-height: 1; padding: 0;
    transition: background .14s, color .14s, border-color .14s;
  }
  .bx-icon:hover { background: #1D3039; color: #fff; }
  .bx-icon--danger:hover { background: #7F1D1D; border-color: #B91C1C; color: #fff; }

  .bx-add {
    width: 100%; padding: 10px; margin-top: 6px;
    border: 1px dashed #33495A; border-radius: 10px;
    background: transparent; color: #86AEC2;
    font-size: 12.5px; font-weight: 600; font-family: inherit; cursor: pointer;
    transition: border-color .14s, color .14s, background .14s;
  }
  .bx-add:hover { border-color: #25D366; color: #25D366; background: rgba(37,211,102,.06); }

  .bx-hint { font-size: 11px; line-height: 1.55; color: #647E8C; margin: 8px 0 0; }
  .bx-hint code { background: #17242E; padding: 1px 5px; border-radius: 4px; color: #93A9B7; }

  .bx-foot { padding: 16px 20px 18px; border-top: 1px solid #253345; background: rgba(9,13,19,.72); }
  .bx-foot-row { display: flex; gap: 7px; margin-top: 7px; }
  .bx-foot-row .bx-btn { flex: 1; }
  .bx-btn {
    width: 100%; padding: 11px 14px; border-radius: 10px;
    border: 1px solid #2A3B45; background: #17242E; color: #D6E3EA;
    font-size: 12.5px; font-weight: 700; font-family: inherit; cursor: pointer;
    transition: background .14s, transform .1s;
  }
  .bx-btn:hover { background: #1D3039; }
  .bx-btn:active { transform: translateY(1px); }
  .bx-btn--primary {
    background: linear-gradient(180deg, #2BD46B, #1FBA59); border-color: #1FBA59; color: #05271A;
    box-shadow: 0 6px 18px -8px rgba(37,211,102,.8);
  }
  .bx-btn--primary:hover { background: linear-gradient(180deg, #33E074, #23C763); }
  .bx-btn--ghost { background: transparent; color: #8FA6B3; }

  /* Resaltado de lo editable en el sitio */
  #app .bx-editable {
    outline: 1px dashed rgba(37,211,102,.42);
    outline-offset: 2px;
    border-radius: 3px;
    cursor: text;
    transition: background .12s, outline-color .12s;
  }
  #app .bx-editable:hover { background: rgba(37,211,102,.09); outline-color: rgba(37,211,102,.75); }
  #app .bx-editable:focus {
    outline: 2px solid #25D366; outline-offset: 2px;
    background: rgba(37,211,102,.07);
  }

  @media (max-width: 1100px) {
    html.bx-on body { margin-right: 0; }
    #bx-panel { width: min(var(--bx-w), 96vw); }
    .bx-resize { display: none; }
  }
  `;

  function injectCSS() {
    var style = document.createElement('style');
    style.id = 'bx-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  /* Cada vez que el sitio se re-renderiza hay que volver a marcar lo editable.
     Si además cambió el idioma (p. ej. con el switch ES/EN del propio sitio),
     el panel se reconstruye para no editar un idioma mostrando el otro. */
  function onRendered() {
    enableInline();
    if (B.state.lang !== panelLang) buildPanel();
  }

  /* --- Arranque ---------------------------------------------------------- */
  function start() {
    /* app.js ya renderizó content.js. Si hay un borrador vigente, lo pisamos
       acá y volvemos a renderizar. */
    var draft = loadDraft();
    if (draft) {
      B.state.content = draft;
      dirty = true;
      B.render();
    }

    editorTab = B.state.page;   /* el editor arranca en la página que estás viendo */
    injectCSS();
    buildPanel();
    bindPanel();
    enableInline();

    document.addEventListener('input', onInlineInput, true);
    document.addEventListener('keydown', onInlineKeydown, true);
    document.addEventListener('click', onInlineClick, true);
    document.addEventListener('paste', onInlinePaste, true);

    window.addEventListener('bravos:rendered', onRendered);

    /* Si navegás el sitio (por la nav), el editor sigue a esa página. app.js
       registró su hashchange primero, así que acá state.page ya cambió. */
    window.addEventListener('hashchange', function () {
      editorTab = B.state.page;
      buildPanel();
    });

    window.addEventListener('beforeunload', function (e) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    });

    console.info('[Bravos] Editor activo. Quitá ?edit=1 de la URL para ver el sitio como un visitante.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
