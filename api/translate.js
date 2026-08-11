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
  var secret = process.env.SESSION_SECRET;
  var key = process.env.DEEPL_API_KEY;
  if (!secret) { res.status(500).json({ ok: false, error: 'servidor sin configurar (falta SESSION_SECRET)' }); return; }
  if (!verify(cookies(req).bx_sess, secret)) {
    res.status(401).json({ ok: false, error: 'Sesión inválida o vencida.' });
    return;
  }
  if (!key) { res.status(500).json({ ok: false, error: 'falta la variable DEEPL_API_KEY en Vercel' }); return; }

  var body = await readJson(req);
  var texts = Array.isArray(body.texts) ? body.texts.map(function (t) { return String(t == null ? '' : t); }) : [];
  if (!texts.length) { res.status(200).json({ ok: true, translations: [] }); return; }
  if (texts.length > 50) { res.status(400).json({ ok: false, error: 'máximo 50 textos por pedido' }); return; }

  var host = /:fx$/.test(key) ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  try {
    var r = await fetch(host + '/v2/translate', {
      method: 'POST',
      headers: {
        'Authorization': 'DeepL-Auth-Key ' + key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: texts,
        source_lang: 'ES',
        target_lang: 'EN-US',
        preserve_formatting: true,
      }),
    });
    if (!r.ok) {
      var errTxt = await r.text();
      var msg = r.status === 456 ? 'se agotó la cuota gratis de DeepL de este mes'
        : r.status === 403 ? 'la DEEPL_API_KEY es inválida'
        : 'DeepL ' + r.status + ': ' + errTxt.slice(0, 160);
      res.status(502).json({ ok: false, error: msg });
      return;
    }
    var data = await r.json();
    var out = (data.translations || []).map(function (t) { return t.text; });
    res.status(200).json({ ok: true, translations: out });
  } catch (e) {
    res.status(502).json({ ok: false, error: 'DeepL: ' + (e.message || e) });
  }
};
