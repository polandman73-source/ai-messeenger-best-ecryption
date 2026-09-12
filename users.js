// ═══════════ Realtime Database: пользователи ═══════════
const ROCKET_Users = (() => {
  const ref = () => firebase.database().ref('rocket/users');

  async function put(user) {
    await ref().child(user.code).set(user);
    return user;
  }
  async function get(code) {
    const snap = await ref().child(code).get();
    return snap.exists() ? snap.val() : null;
  }
  async function all() {
    const snap = await ref().get();
    if (!snap.exists()) return [];
    const data = snap.val();
    return Object.values(data);
  }
  async function update(code, patch) {
    await ref().child(code).update(patch);
  }
  async function setOnline(code, online) {
    await ref().child(code).update({ online, lastSeen: Date.now() });
  }
  async function remove(code) {
    await ref().child(code).remove();
  }
  async function wipe() {
    await ref().remove();
  }
  async function hash(str) {
    const buf = await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(str));
    return [...new Uint8Array(buf)]
      .map(b => b.toString(16).padStart(2,'0')).join('');
  }
  function listen(callback) {
    ref().on('value', snap => {
      const data = snap.val();
      callback(data ? Object.values(data) : []);
    });
  }

  return { put, get, all, update, setOnline, remove, wipe, hash, listen };
})();
