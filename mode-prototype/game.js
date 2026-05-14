const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const ui = {
  runState: document.getElementById("runState"),
  reset: document.getElementById("reset"),
  pause: document.getElementById("pause"),
  statHp: document.getElementById("statHp"),
  statWave: document.getElementById("statWave"),
  statTime: document.getElementById("statTime"),
  statXp: document.getElementById("statXp"),
  statPower: document.getElementById("statPower"),
  statScore: document.getElementById("statScore"),
  systemLog: document.getElementById("systemLog"),
  upgradePanel: document.getElementById("upgradePanel"),
  upgradeChoices: document.getElementById("upgradeChoices")
};

const W = canvas.width;
const H = canvas.height;
const BASE = { x: W / 2, y: H - 104, r: 30 };
const HOLD_LINE_Y = H - 56;
const pointer = { x: W / 2, y: 150, down: false };

let paused = false;
let lastTime = performance.now();
let state = makeState();

const upgrades = [
  {
    id: "rate",
    name: "高速射撃",
    text: "グリッチカービンの射撃間隔を短縮する。",
    apply: s => { s.fireRate = Math.max(0.14, s.fireRate * 0.78); }
  },
  {
    id: "damage",
    name: "グリッチ弾",
    text: "デジタル崩壊ダメージを上昇させる。",
    apply: s => { s.damage += 8; }
  },
  {
    id: "spread",
    name: "弾道補正",
    text: "EAEが角度補正射撃を追加する。",
    apply: s => { s.spread = Math.min(4, s.spread + 1); }
  },
  {
    id: "repair",
    name: "バリア修復",
    text: "観測バリアを回復する。",
    apply: s => { s.hp = Math.min(s.maxHp, s.hp + 28); }
  },
  {
    id: "slow",
    name: "ノイズ固定",
    text: "敵性データの移動を少し抑制する。",
    apply: s => { s.slow = Math.min(0.45, s.slow + 0.09); }
  }
];

function makeState() {
  return {
    hp: 100,
    maxHp: 100,
    wave: 1,
    waveTime: 0,
    waveLength: 32,
    spawnCd: 0.4,
    time: 0,
    score: 0,
    xp: 0,
    xpNeed: 8,
    level: 1,
    fireCd: 0,
    fireRate: 0.42,
    damage: 24,
    spread: 0,
    slow: 0,
    restore: 23.7,
    noise: 78,
    interventionCd: 8,
    interventionFlash: 0,
    eaeBoost: 0,
    bullets: [],
    enemies: [],
    particles: [],
    fragments: makeFragments(),
    log: "EAE支援を開始。観測セクター404を防衛してください。",
    upgradeOpen: false,
    gameOver: false,
    cleared: false
  };
}

