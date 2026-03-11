import { useEffect, useRef, useState } from "react";

const W = 960;
const H = 540;

// ─── Constants ───────────────────────────────────────────────────────────────
const PLAYER_SPEED = 260;
const DASH_DURATION = 0.10;
const DASH_SPEED = 1400;
const IFRAME_DURATION = 0.28;
const DASH_COOLDOWN = 0.65;
const START_GRACE = 1.2;
const PART_RADIUS = 10;
const PART_OFFSETS = [
  { x: 0,   y: -22 },
  { x: -20, y: 11  },
  { x: 20,  y: 11  },
];
const MG_TELEGRAPH_DELAY = 0.28;
const MG_SHOT_DURATION = 0.38;
const MG_SHOT_TICK = 0.04;
const MG_LENGTH = 800;
const MG_TELEGRAPH_WIDTH = 6;
const MG_SHOT_WIDTH = 4;
const MG_SPAWN_INTERVAL_MIN = 1.8;
const MG_SPAWN_INTERVAL_MAX = 3.2;
const MG_SALVO_COUNT = 3;
const MG_SALVO_DELAY = 0.15;
const EXP_TELEGRAPH_DELAY = 0.65;
const EXP_RADIUS = 72;
const EXP_DURATION = 0.45;
const EXP_SPAWN_INTERVAL_MIN = 2.2;
const EXP_SPAWN_INTERVAL_MAX = 4.5;
const SOLDIER_COUNT = 22;
const SOLDIER_SIZE = 7;
const SOLDIER_SPEED = 60;

// ─── Types ────────────────────────────────────────────────────────────────────
interface Part {
  alive: boolean;
  flashing: boolean;
  flashTimer: number;
}

interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  parts: Part[];
  dashing: boolean;
  dashTimer: number;
  dashVx: number;
  dashVy: number;
  iframeTimer: number;
  dashCooldown: number;
  grace: number;
}

interface MGTelegraph {
  id: number;
  ox: number; oy: number;
  dx: number; dy: number;
  timeLeft: number;
}

interface MGShot {
  id: number;
  ox: number; oy: number;
  dx: number; dy: number;
  timeLeft: number;
  tickTimer: number;
  hitParts: Set<number>;
  hitSoldiers: Set<number>;
  done: boolean;
}

interface ExpTelegraph {
  id: number;
  x: number; y: number;
  timeLeft: number;
}

interface Explosion {
  id: number;
  x: number; y: number;
  timeLeft: number;
  hitParts: Set<number>;
  hitSoldiers: Set<number>;
}

interface Soldier {
  id: number;
  x: number; y: number;
  vx: number; vy: number;
  alive: boolean;
  wanderTimer: number;
  flashTimer: number;
}

