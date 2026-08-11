(function () {
  'use strict';

  var B = window.Bravos;
  if (!B) return;

  var STORE_KEY = 'bravos:content';

  var panel = null;
  var saveTimer = null;
  var dirty = false;

  var draftDiscarded = false;

  var panelLang = null;

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

    if (draftDiscarded) return '↻ content.js cambió — arranqué desde el archivo';
    return 'Sin cambios';
  }

  var CE_MODE = (function () {
    var probe = document.createElement('div');
    probe.setAttribute('contenteditable', 'plaintext-only');
    return probe.contentEditable === 'plaintext-only' ? 'plaintext-only' : 'true';
  })();

  function enableInline() {

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

  function onInlineClick(e) {
    if (e.target.closest('#app [data-edit]')) {
      e.stopPropagation();
      e.preventDefault();
    }
  }

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

  function listAt(path) {
    var l = B.nodeAt(path);
    return Array.isArray(l) ? l : null;
  }

  function addItem(listPath, factory) {
    var list = listAt(listPath);
    if (!list) return;
    list.unshift(factory(list.length));
    afterStructuralChange();
  }

  function removeItem(listPath, index) {
    var list = listAt(listPath);

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
    appVersion: function () { return { version: '1.0.0', date: '', url: '' }; },
    terms: function () {
      return { h: i18n('Nueva cláusula', 'New clause'), p: i18n('Texto de la cláusula.', 'Clause text.') };
    },
  };

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

  function confettiField(w, i) {
    var pct = Math.max(0, Math.min(100, Number(getRaw('working.' + i + '.progress')) || 0));
    if (pct < 100) return '';
    var cf = w.confetti || {};
    var on = !!cf.on;
    var hours = Number(cf.hours) > 0 ? Number(cf.hours) : 24;
    var check =
      '<label class="bx-check">' +
        '<input type="checkbox" data-confetti-toggle="' + i + '"' + (on ? ' checked' : '') + '>' +
        '<span class="bx-check-box"></span>' +
        '<span class="bx-check-label">Confeti</span>' +
      '</label>';
    var hoursBlock = on
      ? '<label class="bx-field bx-confetti-hours"><span class="bx-label">¿Cuántas horas querés que dure el confeti?</span>' +
          '<input class="bx-input" type="number" min="1" step="1" value="' + hours + '" data-confetti-hours="' + i + '"></label>' +
          '<p class="bx-hint">Cuenta desde que lo activás: si ponés 24, el confeti deja de salir mañana a esta misma hora. Si agregás un proyecto nuevo, se cancela solo.</p>'
      : '';
    return '<div class="bx-confetti">' + check + hoursBlock + '</div>';
  }

  function cancelAllConfetti() {
    var list = B.nodeAt('working');
    if (Array.isArray(list)) {
      list.forEach(function (w) { if (w.confetti) w.confetti.on = false; });
    }
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
          '<p class="bx-hint">El "X% Completado" se muestra solo y la barra se colorea según el %.</p>' +
          confettiField(w, i) +
          '<div class="bx-sub">Ítems ya logrados (aparecen al pasar el mouse por la barra)</div>' + wItems +
          '<button class="bx-add" data-add="working.' + i + '.items" data-factory="workingItem">+ Agregar ítem</button>' +
          '</div>';
      }).join('') +
      '<button class="bx-add" data-add="working" data-factory="working">+ Agregar proyecto</button>';
    return accordion('working', 'Próximamente (roadmap)', c.working.length, body);
  }

  function appVersionsBlock(platform, label) {
    var list = B.nodeAt('appsPage.' + platform + '.versions') || [];
    var rows = list.map(function (_, k) {
      var base = 'appsPage.' + platform + '.versions.' + k;
      return '<div class="bx-item">' +
        itemHeader((B.nodeAt(base + '.version') || 'Versión ' + (k + 1)), 'appsPage.' + platform + '.versions', k) +
        fieldRaw('Número de versión (ej. 1.2.0)', base + '.version') +
        fieldRaw('Fecha', base + '.date') +
        fieldRaw('URL de descarga directa (https://…)', base + '.url') +
        '</div>';
    }).join('');
    return '<div class="bx-sub">' + label + '</div>' +
      fieldText('Título del bloque', 'appsPage.' + platform + '.heading') +
      fieldText('Nota del bloque', 'appsPage.' + platform + '.note', true) +
      rows +
      '<button class="bx-add" data-add="appsPage.' + platform + '.versions" data-factory="appVersion">+ Agregar versión</button>';
  }

  function sectionApps() {
    var body =
      fieldText('Kicker', 'appsPage.kicker') +
      fieldText('Título', 'appsPage.title') +
      fieldText('Descripción', 'appsPage.sub', true) +
      '<div class="bx-sub">Botones principales</div>' +
      fieldText('Texto del botón iOS', 'appsPage.iosBtn.label') +
      fieldRaw('URL del botón iOS (link a la PWA)', 'appsPage.iosBtn.url') +
      fieldText('Texto del botón Android', 'appsPage.androidBtn.label') +
      fieldRaw('URL del botón Android', 'appsPage.androidBtn.url') +
      '<div class="bx-sub">Descargas</div>' +
      '<p class="bx-hint">En cada versión pegá la <b>URL de descarga directa</b> del archivo (el link que baja el .apk al hacer clic). Para iOS, el link a la PWA.</p>' +
      appVersionsBlock('ios', 'Bloque iOS (PWA)') +
      appVersionsBlock('android', 'Bloque Android') +
      '';
    return accordion('apps', 'Aplicaciones', null, body);
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
      fieldText('Aplicaciones', 'nav.apps') +
      fieldText('Términos', 'nav.terms');
    return accordion('brand', 'Marca, nav y footer', null, body);
  }

  var PAGE_TABS = [
    { tab: 'home', hash: '#/', label: 'Inicio' },
    { tab: 'versions', hash: '#/versions', label: 'Versiones' },
    { tab: 'working', hash: '#/working', label: 'Próximamente' },
    { tab: 'apps', hash: '#/apps', label: 'Aplicaciones' },
    { tab: 'terms', hash: '#/terms-of-service', label: 'Términos' },
    { tab: 'general', hash: '', label: 'General' },
  ];

  var editorTab = 'home';

  function sectionsFor(tab) {
    if (tab === 'versions') return sectionVersions();
    if (tab === 'working') return sectionWorking();
    if (tab === 'apps') return sectionApps();
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

  function buildPanel() {
    if (!panel) {
      panel = document.createElement('aside');
      panel.id = 'bx-panel';
      document.body.appendChild(panel);
    }
    rememberOpenSections();

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
          ? '<button class="bx-btn bx-btn--translate" id="bx-translate">🌐 Traducir español → inglés</button>' +
            '<button class="bx-btn bx-btn--primary" id="bx-save">🚀 Publicar cambios</button>' +
            '<div class="bx-foot-row">' +
              '<button class="bx-btn" id="bx-export">Descargar copia</button>' +
              '<button class="bx-btn" id="bx-import">Importar</button>' +
              '<button class="bx-btn bx-btn--ghost" data-logout>Salir</button>' +
            '</div>' +
            '<p class="bx-hint">Primero <b>"Traducir"</b> (rellena el inglés desde el español); después <b>"Publicar"</b> sube los cambios al sitio (~30 s).</p>'
          : '<button class="bx-btn bx-btn--primary" id="bx-save">💾 Guardar en content.js</button>' +
            '<div class="bx-foot-row">' +
              '<button class="bx-btn" id="bx-export">Descargar copia</button>' +
              '<button class="bx-btn" id="bx-import">Importar</button>' +
              '<button class="bx-btn bx-btn--ghost" id="bx-reset">Restablecer</button>' +
            '</div>' +
            '<p class="bx-hint">"Guardar" escribe los cambios y deja una copia en <code>updates/</code> lista para subir al repo.</p>') +
      '</div>';

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

    try {
      var saved = localStorage.getItem(WIDTH_KEY);
      if (saved) document.documentElement.style.setProperty('--bx-w', saved);
    } catch (e) {}
  }

  function bindPanel() {
    bindResize();
    document.addEventListener('change', function (e) {
      if (!e.target.closest) return;

      var sw = e.target.closest('#bx-panel [data-desc-toggle]');
      if (sw) {
        var ok = toggleDesc(sw.getAttribute('data-desc-toggle'), sw.checked);
        if (ok === false) sw.checked = true;
        return;
      }

      var ct = e.target.closest('#bx-panel [data-confetti-toggle]');
      if (ct) {
        var ci = Number(ct.getAttribute('data-confetti-toggle'));
        var item = B.nodeAt('working.' + ci);
        if (item) {
          if (ct.checked) {
            var prev = item.confetti && Number(item.confetti.hours) > 0 ? Number(item.confetti.hours) : 24;
            item.confetti = { on: true, hours: prev, since: Date.now() };
          } else if (item.confetti) {
            item.confetti.on = false;
          }
        }
        B.render();
        enableInline();
        buildPanel();
        markDirty();
        return;
      }

      var rng = e.target.closest('#bx-panel [data-kind="number"]');
      if (rng && /working\.\d+\.progress$/.test(rng.getAttribute('data-path') || '')) {
        buildPanel();
        return;
      }

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
      if (el.matches && el.matches('#bx-panel [data-confetti-hours]')) {
        var hi = Number(el.getAttribute('data-confetti-hours'));
        var hitem = B.nodeAt('working.' + hi);
        if (hitem) {
          if (!hitem.confetti) hitem.confetti = { on: true, hours: 24, since: Date.now() };
          hitem.confetti.hours = Math.max(1, Math.floor(Number(el.value) || 1));
          hitem.confetti.since = Date.now();
        }
        B.render();
        enableInline();
        markDirty();
        return;
      }
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
        var addPath = add.getAttribute('data-add');
        if (addPath === 'working') cancelAllConfetti();
        addItem(addPath, FACTORIES[add.getAttribute('data-factory')]);
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

        B.setLang(el.getAttribute('data-editlang'));
        return;
      }
      var pg = e.target.closest('#bx-panel [data-edittab]');
      if (pg) {
        e.preventDefault();
        editorTab = pg.getAttribute('data-edittab');
        var hash = pg.getAttribute('data-editpage');

        if (hash) B.navigate(hash);
        buildPanel();
        return;
      }
      if (e.target.closest('#bx-collapse')) {
        document.documentElement.classList.toggle('bx-collapsed');
        return;
      }
      if (e.target.closest('#bx-translate')) { translateAll(); return; }
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

  var HEADER = 'window.BRAVOS_CONTENT = ';

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

  function contentFileText() {
    return HEADER + JSON.stringify(B.state.content, null, 2) + ';\n';
  }

  function exportContent() {
    download('content.js', contentFileText(), 'text/javascript');
    dirty = false;
    updateStatus('✓ Descargado — reemplazá content.js y desplegá');
  }

  function isI18n(n) {
    return n && typeof n === 'object' && !Array.isArray(n) && typeof n.es === 'string' && typeof n.en === 'string';
  }
  function collectAllI18n(node, out) {
    if (!node || typeof node !== 'object') return;
    if (isI18n(node)) { if ((node.es || '').trim()) out.push(node); return; }
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) collectAllI18n(node[i], out);
    } else {
      for (var k in node) {
        if (Object.prototype.hasOwnProperty.call(node, k)) collectAllI18n(node[k], out);
      }
    }
  }
  async function runTranslate(nodes) {
    var texts = nodes.map(function (n) { return n.es; });
    var translated = [];
    for (var i = 0; i < texts.length; i += 50) {
      var r = await fetch('api/translate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: texts.slice(i, i + 50) }),
      });
      var j = await r.json().catch(function () { return {}; });
      if (r.status === 401) { var e = new Error('sesión vencida'); e.session = true; throw e; }
      if (!r.ok || !j.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
      translated = translated.concat(j.translations || []);
    }
    for (var m = 0; m < nodes.length; m++) {
      if (translated[m] != null && translated[m] !== '') nodes[m].en = translated[m];
    }
    return nodes.length;
  }
  function translateAll() {
    var btn = document.getElementById('bx-translate');
    var nodes = [];
    collectAllI18n(B.state.content, nodes);
    if (!nodes.length) { updateStatus('No hay texto en español para traducir.'); return; }
    if (!confirm('¿Traducir ' + nodes.length + ' textos del español al inglés?\nReemplaza el inglés actual por la traducción de DeepL.')) return;
    if (btn) btn.disabled = true;
    updateStatus('🌐 Traduciendo al inglés (' + nodes.length + ')…');
    runTranslate(nodes).then(function (n) {
      if (btn) btn.disabled = false;
      saveDraft();
      dirty = true;
      B.render(); enableInline(); buildPanel();
      updateStatus('✓ Traducido (' + n + '). Revisá y tocá "Publicar".');
    }).catch(function (err) {
      if (btn) btn.disabled = false;
      if (err && err.session) {
        updateStatus('⚠ Sesión vencida. Redirigiendo al login…');
        setTimeout(function () { location.href = location.pathname + '#/login'; location.reload(); }, 1200);
        return;
      }
      updateStatus('⚠ No pude traducir: ' + ((err && err.message) || err));
    });
  }
  function publishOnline(btn) {
    updateStatus('🚀 Publicando…');
    return fetch('api/save', {
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
  }

  function saveToDisk() {
    var btn = document.getElementById('bx-save');
    if (btn) btn.disabled = true;

    if (window.BX_ONLINE) {
      publishOnline(btn);
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

  var CSS = `
  html.bx-on { --bx-w: 560px; }
  html.bx-on body { margin-right: var(--bx-w); }
  html.bx-on.bx-collapsed body { margin-right: 0; }
  html.bx-on.bx-collapsed #bx-panel { transform: translateX(calc(100% - 40px)); }
  html.bx-on.bx-collapsed #bx-collapse { transform: rotate(180deg); }

  #bx-panel {
    position: fixed; top: 0; right: 0; bottom: 0;
    width: var(--bx-w); z-index: 9999;
    background:
      radial-gradient(120% 55% at 100% 0%, rgba(37,211,102,.10), transparent 62%),
      linear-gradient(180deg, #FDFEFF, #F3F7FA);
    color: #23303D;
    border-left: 1px solid #E1E8EF;
    display: flex; flex-direction: column;
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    box-shadow: -34px 0 80px -46px rgba(31,52,74,.45);
    transition: transform .2s ease;
  }
  #bx-panel * { box-sizing: border-box; }

  .bx-resize {
    position: absolute; left: -3px; top: 0; bottom: 0; width: 12px;
    cursor: ew-resize; z-index: 3; touch-action: none;
  }
  .bx-resize::before {
    content: ''; position: absolute; left: 3px; top: 0; bottom: 0; width: 3px;
    background: transparent; transition: background .15s;
  }
  .bx-resize:hover::before, html.bx-resizing .bx-resize::before { background: #25D366; }
  html.bx-resizing { cursor: ew-resize; user-select: none; }

  .bx-head {
    padding: 24px 26px 18px;
    background: linear-gradient(180deg, rgba(37,211,102,.07), rgba(255,255,255,0));
    border-bottom: 1px solid #E7EDF2;
  }
  .bx-head-top { display: flex; align-items: center; justify-content: space-between; }
  .bx-title {
    font-weight: 800; font-size: 16.5px; letter-spacing: -.015em; color: #17222D;
    display: flex; align-items: center; gap: 10px;
  }
  .bx-title::before {
    content: ''; width: 10px; height: 10px; border-radius: 50%;
    background: #25D366; box-shadow: 0 0 0 4px rgba(37,211,102,.16);
  }
  .bx-close {
    width: 34px; height: 34px; border-radius: 10px;
    border: 1px solid #DCE4EC; background: #FFFFFF; color: #6B7C8B;
    cursor: pointer; font-size: 14px; line-height: 1;
    display: flex; align-items: center; justify-content: center;
    transition: transform .2s ease, background .15s, color .15s;
  }
  .bx-close:hover { background: #F1F5F9; color: #1F2A37; }

  .bx-langbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 20px; }
  .bx-langlabel { font-size: 12.5px; color: #71828F; font-weight: 500; }
  .bx-langpills { display: flex; gap: 4px; padding: 4px; background: #EBF0F5; border-radius: 10px; }
  .bx-langpill {
    padding: 7px 15px; border: none; border-radius: 8px;
    background: transparent; color: #64757F;
    font-size: 12.5px; font-weight: 600; font-family: inherit; cursor: pointer;
    transition: background .14s, color .14s, box-shadow .14s;
  }
  .bx-langpill.is-on { background: #FFFFFF; color: #12833F; font-weight: 700; box-shadow: 0 2px 6px -2px rgba(31,52,74,.18); }

  .bx-pagebar {
    display: flex; flex-wrap: wrap; gap: 5px; margin-top: 16px;
    padding: 5px; background: #EEF3F7; border: 1px solid #E1E8EF; border-radius: 12px;
  }
  .bx-pagetab {
    flex: 1 1 auto; padding: 9px 12px; border: none; border-radius: 9px;
    background: transparent; color: #64757F;
    font-size: 12.5px; font-weight: 600; font-family: inherit; cursor: pointer;
    white-space: nowrap; transition: background .14s, color .14s, box-shadow .14s;
  }
  .bx-pagetab:hover { background: #FFFFFF; color: #1F2A37; }
  .bx-pagetab.is-on {
    background: linear-gradient(180deg, #2BD46B, #1FBA59);
    color: #fff; font-weight: 700;
    box-shadow: 0 5px 14px -6px rgba(37,211,102,.8);
  }

  .bx-status {
    margin-top: 16px; font-size: 12px; color: #7A8B98; min-height: 16px;
    display: flex; align-items: center; gap: 7px;
  }

  .bx-body { flex: 1; overflow-y: auto; padding: 24px 26px 30px; }
  .bx-body::-webkit-scrollbar { width: 11px; }
  .bx-body::-webkit-scrollbar-thumb { background: #CFD9E2; border-radius: 9px; border: 3px solid transparent; background-clip: padding-box; }
  .bx-body::-webkit-scrollbar-thumb:hover { background: #B4C2CE; background-clip: padding-box; }

  .bx-tip {
    margin: 0 0 20px; padding: 14px 16px;
    background: rgba(37,211,102,.10); border: 1px solid rgba(37,211,102,.30);
    border-radius: 12px; font-size: 12.5px; line-height: 1.6; color: #0E7A3C;
  }

  .bx-acc {
    border: 1px solid #E4EAF0; border-radius: 16px; margin-bottom: 16px;
    background: #FFFFFF; overflow: hidden;
    box-shadow: 0 4px 18px -12px rgba(31,52,74,.30);
  }
  .bx-summary {
    padding: 19px 20px; cursor: pointer; list-style: none;
    font-size: 14.5px; font-weight: 700; color: #1F2A37;
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    transition: background .14s;
  }
  .bx-summary::-webkit-details-marker { display: none; }
  .bx-summary::after {
    content: '⌄'; margin-left: auto; font-size: 16px; color: #9AA9B5;
    transition: transform .2s ease;
  }
  .bx-acc[open] .bx-summary::after { transform: rotate(180deg); }
  .bx-summary:hover { background: #F7FAFC; }
  .bx-acc[open] .bx-summary { border-bottom: 1px solid #EAEFF4; }
  .bx-count {
    background: rgba(37,211,102,.16); color: #12833F; border-radius: 999px;
    padding: 4px 10px; font-size: 11.5px; font-weight: 700; margin-left: auto;
  }
  .bx-acc-body { padding: 20px; }

  .bx-field { display: block; margin-bottom: 16px; }
  .bx-label { display: block; font-size: 12px; font-weight: 600; color: #64757F; margin-bottom: 7px; }
  .bx-num { color: #12A150; font-weight: 700; }
  .bx-input {
    width: 100%; padding: 11px 13px;
    background: #FFFFFF; border: 1px solid #D9E1E9; border-radius: 10px;
    color: #1F2A37; font-size: 13.5px; font-family: inherit;
    line-height: 1.55; resize: vertical;
    transition: border-color .14s, box-shadow .14s;
  }
  .bx-input::placeholder { color: #A2B0BC; }
  .bx-input:focus { outline: none; border-color: #25D366; box-shadow: 0 0 0 3px rgba(37,211,102,.18); }
  select.bx-input { cursor: pointer; }
  .bx-range { width: 100%; accent-color: #25D366; }

  .bx-rich { display: block; margin-bottom: 12px; }
  .bx-toolbar {
    display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
    padding: 6px; margin-bottom: 6px;
    background: #F2F6F9; border: 1px solid #DFE7EE;
    border-radius: 9px;
  }
  .bx-tbtn {
    min-width: 26px; height: 26px; padding: 0 6px;
    border: 1px solid #DCE4EC; border-radius: 6px;
    background: #FFFFFF; color: #2C3A47;
    font-size: 12.5px; font-family: inherit; line-height: 1; cursor: pointer;
    transition: background .12s, border-color .12s;
  }
  .bx-tbtn:hover { background: #EDF2F6; border-color: #C7D3DD; }
  .bx-tbtn i { font-style: italic; }
  .bx-tsep { width: 1px; height: 18px; background: #DCE4EC; margin: 0 4px; }
  .bx-tcolor { width: 26px; padding: 0; }
  .bx-tc-green { background: #25D366; } .bx-tc-green:hover { background: #25D366; }
  .bx-tc-teal  { background: #128C7E; } .bx-tc-teal:hover  { background: #128C7E; }
  .bx-tc-amber { background: #D69E2E; } .bx-tc-amber:hover { background: #D69E2E; }
  .bx-tc-blue  { background: #2E7FD1; } .bx-tc-blue:hover  { background: #2E7FD1; }
  .bx-rich-ta { display: block; }
  .bx-rich-help { font-size: 10.5px; line-height: 1.55; color: #8493A0; margin: 6px 0 0; }
  .bx-rich-help code { background: #EDF2F6; padding: 0 4px; border-radius: 4px; color: #46586A; }

  .bx-note {
    border: 1px solid #E4EAF0; border-radius: 11px;
    padding: 12px; margin-bottom: 10px; background: #F8FBFD;
  }
  .bx-note .bx-row { margin-bottom: 0; }
  .bx-switch {
    display: flex; align-items: center; gap: 10px;
    margin-top: 10px; cursor: pointer; user-select: none;
  }
  .bx-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
  .bx-switch-track {
    position: relative; width: 38px; height: 21px; flex: none;
    background: #CDD8E1; border-radius: 999px; transition: background .16s;
  }
  .bx-switch-dot {
    position: absolute; top: 2.5px; left: 2.5px;
    width: 16px; height: 16px; border-radius: 50%;
    background: #FFFFFF; box-shadow: 0 1px 3px rgba(31,52,74,.3); transition: transform .16s, background .16s;
  }
  .bx-switch input:checked + .bx-switch-track { background: #25D366; }
  .bx-switch input:checked + .bx-switch-track .bx-switch-dot { transform: translateX(17px); background: #FFFFFF; }
  .bx-switch input:focus-visible + .bx-switch-track { box-shadow: 0 0 0 3px rgba(37,211,102,.35); }
  .bx-switch-label { font-size: 12.5px; font-weight: 600; color: #64757F; }
  .bx-switch input:checked ~ .bx-switch-label { color: #1F2A37; }
  .bx-switch--field { margin: 4px 0 16px; }
  .bx-note .bx-rich { margin-top: 11px; margin-bottom: 0; }

  .bx-confetti { margin: 4px 0 16px; padding: 14px 15px; border: 1px solid #E4EAF0; border-radius: 12px; background: #F8FBFD; }
  .bx-check { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; }
  .bx-check input { position: absolute; opacity: 0; width: 0; height: 0; }
  .bx-check-box { width: 20px; height: 20px; border-radius: 6px; border: 2px solid #C4D0DB; background: #FFFFFF; position: relative; transition: all .15s ease; flex: none; }
  .bx-check input:checked + .bx-check-box { background: #25D366; border-color: #25D366; }
  .bx-check input:checked + .bx-check-box::after { content: ''; position: absolute; left: 6px; top: 2px; width: 5px; height: 10px; border: solid #FFFFFF; border-width: 0 2px 2px 0; transform: rotate(45deg); }
  .bx-check input:focus-visible + .bx-check-box { box-shadow: 0 0 0 3px rgba(37,211,102,.35); }
  .bx-check-label { font-size: 13.5px; font-weight: 700; color: #1F2A37; }
  .bx-confetti-hours { margin: 14px 0 0; }
  .bx-confetti-hours .bx-input { max-width: 130px; }

  .bx-row { display: flex; gap: 7px; align-items: flex-start; margin-bottom: 7px; }
  .bx-row .bx-input { flex: 1; }

  .bx-sub {
    font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .08em; color: #8493A0; margin: 18px 0 9px;
  }

  .bx-item { border: 1px solid #E4EAF0; border-radius: 14px; padding: 17px; margin-bottom: 16px; background: #FBFCFE; }
  .bx-item-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 13px; }
  .bx-item-title {
    font-size: 13px; font-weight: 700; color: #2C3A47;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .bx-item-tools { display: flex; gap: 5px; flex: none; }
  .bx-icon {
    width: 28px; height: 28px; border-radius: 8px;
    border: 1px solid #DCE4EC; background: #FFFFFF; color: #6B7C8B;
    cursor: pointer; font-size: 12.5px; line-height: 1; padding: 0;
    transition: background .14s, color .14s, border-color .14s;
  }
  .bx-icon:hover { background: #F1F5F9; color: #1F2A37; }
  .bx-icon--danger:hover { background: #FEECEC; border-color: #F5B5B5; color: #C0392B; }

  .bx-add {
    width: 100%; padding: 12px; margin-top: 8px;
    border: 1.5px dashed #C4D3DE; border-radius: 11px;
    background: transparent; color: #5E8CA0;
    font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer;
    transition: border-color .14s, color .14s, background .14s;
  }
  .bx-add:hover { border-color: #25D366; color: #12A150; background: rgba(37,211,102,.07); }

  .bx-hint { font-size: 11.5px; line-height: 1.6; color: #7A8B98; margin: 9px 0 0; }
  .bx-hint code { background: #EDF2F6; padding: 1px 5px; border-radius: 4px; color: #46586A; }

  .bx-foot { padding: 18px 22px 20px; border-top: 1px solid #E7EDF2; background: rgba(255,255,255,.78); }
  .bx-foot-row { display: flex; gap: 8px; margin-top: 8px; }
  .bx-foot-row .bx-btn { flex: 1; }
  .bx-btn {
    width: 100%; padding: 12px 15px; border-radius: 11px;
    border: 1px solid #D9E1E9; background: #FFFFFF; color: #2C3A47;
    font-size: 13px; font-weight: 700; font-family: inherit; cursor: pointer;
    transition: background .14s, transform .1s, border-color .14s;
  }
  .bx-btn:hover { background: #F1F5F9; border-color: #C7D3DD; }
  .bx-btn:active { transform: translateY(1px); }
  .bx-btn--primary {
    background: linear-gradient(180deg, #2BD46B, #1FBA59); border-color: #1FBA59; color: #05271A;
    box-shadow: 0 7px 20px -9px rgba(37,211,102,.85);
  }
  .bx-btn--primary:hover { background: linear-gradient(180deg, #33E074, #23C763); border-color: #1FBA59; }
  .bx-btn--ghost { background: transparent; color: #64757F; border-color: transparent; }
  .bx-btn--translate { margin-bottom: 8px; background: #EAF3FF; border-color: #BBD9F7; color: #1E5FA8; }
  .bx-btn--translate:hover { background: #DCEBFC; border-color: #9CC6F0; }

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

  function onRendered() {
    enableInline();
    if (B.state.lang !== panelLang) buildPanel();
  }

  function start() {
    if (window.__bxStarted) return;
    window.__bxStarted = true;

    var draft = loadDraft();
    if (draft) {
      B.state.content = draft;
      dirty = true;
      B.render();
    }

    editorTab = B.state.page;
    injectCSS();
    buildPanel();
    bindPanel();
    enableInline();

    document.addEventListener('input', onInlineInput, true);
    document.addEventListener('keydown', onInlineKeydown, true);
    document.addEventListener('click', onInlineClick, true);
    document.addEventListener('paste', onInlinePaste, true);

    window.addEventListener('bravos:rendered', onRendered);

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
