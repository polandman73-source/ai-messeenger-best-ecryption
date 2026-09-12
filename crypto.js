// ═══════════ AES-GCM 256 + PBKDF2 (200k) ═══════════
const ROCKET_Crypto = (() => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  async function deriveKey(passphrase, salt) {
    const baseKey = await crypto.subtle.importKey(
      'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name:'PBKDF2', salt, iterations:200000, hash:'SHA-256' },
      baseKey, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']);
  }
  const b64 = b => btoa(String.fromCharCode(...new Uint8Array(b)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function encrypt(data, passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv   = crypto.getRandomValues(new Uint8Array(12));
    const key  = await deriveKey(passphrase, salt);
    const buf  = typeof data === 'string' ? enc.encode(data) : data;
    const ct   = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, buf);
    return { salt:b64(salt), iv:b64(iv), ct:b64(ct) };
  }
  async function decrypt(payload, passphrase) {
    const salt = unb64(payload.salt), iv = unb64(payload.iv), ct = unb64(payload.ct);
    const key = await deriveKey(passphrase, salt);
    return crypto.subtle.decrypt({name:'AES-GCM', iv}, key, ct);
  }
  const decryptText = async (p, pw) => dec.decode(await decrypt(p, pw));
  return { encrypt, decrypt, decryptText, b64, unb64 };
})();
