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
  { x: 0,   y: -15 },   // front (brave)
  { x: -13, y: 8   },   // left  (slow)
  { x: 13,  y: 8   },   // right (anxious)
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
const SOLDIER_COUNT = 250;
const SOLDIER_SIZE = 7;
const SOLDIER_SPEED = 60;

// ── NEW: Shield pickup ──────────────────────────────────────────────────────
const SHIELD_SPAWN_INTERVAL_MIN = 12;
const SHIELD_SPAWN_INTERVAL_MAX = 20;
const SHIELD_PICKUP_RADIUS = 22;
const SHIELD_LIFETIME = 14; // seconds before it despawns

// ── NEW: Homing missile ─────────────────────────────────────────────────────
const MISSILE_SPAWN_INTERVAL_MIN = 13;
const MISSILE_SPAWN_INTERVAL_MAX = 24;
const MISSILE_TELEGRAPH_DURATION = 1.4;
const MISSILE_SPEED_INITIAL = 55;
const MISSILE_SPEED_MAX = 145;
const MISSILE_ACCEL = 28;
const MISSILE_HIT_RADIUS = 12;
const MISSILE_BLAST_RADIUS = 40;

// ── NEW: Kill combo ─────────────────────────────────────────────────────────
const COMBO_WINDOW = 2.5;
const COMBO_MAX_MULTIPLIER = 8;

// ─── Types ────────────────────────────────────────────────────────────────────
interface Part {
  alive: boolean;
  flashing: boolean;
  flashTimer: number;
  // personality offsets (visual only, hitbox stays at base PART_OFFSETS)
  lagX: number;    // slow part: lags behind movement
  lagY: number;
  shakeX: number;  // anxious part: jitter
  shakeY: number;
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
  shielded: boolean;
  shieldFlashTimer: number; // brief flash on absorb
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

interface ShieldPickup {
  id: number;
  x: number; y: number;
  lifetime: number;
  pulseTimer: number;
}

interface HomingMissile {
  id: number;
  x: number; y: number;
  vx: number; vy: number;
  speed: number;
  telegraphTimer: number; // > 0: still telegraphing
  alive: boolean;
  trailPoints: { x: number; y: number }[];
}

interface GameState {
  phase: "menu" | "playing" | "dead";
  player: Player;
  mgTelegraphs: MGTelegraph[];
  mgShots: MGShot[];
  expTelegraphs: ExpTelegraph[];
  explosions: Explosion[];
  soldiers: Soldier[];
  shieldPickups: ShieldPickup[];
  missiles: HomingMissile[];
  score: number;
  mgSpawnTimer: number;
  expSpawnTimer: number;
  shieldSpawnTimer: number;
  missileSpawnTimer: number;
  mgSalvoQueue: { angle: number }[];
  mgSalvoTimer: number;
  combo: number;
  comboTimer: number;
  comboDisplayTimer: number;
  nextId: number;
  keys: Set<string>;
  screenShake: number;
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
    parts: PART_OFFSETS.map(() => ({ alive: true, flashing: false, flashTimer: 0, lagX: 0, lagY: 0, shakeX: 0, shakeY: 0 })),
    dashing: false,
    dashTimer: 0,
    dashVx: 0,
    dashVy: 0,
    iframeTimer: START_GRACE,
    dashCooldown: 0,
    grace: START_GRACE,
    shielded: false,
    shieldFlashTimer: 0,
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
    shieldPickups: [],
    missiles: [],
    score: 0,
    mgSpawnTimer: 2.5,
    expSpawnTimer: 3.0,
    shieldSpawnTimer: rand(SHIELD_SPAWN_INTERVAL_MIN, SHIELD_SPAWN_INTERVAL_MAX),
    missileSpawnTimer: rand(MISSILE_SPAWN_INTERVAL_MIN, MISSILE_SPAWN_INTERVAL_MAX),
    mgSalvoQueue: [],
    mgSalvoTimer: 0,
    combo: 0,
    comboTimer: 0,
    comboDisplayTimer: 0,
    nextId: 1000,
    keys: new Set(),
    screenShake: 0,
  };
}

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

// Apply one hit to a player part, respecting shield
function hitPlayerPart(s: GameState, partIndex: number) {
  const pt = s.player.parts[partIndex];
  if (!pt.alive) return;
  if (s.player.shielded) {
    s.player.shielded = false;
    s.player.shieldFlashTimer = 0.5;
    s.screenShake = Math.max(s.screenShake, 0.12);
  } else {
    pt.alive = false;
    s.screenShake = Math.max(s.screenShake, 0.22);
  }
}