function makeFragments() {
  return Array.from({ length: 16 }, () => ({
    x: rand(0, W),
    y: rand(0, H),
    w: rand(28, 120),
    alpha: rand(0.08, 0.24)
  }));
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function spawnEnemy() {
  const sideRoll = Math.random();
  let x;
  let y;
  if (sideRoll < 0.62) {
    x = rand(40, W - 40);
    y = -30;
  } else if (sideRoll < 0.81) {
    x = -30;
    y = rand(70, H * 0.55);
  } else {
    x = W + 30;
    y = rand(70, H * 0.55);
  }

  const bruiser = state.wave >= 3 && Math.random() < 0.18;
  state.enemies.push({
    x,
    y,
    r: bruiser ? 18 : rand(10, 14),
    hp: bruiser ? 76 + state.wave * 9 : 28 + state.wave * 7,
    maxHp: bruiser ? 76 + state.wave * 9 : 28 + state.wave * 7,
    speed: bruiser ? 34 + state.wave * 2 : rand(50, 70) + state.wave * 3,
    damage: bruiser ? 14 : 8,
    xp: bruiser ? 3 : 1,
    color: bruiser ? "#b995ff" : "#f06f6f"
  });
}

function aimAngle() {
  return Math.atan2(pointer.y - BASE.y, pointer.x - BASE.x);
}

function fireShot(angleOffset = 0) {
  const angle = aimAngle() + angleOffset;
  state.bullets.push({
    x: BASE.x + Math.cos(angle) * 34,
    y: BASE.y + Math.sin(angle) * 34,
    vx: Math.cos(angle) * 560,
    vy: Math.sin(angle) * 560,
    r: 5,
    damage: state.damage,
    life: 1.25
  });
}

function autoAimIfIdle() {
  if (pointer.down) return;
  let best = null;
  let bestD = Infinity;
  for (const enemy of state.enemies) {
    const d = dist(BASE, enemy);
    if (d < bestD) {
      best = enemy;
      bestD = d;
    }
  }
  if (best) {
    pointer.x = best.x;
    pointer.y = best.y;
  }
}

function shoot() {
  autoAimIfIdle();
  fireShot(0);
  for (let i = 1; i <= state.spread; i += 1) {
    const offset = i * 0.12;
    fireShot(offset);
    fireShot(-offset);
  }
}

function gainXp(amount) {
  state.xp += amount;
  while (state.xp >= state.xpNeed) {
    state.xp -= state.xpNeed;
    state.level += 1;
    state.xpNeed = Math.floor(state.xpNeed * 1.35 + 3);
    openUpgrade();
  }
}

function openUpgrade() {
  paused = true;
  state.upgradeOpen = true;
  state.log = "リコード候補を検出。適用する補正を選択してください。";
  ui.pause.textContent = "再開";
  ui.upgradeChoices.innerHTML = "";

  const shuffled = [...upgrades].sort(() => Math.random() - 0.5).slice(0, 3);
  for (const upgrade of shuffled) {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<strong>${upgrade.name}</strong><span>${upgrade.text}</span>`;
    button.addEventListener("click", () => {
      upgrade.apply(state);
      state.restore = Math.min(99.9, state.restore + 4.6);
      state.noise = Math.max(12, state.noise - 3);
      state.log = `${upgrade.name}：適用完了。`;
      state.upgradeOpen = false;
      paused = false;
      ui.pause.textContent = "一時停止";
      ui.upgradePanel.hidden = true;
    });
    ui.upgradeChoices.append(button);
  }
  ui.upgradePanel.hidden = false;
}

function completeWave() {
  state.wave += 1;
  state.waveTime = 0;
  state.waveLength = Math.min(50, state.waveLength + 5);
  state.spawnCd = 1;
  state.hp = Math.min(state.maxHp, state.hp + 10);
  state.restore = Math.min(99.9, state.restore + 2.8);
  state.noise = Math.max(8, state.noise - 2);
  state.log = "シーケンス完了。観測データを保存しました。";
  if (state.wave > 5) {
    state.cleared = true;
    state.log = "リコードシーケンス完了。";
    paused = true;
  }
}

function update(dt) {
  state.time += dt;
  state.waveTime += dt;
  state.spawnCd -= dt;
  state.fireCd -= dt;
  state.interventionCd -= dt;
  state.interventionFlash = Math.max(0, state.interventionFlash - dt);
  state.eaeBoost = Math.max(0, state.eaeBoost - dt);

  if (state.interventionCd <= 0 && !state.upgradeOpen) {
    runEaeIntervention();
    state.interventionCd = rand(9, 15);
  }

  if (state.spawnCd <= 0) {
    spawnEnemy();
    state.spawnCd = Math.max(0.18, 0.92 - state.wave * 0.08);
  }

  if (state.fireCd <= 0) {
    shoot();
    state.fireCd = state.eaeBoost > 0 ? state.fireRate * 0.72 : state.fireRate;
  }

  if (state.waveTime >= state.waveLength) {
    completeWave();
  }

  for (const enemy of state.enemies) {
    const angle = Math.atan2(BASE.y - enemy.y, BASE.x - enemy.x);
    const speed = enemy.speed * (1 - state.slow);
    enemy.x += Math.cos(angle) * speed * dt;
    enemy.y += Math.sin(angle) * speed * dt;

    if (enemy.y > HOLD_LINE_Y || dist(enemy, BASE) < enemy.r + BASE.r) {
      enemy.dead = true;
      state.hp -= enemy.damage;
      addBurst(enemy.x, enemy.y, "#f06f6f", 8);
      if (state.hp <= 0) {
        state.hp = 0;
        state.gameOver = true;
        state.log = "観測中断。バリアが消失しました。";
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
        addBurst(bullet.x, bullet.y, "#f1c04f", 3);
        if (enemy.hp <= 0) {
          enemy.dead = true;
          state.score += enemy.xp * 10;
          gainXp(enemy.xp);
          addBurst(enemy.x, enemy.y, enemy.color, 12);
        }
        break;
      }
    }
  }

  for (const particle of state.particles) {
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.life -= dt;
  }

  state.enemies = state.enemies.filter(enemy => !enemy.dead);
  state.bullets = state.bullets.filter(bullet => !bullet.dead && bullet.life > 0 && bullet.x > -40 && bullet.x < W + 40 && bullet.y > -60 && bullet.y < H + 40);
  state.particles = state.particles.filter(particle => particle.life > 0);
}

function runEaeIntervention() {
  const messages = state.restore > 40
    ? [
        "EAE：記憶ノイズは問題ありません。",
        "EAE：敵性データを確認しました。",
        "EAE：防衛プロトコルを継続してください。"
      ]
    : [
        "EAE：バリアは維持されています。",
        "EAE：照準経路を補正しました。",
        "EAE：観測状態は安定しています。"
      ];
  state.log = messages[Math.floor(rand(0, messages.length))];
  state.interventionFlash = 0.7;
  state.eaeBoost = 3.2;
}

function addBurst(x, y, color, count) {
  for (let i = 0; i < count; i += 1) {
    const angle = rand(0, Math.PI * 2);
    const speed = rand(40, 160);
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: rand(1.5, 3.5),
      color,
      life: rand(0.18, 0.48)
    });
  }
}

function drawGrid() {
  ctx.strokeStyle = "rgba(255,255,255,0.055)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
}

function drawSectorLayer() {
  ctx.fillStyle = "#0d0f14";
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(185,149,255,0.13)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 7; i += 1) {
    const y = H * (0.12 + i * 0.12);
    ctx.beginPath();
    ctx.moveTo(0, y + Math.sin(state.time * 1.3 + i) * 6);
    ctx.lineTo(W, y + Math.cos(state.time + i) * 6);
    ctx.stroke();
  }

  for (const fragment of state.fragments) {
    const flicker = fragment.alpha + Math.sin(state.time * 5 + fragment.x) * 0.03;
    ctx.fillStyle = `rgba(185,149,255,${Math.max(0.03, flicker)})`;
    ctx.fillRect(fragment.x, fragment.y, fragment.w, 2);
    ctx.fillStyle = `rgba(104,169,255,${Math.max(0.02, flicker * 0.6)})`;
    ctx.fillRect(fragment.x + 8, fragment.y + 8, fragment.w * 0.5, 2);
  }

  const scanY = (state.time * 64) % H;
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
  drawCircle(enemy, enemy.color, "rgba(255,255,255,0.42)");
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(enemy.x - 17, enemy.y - enemy.r - 12, 34, 5);
  ctx.fillStyle = "#68d38d";
  ctx.fillRect(enemy.x - 17, enemy.y - enemy.r - 12, 34 * clamp(enemy.hp / enemy.maxHp, 0, 1), 5);
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  drawSectorLayer();
  drawGrid();

  ctx.fillStyle = "rgba(240,111,111,0.12)";
  ctx.fillRect(0, HOLD_LINE_Y, W, H - HOLD_LINE_Y);
  ctx.strokeStyle = "rgba(240,111,111,0.72)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, HOLD_LINE_Y);
  ctx.lineTo(W, HOLD_LINE_Y);
  ctx.stroke();

  ctx.strokeStyle = "rgba(104,169,255,0.28)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(BASE.x, BASE.y);
  ctx.lineTo(pointer.x, pointer.y);
  ctx.stroke();

  drawCircle({ ...BASE, r: 44 }, "rgba(104,169,255,0.13)");
  drawGlitchBase();
  drawEaeUnit();

  for (const enemy of state.enemies) drawEnemy(enemy);
  for (const bullet of state.bullets) drawCircle(bullet, "#f1c04f");
  for (const particle of state.particles) drawCircle(particle, particle.color);

  const progress = clamp(state.waveTime / state.waveLength, 0, 1);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(24, 24, W - 48, 8);
  ctx.fillStyle = "#f1c04f";
  ctx.fillRect(24, 24, (W - 48) * progress, 8);

  if (state.gameOver || state.cleared) {
    ctx.fillStyle = "rgba(0,0,0,0.66)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#eef3f0";
    ctx.textAlign = "center";
    ctx.font = "700 44px Segoe UI, sans-serif";
    ctx.fillText(state.cleared ? "リコード完了" : "観測中断", W / 2, H / 2 - 12);
    ctx.font = "20px Segoe UI, sans-serif";
    ctx.fillText(`記録値 ${state.score}`, W / 2, H / 2 + 30);
    ctx.textAlign = "start";
  }

  if (state.interventionFlash > 0) {
    ctx.fillStyle = `rgba(185,149,255,${state.interventionFlash * 0.16})`;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = `rgba(185,149,255,${state.interventionFlash * 0.45})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, H * 0.24);
    ctx.lineTo(W, H * 0.24 + Math.sin(state.time * 18) * 10);
    ctx.stroke();
  }
}

