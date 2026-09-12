// ═══════════ Realtime Database: журнал действий ═══════════
const ROCKET_Audit = (() => {
  const ref = () => firebase.database().ref('rocket/audit');

  async function log(event) {
    const entry = { ...event, ts: Date.now() };
    await ref().push(entry);
  }
  async function all() {
    const snap = await ref().orderByChild('ts').limitToLast(300).get();
    if (!snap.exists()) return [];
    const data = snap.val();
    return Object.values(data).sort((a,b) => b.ts - a.ts);
  }
  async function byActor(actor) {
    const snap = await ref().orderByChild('actor').equalTo(actor).get();
    if (!snap.exists()) return [];
    return Object.values(snap.val()).sort((a,b) => b.ts - a.ts);
  }
  async function wipe() {
    await ref().remove();
  }
  function listen(callback) {
    ref().orderByChild('ts').limitToLast(100).on('child_added',
      snap => callback(snap.val()));
  }
  return { log, all, byActor, wipe, listen };
})();
