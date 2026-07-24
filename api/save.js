/* ============================================================================
   POST /api/save  — verifica la sesión y commitea content.js al repo de GitHub.
   Vercel detecta el push y redespliega el sitio solo (~30 s).
   Variables de entorno necesarias:
     SESSION_SECRET   el mismo secreto que usa /api/login
     GITHUB_TOKEN     token fine-grained con permiso Contents: read/write SOLO en este repo
     (opcionales)     GITHUB_REPO (default "sergiob3822/crm-bravos"), GITHUB_BRANCH (default "main")
   ========================================================================== */
var crypto = require('crypto');

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function verify(token, secret) {
  if (!token) return false;
  var parts = token.split('.');
  if (parts.length !== 2) return false;
  var expected = b64url(crypto.createHmac('sha256', secret).update(parts[0]).digest());
  var a = Buffer.from(parts[1]), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    var payload = JSON.parse(Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    return payload && payload.exp && Date.now() < payload.exp;
  } catch (e) { return false; }
}
function cookies(req) {
  var out = {}, h = req.headers.cookie || '';
  h.split(';').forEach(function (p) { var i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
  return out;
}
function readJson(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise(function (resolve) {
    var d = '';
    req.on('data', function (c) { d += c; });
    req.on('end', function () { try { resolve(JSON.parse(d || '{}')); } catch (e) { resolve({}); } });
  });
}

module.exports = async function (req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }
  var secret = process.env.SESSION_SECRET, token = process.env.GITHUB_TOKEN;
  if (!secret || !token) { res.status(500).json({ ok: false, error: 'servidor sin configurar (faltan variables)' }); return; }

  if (!verify(cookies(req).bx_sess, secret)) {
    res.status(401).json({ ok: false, error: 'Sesión inválida o vencida. Volvé a entrar.' });
    return;
  }

  var body = await readJson(req);
  var content = String(body.content || '');
  if (content.length > 3 * 1024 * 1024) { res.status(413).json({ ok: false, error: 'demasiado grande' }); return; }

  /* Solo aceptamos un content.js válido con todas las secciones. */
  try {
    var sandbox = {};
    new Function('window', content)(sandbox);
    var c = sandbox.BRAVOS_CONTENT;
    if (!c || !c.home || !c.versions || !c.working || !c.terms) throw new Error('faltan secciones');
  } catch (e) {
    res.status(400).json({ ok: false, error: 'content.js inválido: ' + (e.message || e) });
    return;
  }

  var repo = process.env.GITHUB_REPO || 'sergiob3822/crm-bravos';
  var branch = process.env.GITHUB_BRANCH || 'main';
  var url = 'https://api.github.com/repos/' + repo + '/contents/content.js';
  var ghHeaders = {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'bravos-editor',
    'Content-Type': 'application/json',
  };

  try {
    /* Necesitamos el SHA actual del archivo para actualizarlo. */
    var sha;
    var getR = await fetch(url + '?ref=' + encodeURIComponent(branch), { headers: ghHeaders });
    if (getR.ok) { var gj = await getR.json(); sha = gj.sha; }
    else if (getR.status !== 404) { var gt = await getR.text(); throw new Error('lectura ' + getR.status + ': ' + gt.slice(0, 160)); }

    var putBody = {
      message: 'Editar contenido desde el editor online',
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch: branch,
    };
    if (sha) putBody.sha = sha;

    var putR = await fetch(url, { method: 'PUT', headers: ghHeaders, body: JSON.stringify(putBody) });
    if (!putR.ok) { var pt = await putR.text(); throw new Error('escritura ' + putR.status + ': ' + pt.slice(0, 200)); }
    var pj = await putR.json();
    res.status(200).json({ ok: true, commit: (pj.commit && pj.commit.sha) || null });
  } catch (e) {
    res.status(502).json({ ok: false, error: 'GitHub: ' + (e.message || e) });
  }
};