function drawGlitchBase() {
  drawCircle(BASE, "#b995ff", "#efe4ff");
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  ctx.fillRect(BASE.x - 15, BASE.y - 20, 30, 40);
  ctx.fillStyle = "#efe4ff";
  ctx.fillRect(BASE.x - 9, BASE.y - 15, 6, 30);
  ctx.fillStyle = "#68a9ff";
  ctx.fillRect(BASE.x + 4, BASE.y - 8, 9, 16);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "700 11px Consolas, monospace";
  ctx.fillText("404", BASE.x - 11, BASE.y + 4);
}

function drawEaeUnit() {
  const x = BASE.x + 68 + Math.sin(state.time * 2.2) * 8;
  const y = BASE.y - 52 + Math.cos(state.time * 2.1) * 7;
  drawCircle({ x, y, r: 15 }, "#1d1328", "#b995ff");
  drawCircle({ x, y, r: 6 }, "#b995ff", "#efe4ff");
  ctx.strokeStyle = "rgba(185,149,255,0.35)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i += 1) {
    const a = i * Math.PI / 3 + state.time;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * 17, y + Math.sin(a) * 17);
    ctx.lineTo(x + Math.cos(a) * 25, y + Math.sin(a) * 25);
    ctx.stroke();
  }
}

function updateUi() {
  ui.statHp.textContent = Math.ceil(state.hp);
  ui.statWave.textContent = state.wave;
  ui.statTime.textContent = Math.floor(state.time);
  ui.statXp.textContent = `${state.xp}/${state.xpNeed}`;
  ui.statPower.textContent = `${Math.floor(state.restore)}%`;
  ui.statScore.textContent = state.score;
  ui.systemLog.textContent = state.log;

  if (state.gameOver) ui.runState.textContent = "バリア消失";
  else if (state.cleared) ui.runState.textContent = "リコード完了";
  else if (state.upgradeOpen) ui.runState.textContent = "補正を選択";
  else ui.runState.textContent = paused ? "一時停止中" : "EAE起動中";
}

