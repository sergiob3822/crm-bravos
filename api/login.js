/* ============================================================================
   POST /api/login  — valida la contraseña de admin y abre una sesión firmada.
   Variables de entorno necesarias (Vercel → Settings → Environment Variables):
     ADMIN_PASSWORD   la clave del editor (fuerte, larga)
     SESSION_SECRET   una cadena aleatoria larga para firmar la sesión
   ========================================================================== */
var crypto = require('crypto');

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function sign(payload, secret) {
  var data = b64url(Buffer.from(JSON.stringify(payload)));
  var mac = b64url(crypto.createHmac('sha256', secret).update(data).digest());
  return data + '.' + mac;
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
  var pass = process.env.ADMIN_PASSWORD, secret = process.env.SESSION_SECRET;
  if (!pass || !secret) { res.status(500).json({ ok: false, error: 'servidor sin configurar (faltan variables)' }); return; }

  var body = await readJson(req);
  var given = String(body.password || '');
  var a = Buffer.from(given), b = Buffer.from(pass);
  var ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!ok) {
    /* Pequeña demora para frenar fuerza bruta (la clave fuerte es la defensa real). */
    await new Promise(function (r) { setTimeout(r, 450); });
    res.status(401).json({ ok: false, error: 'Contraseña incorrecta.' });
    return;
  }

  var maxAge = 60 * 60 * 8; // 8 horas
  var token = sign({ exp: Date.now() + maxAge * 1000 }, secret);
  res.setHeader('Set-Cookie', [
    'bx_sess=' + token + '; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=' + maxAge,
    'bx_on=1; Secure; SameSite=Strict; Path=/; Max-Age=' + maxAge,
  ]);
  res.status(200).json({ ok: true });
};