// ─── Update ───────────────────────────────────────────────────────────────────
function update(s: GameState, dt: number) {
  if (s.phase !== "playing") return;

  s.score += dt;
  const p = s.player;

  // Screen shake decay
  if (s.screenShake > 0) s.screenShake = Math.max(0, s.screenShake - dt * 3);

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

  // Shield flash timer
  if (p.shieldFlashTimer > 0) p.shieldFlashTimer -= dt;

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

  p.x = Math.max(20, Math.min(W - 20, p.x));
  p.y = Math.max(20, Math.min(H - 20, p.y));

  // Dash trigger
  if (s.keys.has(" ") && !p.dashing && p.dashCooldown <= 0) {
    let ddx = mx, ddy = my;
    const dlen = Math.sqrt(ddx * ddx + ddy * ddy);
    if (dlen > 0) { ddx /= dlen; ddy /= dlen; } else { ddx = 1; }
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

  // ─── Personality updates ─────────────────────────────────────────────────────
  const moveSpeed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
  // Part 0 (brave): very subtle shiver — degree 1
  if (p.parts[0].alive) {
    p.parts[0].shakeX = (Math.random() - 0.5) * 0.7;
    p.parts[0].shakeY = (Math.random() - 0.5) * 0.7;
  }
  // Part 1 (slow/slack): lags behind + medium shiver — degree 2
  if (p.parts[1].alive) {
    const lagTargetX = moveSpeed > 10 ? -(p.vx / moveSpeed) * 8 : 0;
    const lagTargetY = moveSpeed > 10 ? -(p.vy / moveSpeed) * 8 : 0;
    p.parts[1].lagX += (lagTargetX - p.parts[1].lagX) * Math.min(dt * 1.0, 1);
    p.parts[1].lagY += (lagTargetY - p.parts[1].lagY) * Math.min(dt * 1.0, 1);
    p.parts[1].shakeX = (Math.random() - 0.5) * 1.5;
    p.parts[1].shakeY = (Math.random() - 0.5) * 1.5;
  }
  // Part 2 (anxious): strong jitter — degree 3
  if (p.parts[2].alive) {
    p.parts[2].shakeX = (Math.random() - 0.5) * 2.6;
    p.parts[2].shakeY = (Math.random() - 0.5) * 2.6;
  }

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

  if (s.mgSalvoQueue.length > 0) {
    s.mgSalvoTimer -= dt;
    if (s.mgSalvoTimer <= 0) {
      s.mgSalvoTimer = MG_SALVO_DELAY;
      const entry = s.mgSalvoQueue.shift()!;
      const ox = rand(100, W - 100);
      const oy = H + 40;
      const dx = Math.cos(entry.angle);
      const dy = Math.sin(entry.angle);
      s.mgTelegraphs.push({ id: s.nextId++, ox, oy, dx, dy, timeLeft: MG_TELEGRAPH_DELAY });
    }
  }

  // Telegraph -> Shot
  s.mgTelegraphs = s.mgTelegraphs.filter(t => {
    t.timeLeft -= dt;
    if (t.timeLeft <= 0) {
      s.mgShots.push({
        id: t.id, ox: t.ox, oy: t.oy, dx: t.dx, dy: t.dy,
        timeLeft: MG_SHOT_DURATION, tickTimer: 0,
        hitParts: new Set(), hitSoldiers: new Set(), done: false,
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
              firstHitDist = proj; firstHitPart = i;
            }
          }
        });
        if (firstHitPart >= 0) {
          shot.hitParts.add(firstHitPart);
          hitPlayerPart(s, firstHitPart);
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
        x: rand(60, W - 60), y: rand(60, H - 60),
        timeLeft: EXP_TELEGRAPH_DELAY,
      });
    }
  }

  s.expTelegraphs = s.expTelegraphs.filter(t => {
    t.timeLeft -= dt;
    if (t.timeLeft <= 0) {
      s.explosions.push({
        id: t.id, x: t.x, y: t.y,
        timeLeft: EXP_DURATION,
        hitParts: new Set(), hitSoldiers: new Set(),
      });
      return false;
    }
    return true;
  });

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
          hitPlayerPart(s, i);
        }
      });
    }

    return true;
  });

  // ─── Soldiers ────────────────────────────────────────────────────────────────
  s.soldiers.forEach((sol) => {
    sol.wanderTimer -= dt;
    if (sol.wanderTimer <= 0) {
      sol.wanderTimer = rand(1, 3);
      const angle = rand(0, Math.PI * 2);
      sol.vx = Math.cos(angle) * SOLDIER_SPEED;
      sol.vy = Math.sin(angle) * SOLDIER_SPEED;
    }
    sol.x += sol.vx * dt;
    sol.y += sol.vy * dt;
    if (sol.x < -30) sol.x = W + 20;
    if (sol.x > W + 30) sol.x = -20;
    if (sol.y < -30) sol.y = H + 20;
    if (sol.y > H + 30) sol.y = -20;
  });

  // ─── Player ↔ Soldier Collision (soldiers physically block the player) ───────
  const COLLIDE_DIST = PART_RADIUS + SOLDIER_SIZE + 4;
  s.soldiers.forEach(sol => {
    if (!sol.alive) return;
    p.parts.forEach((pt, i) => {
      if (!pt.alive) return;
      const wx = p.x + PART_OFFSETS[i].x;
      const wy = p.y + PART_OFFSETS[i].y;
      const cdx = wx - sol.x;
      const cdy = wy - sol.y;
      const dist = Math.sqrt(cdx * cdx + cdy * cdy);
      if (dist < COLLIDE_DIST && dist > 0.001) {
        const overlap = COLLIDE_DIST - dist;
        const nx = cdx / dist;
        const ny = cdy / dist;
        // Push player away (strong) and nudge soldier (mild)
        p.x += nx * overlap * 0.72;
        p.y += ny * overlap * 0.72;
        sol.x -= nx * overlap * 0.28;
        sol.y -= ny * overlap * 0.28;
        // Kick soldier velocity away so it doesn't immediately push back
        sol.vx -= nx * 60;
        sol.vy -= ny * 60;
        const svlen = Math.sqrt(sol.vx * sol.vx + sol.vy * sol.vy);
        if (svlen > SOLDIER_SPEED * 2) {
          sol.vx = (sol.vx / svlen) * SOLDIER_SPEED * 2;
          sol.vy = (sol.vy / svlen) * SOLDIER_SPEED * 2;
        }
      }
    });
  });

  // Re-clamp player after collision pushback
  p.x = Math.max(20, Math.min(W - 20, p.x));
  p.y = Math.max(20, Math.min(H - 20, p.y));

  // ─── Soldier ↔ Soldier Separation (prevent stacking) ────────────────────────
  const SOL_SEP = SOLDIER_SIZE * 2 + 3;
  for (let i = 0; i < s.soldiers.length; i++) {
    if (!s.soldiers[i].alive) continue;
    for (let j = i + 1; j < s.soldiers.length; j++) {
      if (!s.soldiers[j].alive) continue;
      const sdx = s.soldiers[j].x - s.soldiers[i].x;
      const sdy = s.soldiers[j].y - s.soldiers[i].y;
      const sd = Math.sqrt(sdx * sdx + sdy * sdy);
      if (sd < SOL_SEP && sd > 0.001) {
        const overlap = SOL_SEP - sd;
        const nx = sdx / sd;
        const ny = sdy / sd;
        s.soldiers[i].x -= nx * overlap * 0.5;
        s.soldiers[i].y -= ny * overlap * 0.5;
        s.soldiers[j].x += nx * overlap * 0.5;
        s.soldiers[j].y += ny * overlap * 0.5;
      }
    }
  }

  // ─── NEW: Shield Pickup Spawner ──────────────────────────────────────────────
  s.shieldSpawnTimer -= dt;
  if (s.shieldSpawnTimer <= 0) {
    s.shieldSpawnTimer = rand(SHIELD_SPAWN_INTERVAL_MIN, SHIELD_SPAWN_INTERVAL_MAX);
    if (s.shieldPickups.length < 2) {
      s.shieldPickups.push({
        id: s.nextId++,
        x: rand(80, W - 80),
        y: rand(80, H - 80),
        lifetime: SHIELD_LIFETIME,
        pulseTimer: 0,
      });
    }
  }

  // Shield pickup collection & decay
  s.shieldPickups = s.shieldPickups.filter(pickup => {
    pickup.lifetime -= dt;
    pickup.pulseTimer += dt;
    if (pickup.lifetime <= 0) return false;

    const dist = Math.sqrt((p.x - pickup.x) ** 2 + (p.y - pickup.y) ** 2);
    if (dist < SHIELD_PICKUP_RADIUS + 20) {
      p.shielded = true;
      return false; // collected
    }
    return true;
  });

  // ─── NEW: Homing Missile Spawner ─────────────────────────────────────────────
  s.missileSpawnTimer -= dt;
  if (s.missileSpawnTimer <= 0) {
    s.missileSpawnTimer = rand(MISSILE_SPAWN_INTERVAL_MIN, MISSILE_SPAWN_INTERVAL_MAX);
    const count = Math.random() < 0.35 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      // Spawn from a random edge
      const edge = Math.floor(Math.random() * 4);
      let sx = 0, sy = 0;
      if (edge === 0) { sx = rand(50, W - 50); sy = -30; }
      else if (edge === 1) { sx = W + 30; sy = rand(50, H - 50); }
      else if (edge === 2) { sx = rand(50, W - 50); sy = H + 30; }
      else { sx = -30; sy = rand(50, H - 50); }
      s.missiles.push({
        id: s.nextId++,
        x: sx, y: sy,
        vx: 0, vy: 0,
        speed: MISSILE_SPEED_INITIAL,
        telegraphTimer: MISSILE_TELEGRAPH_DURATION,
        alive: true,
        trailPoints: [],
      });
    }
  }

  // Homing missiles update
  s.missiles = s.missiles.filter(missile => {
    if (!missile.alive) return false;

    // Telegraph phase — blink in place, no movement
    if (missile.telegraphTimer > 0) {
      missile.telegraphTimer -= dt;
      return true;
    }

    // Find nearest alive player part to home toward
    let targetX = p.x, targetY = p.y;
    let minDist = Infinity;
    p.parts.forEach((pt, i) => {
      if (!pt.alive) return;
      const wx = p.x + PART_OFFSETS[i].x;
      const wy = p.y + PART_OFFSETS[i].y;
      const d = Math.sqrt((missile.x - wx) ** 2 + (missile.y - wy) ** 2);
      if (d < minDist) { minDist = d; targetX = wx; targetY = wy; }
    });

    // Steer toward target
    const tdx = targetX - missile.x;
    const tdy = targetY - missile.y;
    const tlen = Math.sqrt(tdx * tdx + tdy * tdy);
    if (tlen > 0) {
      missile.vx = (tdx / tlen) * missile.speed;
      missile.vy = (tdy / tlen) * missile.speed;
    }
    missile.speed = Math.min(missile.speed + MISSILE_ACCEL * dt, MISSILE_SPEED_MAX);

    missile.x += missile.vx * dt;
    missile.y += missile.vy * dt;

    // Trail
    missile.trailPoints.push({ x: missile.x, y: missile.y });
    if (missile.trailPoints.length > 18) missile.trailPoints.shift();

    // Despawn if too far out
    if (missile.x < -100 || missile.x > W + 100 || missile.y < -100 || missile.y > H + 100) {
      return false;
    }

    // Collision with player parts
    if (p.iframeTimer <= 0) {
      for (let i = 0; i < p.parts.length; i++) {
        if (!p.parts[i].alive) continue;
        const wx = p.x + PART_OFFSETS[i].x;
        const wy = p.y + PART_OFFSETS[i].y;
        const dist = Math.sqrt((missile.x - wx) ** 2 + (missile.y - wy) ** 2);
        if (dist < MISSILE_HIT_RADIUS + PART_RADIUS) {
          // Explode
          s.explosions.push({
            id: s.nextId++,
            x: missile.x, y: missile.y,
            timeLeft: EXP_DURATION * 0.7,
            hitParts: new Set([i]),
            hitSoldiers: new Set(),
          });
          hitPlayerPart(s, i);
          missile.alive = false;
          s.screenShake = Math.max(s.screenShake, 0.28);
          return false;
        }
      }
    }

    return true;
  });

  // ─── Death check ─────────────────────────────────────────────────────────────
  const aliveParts = p.parts.filter(pt => pt.alive).length;
  if (aliveParts === 0) s.phase = "dead";
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

