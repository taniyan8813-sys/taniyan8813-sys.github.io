const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const ui = {
  runState: document.getElementById("runState"),
  reset: document.getElementById("reset"),
  pause: document.getElementById("pause"),
  statHp: document.getElementById("statHp"),
  statLevel: document.getElementById("statLevel"),
  statTime: document.getElementById("statTime"),
  statXp: document.getElementById("statXp"),
  statKills: document.getElementById("statKills"),
  statThreat: document.getElementById("statThreat"),
  statDistance: document.getElementById("statDistance"),
  systemLog: document.getElementById("systemLog"),
  upgradePanel: document.getElementById("upgradePanel"),
  upgradeChoices: document.getElementById("upgradeChoices")
};

const W = canvas.width;
const H = canvas.height;
const keys = new Set();
const GOAL_TIME = 180;
const DESTINATION_DISTANCE = 1800;
const touchMove = { active: false, id: null, sx: 0, sy: 0, x: 0, y: 0 };

let paused = false;
let lastTime = performance.now();
let state = makeState();

const upgrades = [
  {
    name: "スター・ドライブ",
    text: "移動出力が上昇する。",
    apply: s => { s.player.speed += 28; }
  },
  {
    name: "リスタート・パルス",
    text: "自動攻撃の間隔を短縮する。",
    apply: s => { s.attackRate = Math.max(0.16, s.attackRate * 0.8); }
  },
  {
    name: "シグナル・カット",
    text: "弾のダメージが上昇する。",
    apply: s => { s.damage += 9; }
  },
  {
    name: "エコー分岐",
    text: "追加弾を生成する。",
    apply: s => { s.projectiles = Math.min(5, s.projectiles + 1); }
  },
  {
    name: "トレース磁場",
    text: "信号XPの回収範囲が広がる。",
    apply: s => { s.pickupRange += 30; }
  },
  {
    name: "応急修復",
    text: "体力を回復する。",
    apply: s => { s.player.hp = Math.min(s.player.maxHp, s.player.hp + 28); }
  }
];

function makeState() {
  return {
    time: 0,
    threat: 1,
    spawnCd: 0,
    attackCd: 0,
    attackRate: 0.52,
    damage: 24,
    projectiles: 1,
    pickupRange: 92,
    level: 1,
    xp: 0,
    xpNeed: 5,
    kills: 0,
    travel: 0,
    interferenceCd: 11,
    interferenceFlash: 0,
    gameOver: false,
    cleared: false,
    upgradeOpen: false,
    player: {
      x: W / 2,
      y: H / 2,
      r: 15,
      speed: 218,
      hp: 120,
      maxHp: 120,
      invuln: 0
    },
    enemies: [],
    bullets: [],
    gems: [],
    particles: [],
    fractures: makeFractures(),
    log: "信号追跡を開始。E-01への経路を固定。"
  };
}

