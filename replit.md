# Runaway Troopers

A 2D top-down survival arcade game built with HTML5 Canvas inside a React/TypeScript fullstack template.

## Overview

The player controls a formation of THREE triangle parts (triforce-style). Each part is an individual life with its own hitbox. The goal is to survive as long as possible against escalating hazards.

## Architecture

- **Frontend**: React + TypeScript, HTML5 Canvas game loop via `requestAnimationFrame`
- **Backend**: Express (minimal — game is entirely client-side)
- **Game file**: `client/src/pages/Game.tsx` — all game logic, update loop, and rendering

## Game Mechanics

### Player
- 3 triangle parts in triforce formation (top, bottom-left, bottom-right)
- Each part has its own hitbox (radius-based circle collider)
- Parts die individually when hit; 0 parts = game over
- WASD / Arrow Keys to move
- SPACE to dash (brief invincibility i-frames during dash)

### Dash System
- Duration: 0.10s dash window
- I-frames: 0.28s invulnerability (longer than dash so you stay safe after)
- Cooldown: 0.65s between dashes
- Start grace: 1.2s invulnerability at game start

### MG System (Machine Gun)
- Telegraph phase: orange dashed line (0.28s warning)
- Shot phase: red beam, thin (0.38s duration)
- Fan spawner: shots originate from below the screen at random X positions with angles between -35° and +35° from vertical
- First-hit-only: beam stops affecting targets after first hit (player part or soldier)
- 3-shot salvos with 0.15s delay between each shot

### Explosions
- Telegraph: orange expanding ring (0.65s warning)
- Blast: radial damage zone with gradient flash effect (radius 72px)
- Can hit multiple parts in one blast (each part hit once per explosion)

### Soldiers
- 22 wandering triangle enemies
- Random wander direction changes every 1-3 seconds
- Wrap around screen edges
- Can be killed by MG shots or explosions, then respawn off-screen after delay

### Scoring
- Survival time in seconds
- Grade at death: D/C/B/A/S/S+ based on time

## Files

- `client/src/pages/Game.tsx` — Complete game (canvas loop, all entities, render)
- `client/src/App.tsx` — Routes to Game page
- `server/routes.ts` — Empty (no backend routes needed)
- `shared/schema.ts` — Default user schema (unused by game)

## Running

The "Start application" workflow runs `npm run dev` which starts both Express (port 5000) and Vite dev server.
