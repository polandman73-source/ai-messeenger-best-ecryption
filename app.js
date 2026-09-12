(() => {
  // ═══════════ КОНФИГ ═══════════
  const PANIC_CODE = '6767';
  const GROUP_CODE = '1919';
  const ADMIN_CODE = '2670';
  const GROUP_KEY  = 'ROCKET_6B_GROUP_SECRET_2026_XY9K';

  // ═══════════ DOM ═══════════
  const $ = id => document.getElementById(id);
  const screens = {
    login:    $('screen-login'),
    register: $('screen-register'),
    pending:  $('screen-pending'),
    app:      $('screen-app'),
    admin:    $('screen-admin'),
  };
  const inCode = $('in-code'), inNick = $('in-nick'),
        inPass = $('in-pass'), inPass2 = $('in-pass2'),
        loginMsg = $('login-msg'), regMsg = $('reg-msg'),
        regCode = $('reg-code'), pendingMsg = $('pending-msg'),
        messages = $('messages'), msgInput = $('msg-input'),
        channelTitle = $('channel-title'),
        membersPanel = $('members-panel'),
        channelsSidebar = document.querySelector('.channels'),
        drawer = $('drawer'), overlay = $('overlay'), toast = $('toast');

  // ═══════════ STATE ═══════════
  let me = null;
  let unsubMessages = null;
  let unsubSeen = null;
  let unsubTyping = null;
  let unsubUsers = null;
  let seenCache = {};
  let typingTimer = null;
  let renderedTs = new Set();
  let lastAuthor = null;

  // ═══════════ УТИЛИТЫ ═══════════
  const show = name => {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
  };
  function toastMsg(t, type='') {
    toast.textContent = t;
    toast.className = 'toast show ' + type;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.className = 'toast ' + type, 2600);
  }
  const setMsg = (el, t, ok=false) => {
    el.textContent = t;
    el.className = 'msg-line' + (ok ? ' ok' : '');
  };
  const isAdmin = () => me && me.code === ADMIN_CODE;

  // ═══════════ ВХОД ═══════════
  $('btn-login').onclick = async () => {
    const code = inCode.value.trim();
    setMsg(loginMsg, '');
    if (!/^\d{4,8}$/.test(code)) return setMsg(loginMsg, 'Кодовый номер: 4–8 цифр');
    if (code === PANIC_CODE) return panicWipe();

    const existing = await ROCKET_Users.get(code);
    if (existing) {
      const pass = prompt(`Пользователь «${existing.nick}» найден.\nВведите пароль:`);
      if (pass === null) return;
      const hash = await ROCKET_Users.hash(pass);
      if (hash !== existing.passHash) return setMsg(loginMsg, 'Неверный пароль');

      me = existing;
      await ROCKET_Users.setOnline(me.code, true);
      await ROCKET_Audit.log({
        actor: me.code, nick: me.nick, type:'login',
        action:'вошёл в систему', room:'#6Б/общий-чат'
      });

      if (me.status !== 'approved') { show('pending'); startPendingWatcher(); return; }
      enterApp();
    } else {
      regCode.textContent = code;
      inNick.value = inPass.value = inPass2.value = '';
      setMsg(regMsg, '');
      show('register');
    }
  };
  $('btn-back').onclick = () => { show('login'); setMsg(loginMsg, ''); };

  // ═══════════ РЕГИСТРАЦИЯ ═══════════
  $('btn-register').onclick = async () => {
    const code = regCode.textContent;
    const nick = inNick.value.trim();
    const p1 = inPass.value, p2 = inPass2.value;
    setMsg(regMsg, '');
    if (nick.length < 2 || nick.length > 20) return setMsg(regMsg, 'Ник: 2–20 символов');
    if (!/^[\wа-яёА-ЯЁ \-]+$/u.test(nick))   return setMsg(regMsg, 'Недопустимые символы');
    if (p1.length < 6)                       return setMsg(regMsg, 'Пароль ≥ 6 символов');
    if (p1 !== p2)                           return setMsg(regMsg, 'Пароли не совпадают');

    const passHash = await ROCKET_Users.hash(p1);
    const isAdminAcc = (code === ADMIN_CODE);
    const status = isAdminAcc ? 'approved' : 'pending';

    const user = {
      code, nick, passHash, status, isAdmin: isAdminAcc,
      createdAt: Date.now(), avatar: nick[0].toUpperCase(),
      online: true, lastSeen: Date.now(),
    };
    await ROCKET_Users.put(user);
    await ROCKET_Audit.log({
      actor: code, nick, type:'register',
      action:'зарегистрирован (ожидает подтверждения)', room:'—'
    });
    me = user;

    if (status === 'approved') {
      toastMsg('Аккаунт создан ✓', 'ok');
      enterApp();
    } else {
      show('pending');
      startPendingWatcher();
    }
  };
  $('btn-pending-back').onclick = () => {
    if (unsubUsers) unsubUsers();
    me = null;
    show('login');
    inCode.value = '';
  };

  function startPendingWatcher() {
    unsubUsers = () => {};
    ROCKET_Users.listen(users => {
      const u = users.find(x => x.code === me.code);
      if (u && u.status === 'approved') {
        me = u;
        if (unsubUsers) unsubUsers();
        toastMsg('Аккаунт подтверждён ✓', 'ok');
        enterApp();
      }
    });
  }

  // ═══════════ ОСНОВНОЙ ЭКРАН ═══════════
  async function enterApp() {
    show('app');
    updateMe();
    await renderMiniUsers();
    await renderMembers();
    await loadMessages();
    subscribeAll();
    setupHotkeys();
    setupSwipe();
    setupTheme();
    setupJumpButton();
    if (isAdmin()) $('guild-admin').style.display = 'flex';
    msgInput.focus();
  }

  function updateMe() {
    $('me-avatar').textContent = me.avatar;
    $('me-nick').textContent = me.nick;
    $('me-status').textContent = isAdmin() ? '🛡️ админ' : 'участник 6Б';
  }

  // ═══════════ ЗАГРУЗКА ИСТОРИИ ═══════════
  async function loadMessages() {
    messages.innerHTML = '';
    renderedTs.clear();
    lastAuthor = null;
    const history = await ROCKET_Channel.history(300);
    for (const item of history) {
      if (renderedTs.has(item.ts)) continue;
      renderedTs.add(item.ts);
      await renderMessage(item, false);
    }
    scrollBottom();
    await markAllSeen(history);
  }

  async function markAllSeen(history) {
    for (const item of history) {
      if (item.from === me.code) continue;
      await ROCKET_Seen.mark(item.ts, me.code);
    }
  }

  // ═══════════ ПОДПИСКИ REALTIME ═══════════
  function subscribeAll() {
    // новые сообщения
    ROCKET_Channel.listen(async item => {
      if (renderedTs.has(item.ts)) return;
      renderedTs.add(item.ts);
      await renderMessage(item, true);
      scrollBottom();
      if (item.from !== me.code) {
        await ROCKET_Seen.mark(item.ts, me.code);
      }
    });

    // обновления «кто видел»
    ROCKET_Seen.listen(data => {
      seenCache = data;
      document.querySelectorAll('.seen-row').forEach(refreshSeenRow);
    });

    // обновления пользователей
    ROCKET_Users.listen(() => {
      renderMiniUsers();
      renderMembers();
      if (isAdmin()) {
        // обновляем админку если открыта
        if (screens.admin.classList.contains('active')) renderAdmin();
      }
    });

    // печатает кто-то
    ROCKET_Typing.listen(users => {
      const others = users.filter(u => u.code !== me.code);
      const el = $('typing-indicator');
      if (!others.length) { el.hidden = true; return; }
      el.hidden = false;
      el.textContent = others.map(u => u.nick).join(', ') +
        (others.length === 1 ? ' печатает' : ' печатают');
    });
  }

  // ═══════════ ОТПРАВКА ═══════════
  async function sendText() {
    const text = msgInput.value.trim();
    if (!text) return;
    const payload = await ROCKET_Crypto.encrypt(text, GROUP_KEY);
    const item = {
      type:'text', payload, from:me.code, nick:me.nick,
      isAdmin: isAdmin(), ts: Date.now(),
    };
    msgInput.value = '';
    ROCKET_Typing.set(me.code, me.nick, false);
    await ROCKET_Channel.send(item);
    await ROCKET_Audit.log({
      actor: me.code, nick: me.nick, type:'send',
      action: `отправил: «${text.slice(0,60)}${text.length>60?'…':''}»`,
      room: '#6Б/общий-чат',
    });
  }

  async function sendFile(file) {
    if (file.size > 8*1024*1024) return toastMsg('Файл >8 МБ', 'err');
    const buf = await file.arrayBuffer();
    const payload = await ROCKET_Crypto.encrypt(buf, GROUP_KEY);
    const id = 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
    await ROCKET_Store.put(id, payload);
    const item = {
      type:'image', id, from:me.code, nick:me.nick, isAdmin:isAdmin(),
      ts: Date.now(), fname: file.name, fsize: file.size,
    };
    await ROCKET_Channel.send(item);
    await ROCKET_Audit.log({
      actor: me.code, nick: me.nick, type:'photo',
      action: `отправил фото «${file.name}» (${Math.round(file.size/1024)} КБ)`,
      room: '#6Б/общий-чат',
    });
  }

  async function sendCircle(blob) {
    const buf = await blob.arrayBuffer();
    const payload = await ROCKET_Crypto.encrypt(buf, GROUP_KEY);
    const id = 'circ_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
    await ROCKET_Store.put(id, payload);
    const item = {
      type:'circle', id, from:me.code, nick:me.nick, isAdmin:isAdmin(),
      ts: Date.now(), fsize: blob.size,
    };
    await ROCKET_Channel.send(item);
    await ROCKET_Audit.log({
      actor: me.code, nick: me.nick, type:'video',
      action: `отправил кружочек (${(blob.size/1024).toFixed(0)} КБ)`,
      room: '#6Б/общий-чат',
    });
  }

  // ═══════════ РЕНДЕР СООБЩЕНИЯ ═══════════
  async function renderMessage(item, animate = false) {
    const grouped = lastAuthor === item.from && item.type === 'text';
    lastAuthor = item.from;

    const div = document.createElement('div');
    div.className = 'msg' + (grouped ? ' grouped' : '');
    div.dataset.ts = item.ts;

    const av = document.createElement('div');
    av.className = 'msg-avatar' + (grouped ? ' hidden' : '');
    av.textContent = (item.nick || '?')[0].toUpperCase();
    av.onclick = () => toastMsg(`#${item.from} ${item.nick}`);
    div.appendChild(av);

    const body = document.createElement('div');
    body.className = 'msg-body';

    if (!grouped) {
      const head = document.createElement('div');
      head.className = 'msg-head';
      const author = document.createElement('span');
      author.className = 'msg-author' + (item.from === ADMIN_CODE ? ' admin' : '');
      author.textContent = (item.nick || 'Аноним') +
        (item.from === ADMIN_CODE ? ' 🛡️' : '');
      head.appendChild(author);
      const time = document.createElement('span');
      time.className = 'msg-time';
      time.textContent = new Date(item.ts).toLocaleString('ru-RU',
        {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
      head.appendChild(time);
      body.appendChild(head);
    }

    if (item.type === 'text') {
      try {
        const t = await ROCKET_Crypto.decryptText(item.payload, GROUP_KEY);
        const p = document.createElement('div');
        p.className = 'msg-text';
        p.textContent = t;
        body.appendChild(p);
      } catch {
        const p = document.createElement('div');
        p.className = 'msg-text';
        p.textContent = '⚠️ ошибка расшифровки';
        body.appendChild(p);
      }
    } else if (item.type === 'image') {
      try {
        const pl = await ROCKET_Store.get(item.id);
        if (!pl) throw 0;
        const buf = await ROCKET_Crypto.decrypt(pl, GROUP_KEY);
        const url = URL.createObjectURL(new Blob([buf]));
        const img = document.createElement('img');
        img.className = 'photo'; img.src = url; img.loading = 'lazy';
        img.onclick = () => window.open(url, '_blank');
        body.appendChild(img);
      } catch {
        const d = document.createElement('div');
        d.className = 'msg-text';
        d.textContent = '⚠️ фото недоступно на этом устройстве';
        body.appendChild(d);
      }
    } else if (item.type === 'circle') {
      const holder = document.createElement('div');
      holder.className = 'circle-msg';
      const vid = document.createElement('video');
      vid.playsInline = true; vid.loop = true;
      holder.appendChild(vid);
      const badge = document.createElement('div');
      badge.className = 'circle-badge';
      badge.textContent = 'кружок';
      holder.appendChild(badge);

      holder.onclick = async () => {
        if (holder.classList.contains('playing')) {
          vid.pause();
          holder.classList.remove('playing');
          return;
        }
        if (!vid.src) {
          try {
            const pl = await ROCKET_Store.get(item.id);
            if (!pl) throw 0;
            const buf = await ROCKET_Crypto.decrypt(pl, GROUP_KEY);
            const url = URL.createObjectURL(new Blob([buf], { type:'video/webm' }));
            vid.src = url;
          } catch { return toastMsg('Кружок недоступен на устройстве', 'err'); }
        }
        vid.play();
        holder.classList.add('playing');
        ROCKET_Audit.log({
          actor: me.code, nick: me.nick, type:'view',
          action:'просмотрел кружочек', room:'#6Б/общий-чат',
        });
      };
      body.appendChild(holder);
    }

    // кто видел
    const seenRow = document.createElement('div');
    seenRow.className = 'seen-row';
    seenRow.dataset.ts = item.ts;
    body.appendChild(seenRow);
    div.appendChild(body);

    messages.appendChild(div);
    refreshSeenRow(seenRow);
  }

  function refreshSeenRow(row) {
    const ts = row.dataset.ts;
    const ids = Object.keys(seenCache[ts] || {}).filter(c => c !== me.code);
    row.innerHTML = '';

    if (!ids.length) {
      const span = document.createElement('span');
      span.style.color = 'var(--txt-3)';
      span.textContent = '👁 никто не видел';
      row.appendChild(span);
      return;
    }

    const faces = document.createElement('div');
    faces.className = 'seen-faces';
    const showAvatars = ids.slice(0, 4);
    for (const code of showAvatars) {
      const av = document.createElement('div');
      av.className = 'mini-av';
      av.textContent = (code[0] || '?').toUpperCase();
      av.title = '#' + code;
      faces.appendChild(av);
    }
    if (ids.length > 4) {
      const m = document.createElement('div');
      m.className = 'mini-av more';
      m.textContent = '+' + (ids.length - 4);
      faces.appendChild(m);
    }
    row.appendChild(faces);

    const txt = document.createElement('span');
    txt.textContent = `видели ${ids.length}`;
    row.appendChild(txt);
  }

  function scrollBottom() {
    messages.scrollTop = messages.scrollHeight;
  }

  // ═══════════ МИНИ-СПИСОК ═══════════
  async function renderMiniUsers() {
    const users = await ROCKET_Users.all();
    const approved = users.filter(u => u.status === 'approved');
    $('mini-count').textContent = approved.length;
    const box = $('mini-users');
    box.innerHTML = '';
    approved.sort((a,b) => (b.online?1:0) - (a.online?1:0) || a.nick.localeCompare(b.nick));
    for (const u of approved.slice(0, 8)) {
      const div = document.createElement('div');
      div.className = 'mini-user';
      const dot = document.createElement('span');
      dot.className = 'dot ' + (u.online ? 'on' : 'off');
      div.appendChild(dot);
      const n = document.createElement('span');
      n.className = 'mini-nick';
      n.textContent = u.nick;
      div.appendChild(n);
      if (u.isAdmin) {
        const b = document.createElement('span');
        b.className = 'mini-badge'; b.textContent = 'ADMIN';
        div.appendChild(b);
      }
      div.onclick = () => toastMsg(`#${u.code} ${u.nick}${u.online ? ' · онлайн' : ''}`);
      box.appendChild(div);
    }
    if (approved.length > 8) {
      const more = document.createElement('div');
      more.className = 'mini-user';
      more.style.justifyContent = 'center';
      more.style.color = 'var(--txt-3)';
      more.textContent = 'и ещё ' + (approved.length - 8);
      box.appendChild(more);
    }
  }

  // ═══════════ ПАНЕЛЬ УЧАСТНИКОВ ═══════════
  async function renderMembers() {
    const users = await ROCKET_Users.all();
    const approved = users.filter(u => u.status === 'approved');
    $('members-count').textContent = approved.length;

    const box = $('members-list');
    box.innerHTML = '';
    approved.sort((a,b) => (b.online?1:0) - (a.online?1:0) || a.nick.localeCompare(b.nick));

    for (const u of approved) {
      const item = document.createElement('div');
      item.className = 'member-item ' + (u.online ? 'online' : '');
      const av = document.createElement('div');
      av.className = 'avatar'; av.textContent = u.avatar;
      item.appendChild(av);
      const n = document.createElement('div');
      n.className = 'member-name';
      n.textContent = u.nick;
      item.appendChild(n);
      if (u.isAdmin) {
        const t = document.createElement('span');
        t.className = 'member-tag admin'; t.textContent = 'ADMIN';
        item.appendChild(t);
      } else if (u.online) {
        const t = document.createElement('span');
        t.className = 'member-tag'; t.textContent = 'ON';
        item.appendChild(t);
      }
      item.onclick = () => toastMsg(`#${u.code} ${u.nick}`);
      box.appendChild(item);
    }
  }

  // ═══════════ КРУЖОЧЕК ═══════════
  let mediaRecorder = null, recChunks = [], recStream = null, recTimer = null;

  $('btn-circle').onclick = async () => {
    try {
      recStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode:'user', width: 480, height: 480 },
        audio: true,
      });
      $('rec-preview').srcObject = recStream;
      $('circle-recorder').hidden = false;
      recChunks = [];
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus' : 'video/webm';
      mediaRecorder = new MediaRecorder(recStream, { mimeType: mime });
      mediaRecorder.ondataavailable = e => { if (e.data.size) recChunks.push(e.data); };
      mediaRecorder.start();
      let sec = 0;
      recTimer = setInterval(() => {
        sec++;
        const m = String(Math.floor(sec/60)).padStart(2,'0');
        const s = String(sec%60).padStart(2,'0');
        $('rec-timer').textContent = m + ':' + s;
        if (sec >= 60) stopCircle(true);
      }, 1000);
      $('rec-timer').textContent = '00:00';
    } catch (e) {
      toastMsg('Нет доступа к камере', 'err');
    }
  };
  $('rec-cancel').onclick = () => stopCircle(false);
  $('rec-send').onclick = () => stopCircle(true);

  function stopCircle(send) {
    clearInterval(recTimer);
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.onstop = async () => {
        if (send && recChunks.length) {
          const blob = new Blob(recChunks, { type: 'video/webm' });
          await sendCircle(blob);
        }
        recStream.getTracks().forEach(t => t.stop());
        $('circle-recorder').hidden = true;
        $('rec-preview').srcObject = null;
      };
      mediaRecorder.stop();
    } else {
      if (recStream) recStream.getTracks().forEach(t => t.stop());
      $('circle-recorder').hidden = true;
    }
  }

  // ═══════════ UI SETUP ═══════════
  function setupTheme() {
    const savedTheme = localStorage.getItem('rocket_theme') || 'dark';
    document.documentElement.dataset.theme = savedTheme;
    const btn = $('guild-theme');
    btn.textContent = savedTheme === 'light' ? '☀️' : '🌙';
    btn.onclick = () => {
      const cur = document.documentElement.dataset.theme;
      const next = cur === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      localStorage.setItem('rocket_theme', next);
      btn.textContent = next === 'light' ? '☀️' : '🌙';
    };
  }

  function setupJumpButton() {
    const btn = $('jump-bottom');
    messages.addEventListener('scroll', () => {
      const isDown = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 200;
      btn.style.display = isDown ? 'none' : 'flex';
    });
    btn.onclick = () => messages.scrollTo({ top: messages.scrollHeight, behavior:'smooth' });
  }

  function setupHotkeys() {
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        channelsSidebar.classList.remove('open');
        membersPanel.classList.remove('open');
        const mo = $('mobile-overlay'); if (mo) mo.classList.remove('open');
        const rec = $('circle-recorder'); if (rec && !rec.hidden) stopCircle(false);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        msgInput.focus();
      }
      if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        messages.scrollTo({ top: messages.scrollHeight, behavior:'smooth' });
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        sendText();
      }
    });
  }

  function setupSwipe() {
    const mobileOverlay = $('mobile-overlay');
    mobileOverlay.onclick = () => {
      channelsSidebar.classList.remove('open');
      membersPanel.classList.remove('open');
      mobileOverlay.classList.remove('open');
    };
    $('close-channels').onclick = () => {
      channelsSidebar.classList.remove('open');
      mobileOverlay.classList.remove('open');
    };
    $('close-members').onclick = () => {
      membersPanel.classList.remove('open');
      mobileOverlay.classList.remove('open');
    };

    if (!window.matchMedia('(max-width: 768px)').matches) return;
    let touchX = 0, touchY = 0;
    document.addEventListener('touchstart', e => {
      touchX = e.touches[0].clientX;
      touchY = e.touches[0].clientY;
    }, { passive: true });
    document.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - touchX;
      const dy = e.changedTouches[0].clientY - touchY;
      if (Math.abs(dx) < 60 || Math.abs(dy) > 50) return;
      const fromLeft = touchX < 30;
      const fromRight = touchX > window.innerWidth - 30;
      if (dx > 60 && fromLeft) {
        channelsSidebar.classList.add('open');
        mobileOverlay.classList.add('open');
      } else if (dx < -60 && fromRight) {
        membersPanel.classList.add('open');
        mobileOverlay.classList.add('open');
      } else if (dx > 60 && channelsSidebar.classList.contains('open')) {
        channelsSidebar.classList.remove('open');
        mobileOverlay.classList.remove('open');
      } else if (dx < -60 && membersPanel.classList.contains('open')) {
        membersPanel.classList.remove('open');
        mobileOverlay.classList.remove('open');
      }
    }, { passive: true });
  }

  $('toggle-side').onclick = () => {
    const isOpen = channelsSidebar.classList.toggle('open');
    membersPanel.classList.remove('open');
    $('mobile-overlay').classList.toggle('open', isOpen);
  };
  $('toggle-members').onclick = () => {
    const isOpen = membersPanel.classList.toggle('open');
    channelsSidebar.classList.remove('open');
    $('mobile-overlay').classList.toggle('open', isOpen);
  };

  // ═══════════ ВЫХОД / PANIC ═══════════
  async function doLogout() {
    if (me) {
      await ROCKET_Users.setOnline(me.code, false);
      await ROCKET_Audit.log({
        actor: me.code, nick: me.nick, type:'login',
        action:'вышел', room:'—'
      });
    }
    me = null;
    inCode.value = '';
    setMsg(loginMsg, '');
    show('login');
  }
  $('drawer-logout').onclick = doLogout;
  $('drawer-logout2') && ($('drawer-logout2').onclick = doLogout);

  async function panicWipe() {
    try {
      await ROCKET_Store.wipe();
      await ROCKET_Channel.wipe();
      await ROCKET_Seen.wipe();
      await ROCKET_Users.wipe();
      await ROCKET_Audit.wipe();
      localStorage.clear();
      sessionStorage.clear();
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch {}
    document.body.innerHTML = `<div style="display:flex;height:100vh;flex-direction:column;
      justify-content:center;align-items:center;gap:14px;background:#0a0a0f;color:#f23f43;
      font-family:sans-serif;text-align:center;padding:20px">
      <div style="font-size:64px">💣</div>
      <div style="font-size:22px;font-weight:800;letter-spacing:2px">ДАННЫЕ УНИЧТОЖЕНЫ</div>
      <div style="color:#8b8b9e;font-size:13px">Аккаунты, сообщения, фото, видео и журнал удалены</div>
    </div>`;
  }

  // ═══════════ АДМИН ═══════════
  $('admin-back').onclick = () => show('app');
  $('admin-refresh').onclick = () => { renderAdmin(); toastMsg('Обновлено', 'ok'); };
  $('guild-admin').onclick = () => { renderAdmin(); show('admin'); };

  document.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      $('tab-' + t.dataset.tab).classList.add('active');
    };
  });

  async function renderAdmin() {
    if (!isAdmin()) return show('app');
    await renderRequests();
    await renderAdminUsers();
    await renderAudit();
  }

  async function renderRequests() {
    const users = await ROCKET_Users.all();
    const pending = users.filter(u => u.status === 'pending');
    $('req-badge').textContent = pending.length;
    $('req-badge').style.display = pending.length ? 'inline-block' : 'none';
    const box = $('requests-list');
    box.innerHTML = '';
    if (!pending.length) {
      box.innerHTML = '<div style="color:var(--txt-2);text-align:center;padding:24px">Нет заявок</div>';
      return;
    }
    for (const u of pending) {
      const card = document.createElement('div');
      card.className = 'req-card';
      card.innerHTML = `
        <div class="avatar">${u.avatar}</div>
        <div class="req-info">
          <div class="req-nick">${u.nick}</div>
          <div class="req-meta">#${u.code} · ${new Date(u.createdAt).toLocaleString('ru-RU')}</div>
        </div>
        <div class="req-actions">
          <button class="req-btn ok" data-act="ok">✓</button>
          <button class="req-btn no" data-act="no">✕</button>
        </div>`;
      card.querySelector('[data-act="ok"]').onclick = async () => {
        await ROCKET_Users.update(u.code, { status:'approved' });
        await ROCKET_Audit.log({
          actor: me.code, nick: me.nick, type:'view',
          action:`подтвердил «${u.nick}» #${u.code}`, room:'—'
        });
        toastMsg(`«${u.nick}» подтверждён ✓`, 'ok');
        renderRequests();
      };
      card.querySelector('[data-act="no"]').onclick = async () => {
        if (!confirm(`Отклонить «${u.nick}»?`)) return;
        await ROCKET_Users.remove(u.code);
        await ROCKET_Audit.log({
          actor: me.code, nick: me.nick, type:'danger',
          action:`отклонил заявку «${u.nick}» #${u.code}`, room:'—'
        });
        toastMsg('Заявка отклонена', 'err');
        renderRequests();
      };
      box.appendChild(card);
    }
  }

  async function renderAdminUsers() {
    const users = await ROCKET_Users.all();
    const box = $('admin-users-list');
    box.innerHTML = '';
    for (const u of users) {
      const row = document.createElement('div');
      row.className = 'user-row';
      const badges =
        (u.isAdmin ? '<span class="badge admin">ADMIN</span>' : '') +
        (u.online ? '<span class="badge online">online</span>' : '') +
        (u.status === 'pending' ? '<span class="badge pending">⏳</span>' : '');
      row.innerHTML = `
        <div class="avatar">${u.avatar}</div>
        <div class="user-row-info">
          <div class="user-row-nick">${u.nick} ${badges}</div>
          <div class="user-row-meta">#${u.code} · создан ${new Date(u.createdAt).toLocaleDateString('ru-RU')}</div>
        </div>
        <button class="icon-btn" title="Удалить" style="color:var(--red)">🗑</button>`;
      row.querySelector('button').onclick = async () => {
        if (!confirm(`Удалить «${u.nick}»?`)) return;
        await ROCKET_Users.remove(u.code);
        await ROCKET_Audit.log({
          actor: me.code, nick: me.nick, type:'danger',
          action:`удалил пользователя «${u.nick}» #${u.code}`, room:'—'
        });
        renderAdminUsers();
      };
      box.appendChild(row);
    }
  }

  async function renderAudit() {
    const events = await ROCKET_Audit.all();
    const box = $('audit-list');
    box.innerHTML = '';
    if (!events.length) {
      box.innerHTML = '<div style="color:var(--txt-2);text-align:center;padding:24px">Пока нет событий</div>';
      return;
    }
    for (const e of events) {
      const div = document.createElement('div');
      div.className = 'audit-item type-' + (e.type || 'view');
      div.innerHTML = `
        <div class="head">
          <span class="who">${e.nick} #${e.actor}</span>
          <span class="when">${new Date(e.ts).toLocaleString('ru-RU')}</span>
        </div>
        <div class="what">${e.action}</div>
        <div class="where">📍 ${e.room}</div>`;
      box.appendChild(div);
    }
  }

  // ═══════════ ОТПРАВКА / INPUT ═══════════
  $('btn-send').onclick = sendText;
  msgInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendText();
    }
  });

  // печатает
  msgInput.addEventListener('input', () => {
    if (!me) return;
    ROCKET_Typing.set(me.code, me.nick, true);
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => ROCKET_Typing.set(me.code, me.nick, false), 2500);
  });

  $('file-input').onchange = e => {
    if (e.target.files[0]) sendFile(e.target.files[0]);
    e.target.value = '';
  };

  $('guild-add').onclick = () => {
    toastMsg('Код группы 6Б: 1919', 'ok');
  };

  // отключение онлайна при выходе
  window.addEventListener('beforeunload', () => {
    if (me) ROCKET_Users.setOnline(me.code, false);
    if (me) ROCKET_Typing.set(me.code, me.nick, false);
  });

  // ═══════════ СОЗДАНИЕ АДМИНА ═══════════
  (async () => {
    const all = await ROCKET_Users.all();
    if (!all.some(u => u.code === ADMIN_CODE)) {
      await ROCKET_Users.put({
        code: ADMIN_CODE, nick: 'Учитель',
        passHash: await ROCKET_Users.hash('admin'),
        status: 'approved', isAdmin: true,
        createdAt: Date.now(), avatar: 'У',
        online: false, lastSeen: Date.now(),
      });
      console.info('✅ Админ создан: код 2670, пароль admin');
    }
  })();
})();