function makeFractures() {
  return Array.from({ length: 18 }, () => ({
    x: rand(0, W),
    y: rand(0, H),
    w: rand(42, 160),
    h: rand(12, 42),
    drift: rand(0.1, 0.7),
    alpha: rand(0.08, 0.2)
  }));
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function spawnEnemy() {
  const edge = Math.floor(rand(0, 4));
  const positions = [
    { x: rand(0, W), y: -28 },
    { x: W + 28, y: rand(0, H) },
    { x: rand(0, W), y: H + 28 },
    { x: -28, y: rand(0, H) }
  ];
  const p = positions[edge];
  const roll = Math.random();
  const type = state.threat >= 3 && roll < 0.14
    ? "blocker"
    : state.threat >= 3 && roll < 0.26
      ? "static"
      : roll < 0.56
        ? "skitter"
        : "drifter";
  const stats = enemyStats(type);
  state.enemies.push({
    x: p.x,
    y: p.y,
    type,
    phase: rand(0, Math.PI * 2),
    pulse: rand(0.8, 1.4),
    r: stats.r,
    hp: stats.hp,
    maxHp: stats.hp,
    speed: stats.speed,
    damage: stats.damage,
    xp: stats.xp,
    color: stats.color
  });
}

function enemyStats(type) {
  if (type === "skitter") {
    return {
      r: 9,
      hp: 18 + state.threat * 3,
      speed: 90 + state.threat * 3,
      damage: 5,
      xp: 1,
      color: "#f0bf54"
    };
  }
  if (type === "blocker") {
    return {
      r: 21,
      hp: 88 + state.threat * 12,
      speed: 38 + state.threat * 2,
      damage: 12,
      xp: 5,
      color: "#b995ff"
    };
  }
  if (type === "static") {
    return {
      r: 14,
      hp: 38 + state.threat * 8,
      speed: 60 + state.threat * 2,
      damage: 8,
      xp: 2,
      color: "#6aa9ff"
    };
  }
  return {
    r: 13,
    hp: 34 + state.threat * 6,
    speed: 68 + state.threat * 3,
    damage: 6,
    xp: 1,
    color: "#f06f6f"
  };
}

function nearestEnemy(origin, limit = Infinity) {
  let best = null;
  let bestD = limit;
  for (const enemy of state.enemies) {
    const d = dist(origin, enemy);
    if (d < bestD) {
      best = enemy;
      bestD = d;
    }
  }
  return best;
}

function fireAt(target, offset) {
  const p = state.player;
  const angle = Math.atan2(target.y - p.y, target.x - p.x) + offset;
  state.bullets.push({
    x: p.x + Math.cos(angle) * 18,
    y: p.y + Math.sin(angle) * 18,
    vx: Math.cos(angle) * 520,
    vy: Math.sin(angle) * 520,
    r: 5,
    damage: state.damage,
    life: 1.35
  });
}

function autoAttack() {
  const target = nearestEnemy(state.player, 360);
  if (!target) return;
  const count = state.projectiles;
  const spread = count === 1 ? 0 : 0.18;
  const start = -((count - 1) * spread) / 2;
  for (let i = 0; i < count; i += 1) {
    fireAt(target, start + i * spread);
  }
}

function gainXp(amount) {
  state.xp += amount;
  while (state.xp >= state.xpNeed) {
    state.xp -= state.xpNeed;
    state.level += 1;
    state.xpNeed = Math.floor(state.xpNeed * 1.32 + 3);
    openUpgrade();
  }
}

function openUpgrade() {
  paused = true;
  state.upgradeOpen = true;
  state.log = "未登録の成長反応を検出。候補を選択してください。";
  ui.pause.textContent = "再開";
  ui.upgradeChoices.innerHTML = "";
  const choices = [...upgrades].sort(() => Math.random() - 0.5).slice(0, 3);
  for (const upgrade of choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<strong>${upgrade.name}</strong><span>${upgrade.text}</span>`;
    button.addEventListener("click", () => {
      upgrade.apply(state);
      state.upgradeOpen = false;
      paused = false;
      state.log = `${upgrade.name}：適用完了。`;
      ui.pause.textContent = "一時停止";
      ui.upgradePanel.hidden = true;
    });
    ui.upgradeChoices.append(button);
  }
  ui.upgradePanel.hidden = false;
}

function movePlayer(dt) {
  const move = { x: 0, y: 0 };
  if (keys.has("ArrowLeft") || keys.has("KeyA")) move.x -= 1;
  if (keys.has("ArrowRight") || keys.has("KeyD")) move.x += 1;
  if (keys.has("ArrowUp") || keys.has("KeyW")) move.y -= 1;
  if (keys.has("ArrowDown") || keys.has("KeyS")) move.y += 1;
  if (touchMove.active) {
    const dx = touchMove.x - touchMove.sx;
    const dy = touchMove.y - touchMove.sy;
    const len = Math.hypot(dx, dy);
    if (len > 8) {
      move.x += dx / Math.max(36, len);
      move.y += dy / Math.max(36, len);
    }
  }
  applyMove(move, dt);
}

function applyMove(move, dt) {
  const p = state.player;
  const len = Math.hypot(move.x, move.y) || 1;
  const dx = (move.x / len) * p.speed * dt;
  const dy = (move.y / len) * p.speed * dt;
  p.x = clamp(p.x + dx, p.r, W - p.r);
  p.y = clamp(p.y + dy, p.r, H - p.r);

  if (dx > 0 && p.x > W * 0.58) {
    const scroll = Math.min(dx, p.x - W * 0.58);
    p.x -= scroll;
    state.travel = Math.min(DESTINATION_DISTANCE, state.travel + scroll);
    scrollWorld(scroll);
  }
}

function movementVectorFromCode(code) {
  const move = { x: 0, y: 0 };
  if (code === "ArrowLeft" || code === "KeyA") move.x = -1;
  if (code === "ArrowRight" || code === "KeyD") move.x = 1;
  if (code === "ArrowUp" || code === "KeyW") move.y = -1;
  if (code === "ArrowDown" || code === "KeyS") move.y = 1;
  return move;
}

function scrollWorld(amount) {
  for (const enemy of state.enemies) enemy.x -= amount;
  for (const bullet of state.bullets) bullet.x -= amount;
  for (const gem of state.gems) gem.x -= amount;
  for (const particle of state.particles) particle.x -= amount;
  for (const fracture of state.fractures) {
    fracture.x -= amount * fracture.drift;
    if (fracture.x + fracture.w < -20) {
      fracture.x = W + rand(20, 180);
      fracture.y = rand(0, H);
      fracture.w = rand(42, 160);
      fracture.h = rand(12, 42);
    }
  }
}

function update(dt) {
  state.time += dt;
  state.threat = 1 + Math.floor(state.time / 22) + Math.floor((state.travel / DESTINATION_DISTANCE) * 3);
  state.spawnCd -= dt;
  state.attackCd -= dt;
  state.interferenceCd -= dt;
  state.interferenceFlash = Math.max(0, state.interferenceFlash - dt);
  state.player.invuln = Math.max(0, state.player.invuln - dt);

  if (state.interferenceCd <= 0 && !state.upgradeOpen) {
    runSignalInterference();
    state.interferenceCd = rand(10, 16);
  }

  const spawnInterval = Math.max(0.11, 0.72 - state.threat * 0.055);
  while (state.spawnCd <= 0) {
    spawnEnemy();
    state.spawnCd += spawnInterval;
  }

  movePlayer(dt);

  if (state.attackCd <= 0) {
    autoAttack();
    state.attackCd = state.attackRate;
  }

  for (const enemy of state.enemies) {
    const angle = Math.atan2(state.player.y - enemy.y, state.player.x - enemy.x);
    const wobble = enemy.type === "static" ? Math.sin(state.time * 4.2 + enemy.phase) * 0.75 : 0;
    const rush = enemy.type === "skitter" && Math.sin(state.time * 4.6 + enemy.phase) > 0.72 ? 1.32 : 1;
    enemy.x += (Math.cos(angle) * enemy.speed * rush + Math.cos(angle + Math.PI / 2) * enemy.speed * wobble) * dt;
    enemy.y += (Math.sin(angle) * enemy.speed * rush + Math.sin(angle + Math.PI / 2) * enemy.speed * wobble) * dt;
    if (dist(enemy, state.player) < enemy.r + state.player.r && state.player.invuln <= 0) {
      state.player.hp -= enemy.damage;
      state.player.invuln = 0.75;
      enemy.dead = true;
      addBurst(enemy.x, enemy.y, "#f06f6f", 10);
      if (state.player.hp <= 0) {
        state.player.hp = 0;
        state.gameOver = true;
        state.log = "観測中断。記録データが欠損しました。";
        paused = true;
      }
    }
  }

  for (const bullet of state.bullets) {
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.life -= dt;
    for (const enemy of state.enemies) {
      if (!enemy.dead && dist(bullet, enemy) < bullet.r + enemy.r) {
        enemy.hp -= bullet.damage;
        bullet.dead = true;
        addBurst(bullet.x, bullet.y, "#72d98a", 3);
        if (enemy.hp <= 0) {
          enemy.dead = true;
          state.kills += 1;
          dropGem(enemy.x, enemy.y, enemy.xp);
          addBurst(enemy.x, enemy.y, enemy.color, 12);
        }
        break;
      }
    }
  }

  for (const gem of state.gems) {
    const d = dist(gem, state.player);
    if (d < state.pickupRange) {
      const angle = Math.atan2(state.player.y - gem.y, state.player.x - gem.x);
      const pull = 260 + (state.pickupRange - d) * 4;
      gem.x += Math.cos(angle) * pull * dt;
      gem.y += Math.sin(angle) * pull * dt;
    }
    if (d < gem.r + state.player.r) {
      gem.dead = true;
      gainXp(gem.value);
      addBurst(gem.x, gem.y, "#6aa9ff", 5);
    }
  }

  for (const particle of state.particles) {
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.life -= dt;
  }

  if (state.travel >= DESTINATION_DISTANCE || state.time >= GOAL_TIME) {
    state.cleared = true;
    state.log = state.travel >= DESTINATION_DISTANCE
      ? "信号接続。経路記録を保存しました。"
      : "生存記録完了。観測データを保存しました。";
    paused = true;
  }

  state.enemies = state.enemies.filter(enemy => !enemy.dead);
  state.bullets = state.bullets.filter(b => !b.dead && b.life > 0 && b.x > -50 && b.x < W + 50 && b.y > -50 && b.y < H + 50);
  state.gems = state.gems.filter(gem => !gem.dead);
  state.particles = state.particles.filter(p => p.life > 0);
}

function runSignalInterference() {
  const reach = state.travel / DESTINATION_DISTANCE;
  const messages = reach > 0.55
    ? [
        "信号妨害を検出。経路はまだ維持されています。",
        "未識別ユニットの反応が上昇しています。",
        "音声トレースが劣化。移動を継続してください。"
      ]
    : [
        "信号ノイズが上昇しています。",
        "不明なバリア反応を検出しました。",
        "トレース線が揺らぎました。経路は維持されています。"
      ];
  state.log = messages[Math.floor(rand(0, messages.length))];
  state.interferenceFlash = 0.65;
}

function dropGem(x, y, value) {
  state.gems.push({
    x,
    y,
    value,
    r: value > 1 ? 7 : 5,
    drift: rand(0, Math.PI * 2)
  });
}

function addBurst(x, y, color, count) {
  for (let i = 0; i < count; i += 1) {
    const angle = rand(0, Math.PI * 2);
    const speed = rand(36, 150);
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: rand(1.5, 3.5),
      color,
      life: rand(0.18, 0.52)
    });
  }
}

function drawGrid() {
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  const shift = (state.time * 12 - state.travel) % 48;
  for (let x = -48; x <= W + 48; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x + shift, 0);
    ctx.lineTo(x + shift, H);
    ctx.stroke();
  }
  for (let y = -48; y <= H + 48; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y + shift);
    ctx.lineTo(W, y + shift);
    ctx.stroke();
  }
}

function drawWorldLayer() {
  const roadShift = (state.travel * 0.55) % 160;
  ctx.fillStyle = "#11151a";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "rgba(255,241,210,0.035)";
  for (let x = -160; x < W + 160; x += 160) {
    ctx.fillRect(x - roadShift, H * 0.45, 86, 18);
    ctx.fillRect(x - roadShift + 26, H * 0.68, 118, 12);
  }

  ctx.strokeStyle = "rgba(255,157,63,0.16)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 5; i += 1) {
    const y = H * (0.18 + i * 0.16);
    ctx.beginPath();
    ctx.moveTo(0, y + Math.sin(state.time + i) * 5);
    ctx.lineTo(W, y + Math.cos(state.time * 0.8 + i) * 5);
    ctx.stroke();
  }

  for (const fracture of state.fractures) {
    ctx.fillStyle = `rgba(255,157,63,${fracture.alpha})`;
    ctx.fillRect(fracture.x, fracture.y, fracture.w, 2);
    ctx.fillStyle = `rgba(106,169,255,${fracture.alpha * 0.7})`;
    ctx.fillRect(fracture.x + 8, fracture.y + 7, fracture.w * 0.58, 2);
    ctx.strokeStyle = `rgba(255,255,255,${fracture.alpha * 0.5})`;
    ctx.strokeRect(fracture.x, fracture.y, fracture.w, fracture.h);
  }

  const scanY = (state.time * 80) % H;
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fillRect(0, scanY, W, 2);
}

function drawCircle(entity, fill, stroke) {
  ctx.beginPath();
  ctx.arc(entity.x, entity.y, entity.r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawEnemy(enemy) {
  if (enemy.type === "blocker") {
    drawCircle({ x: enemy.x, y: enemy.y, r: enemy.r + 8 }, "rgba(185,149,255,0.12)");
  }
  if (enemy.type === "static") {
    ctx.strokeStyle = "rgba(106,169,255,0.32)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, enemy.r + 10 + Math.sin(state.time * 8 + enemy.phase) * 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  drawCircle(enemy, enemy.color, "rgba(255,255,255,0.35)");
  if (enemy.type === "skitter") {
    ctx.fillStyle = "rgba(255,241,210,0.65)";
    ctx.fillRect(enemy.x - 3, enemy.y - 3, 6, 6);
  }
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(enemy.x - 15, enemy.y - enemy.r - 11, 30, 4);
  ctx.fillStyle = "#72d98a";
  ctx.fillRect(enemy.x - 15, enemy.y - enemy.r - 11, 30 * clamp(enemy.hp / enemy.maxHp, 0, 1), 4);
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  drawWorldLayer();
  drawGrid();

  drawDestinationMarker();

  for (const gem of state.gems) drawCircle(gem, "#6aa9ff", "rgba(210,232,255,0.6)");
  for (const enemy of state.enemies) drawEnemy(enemy);
  for (const bullet of state.bullets) drawCircle(bullet, "#72d98a");
  for (const particle of state.particles) drawCircle(particle, particle.color);

  const p = state.player;
  drawCircle({ x: p.x, y: p.y, r: state.pickupRange }, "rgba(106,169,255,0.08)");
  drawAkari(p);
  drawTouchStick();

  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(24, 24, W - 48, 8);
  ctx.fillStyle = "#72d98a";
  ctx.fillRect(24, 24, (W - 48) * clamp(state.travel / DESTINATION_DISTANCE, 0, 1), 8);

  if (state.gameOver || state.cleared) {
    ctx.fillStyle = "rgba(0,0,0,0.66)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#eff4f1";
    ctx.textAlign = "center";
    ctx.font = "700 44px Segoe UI, sans-serif";
    ctx.fillText(state.cleared ? "信号接続" : "観測中断", W / 2, H / 2 - 12);
    ctx.font = "20px Segoe UI, sans-serif";
    ctx.fillText(`突破数 ${state.kills}`, W / 2, H / 2 + 30);
    ctx.textAlign = "start";
  }

  if (state.interferenceFlash > 0) {
    ctx.fillStyle = `rgba(255,157,63,${state.interferenceFlash * 0.12})`;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = `rgba(106,169,255,${state.interferenceFlash * 0.42})`;
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i += 1) {
      const y = H * (0.28 + i * 0.18) + Math.sin(state.time * 20 + i) * 12;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y + Math.cos(state.time * 18 + i) * 8);
      ctx.stroke();
    }
  }
}

function drawAkari(p) {
  const body = p.invuln > 0 ? "#fff1d2" : "#ff9d3f";
  drawCircle({ x: p.x, y: p.y, r: p.r + 5 }, "rgba(255,157,63,0.18)");
  drawCircle(p, body, "#fff1d2");
  ctx.fillStyle = "#f0bf54";
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - p.r - 12);
  ctx.lineTo(p.x + 5, p.y - p.r - 2);
  ctx.lineTo(p.x + 16, p.y - p.r - 1);
  ctx.lineTo(p.x + 8, p.y + p.r * 0.18);
  ctx.lineTo(p.x + 11, p.y + p.r + 12);
  ctx.lineTo(p.x, p.y + p.r + 5);
  ctx.lineTo(p.x - 11, p.y + p.r + 12);
  ctx.lineTo(p.x - 8, p.y + p.r * 0.18);
  ctx.lineTo(p.x - 16, p.y - p.r - 1);
  ctx.lineTo(p.x - 5, p.y - p.r - 2);
  ctx.closePath();
  ctx.fill();
}

function drawTouchStick() {
  if (!touchMove.active) return;
  ctx.save();
  ctx.strokeStyle = "rgba(255,241,210,0.38)";
  ctx.fillStyle = "rgba(255,157,63,0.16)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(touchMove.sx, touchMove.sy, 38, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255,157,63,0.5)";
  const dx = touchMove.x - touchMove.sx;
  const dy = touchMove.y - touchMove.sy;
  const len = Math.hypot(dx, dy) || 1;
  const knobX = touchMove.sx + (dx / len) * Math.min(30, len);
  const knobY = touchMove.sy + (dy / len) * Math.min(30, len);
  ctx.beginPath();
  ctx.arc(knobX, knobY, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawDestinationMarker() {
  const remaining = DESTINATION_DISTANCE - state.travel;
  ctx.save();
  if (remaining < W - 120) {
    const x = W - remaining;
    ctx.fillStyle = "rgba(240,191,84,0.13)";
    ctx.fillRect(x, 0, W - x, H);
    ctx.strokeStyle = "#f0bf54";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    ctx.fillStyle = "#f0bf54";
    ctx.font = "700 18px Segoe UI, sans-serif";
    ctx.fillText("到達点", clamp(x + 16, 24, W - 160), 58);
  } else {
    ctx.fillStyle = "rgba(240,191,84,0.16)";
    ctx.beginPath();
    ctx.moveTo(W - 52, H / 2);
    ctx.lineTo(W - 82, H / 2 - 18);
    ctx.lineTo(W - 82, H / 2 + 18);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function updateUi() {
  ui.statHp.textContent = Math.ceil(state.player.hp);
  ui.statLevel.textContent = state.level;
  ui.statTime.textContent = Math.floor(state.time);
  ui.statXp.textContent = `${state.xp}/${state.xpNeed}`;
  ui.statKills.textContent = state.kills;
  ui.statThreat.textContent = state.threat;
  ui.statDistance.textContent = `${Math.floor((state.travel / DESTINATION_DISTANCE) * 100)}%`;

  if (state.gameOver) ui.runState.textContent = "観測中断";
  else if (state.cleared) ui.runState.textContent = "接続完了";
  else if (state.upgradeOpen) ui.runState.textContent = "信号を選択";
  else ui.runState.textContent = paused ? "一時停止中" : "ヒカリへ向かう";
  ui.systemLog.textContent = state.log;
}

function loop(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;
  if (!paused && !state.gameOver && !state.cleared) update(dt);
  draw();
  updateUi();
  setTimeout(() => loop(performance.now()), 1000 / 60);
}

window.addEventListener("keydown", event => {
  keys.add(event.code);
  if (event.code === "Space" && !state.upgradeOpen && !state.gameOver && !state.cleared) {
    paused = !paused;
    ui.pause.textContent = paused ? "再開" : "一時停止";
  }
  const move = movementVectorFromCode(event.code);
  if (!paused && !state.gameOver && !state.cleared && (move.x || move.y)) {
    applyMove(move, 0.08);
  }
});

window.addEventListener("keyup", event => {
  keys.delete(event.code);
});

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (W / rect.width),
    y: (event.clientY - rect.top) * (H / rect.height)
  };
}

canvas.addEventListener("pointerdown", event => {
  const p = canvasPoint(event);
  touchMove.active = true;
  touchMove.id = event.pointerId;
  touchMove.sx = p.x;
  touchMove.sy = p.y;
  touchMove.x = p.x;
  touchMove.y = p.y;
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", event => {
  if (!touchMove.active || event.pointerId !== touchMove.id) return;
  const p = canvasPoint(event);
  touchMove.x = p.x;
  touchMove.y = p.y;
});

canvas.addEventListener("pointerup", event => {
  if (event.pointerId !== touchMove.id) return;
  touchMove.active = false;
  touchMove.id = null;
  canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener("pointercancel", () => {
  touchMove.active = false;
  touchMove.id = null;
});

ui.reset.addEventListener("click", () => {
  state = makeState();
  paused = false;
  touchMove.active = false;
  ui.pause.textContent = "一時停止";
  ui.upgradePanel.hidden = true;
});

ui.pause.addEventListener("click", () => {
  if (state.gameOver || state.cleared || state.upgradeOpen) return;
  paused = !paused;
  ui.pause.textContent = paused ? "再開" : "一時停止";
});

loop(performance.now());