function loop(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;
  if (!paused && !state.gameOver && !state.cleared) update(dt);
  draw();
  updateUi();
  setTimeout(() => loop(performance.now()), 1000 / 60);
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (W / rect.width),
    y: (event.clientY - rect.top) * (H / rect.height)
  };
}

function setAim(event) {
  const p = canvasPoint(event);
  pointer.x = clamp(p.x, 0, W);
  pointer.y = clamp(p.y, 0, HOLD_LINE_Y - 10);
}

canvas.addEventListener("pointerdown", event => {
  pointer.down = true;
  setAim(event);
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", event => {
  if (pointer.down) setAim(event);
});

canvas.addEventListener("pointerup", event => {
  pointer.down = false;
  canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener("pointercancel", () => {
  pointer.down = false;
});

ui.reset.addEventListener("click", () => {
  state = makeState();
  paused = false;
  ui.pause.textContent = "一時停止";
  ui.upgradePanel.hidden = true;
});

ui.pause.addEventListener("click", () => {
  if (state.gameOver || state.cleared || state.upgradeOpen) return;
  paused = !paused;
  ui.pause.textContent = paused ? "再開" : "一時停止";
});

window.addEventListener("keydown", event => {
  if (event.code === "Space" && !state.upgradeOpen && !state.gameOver && !state.cleared) {
    paused = !paused;
    ui.pause.textContent = paused ? "再開" : "一時停止";
  }
});

loop(performance.now());
