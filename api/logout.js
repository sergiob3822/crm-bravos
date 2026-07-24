/* POST /api/logout — cierra la sesión (borra las cookies). */
module.exports = function (req, res) {
  res.setHeader('Set-Cookie', [
    'bx_sess=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0',
    'bx_on=; Secure; SameSite=Strict; Path=/; Max-Age=0',
  ]);
  res.status(200).json({ ok: true });
};
