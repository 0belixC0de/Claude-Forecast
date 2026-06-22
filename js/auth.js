/* ═══════════════════════════════════════════
   Auth – Register · Login · Admin
   ═══════════════════════════════════════════ */

const Auth = (() => {

  async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function getUsers() {
    try { return JSON.parse(localStorage.getItem('cf_users') || '[]'); } catch { return []; }
  }

  function getSession() {
    try { return JSON.parse(sessionStorage.getItem('cf_session') || 'null'); } catch { return null; }
  }

  function setSession(username, isAdmin) {
    sessionStorage.setItem('cf_session', JSON.stringify({ username, isAdmin }));
  }

  function clearSession() {
    sessionStorage.removeItem('cf_session');
  }

  function isLoggedIn() { return !!getSession(); }
  function isAdmin()    { return getSession()?.isAdmin === true; }
  function username()   { return getSession()?.username || ''; }

  async function register(username, password) {
    username = username.trim();
    if (username.length < 2) return { ok: false, msg: 'Benutzername mind. 2 Zeichen' };
    if (password.length < 6) return { ok: false, msg: 'Passwort mind. 6 Zeichen' };
    const users = getUsers();
    if (users.find(u => u.username.toLowerCase() === username.toLowerCase()))
      return { ok: false, msg: 'Benutzername bereits vergeben' };
    const hash = await sha256(password);
    users.push({ username, hash });
    localStorage.setItem('cf_users', JSON.stringify(users));
    setSession(username, false);
    return { ok: true };
  }

  async function login(username, password) {
    username = username.trim();
    const user = getUsers().find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) return { ok: false, msg: 'Benutzer nicht gefunden' };
    const hash = await sha256(password);
    if (hash !== user.hash) return { ok: false, msg: 'Falsches Passwort' };
    setSession(username, false);
    return { ok: true };
  }

  async function loginAdmin(password) {
    const stored = localStorage.getItem('cf_admin_hash');
    if (!stored) {
      if (password.length < 6) return { ok: false, firstTime: true, msg: 'Passwort mind. 6 Zeichen' };
      localStorage.setItem('cf_admin_hash', await sha256(password));
      setSession('admin', true);
      return { ok: true, firstTime: true };
    }
    if (await sha256(password) !== stored) return { ok: false, msg: 'Falsches Admin-Passwort' };
    setSession('admin', true);
    return { ok: true };
  }

  async function changeAdminPassword(pw) {
    if (pw.length < 6) return { ok: false, msg: 'Passwort mind. 6 Zeichen' };
    localStorage.setItem('cf_admin_hash', await sha256(pw));
    return { ok: true };
  }

  function listUsers()        { return getUsers().map(u => u.username); }
  function removeUser(name)   {
    localStorage.setItem('cf_users', JSON.stringify(getUsers().filter(u => u.username !== name)));
  }

  return { isLoggedIn, isAdmin, username, clearSession, register, login, loginAdmin, changeAdminPassword, listUsers, removeUser };
})();