interface GameState {
  phase: "menu" | "playing" | "dead";
  player: Player;
  mgTelegraphs: MGTelegraph[];
  mgShots: MGShot[];
  expTelegraphs: ExpTelegraph[];
  explosions: Explosion[];
  soldiers: Soldier[];
  score: number;
  mgSpawnTimer: number;
  expSpawnTimer: number;
  mgSalvoQueue: { angle: number }[];
  mgSalvoTimer: number;
  nextId: number;
  keys: Set<string>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function makePlayer(): Player {
  return {
    x: W / 2,
    y: H / 2,
    vx: 0, vy: 0,
    parts: PART_OFFSETS.map(() => ({ alive: true, flashing: false, flashTimer: 0 })),
    dashing: false,
    dashTimer: 0,
    dashVx: 0,
    dashVy: 0,
    iframeTimer: START_GRACE,
    dashCooldown: 0,
    grace: START_GRACE,
  };
}

function makeSoldier(id: number): Soldier {
  const edge = Math.floor(Math.random() * 4);
  let x = 0, y = 0;
  if (edge === 0) { x = rand(0, W); y = -20; }
  else if (edge === 1) { x = W + 20; y = rand(0, H); }
  else if (edge === 2) { x = rand(0, W); y = H + 20; }
  else { x = -20; y = rand(0, H); }
  const angle = rand(0, Math.PI * 2);
  return {
    id, x, y,
    vx: Math.cos(angle) * SOLDIER_SPEED,
    vy: Math.sin(angle) * SOLDIER_SPEED,
    alive: true,
    wanderTimer: rand(1, 3),
    flashTimer: 0,
  };
}

function makeState(): GameState {
  const soldiers: Soldier[] = [];
  for (let i = 0; i < SOLDIER_COUNT; i++) soldiers.push(makeSoldier(i));
  return {
    phase: "menu",
    player: makePlayer(),
    mgTelegraphs: [],
    mgShots: [],
    expTelegraphs: [],
    explosions: [],
    soldiers,
    score: 0,
    mgSpawnTimer: 2.5,
    expSpawnTimer: 3.0,
    mgSalvoQueue: [],
    mgSalvoTimer: 0,
    nextId: 1000,
    keys: new Set(),
  };
}

// Point-to-line-segment distance (squared)
function pointLineDistSq(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const abx = bx - ax, aby = by - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return (px - ax) ** 2 + (py - ay) ** 2;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
  const cx = ax + t * abx, cy = ay + t * aby;
  return (px - cx) ** 2 + (py - cy) ** 2;
}

function projOnBeam(px: number, py: number, ox: number, oy: number, dx: number, dy: number) {
  return (px - ox) * dx + (py - oy) * dy;
}

// ─── Update ───────────────────────────────────────────────────────────────────
function update(s: GameState, dt: number) {
  if (s.phase !== "playing") return;

  s.score += dt;
  const p = s.player;

  // Grace
  if (p.grace > 0) p.grace -= dt;

  // Dash timer
  if (p.dashing) {
    p.dashTimer -= dt;
    if (p.dashTimer <= 0) { p.dashing = false; p.dashTimer = 0; }
  }

  // Iframe timer
  if (p.iframeTimer > 0) p.iframeTimer -= dt;

  // Dash cooldown
  if (p.dashCooldown > 0) p.dashCooldown -= dt;

  // Input
  let mx = 0, my = 0;
  if (s.keys.has("ArrowLeft")  || s.keys.has("a") || s.keys.has("A")) mx -= 1;
  if (s.keys.has("ArrowRight") || s.keys.has("d") || s.keys.has("D")) mx += 1;
  if (s.keys.has("ArrowUp")    || s.keys.has("w") || s.keys.has("W")) my -= 1;
  if (s.keys.has("ArrowDown")  || s.keys.has("s") || s.keys.has("S")) my += 1;
  const mlen = Math.sqrt(mx * mx + my * my);
  if (mlen > 0) { mx /= mlen; my /= mlen; }

  if (!p.dashing) {
    p.vx = mx * PLAYER_SPEED;
    p.vy = my * PLAYER_SPEED;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  } else {
    p.x += p.dashVx * dt;
    p.y += p.dashVy * dt;
  }

  // Clamp to canvas
  p.x = Math.max(20, Math.min(W - 20, p.x));
  p.y = Math.max(20, Math.min(H - 20, p.y));

  // Dash trigger
  if (s.keys.has(" ") && !p.dashing && p.dashCooldown <= 0) {
    let ddx = mx, ddy = my;
    if (ddx === 0 && ddy === 0) ddx = 0;
    const dlen = Math.sqrt(ddx * ddx + ddy * ddy);
    if (dlen > 0) {
      ddx /= dlen; ddy /= dlen;
    } else {
      ddx = 1;
    }
    p.dashing = true;
    p.dashTimer = DASH_DURATION;
    p.dashVx = ddx * DASH_SPEED;
    p.dashVy = ddy * DASH_SPEED;
    p.iframeTimer = IFRAME_DURATION;
    p.dashCooldown = DASH_COOLDOWN;
  }

  // Flash update
  p.parts.forEach(pt => {
    if (pt.flashing) {
      pt.flashTimer -= dt;
      if (pt.flashTimer <= 0) { pt.flashing = false; pt.flashTimer = 0; }
    }
  });

  // ─── MG Spawner ─────────────────────────────────────────────────────────────
  s.mgSpawnTimer -= dt;
  if (s.mgSpawnTimer <= 0) {
    s.mgSpawnTimer = rand(MG_SPAWN_INTERVAL_MIN, MG_SPAWN_INTERVAL_MAX);
    for (let i = 0; i < MG_SALVO_COUNT; i++) {
      const angleDeg = rand(-35, 35);
      const angleRad = (angleDeg * Math.PI / 180) - Math.PI / 2;
      s.mgSalvoQueue.push({ angle: angleRad });
    }
  }

  // Salvo fire
  if (s.mgSalvoQueue.length > 0) {
    s.mgSalvoTimer -= dt;
    if (s.mgSalvoTimer <= 0) {
      s.mgSalvoTimer = MG_SALVO_DELAY;
      const entry = s.mgSalvoQueue.shift()!;
      const ox = rand(100, W - 100);
      const oy = H + 40;
      const dx = Math.cos(entry.angle);
      const dy = Math.sin(entry.angle);
      s.mgTelegraphs.push({
        id: s.nextId++,
        ox, oy, dx, dy,
        timeLeft: MG_TELEGRAPH_DELAY,
      });
    }
  }

  // Telegraph -> Shot
  s.mgTelegraphs = s.mgTelegraphs.filter(t => {
    t.timeLeft -= dt;
    if (t.timeLeft <= 0) {
      s.mgShots.push({
        id: t.id,
        ox: t.ox, oy: t.oy,
        dx: t.dx, dy: t.dy,
        timeLeft: MG_SHOT_DURATION,
        tickTimer: 0,
        hitParts: new Set(),
        hitSoldiers: new Set(),
        done: false,
      });
      return false;
    }
    return true;
  });

  // MG Shots
  s.mgShots = s.mgShots.filter(shot => {
    shot.timeLeft -= dt;
    if (shot.timeLeft <= 0 || shot.done) return false;

    shot.tickTimer -= dt;
    if (shot.tickTimer <= 0) {
      shot.tickTimer = MG_SHOT_TICK;

      // Check player parts
      if (p.iframeTimer <= 0) {
        let firstHitDist = Infinity;
        let firstHitPart = -1;
        p.parts.forEach((pt, i) => {
          if (!pt.alive || shot.hitParts.has(i)) return;
          const wx = p.x + PART_OFFSETS[i].x;
          const wy = p.y + PART_OFFSETS[i].y;
          const dSq = pointLineDistSq(wx, wy, shot.ox, shot.oy,
            shot.ox + shot.dx * MG_LENGTH, shot.oy + shot.dy * MG_LENGTH);
          if (dSq < (MG_SHOT_WIDTH * 0.5 + PART_RADIUS) ** 2) {
            const proj = projOnBeam(wx, wy, shot.ox, shot.oy, shot.dx, shot.dy);
            if (proj >= 0 && proj <= MG_LENGTH && proj < firstHitDist) {
              firstHitDist = proj;
              firstHitPart = i;
            }
          }
        });
        if (firstHitPart >= 0) {
          const pt = p.parts[firstHitPart];
          pt.alive = false;
          pt.flashing = false;
          shot.hitParts.add(firstHitPart);
          shot.done = true;
        }
      }

      // Check soldiers
      if (!shot.done) {
        let firstHitDist = Infinity;
        let firstHitSoldier = -1;
        s.soldiers.forEach((sol, i) => {
          if (!sol.alive || shot.hitSoldiers.has(i)) return;
          const dSq = pointLineDistSq(sol.x, sol.y, shot.ox, shot.oy,
            shot.ox + shot.dx * MG_LENGTH, shot.oy + shot.dy * MG_LENGTH);
          if (dSq < (MG_SHOT_WIDTH * 0.5 + SOLDIER_SIZE) ** 2) {
            const proj = projOnBeam(sol.x, sol.y, shot.ox, shot.oy, shot.dx, shot.dy);
            if (proj >= 0 && proj <= MG_LENGTH && proj < firstHitDist) {
              firstHitDist = proj;
              firstHitSoldier = i;
            }
          }
        });
        if (firstHitSoldier >= 0) {
          const sol = s.soldiers[firstHitSoldier];
          sol.alive = false;
          shot.hitSoldiers.add(firstHitSoldier);
          shot.done = true;
        }
      }
    }
    return true;
  });

  // ─── Explosion Spawner ───────────────────────────────────────────────────────
  s.expSpawnTimer -= dt;
  if (s.expSpawnTimer <= 0) {
    s.expSpawnTimer = rand(EXP_SPAWN_INTERVAL_MIN, EXP_SPAWN_INTERVAL_MAX);
    const count = Math.floor(rand(1, 4));
    for (let i = 0; i < count; i++) {
      s.expTelegraphs.push({
        id: s.nextId++,
        x: rand(60, W - 60),
        y: rand(60, H - 60),
        timeLeft: EXP_TELEGRAPH_DELAY,
      });
    }
  }

  // Telegraph -> Explosion
  s.expTelegraphs = s.expTelegraphs.filter(t => {
    t.timeLeft -= dt;
    if (t.timeLeft <= 0) {
      s.explosions.push({
        id: t.id,
        x: t.x, y: t.y,
        timeLeft: EXP_DURATION,
        hitParts: new Set(),
        hitSoldiers: new Set(),
      });
      return false;
    }
    return true;
  });

  // Explosions
  s.explosions = s.explosions.filter(exp => {
    exp.timeLeft -= dt;
    if (exp.timeLeft <= 0) return false;

    if (p.iframeTimer <= 0) {
      p.parts.forEach((pt, i) => {
        if (!pt.alive || exp.hitParts.has(i)) return;
        const wx = p.x + PART_OFFSETS[i].x;
        const wy = p.y + PART_OFFSETS[i].y;
        const dist = Math.sqrt((wx - exp.x) ** 2 + (wy - exp.y) ** 2);
        if (dist < EXP_RADIUS) {
          exp.hitParts.add(i);
          pt.alive = false;
        }
      });
    }

    s.soldiers.forEach((sol, i) => {
      if (!sol.alive || exp.hitSoldiers.has(i)) return;
      const dist = Math.sqrt((sol.x - exp.x) ** 2 + (sol.y - exp.y) ** 2);
      if (dist < EXP_RADIUS) {
        exp.hitSoldiers.add(i);
        sol.alive = false;
      }
    });

    return true;
  });

  // ─── Soldiers ────────────────────────────────────────────────────────────────
  s.soldiers.forEach((sol, i) => {
    if (!sol.alive) {
      sol.flashTimer -= dt;
      if (sol.flashTimer <= 0) {
        // Respawn off-screen
        const ns = makeSoldier(sol.id);
        s.soldiers[i] = { ...ns, alive: true };
      }
      return;
    }

    sol.wanderTimer -= dt;
    if (sol.wanderTimer <= 0) {
      sol.wanderTimer = rand(1, 3);
      const angle = rand(0, Math.PI * 2);
      sol.vx = Math.cos(angle) * SOLDIER_SPEED;
      sol.vy = Math.sin(angle) * SOLDIER_SPEED;
    }
    sol.x += sol.vx * dt;
    sol.y += sol.vy * dt;

    // Wrap around
    if (sol.x < -30) sol.x = W + 20;
    if (sol.x > W + 30) sol.x = -20;
    if (sol.y < -30) sol.y = H + 20;
    if (sol.y > H + 30) sol.y = -20;
  });

  // Check dead soldiers (mark with flash timer for respawn)
  s.soldiers.forEach(sol => {
    if (!sol.alive && sol.flashTimer === 0) {
      sol.flashTimer = rand(2, 5);
    }
  });

  // ─── Death check ─────────────────────────────────────────────────────────────
  const aliveParts = p.parts.filter(pt => pt.alive).length;
  if (aliveParts === 0) {
    s.phase = "dead";
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────
function drawTriangle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, angle = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = angle + (i * Math.PI * 2) / 3;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function render(ctx: CanvasRenderingContext2D, s: GameState) {
  // Background
  ctx.fillStyle = "#0a0c10";
  ctx.fillRect(0, 0, W, H);

  // Grid lines (subtle)
  ctx.strokeStyle = "rgba(255,255,255,0.03)";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  const p = s.player;

  // ─── Soldiers ────────────────────────────────────────────────────────────────
  s.soldiers.forEach(sol => {
    if (!sol.alive) return;
    ctx.fillStyle = "rgba(160,160,180,0.7)";
    ctx.strokeStyle = "rgba(200,200,220,0.8)";
    ctx.lineWidth = 1;
    drawTriangle(ctx, sol.x, sol.y, SOLDIER_SIZE);
    ctx.fill();
    ctx.stroke();
  });

  // ─── MG Telegraphs ───────────────────────────────────────────────────────────
  s.mgTelegraphs.forEach(t => {
    const alpha = 0.4 + 0.5 * (1 - t.timeLeft / MG_TELEGRAPH_DELAY);
    ctx.save();
    ctx.strokeStyle = `rgba(255,165,0,${alpha})`;
    ctx.lineWidth = MG_TELEGRAPH_WIDTH;
    ctx.setLineDash([12, 8]);
    ctx.lineDashOffset = -(Date.now() * 0.05 % 20);
    ctx.shadowColor = "rgba(255,140,0,0.6)";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(t.ox, t.oy);
    ctx.lineTo(t.ox + t.dx * MG_LENGTH, t.oy + t.dy * MG_LENGTH);
    ctx.stroke();
    ctx.restore();
  });

  // ─── MG Shots ────────────────────────────────────────────────────────────────
  s.mgShots.forEach(shot => {
    const alpha = 0.6 + 0.4 * (shot.timeLeft / MG_SHOT_DURATION);
    ctx.save();
    ctx.strokeStyle = `rgba(255,60,60,${alpha})`;
    ctx.lineWidth = MG_SHOT_WIDTH;
    ctx.setLineDash([]);
    ctx.shadowColor = "rgba(255,0,0,0.9)";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(shot.ox, shot.oy);
    ctx.lineTo(shot.ox + shot.dx * MG_LENGTH, shot.oy + shot.dy * MG_LENGTH);
    ctx.stroke();
    ctx.restore();
  });

  // ─── Explosion Telegraphs ────────────────────────────────────────────────────
  s.expTelegraphs.forEach(t => {
    const progress = 1 - t.timeLeft / EXP_TELEGRAPH_DELAY;
    const alpha = 0.3 + 0.5 * progress;
    const r = EXP_RADIUS * (0.3 + 0.7 * progress);
    ctx.save();
    ctx.strokeStyle = `rgba(255,165,0,${alpha})`;
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.shadowColor = "rgba(255,140,0,0.5)";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
    ctx.stroke();
    // Center dot
    ctx.fillStyle = `rgba(255,200,0,${alpha * 0.6})`;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  // ─── Explosions ──────────────────────────────────────────────────────────────
  s.explosions.forEach(exp => {
    const progress = 1 - exp.timeLeft / EXP_DURATION;
    const alpha = 1 - progress * progress;
    const outerR = EXP_RADIUS * (0.6 + 0.4 * progress);
    ctx.save();
    // Fill
    const grad = ctx.createRadialGradient(exp.x, exp.y, 0, exp.x, exp.y, outerR);
    grad.addColorStop(0, `rgba(255,220,100,${alpha * 0.6})`);
    grad.addColorStop(0.4, `rgba(255,80,20,${alpha * 0.4})`);
    grad.addColorStop(1, `rgba(255,0,0,0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(exp.x, exp.y, outerR, 0, Math.PI * 2);
    ctx.fill();
    // Ring
    ctx.strokeStyle = `rgba(255,100,0,${alpha})`;
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.shadowColor = "rgba(255,50,0,0.8)";
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(exp.x, exp.y, outerR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });

  // ─── Player ──────────────────────────────────────────────────────────────────
  const isInvuln = p.iframeTimer > 0;
  const blink = isInvuln && p.grace <= 0 && Math.floor(Date.now() / 80) % 2 === 0;

  p.parts.forEach((pt, i) => {
    if (!pt.alive) return;
    const wx = p.x + PART_OFFSETS[i].x;
    const wy = p.y + PART_OFFSETS[i].y;

    ctx.save();
    if (blink) {
      ctx.globalAlpha = 0.35;
    }
    ctx.shadowColor = isInvuln ? "rgba(100,200,255,0.9)" : "rgba(100,255,120,0.7)";
    ctx.shadowBlur = isInvuln ? 20 : 12;
    ctx.strokeStyle = isInvuln ? "#7de8ff" : "#88ff99";
    ctx.fillStyle = isInvuln ? "rgba(100,220,255,0.25)" : "rgba(100,255,130,0.2)";
    ctx.lineWidth = 2;
    drawTriangle(ctx, wx, wy, PART_RADIUS);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  });

  // Dash trail
  if (p.dashing) {
    const aliveParts = p.parts.filter(pt => pt.alive);
    const alpha = p.dashTimer / DASH_DURATION;
    aliveParts.forEach((pt, i) => {
      const ri = p.parts.indexOf(pt);
      const wx = p.x + PART_OFFSETS[ri].x - p.dashVx * 0.04;
      const wy = p.y + PART_OFFSETS[ri].y - p.dashVy * 0.04;
      ctx.save();
      ctx.globalAlpha = alpha * 0.4;
      ctx.strokeStyle = "#88ddff";
      ctx.lineWidth = 1.5;
      drawTriangle(ctx, wx, wy, PART_RADIUS * 0.9);
      ctx.stroke();
      ctx.restore();
    });
  }

  // ─── HUD ─────────────────────────────────────────────────────────────────────
  const aliveParts = p.parts.filter(pt => pt.alive).length;

  // Lives indicator
  for (let i = 0; i < 3; i++) {
    const filled = i < aliveParts;
    ctx.save();
    ctx.shadowColor = filled ? "rgba(100,255,120,0.8)" : "rgba(255,60,60,0.4)";
    ctx.shadowBlur = filled ? 10 : 4;
    ctx.strokeStyle = filled ? "#88ff99" : "rgba(255,80,80,0.5)";
    ctx.fillStyle = filled ? "rgba(100,255,130,0.3)" : "rgba(80,20,20,0.3)";
    ctx.lineWidth = 1.5;
    drawTriangle(ctx, 30 + i * 32, 24, 10);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Score
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 18px 'Oxanium', monospace";
  ctx.textAlign = "right";
  ctx.shadowColor = "rgba(255,255,255,0.3)";
  ctx.shadowBlur = 8;
  ctx.fillText(`${Math.floor(s.score)}s`, W - 20, 30);
  ctx.restore();

  // Dash cooldown bar
  if (p.dashCooldown > 0) {
    const frac = p.dashCooldown / DASH_COOLDOWN;
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(20, H - 16, 100, 6);
    ctx.fillStyle = `rgba(100,200,255,${0.7 + 0.3 * (1 - frac)})`;
    ctx.fillRect(20, H - 16, 100 * (1 - frac), 6);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "10px monospace";
    ctx.fillText("DASH", 20, H - 22);
    ctx.restore();
  } else {
    ctx.save();
    ctx.fillStyle = "rgba(100,200,255,0.5)";
    ctx.font = "bold 10px monospace";
    ctx.fillText("DASH READY", 20, H - 22);
    ctx.restore();
  }

  // Grace indicator
  if (p.grace > 0) {
    const alpha = p.grace / START_GRACE;
    ctx.save();
    ctx.fillStyle = `rgba(100,200,255,${alpha * 0.6})`;
    ctx.font = "bold 14px 'Oxanium', monospace";
    ctx.textAlign = "center";
    ctx.fillText("▶  INVULNERABLE  ◀", W / 2, H - 20);
    ctx.restore();
  }

  // ─── Menu screen ─────────────────────────────────────────────────────────────
  if (s.phase === "menu") {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = "center";

    // Title
    ctx.font = "bold 64px 'Oxanium', monospace";
    ctx.fillStyle = "#88ff99";
    ctx.shadowColor = "rgba(100,255,120,0.8)";
    ctx.shadowBlur = 30;
    ctx.fillText("RUNAWAY TROOPERS", W / 2, H / 2 - 80);

    // Subtitle
    ctx.font = "18px 'Oxanium', monospace";
    ctx.fillStyle = "rgba(200,220,255,0.8)";
    ctx.shadowBlur = 0;
    ctx.fillText("2D TOP-DOWN SURVIVAL ARCADE", W / 2, H / 2 - 38);

    // Instructions
    ctx.font = "14px monospace";
    ctx.fillStyle = "rgba(160,180,200,0.8)";
    ctx.fillText("WASD / ARROW KEYS  —  Move", W / 2, H / 2 + 20);
    ctx.fillText("SPACE  —  Dash (i-frames)", W / 2, H / 2 + 42);

    // Lives display
    ctx.fillStyle = "rgba(100,255,130,0.9)";
    ctx.shadowColor = "rgba(100,255,120,0.8)";
    ctx.shadowBlur = 15;
    ctx.font = "bold 26px 'Oxanium', monospace";
    ctx.fillText("▲  ▲  ▲   =  3 LIVES", W / 2, H / 2 + 90);

    // Start prompt
    ctx.shadowBlur = 0;
    ctx.font = "bold 20px 'Oxanium', monospace";
    ctx.fillStyle = Math.floor(Date.now() / 500) % 2 === 0 ? "#ffffff" : "rgba(255,255,255,0.4)";
    ctx.fillText("PRESS ENTER OR CLICK TO START", W / 2, H / 2 + 140);

    ctx.restore();
  }

  // ─── Dead screen ─────────────────────────────────────────────────────────────
  if (s.phase === "dead") {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = "center";

    ctx.font = "bold 56px 'Oxanium', monospace";
    ctx.fillStyle = "#ff5555";
    ctx.shadowColor = "rgba(255,60,60,0.9)";
    ctx.shadowBlur = 30;
    ctx.fillText("ELIMINATED", W / 2, H / 2 - 60);

    ctx.shadowBlur = 0;
    ctx.font = "28px 'Oxanium', monospace";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(`SURVIVAL TIME: ${Math.floor(s.score)}s`, W / 2, H / 2);

    let grade = "F";
    if (s.score >= 120) grade = "S+";
    else if (s.score >= 90) grade = "S";
    else if (s.score >= 60) grade = "A";
    else if (s.score >= 40) grade = "B";
    else if (s.score >= 20) grade = "C";
    else if (s.score >= 10) grade = "D";

    ctx.font = "bold 48px 'Oxanium', monospace";
    ctx.fillStyle = "#ffdd66";
    ctx.shadowColor = "rgba(255,220,80,0.7)";
    ctx.shadowBlur = 20;
    ctx.fillText(grade, W / 2, H / 2 + 60);

    ctx.shadowBlur = 0;
    ctx.font = "bold 18px 'Oxanium', monospace";
    ctx.fillStyle = Math.floor(Date.now() / 500) % 2 === 0 ? "#ffffff" : "rgba(255,255,255,0.4)";
    ctx.fillText("PRESS ENTER OR CLICK TO RETRY", W / 2, H / 2 + 120);

    ctx.restore();
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState>(makeState());
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const s = stateRef.current;

    const handleKey = (e: KeyboardEvent) => {
      if (e.type === "keydown") {
        s.keys.add(e.key);
        if ((e.key === "Enter") && (s.phase === "menu" || s.phase === "dead")) {
          startGame();
        }
        if (e.key === " " || e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
        }
      } else {
        s.keys.delete(e.key);
      }
    };

    const handleClick = () => {
      if (s.phase === "menu" || s.phase === "dead") {
        startGame();
      }
    };

    function startGame() {
      const ns = makeState();
      ns.keys = s.keys;
      ns.phase = "playing";
      Object.assign(s, ns);
    }

    window.addEventListener("keydown", handleKey);
    window.addEventListener("keyup", handleKey);
    canvas.addEventListener("click", handleClick);

    function loop(time: number) {
      const dt = Math.min((time - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = time;
      update(s, dt);
      render(ctx!, s);
      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame((t) => {
      lastTimeRef.current = t;
      rafRef.current = requestAnimationFrame(loop);
    });

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("keyup", handleKey);
      canvas.removeEventListener("click", handleClick);
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#050608]">
      <div className="relative" style={{ width: W, maxWidth: "100vw" }}>
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          data-testid="game-canvas"
          style={{
            display: "block",
            width: "100%",
            height: "auto",
            imageRendering: "pixelated",
            cursor: "crosshair",
            border: "1px solid rgba(100,255,120,0.15)",
            boxShadow: "0 0 60px rgba(50,200,80,0.08), 0 0 120px rgba(0,0,0,0.8)",
          }}
        />
      </div>
      <div className="mt-3 text-xs text-center" style={{ color: "rgba(100,130,120,0.6)", fontFamily: "monospace" }}>
        WASD / ARROWS to move &nbsp;•&nbsp; SPACE to dash (invincible during dash)
      </div>
    </div>
  );
}
