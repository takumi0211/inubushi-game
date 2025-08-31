(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

  const timeEl = document.getElementById('time');
  const bestEl = document.getElementById('best');
  const ammoEl = document.getElementById('ammo');
  const shieldLeftEl = document.getElementById('shieldLeft');
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('startBtn');

  // Simple mobile joystick
  const joystick = document.getElementById('joystick');
  const stick = document.getElementById('stick');
  const joyState = { active: false, dx: 0, dy: 0, baseX: 0, baseY: 0 };
  const fireBtn = document.getElementById('fireBtn');

  let width = 0;
  let height = 0;
  let uiScale = 1;
  let worldScale = 1;
  function resize() {
    const w = Math.floor(window.innerWidth);
    const h = Math.floor(window.innerHeight);
    width = w; height = h;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // scales
    const minDim = Math.min(width, height);
    uiScale = clamp(minDim / 800, 0.85, 1.25);
    worldScale = clamp(minDim / 900, 0.9, 1.35);
    document.documentElement.style.setProperty('--ui', uiScale.toFixed(3));
    // adjust joystick sensitivity with UI scale
    joyMax = 38 * uiScale;
    // update player scaled params
    player.r = 10 * worldScale;
    player.speed = 230 * worldScale;
  }
  window.addEventListener('resize', resize);

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

  // Game state
  const State = {
    Menu: 'menu',
    Playing: 'playing',
    GameOver: 'gameover',
  };
  let state = State.Menu;

  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
      e.preventDefault();
    }
    if (e.code === 'Space') {
      if (state !== State.Playing) startGame();
      else fireRocket();
    } else if (e.code === 'KeyR') {
      if (state === State.GameOver) startGame();
    } else if (e.code === 'KeyP') {
      togglePause();
    }
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  fireBtn?.addEventListener('click', () => { if (state === State.Playing) fireRocket(); });

  // Touch joystick
  const rectCenter = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, r };
  };
  const joyPointer = { id: null };
  let joyMax = 38;
  function setStick(dx, dy) {
    const mag = Math.hypot(dx, dy);
    const clamped = mag > joyMax ? joyMax / mag : 1;
      stick.style.transform = `translate(calc(-50% + ${dx * clamped}px), calc(-50% + ${dy * clamped}px))`;
      joyState.dx = (dx / joyMax);
      joyState.dy = (dy / joyMax);
  }
  function resetStick() {
    joyState.active = false;
    joyState.dx = 0; joyState.dy = 0;
    stick.style.transform = 'translate(-50%, -50%)';
  }
  function handleJoyStart(e) {
    const touch = (e.changedTouches || [e])[0];
    joyPointer.id = touch.identifier ?? 'mouse';
    joyState.active = true;
    const c = rectCenter(joystick);
    joyState.baseX = c.x; joyState.baseY = c.y;
    const dx = (touch.clientX - c.x);
    const dy = (touch.clientY - c.y);
    setStick(dx, dy);
  }
  function handleJoyMove(e) {
    if (!joyState.active) return;
    const touches = e.changedTouches || [e];
    for (const t of touches) {
      const id = t.identifier ?? 'mouse';
      if (id !== joyPointer.id) continue;
      const dx = t.clientX - joyState.baseX;
      const dy = t.clientY - joyState.baseY;
      setStick(dx, dy);
    }
  }
  function handleJoyEnd(e) {
    const touches = e.changedTouches || [e];
    for (const t of touches) {
      const id = t.identifier ?? 'mouse';
      if (id === joyPointer.id) { resetStick(); joyPointer.id = null; }
    }
  }
  joystick.addEventListener('pointerdown', (e) => { e.preventDefault(); handleJoyStart(e); });
  joystick.addEventListener('pointermove', (e) => { e.preventDefault(); handleJoyMove(e); });
  joystick.addEventListener('pointerup', (e) => { e.preventDefault(); handleJoyEnd(e); });
  joystick.addEventListener('pointercancel', (e) => { e.preventDefault(); handleJoyEnd(e); });
  joystick.addEventListener('touchstart', (e) => { e.preventDefault(); handleJoyStart(e); }, { passive: false });
  joystick.addEventListener('touchmove', (e) => { e.preventDefault(); handleJoyMove(e); }, { passive: false });
  joystick.addEventListener('touchend', (e) => { e.preventDefault(); handleJoyEnd(e); }, { passive: false });

  startBtn.addEventListener('click', () => startGame());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) startGame();
  });

  // Entities
  const player = {
    x: 0, y: 0, r: 10,
    speed: 230, // px/sec
    color: '#25d8ff',
  };
  // After player exists, compute initial layout/scales
  resize();

  const bullets = [];
  function chooseEnemyKind(d) {
    // Unlock gradually
    const avail = [];
    const w = [];
    // bolt always available
    avail.push('bolt'); w.push(1.0 - 0.5 * d);
    if (time > 8) { avail.push('zigzag'); w.push(0.3 + 0.6 * d); }
    if (time > 12) { avail.push('seeker'); w.push(0.2 + 0.6 * d); }
    if (time > 18) { avail.push('bouncer'); w.push(0.15 + 0.5 * d); }
    // pick by weight
    let sum = w.reduce((a,b)=>a+b,0) || 1;
    let r = Math.random() * sum;
    for (let i = 0; i < avail.length; i++) { r -= w[i]; if (r <= 0) return avail[i]; }
    return 'bolt';
  }

  function spawnBullet(t) {
    // Spawn from a random edge, aim at current player
    const d = Math.min(1, time / 90);
    const edge = Math.floor(Math.random() * 4); // 0 top,1 right,2 bottom,3 left
    let x, y;
    const margin = 8;
    if (edge === 0) { x = Math.random() * width; y = -margin; }
    else if (edge === 1) { x = width + margin; y = Math.random() * height; }
    else if (edge === 2) { x = Math.random() * width; y = height + margin; }
    else { x = -margin; y = Math.random() * height; }

    const targetX = player.x;
    const targetY = player.y;
    let dx = targetX - x;
    let dy = targetY - y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len; const uy = dy / len;

    const baseSpeed = (100 + 170 * d + Math.random() * 20) * worldScale;
    const kind = chooseEnemyKind(d);
    if (kind === 'bolt') {
      bullets.push({ kind, x, y, r: 5 * worldScale, vx: ux * baseSpeed, vy: uy * baseSpeed, color: '#3cff4e' });
    } else if (kind === 'zigzag') {
      const speed = baseSpeed * 0.95;
      const perpX = -uy; const perpY = ux;
      const amp = (18 + 22 * d) * worldScale;
      const freq = 3 + 2 * d;
      bullets.push({ kind, x, y, r: 5 * worldScale, vx: ux * speed, vy: uy * speed, px: perpX, py: perpY, amp, phase: 0, prevSin: 0, freq, color: '#00e1ff' });
    } else if (kind === 'seeker') {
      const max = (90 + 110 * d) * worldScale;      // lower top speed
      const start = max * 0.5;                      // slower initial velocity
      const accel = (120 + 100 * d) * worldScale;   // gentler steering strength
      bullets.push({ kind, x, y, r: 5 * worldScale, vx: ux * start, vy: uy * start, max, accel, color: '#ff72e0' });
    } else { // bouncer
      const speed = baseSpeed * 0.85;
      const bounces = 2 + Math.floor(3 * d);
      const ttl = 6 + 3 * d;
      bullets.push({ kind: 'bouncer', x, y, r: 6 * worldScale, vx: ux * speed, vy: uy * speed, bounces, ttl, color: '#ffd166' });
    }
  }

  // Occasional sweeping laser-like wave (rectangles crossing screen)
  const beams = [];
  function spawnBeam(t) {
    // Horizontal or vertical sweep
    const vertical = Math.random() < 0.5;
    const thickness = (10 + Math.random() * 20) * worldScale;
    const speed = (160 + Math.min(240, t * 5)) * worldScale;
    const safeGap = (120 + Math.random() * 80) * worldScale;
    if (vertical) {
      const fromLeft = Math.random() < 0.5;
      const x = fromLeft ? -thickness : width + thickness;
      beams.push({ vertical: true, x, y: 0, w: thickness, h: height, vx: fromLeft ? speed : -speed, vy: 0, gapY: clamp(player.y - safeGap/2, 40, height-40-safeGap), gapH: safeGap, color: '#ff3b3b' });
    } else {
      const fromTop = Math.random() < 0.5;
      const y = fromTop ? -thickness : height + thickness;
      beams.push({ vertical: false, x: 0, y, w: width, h: thickness, vx: 0, vy: fromTop ? speed : -speed, gapX: clamp(player.x - safeGap/2, 40, width-40-safeGap), gapW: safeGap, color: '#ff6262' });
    }
  }

  function drawBeam(b) {
    ctx.save();
    ctx.fillStyle = b.color;
    ctx.globalAlpha = 0.85;
    ctx.shadowBlur = 18;
    ctx.shadowColor = b.color;
    if (b.vertical) {
      // Draw two rects with a safe gap
      ctx.fillRect(b.x, b.y, b.w, b.gapY);
      ctx.fillRect(b.x, b.gapY + b.gapH, b.w, height - (b.gapY + b.gapH));
    } else {
      ctx.fillRect(b.x, b.y, b.gapX, b.h);
      ctx.fillRect(b.gapX + b.gapW, b.y, width - (b.gapX + b.gapW), b.h);
    }
    ctx.restore();
  }

  let spawnTimer = 0;
  let spawnInterval = 0.95; // eased start, will scale down
  let beamTimer = 0;
  let beamInterval = 5.0; // eased start
  let time = 0;
  let best = parseFloat(localStorage.getItem('dodge_highscore') || '0') || 0;
  bestEl.textContent = best.toFixed(1);
  let paused = false;

  // Power-ups and weapons
  const powerups = [];
  const rockets = [];
  const effects = [];
  let powerTimer = 0;
  let powerInterval = 7.0;
  let shieldUntil = 0; // measured in "time" seconds
  let slowUntil = 0;
  let magnetUntil = 0;
  let bazookaAmmo = 0;
  function hasShield() { return time < shieldUntil; }
  function hasSlow() { return time < slowUntil; }
  function hasMagnet() { return time < magnetUntil; }
  function enemyScale() { return hasSlow() ? 0.35 : 1; }

  function spawnPowerup() {
    const margin = 30;
    const x = clamp(Math.random() * width, margin, width - margin);
    const y = clamp(Math.random() * height, margin, height - margin);
    // 20% bomb, others distributed: shield 30%, bazooka 25%, slow 15%, magnet 10%
    const r = Math.random();
    const type = r < 0.2 ? 'bomb' : r < 0.5 ? 'shield' : r < 0.75 ? 'bazooka' : r < 0.9 ? 'slow' : 'magnet';
    powerups.push({ x, y, r: 12 * worldScale, type, ttl: 12, phase: Math.random() * Math.PI * 2 });
  }

  function collectPowerup(p) {
    if (p.type === 'shield') {
      shieldUntil = Math.max(time + 3.0, shieldUntil);
    } else if (p.type === 'bazooka') {
      bazookaAmmo += 2; // two rockets per pickup
      ammoEl.textContent = String(bazookaAmmo);
    } else if (p.type === 'slow') {
      slowUntil = Math.max(time + 3.0, slowUntil);
    } else if (p.type === 'magnet') {
      magnetUntil = Math.max(time + 10.0, magnetUntil);
    } else if (p.type === 'bomb') {
      // Full-field wipe
      const R = Math.max(width, height);
      effects.push({ kind: 'boom', x: player.x, y: player.y, ttl: 0.35, r: R });
      bullets.length = 0;
      beams.length = 0;
    }
    // pickup flash
    effects.push({ kind: 'burst', x: p.x, y: p.y, ttl: 0.25, r: 12 * worldScale });
  }

  function fireRocket() {
    if (bazookaAmmo <= 0) return;
    bazookaAmmo -= 1;
    ammoEl.textContent = String(bazookaAmmo);
    const ang = lastMoveAngle; // shoot forward
    const speed = 520 * worldScale;
    rockets.push({ x: player.x, y: player.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, r: 6 * worldScale, ttl: 1.2 });
  }

  function reset() {
    player.x = width / 2;
    player.y = height / 2;
    bullets.length = 0;
    beams.length = 0;
    powerups.length = 0;
    rockets.length = 0;
    effects.length = 0;
    spawnTimer = 0;
    beamTimer = 0;
    spawnInterval = 0.95;
    beamInterval = 5.0;
    time = 0;
    paused = false;
    powerTimer = 2.0; // first power earlier
    powerInterval = 7.0;
    shieldUntil = 0;
    slowUntil = 0;
    magnetUntil = 0;
    bazookaAmmo = 0;
    ammoEl.textContent = '0';
    shieldLeftEl.textContent = '-';
  }

  function startGame() {
    overlay.classList.remove('show');
    state = State.Playing;
    reset();
  }

  function showGameOver() {
    const s = time.toFixed(1);
    const b = best.toFixed(1);
    overlay.innerHTML = `
      <div class="panel">
        <h1>Game Over</h1>
        <p class="sub">生存時間: <strong>${s}s</strong>（ベスト: <strong>${b}s</strong>）</p>
        <button id="restartBtn">もう一度</button>
        <p style="opacity:.8;margin-top:8px;">R または スペース でも再開できます</p>
      </div>`;
    overlay.classList.add('show');
    document.getElementById('restartBtn').addEventListener('click', () => startGame());
  }

  function togglePause() {
    if (state !== State.Playing) return;
    paused = !paused;
  }

  function step(dt) {
    if (state !== State.Playing || paused) return;

    // Difficulty scaling (gentle start, ramps to ~90s)
    time += dt;
    timeEl.textContent = time.toFixed(1);
    const d = Math.min(1, time / 90);
    spawnInterval = Math.max(0.28, 1.0 - 0.6 * d);
    beamInterval = Math.max(2.4, 5.0 - 2.6 * d);

    // Input
    let ix = 0, iy = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) iy -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) iy += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
    if (joyState.active) { ix += joyState.dx; iy += joyState.dy; }
    if (ix || iy) {
      const len = Math.hypot(ix, iy) || 1;
      ix /= len; iy /= len;
      lastMoveAngle = Math.atan2(iy, ix);
      player.x = clamp(player.x + ix * player.speed * dt, player.r, width - player.r);
      player.y = clamp(player.y + iy * player.speed * dt, player.r, height - player.r);
    }

    // Spawns
    spawnTimer += dt;
    if (spawnTimer >= spawnInterval) {
      spawnTimer -= spawnInterval;
      // Burst size scales with difficulty
      const burst = (() => {
        if (d < 0.25) return 1;
        if (d < 0.6) return Math.random() < 0.35 ? 2 : 1;
        if (d < 0.85) return Math.random() < 0.55 ? 2 : 1;
        return Math.random() < 0.35 ? 3 : 2;
      })();
      for (let i = 0; i < burst; i++) spawnBullet(time);
    }
    beamTimer += dt;
    if (beamTimer >= beamInterval) {
      beamTimer = 0;
      spawnBeam(time);
    }

    // Power-up spawn
    powerTimer += dt;
    const pInt = Math.max(4.0, powerInterval - time * 0.01);
    if (powerTimer >= pInt) {
      powerTimer = 0; spawnPowerup();
    }

    // Update bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      const k = enemyScale();
      if (b.kind === 'seeker') {
        // steer towards player
        const dx = player.x - b.x, dy = player.y - b.y;
        const dlen = Math.hypot(dx, dy) || 1;
        const tx = dx / dlen, ty = dy / dlen;
        b.vx += tx * b.accel * dt * k;
        b.vy += ty * b.accel * dt * k;
        // clamp speed
        const sp = Math.hypot(b.vx, b.vy) || 1;
        const max = b.max * k;
        if (sp > max) { b.vx = (b.vx / sp) * max; b.vy = (b.vy / sp) * max; }
        b.x += b.vx * dt; b.y += b.vy * dt;
      } else if (b.kind === 'zigzag') {
        const sp = Math.hypot(b.vx, b.vy) || 1;
        const px = b.px, py = b.py; // perp unit
        const prev = b.prevSin;
        b.phase += b.freq * dt * k;
        const s = Math.sin(b.phase);
        const offset = (s - prev) * b.amp;
        b.prevSin = s;
        b.x += b.vx * dt * k + px * offset;
        b.y += b.vy * dt * k + py * offset;
      } else if (b.kind === 'bouncer') {
        b.ttl -= dt; if (b.ttl <= 0) { bullets.splice(i, 1); continue; }
        b.x += b.vx * dt * k; b.y += b.vy * dt * k;
        let bounced = false;
        if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx); bounced = true; }
        if (b.x + b.r > width) { b.x = width - b.r; b.vx = -Math.abs(b.vx); bounced = true; }
        if (b.y - b.r < 0) { b.y = b.r; b.vy = Math.abs(b.vy); bounced = true; }
        if (b.y + b.r > height) { b.y = height - b.r; b.vy = -Math.abs(b.vy); bounced = true; }
        if (bounced) { b.bounces--; if (b.bounces < 0) { bullets.splice(i, 1); continue; } }
      } else { // bolt
        b.x += b.vx * dt * k;
        b.y += b.vy * dt * k;
      }

      // Remove if out of bounds (except active bouncers handled above)
      if (b.kind !== 'bouncer' && (b.x < -30 || b.x > width + 30 || b.y < -30 || b.y > height + 30)) {
        bullets.splice(i, 1);
        continue;
      }
      // Collision with player
      if (!hasShield() && dist(b.x, b.y, player.x, player.y) < b.r + player.r) {
        endRun();
        return;
      }
    }

    // Update beams
    for (let i = beams.length - 1; i >= 0; i--) {
      const bm = beams[i];
      const k2 = enemyScale();
      bm.x += bm.vx * dt * k2;
      bm.y += bm.vy * dt * k2;
      const off = 80;
      if (bm.vertical) {
        if (bm.x < -bm.w - off || bm.x > width + bm.w + off) { beams.splice(i, 1); continue; }
        // Collision unless inside gap
        if (!hasShield() && !(player.y >= bm.gapY && player.y <= bm.gapY + bm.gapH)) {
          if (player.x + player.r > bm.x && player.x - player.r < bm.x + bm.w) {
            endRun(); return;
          }
        }
      } else {
        if (bm.y < -bm.h - off || bm.y > height + bm.h + off) { beams.splice(i, 1); continue; }
        if (!hasShield() && !(player.x >= bm.gapX && player.x <= bm.gapX + bm.gapW)) {
          if (player.y + player.r > bm.y && player.y - player.r < bm.y + bm.h) {
            endRun(); return;
          }
        }
      }
    }

    // Update powerups (float, ttl) and collect
    for (let i = powerups.length - 1; i >= 0; i--) {
      const p = powerups[i];
      p.phase += dt * 2.2;
      p.ttl -= dt;
      if (p.ttl <= 0) { powerups.splice(i, 1); continue; }
      if (hasMagnet()) {
        // stronger pull towards player
        const dx = player.x - p.x;
        const dy = player.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const pull = 300 * dt / d; // stronger magnet
        p.x += dx * pull;
        p.y += dy * pull;
      }
      const collectRadius = p.r + player.r + (hasMagnet() ? 80 : 0);
      if (dist(p.x, p.y, player.x, player.y) < collectRadius) {
        collectPowerup(p);
        powerups.splice(i, 1);
      }
    }

    // Update rockets
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.ttl -= dt;
      // Remove out of bounds
      if (r.x < -40 || r.x > width + 40 || r.y < -40 || r.y > height + 40 || r.ttl <= 0) {
        effects.push({ kind: 'boom', x: r.x, y: r.y, ttl: 0.22, r: 40 });
        rockets.splice(i, 1);
        // clear nearby bullets
        for (let j = bullets.length - 1; j >= 0; j--) {
          const b = bullets[j];
          if (dist(b.x, b.y, r.x, r.y) < 40) bullets.splice(j, 1);
        }
        continue;
      }
      // Hit beams?
      let hit = false;
      for (let k = beams.length - 1; k >= 0; k--) {
        const bm = beams[k];
        if (bm.vertical) {
          if (!(r.y >= bm.gapY && r.y <= bm.gapY + bm.gapH)) {
            if (r.x + r.r > bm.x && r.x - r.r < bm.x + bm.w) { hit = true; beams.splice(k, 1); }
          }
        } else {
          if (!(r.x >= bm.gapX && r.x <= bm.gapX + bm.gapW)) {
            if (r.y + r.r > bm.y && r.y - r.r < bm.y + bm.h) { hit = true; beams.splice(k, 1); }
          }
        }
        if (hit) break;
      }
      if (hit) {
        effects.push({ kind: 'boom', x: r.x, y: r.y, ttl: 0.22, r: 60 });
        rockets.splice(i, 1);
        // clear nearby bullets
        for (let j = bullets.length - 1; j >= 0; j--) {
          const b = bullets[j];
          if (dist(b.x, b.y, r.x, r.y) < 70) bullets.splice(j, 1);
        }
      }
    }

    // Effects ttl
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      e.ttl -= dt; if (e.ttl <= 0) effects.splice(i, 1);
    }

    // HUD updates for shield
    if (hasShield()) {
      const left = Math.max(0, shieldUntil - time);
      shieldLeftEl.textContent = left.toFixed(1) + 's';
    } else {
      shieldLeftEl.textContent = '-';
    }
  }

  function endRun() {
    state = State.GameOver;
    if (time > best) {
      best = time;
      localStorage.setItem('dodge_highscore', String(best));
      bestEl.textContent = best.toFixed(1);
    }
    showGameOver();
  }

  // --- Space opera styling additions ---
  // Starfield background
  const stars = [];
  function initStars() {
    stars.length = 0;
    const density = Math.floor((width * height) / 9000);
    for (let i = 0; i < density; i++) {
      stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        s: Math.random() * 1.4 + 0.3,
        v: Math.random() * 14 + 10,
        a: Math.random() * 0.6 + 0.4,
      });
    }
  }
  window.addEventListener('resize', initStars);
  initStars();

  let lastMoveAngle = 0; // radians

  function drawShip(x, y, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // Engine glow
    const glow = ctx.createRadialGradient(-14, 0, 2, -20, 0, 26);
    glow.addColorStop(0, 'rgba(50,220,255,0.85)');
    glow.addColorStop(0.5, 'rgba(50,220,255,0.25)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(-18, 0, 22, 0, Math.PI * 2);
    ctx.fill();

    // Hull
    ctx.fillStyle = '#cfe9ff';
    ctx.strokeStyle = '#6fbff0';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(18, 0);     // nose
    ctx.lineTo(-8, -7);    // upper body
    ctx.lineTo(-14, -3);
    ctx.lineTo(-14, 3);
    ctx.lineTo(-8, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Wings
    ctx.fillStyle = '#9dd2ff';
    ctx.strokeStyle = '#5aa6d1';
    ctx.beginPath();
    ctx.moveTo(2, -9);
    ctx.lineTo(-12, -14);
    ctx.lineTo(-4, -2);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(2, 9);
    ctx.lineTo(-12, 14);
    ctx.lineTo(-4, 2);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    // Cockpit line
    ctx.strokeStyle = '#3a6b8a';
    ctx.beginPath();
    ctx.moveTo(6, -2);
    ctx.lineTo(10, 0);
    ctx.lineTo(6, 2);
    ctx.stroke();

    ctx.restore();
  }

  function drawLaser(x, y, angle, color, len, thickness) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const w = len;
    const h = thickness;
    const r = h / 2;
    // Glow
    const grd = ctx.createLinearGradient(-w/2, 0, w/2, 0);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.5, color);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = grd;
    ctx.fillRect(-w/2 - 2, -h, w + 4, h * 2);
    ctx.globalAlpha = 1;
    // Core
    ctx.fillStyle = color;
    roundRect(-w/2, -h/2, w, h, r);
    ctx.fill();
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function render() {
    ctx.clearRect(0, 0, width, height);

    // Starfield background
    ctx.save();
    for (const s of stars) {
      ctx.globalAlpha = s.a;
      ctx.fillStyle = '#e6f1ff';
      ctx.fillRect(Math.floor(s.x), Math.floor(s.y), s.s, s.s);
    }
    ctx.restore();

    // Player starfighter
    drawShip(player.x, player.y, lastMoveAngle);

    // Shield aura (clear cyan)
    if (hasShield()) {
      const left = Math.max(0, shieldUntil - time);
      const pulse = 0.4 + 0.6 * Math.sin((left * 8) + player.x * 0.01);
      const outer = player.r + (12 * worldScale) + pulse * (3 * worldScale);
      const inner = player.r + (6 * worldScale);
      // Outer glow
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g1 = ctx.createRadialGradient(player.x, player.y, inner, player.x, player.y, outer);
      g1.addColorStop(0, 'rgba(90, 240, 255, 0.35)');
      g1.addColorStop(1, 'rgba(90, 240, 255, 0)');
      ctx.fillStyle = g1;
      ctx.beginPath(); ctx.arc(player.x, player.y, outer, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // Bright ring
      ctx.save();
      ctx.strokeStyle = '#bdf6ff';
      ctx.lineWidth = 2.5;
      ctx.shadowBlur = 10; ctx.shadowColor = '#bdf6ff';
      ctx.beginPath(); ctx.arc(player.x, player.y, inner + 3, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // Enemy lasers
    for (const b of bullets) {
      const ang = Math.atan2(b.vy, b.vx);
      drawLaser(b.x, b.y, ang, b.color || '#3cff4e', 18 + Math.min(10, Math.hypot(b.vx, b.vy) / 50), 4);
    }

    // Beams (heavy sweep)
    for (const bm of beams) drawBeam(bm);

    // Power-ups
    for (const p of powerups) {
      const bob = Math.sin(p.phase) * 2.5;
      ctx.save();
      let g;
      if (p.type === 'shield') {
        g = ctx.createRadialGradient(p.x, p.y + bob, 0, p.x, p.y + bob, p.r + 10);
        g.addColorStop(0, 'rgba(120, 220, 255, 0.95)');
        g.addColorStop(0.5, 'rgba(80, 200, 255, 0.6)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
      } else if (p.type === 'bazooka') {
        g = ctx.createRadialGradient(p.x, p.y + bob, 0, p.x, p.y + bob, p.r + 10);
        g.addColorStop(0, 'rgba(255, 200, 120, 0.95)');
        g.addColorStop(0.5, 'rgba(255, 150, 80, 0.7)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
      } else if (p.type === 'slow') {
        g = ctx.createRadialGradient(p.x, p.y + bob, 0, p.x, p.y + bob, p.r + 10);
        g.addColorStop(0, 'rgba(210, 160, 255, 0.95)');
        g.addColorStop(0.5, 'rgba(180, 110, 255, 0.6)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
      } else if (p.type === 'magnet') {
        g = ctx.createRadialGradient(p.x, p.y + bob, 0, p.x, p.y + bob, p.r + 10);
        g.addColorStop(0, 'rgba(160, 255, 160, 0.95)');
        g.addColorStop(0.5, 'rgba(120, 230, 120, 0.6)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
      } else { // bomb
        g = ctx.createRadialGradient(p.x, p.y + bob, 0, p.x, p.y + bob, p.r + 10);
        g.addColorStop(0, 'rgba(255, 120, 160, 0.95)');
        g.addColorStop(0.5, 'rgba(255, 90, 130, 0.6)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
      }
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y + bob, p.r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // Rockets
    for (const r of rockets) {
      const ang = Math.atan2(r.vy, r.vx);
      // trail
      ctx.save();
      const trail = ctx.createLinearGradient(r.x - Math.cos(ang) * 20, r.y - Math.sin(ang) * 20, r.x, r.y);
      trail.addColorStop(0, 'rgba(255,160,120,0)');
      trail.addColorStop(1, 'rgba(255,160,120,0.9)');
      ctx.fillStyle = trail;
      roundRect(r.x - Math.cos(ang) * 18, r.y - Math.sin(ang) * 18, 20, 4, 2);
      ctx.fill();
      // body
      ctx.translate(r.x, r.y); ctx.rotate(ang);
      ctx.fillStyle = '#ffd2b8';
      roundRect(-6, -3, 12, 6, 3); ctx.fill();
      ctx.restore();
    }

    // Effects
    for (const e of effects) {
      if (e.kind === 'boom' || e.kind === 'burst') {
        ctx.save();
        const life = Math.max(0, e.ttl);
        const t = (e.kind === 'boom') ? (1 - life / 0.22) : (1 - life / 0.25);
        const R = (e.kind === 'boom') ? (e.r * (0.7 + 0.6 * t)) : (e.r * (0.8 + 0.8 * t));
        const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, R);
        const col = (e.kind === 'boom') ? '255,190,150' : '120,220,255';
        g.addColorStop(0, `rgba(${col},0.9)`);
        g.addColorStop(0.6, `rgba(${col},0.35)`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(e.x, e.y, R, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }

    // HUD pause indicator
    if (state === State.Playing && paused) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#e6f1ff';
      ctx.font = 'bold 28px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED (P で再開)', width / 2, height / 2);
      ctx.restore();
    }
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    // Update stars regardless of state
    for (const s of stars) {
      s.y += s.v * dt;
      if (state === State.Playing && !paused) {
        // slight horizontal parallax based on last heading
        s.x -= Math.cos(lastMoveAngle) * 8 * dt;
      }
      if (s.y > height + 2) { s.y = -2; s.x = Math.random() * width; }
      if (s.x < -2) s.x = width + 2; else if (s.x > width + 2) s.x = -2;
    }
    step(dt);
    render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // Prepare menu content
  overlay.classList.add('show');
})();