// Elongated triangle: tip extends tipR, base vertices use baseR
function drawElongatedTriangle(ctx: CanvasRenderingContext2D, cx: number, cy: number, tipR: number, baseR: number, angle = -Math.PI / 2) {
  ctx.beginPath();
  const tip = [cx + Math.cos(angle) * tipR, cy + Math.sin(angle) * tipR];
  const b1a = angle + (Math.PI * 2) / 3;
  const b2a = angle - (Math.PI * 2) / 3;
  const b1 = [cx + Math.cos(b1a) * baseR, cy + Math.sin(b1a) * baseR];
  const b2 = [cx + Math.cos(b2a) * baseR, cy + Math.sin(b2a) * baseR];
  ctx.moveTo(tip[0], tip[1]);
  ctx.lineTo(b1[0], b1[1]);
  ctx.lineTo(b2[0], b2[1]);
  ctx.closePath();
}

function drawHexagon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 - Math.PI / 6;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawDiamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r * 0.65, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r * 0.65, cy);
  ctx.closePath();
}

function render(ctx: CanvasRenderingContext2D, s: GameState) {
  // Screen shake
  ctx.save();
  if (s.screenShake > 0) {
    const sx = (Math.random() - 0.5) * s.screenShake * 18;
    const sy = (Math.random() - 0.5) * s.screenShake * 18;
    ctx.translate(sx, sy);
  }

  // Background
  ctx.fillStyle = "#0a0c10";
  ctx.fillRect(-20, -20, W + 40, H + 40);

  // Grid lines
  ctx.strokeStyle = "rgba(255,255,255,0.03)";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  const p = s.player;
  const now = Date.now();

  // ─── NEW: Shield Pickups ──────────────────────────────────────────────────
  s.shieldPickups.forEach(pickup => {
    const pulse = Math.sin(pickup.pulseTimer * 4) * 0.5 + 0.5;
    const fadeAlpha = pickup.lifetime < 3 ? pickup.lifetime / 3 : 1;
    ctx.save();
    ctx.shadowColor = `rgba(0,220,255,${0.6 * fadeAlpha})`;
    ctx.shadowBlur = 16 + pulse * 10;
    ctx.strokeStyle = `rgba(0,220,255,${(0.7 + 0.3 * pulse) * fadeAlpha})`;
    ctx.fillStyle = `rgba(0,180,255,${0.12 * fadeAlpha})`;
    ctx.lineWidth = 2;
    drawHexagon(ctx, pickup.x, pickup.y, 16 + pulse * 3);
    ctx.fill();
    ctx.stroke();
    // Inner dot
    ctx.fillStyle = `rgba(100,240,255,${(0.6 + 0.4 * pulse) * fadeAlpha})`;
    ctx.beginPath();
    ctx.arc(pickup.x, pickup.y, 4, 0, Math.PI * 2);
    ctx.fill();
    // Label
    ctx.fillStyle = `rgba(180,240,255,${0.8 * fadeAlpha})`;
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    ctx.shadowBlur = 0;
    ctx.fillText("SHIELD", pickup.x, pickup.y + 26);
    ctx.restore();
  });

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
    ctx.lineDashOffset = -(now * 0.05 % 20);
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
    ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = `rgba(255,200,0,${alpha * 0.6})`;
    ctx.beginPath(); ctx.arc(t.x, t.y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });

  // ─── Explosions ──────────────────────────────────────────────────────────────
  s.explosions.forEach(exp => {
    const progress = 1 - exp.timeLeft / EXP_DURATION;
    const alpha = 1 - progress * progress;
    const outerR = EXP_RADIUS * (0.6 + 0.4 * progress);
    ctx.save();
    const grad = ctx.createRadialGradient(exp.x, exp.y, 0, exp.x, exp.y, outerR);
    grad.addColorStop(0, `rgba(255,220,100,${alpha * 0.6})`);
    grad.addColorStop(0.4, `rgba(255,80,20,${alpha * 0.4})`);
    grad.addColorStop(1, `rgba(255,0,0,0)`);
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(exp.x, exp.y, outerR, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(255,100,0,${alpha})`;
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.shadowColor = "rgba(255,50,0,0.8)";
    ctx.shadowBlur = 20;
    ctx.beginPath(); ctx.arc(exp.x, exp.y, outerR, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  });

  // ─── NEW: Homing Missiles ─────────────────────────────────────────────────
  s.missiles.forEach(missile => {
    if (!missile.alive) return;

    if (missile.telegraphTimer > 0) {
      // Telegraph: flashing warning diamond at spawn position
      const blink = Math.floor(now / 120) % 2 === 0;
      if (blink) {
        ctx.save();
        ctx.strokeStyle = "rgba(220,80,255,0.9)";
        ctx.fillStyle = "rgba(180,0,255,0.15)";
        ctx.shadowColor = "rgba(200,0,255,0.8)";
        ctx.shadowBlur = 18;
        ctx.lineWidth = 2;
        drawDiamond(ctx, missile.x, missile.y, 14);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      return;
    }

    // Trail
    for (let i = 1; i < missile.trailPoints.length; i++) {
      const tp = missile.trailPoints[i - 1];
      const tc = missile.trailPoints[i];
      const a = (i / missile.trailPoints.length) * 0.5;
      ctx.save();
      ctx.strokeStyle = `rgba(200,60,255,${a})`;
      ctx.lineWidth = 2;
      ctx.shadowColor = "rgba(180,0,255,0.5)";
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(tp.x, tp.y);
      ctx.lineTo(tc.x, tc.y);
      ctx.stroke();
      ctx.restore();
    }

    // Missile body
    const spin = (now * 0.003) % (Math.PI * 2);
    ctx.save();
    ctx.strokeStyle = "rgba(220,80,255,1)";
    ctx.fillStyle = "rgba(180,0,255,0.35)";
    ctx.shadowColor = "rgba(200,0,255,0.9)";
    ctx.shadowBlur = 22;
    ctx.lineWidth = 2;
    drawDiamond(ctx, missile.x, missile.y, 12 + Math.sin(spin * 3) * 2);
    ctx.fill();
    ctx.stroke();
    // Core dot
    ctx.fillStyle = "#ff88ff";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(missile.x, missile.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  // ─── Player ──────────────────────────────────────────────────────────────────
  const isInvuln = p.iframeTimer > 0;
  const blink = isInvuln && p.grace <= 0 && Math.floor(now / 80) % 2 === 0;
  const shieldAbsorbing = p.shieldFlashTimer > 0;

  // Shield ring around player
  if (p.shielded || shieldAbsorbing) {
    const ringPulse = Math.sin(now * 0.006) * 0.3 + 0.7;
    const ringAlpha = shieldAbsorbing ? p.shieldFlashTimer / 0.5 : ringPulse;
    ctx.save();
    ctx.strokeStyle = shieldAbsorbing
      ? `rgba(255,255,255,${ringAlpha})`
      : `rgba(0,220,255,${ringAlpha * 0.9})`;
    ctx.lineWidth = shieldAbsorbing ? 4 : 2.5;
    ctx.shadowColor = shieldAbsorbing ? "rgba(200,240,255,1)" : "rgba(0,200,255,0.8)";
    ctx.shadowBlur = shieldAbsorbing ? 30 : 16;
    ctx.setLineDash(shieldAbsorbing ? [] : [6, 4]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 38 + (shieldAbsorbing ? p.shieldFlashTimer * 20 : 0), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ── Per-part personality rendering ──────────────────────────────────────────
  const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
  const moveDir = spd > 12 ? Math.atan2(p.vy, p.vx) : -Math.PI / 2;

  p.parts.forEach((pt, i) => {
    if (!pt.alive) return;

    let wx: number, wy: number, triAngle: number, triR: number;
    let stroke: string, fill: string, shadow: string, lineW: number, blur: number;

    if (i === 0) {
      // ── BRAVE: leans forward, faces movement dir, bold and bright ─────────
      const leanX = spd > 12 ? (p.vx / spd) * 3 : 0;
      const leanY = spd > 12 ? (p.vy / spd) * 3 : 0;
      wx = p.x + PART_OFFSETS[0].x + leanX + pt.shakeX;
      wy = p.y + PART_OFFSETS[0].y + leanY + pt.shakeY;
      // Subtle tilt toward movement dir — blend only 20% from default upward angle
      const defaultAngle = -Math.PI / 2;
      const tiltBlend = spd > 12 ? 0.22 : 0;
      const angleDiff = moveDir - defaultAngle;
      const wrappedDiff = ((angleDiff + Math.PI) % (Math.PI * 2)) - Math.PI;
      triAngle = defaultAngle + wrappedDiff * tiltBlend;
      triR = PART_RADIUS * 0.88;
      stroke = isInvuln ? "#aaeeff" : "#bbffaa";
      fill   = isInvuln ? "rgba(120,230,255,0.32)" : "rgba(140,255,120,0.30)";
      shadow = isInvuln ? "rgba(100,210,255,1)"    : "rgba(100,255,80,0.95)";
      lineW  = 2.5;
      blur   = isInvuln ? 22 : 18;
    } else if (i === 1) {
      // ── SLOW/SLACK: lags behind, chunky/fat, slightly tilted ─────────────
      wx = p.x + PART_OFFSETS[1].x + pt.lagX + pt.shakeX;
      wy = p.y + PART_OFFSETS[1].y + pt.lagY + pt.shakeY;
      triAngle = -Math.PI / 2 + 0.28;   // leans away, slouching tilt
      triR = PART_RADIUS * 1.45;         // noticeably bigger / fat
      stroke = isInvuln ? "#77bbdd" : "#77bb88";
      fill   = isInvuln ? "rgba(80,170,210,0.28)" : "rgba(80,190,100,0.26)";
      shadow = isInvuln ? "rgba(70,160,200,0.6)"  : "rgba(70,180,90,0.55)";
      lineW  = 2.2;
      blur   = isInvuln ? 12 : 9;
    } else {
      // ── ANXIOUS: shaky position, nervous wobble, slightly paler ──────────
      wx = p.x + PART_OFFSETS[2].x + pt.shakeX;
      wy = p.y + PART_OFFSETS[2].y + pt.shakeY;
      const wobble = Math.sin(now * 0.022) * 0.32;
      triAngle = -Math.PI / 2 + wobble;
      triR = PART_RADIUS * (0.88 + Math.abs(Math.sin(now * 0.018)) * 0.14);
      stroke = isInvuln ? "#ccddff" : "#bbffdd";
      fill   = isInvuln ? "rgba(140,180,255,0.18)" : "rgba(160,255,200,0.15)";
      shadow = isInvuln ? "rgba(130,170,255,0.75)" : "rgba(140,255,180,0.7)";
      lineW  = 1.8;
      blur   = isInvuln ? 14 : 10;
    }

    ctx.save();
    if (blink) ctx.globalAlpha = 0.32;
    ctx.shadowColor = shadow;
    ctx.shadowBlur  = blur;
    ctx.strokeStyle = stroke;
    ctx.fillStyle   = fill;
    ctx.lineWidth   = lineW;
    ctx.setLineDash([]);
    if (i === 1) {
      // Fat/slow: elongated — long tip, chunky base
      drawElongatedTriangle(ctx, wx, wy, triR * 1.5, triR * 0.9, triAngle);
    } else {
      drawTriangle(ctx, wx, wy, triR, triAngle);
    }
    ctx.fill();
    ctx.stroke();

    // ── Extra personality details ───────────────────────────────────────────
    if (i === 0 && !isInvuln) {
      // Brave: small bold forward dot (leading "eye")
      const dotX = wx + Math.cos(triAngle) * (triR * 0.55);
      const dotY = wy + Math.sin(triAngle) * (triR * 0.55);
      ctx.fillStyle = "#eeffcc";
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(dotX, dotY, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    if (i === 1 && !isInvuln) {
      // Slow: tiny drooping "..." trailing dot
      ctx.fillStyle = "rgba(120,200,130,0.5)";
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(wx - 3, wy + triR * 0.7, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (i === 2 && !isInvuln) {
      // Anxious: two tiny "eyes" darting with shake
      const eyeAngle = triAngle + Math.PI * 0.6;
      const eyeAngle2 = triAngle - Math.PI * 0.6;
      const er = triR * 0.45;
      ctx.fillStyle = "rgba(200,255,220,0.7)";
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(wx + Math.cos(eyeAngle) * er, wy + Math.sin(eyeAngle) * er, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(wx + Math.cos(eyeAngle2) * er, wy + Math.sin(eyeAngle2) * er, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  });

  // Dash trail (uses personality positions)
  if (p.dashing) {
    const alpha = p.dashTimer / DASH_DURATION;
    p.parts.forEach((pt, i) => {
      if (!pt.alive) return;
      let twx = p.x + PART_OFFSETS[i].x - p.dashVx * 0.04;
      let twy = p.y + PART_OFFSETS[i].y - p.dashVy * 0.04;
      if (i === 1) { twx += pt.lagX; twy += pt.lagY; }
      if (i === 2) { twx += pt.shakeX; twy += pt.shakeY; }
      ctx.save();
      ctx.globalAlpha = alpha * 0.4;
      ctx.strokeStyle = "#88ddff";
      ctx.lineWidth = 1.5;
      drawTriangle(ctx, twx, twy, PART_RADIUS * 0.88);
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

  // Shield HUD icon
  ctx.save();
  ctx.shadowColor = p.shielded ? "rgba(0,220,255,0.9)" : "rgba(80,120,140,0.3)";
  ctx.shadowBlur = p.shielded ? 12 : 4;
  ctx.strokeStyle = p.shielded ? "#00ddff" : "rgba(80,120,140,0.4)";
  ctx.fillStyle = p.shielded ? "rgba(0,180,255,0.2)" : "rgba(20,40,50,0.3)";
  ctx.lineWidth = 1.5;
  drawHexagon(ctx, 130, 24, 10);
  ctx.fill();
  ctx.stroke();
  if (p.shielded) {
    ctx.fillStyle = "rgba(0,220,255,0.8)";
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "center";
    ctx.shadowBlur = 0;
    ctx.fillText("SHD", 130, 41);
  }
  ctx.restore();

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
    ctx.textAlign = "left";
    ctx.fillText("DASH", 20, H - 22);
    ctx.restore();
  } else {
    ctx.save();
    ctx.fillStyle = "rgba(100,200,255,0.5)";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "left";
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

  ctx.restore(); // end screen shake transform

  // ─── Menu screen ─────────────────────────────────────────────────────────────
  if (s.phase === "menu") {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";

    ctx.font = "bold 64px 'Oxanium', monospace";
    ctx.fillStyle = "#88ff99";
    ctx.shadowColor = "rgba(100,255,120,0.8)";
    ctx.shadowBlur = 30;
    ctx.fillText("RUNAWAY TROOPERS", W / 2, H / 2 - 90);

    ctx.font = "18px 'Oxanium', monospace";
    ctx.fillStyle = "rgba(200,220,255,0.8)";
    ctx.shadowBlur = 0;
    ctx.fillText("2D TOP-DOWN SURVIVAL ARCADE", W / 2, H / 2 - 50);

    ctx.font = "13px monospace";
    ctx.fillStyle = "rgba(160,180,200,0.8)";
    ctx.fillText("WASD / ARROWS  —  Move       SPACE  —  Dash (i-frames)", W / 2, H / 2 + 10);

    ctx.font = "13px monospace";
    ctx.fillStyle = "rgba(0,220,200,0.7)";
    ctx.fillText("⬡ Collect SHIELD pickups to absorb one hit", W / 2, H / 2 + 36);

    ctx.fillStyle = "rgba(200,100,255,0.7)";
    ctx.fillText("◆ Homing missiles track you — dodge carefully", W / 2, H / 2 + 58);

    ctx.fillStyle = "rgba(180,200,160,0.7)";
    ctx.fillText("▲ Soldiers are obstacles — navigate around them", W / 2, H / 2 + 80);

    ctx.fillStyle = "rgba(100,255,130,0.9)";
    ctx.shadowColor = "rgba(100,255,120,0.8)";
    ctx.shadowBlur = 15;
    ctx.font = "bold 22px 'Oxanium', monospace";
    ctx.fillText("▲  ▲  ▲   =  3 LIVES", W / 2, H / 2 + 116);

    ctx.shadowBlur = 0;
    ctx.font = "bold 20px 'Oxanium', monospace";
    ctx.fillStyle = Math.floor(now / 500) % 2 === 0 ? "#ffffff" : "rgba(255,255,255,0.4)";
    ctx.fillText("PRESS ENTER OR CLICK TO START", W / 2, H / 2 + 155);
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
    ctx.fillStyle = Math.floor(now / 500) % 2 === 0 ? "#ffffff" : "rgba(255,255,255,0.4)";
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
        if (e.key === "Enter" && (s.phase === "menu" || s.phase === "dead")) {
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
      if (s.phase === "menu" || s.phase === "dead") startGame();
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
        WASD / ARROWS to move &nbsp;•&nbsp; SPACE to dash &nbsp;•&nbsp; Collect ⬡ shields &nbsp;•&nbsp; Soldiers block you — maneuver around them
      </div>
    </div>
  );
}
