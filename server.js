const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

const PORT = process.env.PORT || 3000;
const WORLD = { width: 960, height: 540 };
const TWO_PI = Math.PI * 2;
const TUNNEL = {
  playerDepth: 78,
  spawnDepth: 980,
  tubeRadius: 210
};
const LANE_RADIAL = 0.82;
const MAX_WEAPON_LEVEL = 4;
const MAX_UPGRADE_SLOTS = 4;
const ENEMY_MOTION_START_MS = 18000;
const TICK_RATE = 1000 / 30;
const ROOM_TTL_MS = 1000 * 60 * 45;

app.use(express.json());
app.use("/vendor/three", express.static(path.join(__dirname, "node_modules", "three", "build")));
app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
const leaderboard = [];

function randomRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return rooms.has(code) ? randomRoomCode() : code;
}

function now() {
  return Date.now();
}

function wrapAngle(angle) {
  return ((angle % TWO_PI) + TWO_PI) % TWO_PI;
}

function angleDelta(a, b) {
  const diff = Math.abs(wrapAngle(a) - wrapAngle(b));
  return Math.min(diff, TWO_PI - diff);
}

function tunnelSeparation(a, b) {
  const radial = ((a.radial || 0.82) + (b.radial || 0.82)) / 2;
  const arc = angleDelta(a.angle || 0, b.angle || 0) * TUNNEL.tubeRadius * radial;
  const ring = ((a.radial || 0.82) - (b.radial || 0.82)) * TUNNEL.tubeRadius;
  return Math.sqrt(arc * arc + ring * ring);
}

function tunnelHit(a, b, depthWindow) {
  return Math.abs((a.depth || 0) - (b.depth || 0)) <= depthWindow
    && tunnelSeparation(a, b) <= (a.radius || 0) + (b.radius || 0);
}

function projectileEnemyHit(projectile, enemy) {
  const depthWindow = 58 + Math.max(0, (projectile.vz || 0) - (enemy.speed || 0));
  const aimAssist = enemy.type === "tank" ? 44 : 34;
  return Math.abs((projectile.depth || 0) - (enemy.depth || 0)) <= depthWindow
    && tunnelSeparation(projectile, enemy) <= (projectile.radius || 0) + (enemy.radius || 0) + aimAssist;
}

function safeNickname(value) {
  const nick = String(value || "Pilot").trim().slice(0, 18);
  return nick || "Pilot";
}

function createRoom(hostNickname = "") {
  const id = randomRoomCode();
  const room = {
    id,
    hostId: null,
    hostNickname: safeNickname(hostNickname || "Host"),
    status: "waiting",
    createdAt: now(),
    updatedAt: now(),
    startedAt: null,
    endedAt: null,
    pausedAt: null,
    players: new Map(),
    inputs: new Map(),
    enemies: new Map(),
    obstacles: new Map(),
    powerUps: new Map(),
    projectiles: new Map(),
    nextEntityId: 1,
    spawn: {
      enemy: 0,
      obstacle: 0,
      powerUp: 4800
    },
    lastStateAt: 0,
    elapsed: 0,
    phaseStartedElapsed: 0,
    distance: 0,
    speed: 5,
    difficulty: 1,
    finalRanking: []
  };
  room.phase = 1;
  rooms.set(id, room);
  return room;
}

function publicRoom(room) {
  return {
    id: room.id,
    status: room.status,
    hostId: room.hostId,
    hostNickname: room.hostNickname,
    playerCount: room.players.size,
    players: Array.from(room.players.values()).map((player) => ({
      id: player.id,
      nickname: player.nickname,
      alive: player.alive,
      connected: player.connected,
      score: Math.floor(player.score)
    })),
    createdAt: room.createdAt,
    startedAt: room.startedAt,
    endedAt: room.endedAt
  };
}

function addScore(entry) {
  leaderboard.push({
    nickname: safeNickname(entry.nickname),
    score: Math.max(0, Math.floor(Number(entry.score) || 0)),
    roomId: entry.roomId || "SOLO",
    createdAt: now()
  });
  leaderboard.sort((a, b) => b.score - a.score);
  leaderboard.splice(20);
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/rooms", (req, res) => {
  const openRooms = Array.from(rooms.values())
    .filter((room) => room.status !== "ended")
    .map(publicRoom);
  res.json({ rooms: openRooms });
});

app.post("/api/rooms", (req, res) => {
  const room = createRoom(req.body && req.body.nickname);
  res.status(201).json({ room: publicRoom(room) });
});

app.get("/api/rooms/:roomId", (req, res) => {
  const room = rooms.get(String(req.params.roomId || "").toUpperCase());
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  res.json({ room: publicRoom(room) });
});

app.get("/api/leaderboard", (req, res) => {
  res.json({ leaderboard });
});

app.post("/api/score", (req, res) => {
  addScore(req.body || {});
  res.status(201).json({ leaderboard });
});

function entityId(room, prefix) {
  const id = `${prefix}${room.nextEntityId}`;
  room.nextEntityId += 1;
  return id;
}

function makePlayer(socket, nickname, room) {
  const angle = wrapAngle(Math.PI / 2 + room.players.size * 0.42);
  return {
    id: socket.id,
    nickname: safeNickname(nickname),
    x: 125,
    y: WORLD.height / 2,
    angle,
    radial: 0.82,
    depth: TUNNEL.playerDepth,
    radius: 15,
    lives: 3,
    alive: true,
    spectator: false,
    score: 0,
    distance: 0,
    kills: 0,
    collected: 0,
    weaponLevel: 1,
    upgradeSlots: 0,
    totalUpgrades: 0,
    streak: 0,
    shieldUntil: 0,
    rapidUntil: 0,
    lastShotAt: 0,
    invulnerableUntil: 0,
    color: pickColor(room.players.size),
    connected: true
  };
}

function pickColor(index) {
  const colors = ["#4df7ff", "#ff4de3", "#ffe66d", "#6dff8d", "#9b7cff", "#ff9057"];
  return colors[index % colors.length];
}

function defaultInput() {
  return {
    left: false,
    right: false,
    shooting: false
  };
}

function startRoom(room) {
  if (!room || room.status === "running" || room.players.size === 0) {
    return false;
  }

  room.status = "running";
  room.startedAt = now();
  room.endedAt = null;
  room.pausedAt = null;
  room.elapsed = 0;
  room.phaseStartedElapsed = 0;
  room.distance = 0;
  room.speed = 5;
  room.difficulty = 1;
  room.phase = 1;
  room.finalRanking = [];
  room.enemies.clear();
  room.obstacles.clear();
  room.powerUps.clear();
  room.projectiles.clear();
  room.spawn.enemy = 700;
  room.spawn.obstacle = 1800;
  room.spawn.powerUp = 4300;

  let i = 0;
  for (const player of room.players.values()) {
    player.x = 118;
    player.y = 170 + i * 58;
    player.angle = wrapAngle(Math.PI / 2 + i * 0.44);
    player.radial = LANE_RADIAL;
    player.depth = TUNNEL.playerDepth;
    player.lives = 3;
    player.alive = true;
    player.spectator = false;
    player.score = 0;
    player.distance = 0;
    player.kills = 0;
    player.collected = 0;
    player.weaponLevel = 1;
    player.upgradeSlots = 0;
    player.totalUpgrades = 0;
    player.streak = 0;
    player.shieldUntil = 0;
    player.rapidUntil = 0;
    player.lastShotAt = 0;
    player.invulnerableUntil = now() + 1200;
    i += 1;
  }

  io.to(room.id).emit("gameStarted", snapshotRoom(room));
  return true;
}

function endRoom(room) {
  if (!room || !["running", "paused"].includes(room.status)) {
    return;
  }
  room.status = "ended";
  room.endedAt = now();
  room.finalRanking = ranking(room);
  for (const entry of room.finalRanking) {
    addScore({ nickname: entry.nickname, score: entry.score, roomId: room.id });
  }
  io.to(room.id).emit("gameOver", {
    roomId: room.id,
    ranking: room.finalRanking,
    leaderboard
  });
}

function setRoomPaused(room, paused, socketId) {
  if (!room) {
    return false;
  }
  if (paused && room.status !== "running") {
    return false;
  }
  if (!paused && room.status !== "paused") {
    return false;
  }

  const time = now();
  if (paused) {
    room.pausedAt = time;
  } else if (room.pausedAt) {
    const pauseDuration = time - room.pausedAt;
    for (const player of room.players.values()) {
      if (player.shieldUntil > room.pausedAt) player.shieldUntil += pauseDuration;
      if (player.rapidUntil > room.pausedAt) player.rapidUntil += pauseDuration;
      if (player.invulnerableUntil > room.pausedAt) player.invulnerableUntil += pauseDuration;
    }
    room.pausedAt = null;
  }
  room.status = paused ? "paused" : "running";
  room.updatedAt = time;
  const player = room.players.get(socketId);
  const payload = {
    roomId: room.id,
    playerId: socketId,
    nickname: player ? player.nickname : "Piloto",
    state: snapshotRoom(room)
  };
  io.to(room.id).emit(paused ? "gamePaused" : "gameResumed", payload);
  io.to(room.id).emit("roomState", payload.state);
  return true;
}

function ranking(room) {
  return Array.from(room.players.values())
    .map((player) => ({
      id: player.id,
      nickname: player.nickname,
      score: Math.floor(player.score),
      kills: player.kills,
      distance: Math.floor(player.distance),
      alive: player.alive
    }))
    .sort((a, b) => b.score - a.score);
}

function snapshotRoom(room) {
  return {
    roomId: room.id,
    status: room.status,
    world: WORLD,
    elapsed: Math.floor(room.elapsed),
    distance: Math.floor(room.distance),
    speed: Number(room.speed.toFixed(2)),
    difficulty: Number(room.difficulty.toFixed(2)),
    phase: room.phase,
    maxWeaponLevel: MAX_WEAPON_LEVEL,
    maxUpgradeSlots: MAX_UPGRADE_SLOTS,
    hostId: room.hostId,
    ranking: ranking(room),
    players: Array.from(room.players.values()).map((player) => ({
      id: player.id,
      nickname: player.nickname,
      x: Math.round(player.x),
      y: Math.round(player.y),
      angle: Number(player.angle.toFixed(4)),
      radial: Number(player.radial.toFixed(3)),
      depth: Math.round(player.depth),
      radius: player.radius,
      lives: player.lives,
      alive: player.alive,
      spectator: player.spectator,
      score: Math.floor(player.score),
      distance: Math.floor(player.distance),
      kills: player.kills,
      weaponLevel: player.weaponLevel,
      upgradeSlots: player.upgradeSlots,
      totalUpgrades: player.totalUpgrades,
      shield: player.shieldUntil > now(),
      rapid: player.rapidUntil > now(),
      shieldRemaining: Math.max(0, player.shieldUntil - now()),
      rapidRemaining: Math.max(0, player.rapidUntil - now()),
      color: player.color,
      connected: player.connected
    })),
    enemies: Array.from(room.enemies.values()),
    obstacles: Array.from(room.obstacles.values()),
    powerUps: Array.from(room.powerUps.values()),
    projectiles: Array.from(room.projectiles.values())
  };
}

function spawnEnemy(room) {
  const roll = Math.random();
  let type = "straight";
  if (room.difficulty > 1.4 && roll > 0.72) type = "zigzag";
  if (room.difficulty > 2.0 && roll > 0.84) type = "tank";
  if (room.difficulty > 2.8 && roll > 0.9) type = "fast";

  const baseHp = type === "tank" ? 3 : 1;
  const alivePlayers = Array.from(room.players.values()).filter((player) => player.alive);
  const targetPlayer = alivePlayers.length
    ? alivePlayers[Math.floor(Math.random() * alivePlayers.length)]
    : null;
  const targetAngle = targetPlayer && Math.random() < 0.62
    ? wrapAngle(targetPlayer.angle + (Math.random() - 0.5) * 0.62)
    : Math.random() * TWO_PI;
  const enemy = {
    id: entityId(room, "e"),
    type,
    x: WORLD.width + 35,
    y: 54 + Math.random() * (WORLD.height - 108),
    angle: targetAngle,
    radial: LANE_RADIAL,
    depth: TUNNEL.spawnDepth,
    radius: type === "tank" ? 24 : type === "fast" ? 13 : 18,
    hp: baseHp,
    maxHp: baseHp,
    speed: room.speed + (type === "fast" ? 3.4 : type === "tank" ? 0.6 : 1.7) + (room.phase - 1) * 0.25,
    phase: Math.random() * Math.PI * 2,
    moving: room.elapsed >= ENEMY_MOTION_START_MS || room.phase > 1,
    orbitSpeed: (Math.random() > 0.5 ? 1 : -1) * (0.01 + Math.random() * 0.018),
    motionSeed: Math.random() * Math.PI * 2,
    value: type === "tank" ? 45 : type === "fast" ? 30 : type === "zigzag" ? 25 : 18
  };
  room.enemies.set(enemy.id, enemy);
  io.to(room.id).emit("spawnEnemy", enemy);
}

function spawnObstacle(room) {
  const sizeScale = 1 + Math.min(1.55, room.difficulty * 0.12 + (room.phase - 1) * 0.18);
  const obstacle = {
    id: entityId(room, "o"),
    type: Math.random() > 0.45 ? "asteroid" : "barrier",
    x: WORLD.width + 50,
    y: 60 + Math.random() * (WORLD.height - 120),
    angle: Math.random() * TWO_PI,
    radial: LANE_RADIAL,
    depth: TUNNEL.spawnDepth + 40,
    angleSpan: (0.2 + Math.random() * 0.28) * sizeScale,
    radius: (18 + Math.random() * 22) * sizeScale,
    width: 28 * sizeScale,
    height: (90 + Math.random() * 90) * sizeScale,
    speed: room.speed + 1.2 + room.phase * 0.25,
    sizeScale
  };
  room.obstacles.set(obstacle.id, obstacle);
  io.to(room.id).emit("spawnObstacle", obstacle);
}

function spawnPowerUp(room) {
  const types = ["upgrade", "upgrade", "upgrade", "shield", "rapid", "heal", "bonus"];
  const type = types[Math.floor(Math.random() * types.length)];
  const powerUp = {
    id: entityId(room, "p"),
    type,
    x: WORLD.width + 42,
    y: 70 + Math.random() * (WORLD.height - 140),
    angle: Math.random() * TWO_PI,
    radial: LANE_RADIAL,
    depth: TUNNEL.spawnDepth + 30,
    radius: 16,
    speed: room.speed + 0.8
  };
  room.powerUps.set(powerUp.id, powerUp);
  io.to(room.id).emit("spawnPowerUp", powerUp);
}

function shoot(room, player) {
  const time = now();
  const level = Math.max(1, Math.min(MAX_WEAPON_LEVEL, player.weaponLevel || 1));
  const cooldown = player.rapidUntil > time ? 105 : Math.max(155, 295 - level * 24);
  if (!player.alive || time - player.lastShotAt < cooldown) {
    return;
  }

  player.lastShotAt = time;
  const baseSpread = level === 1 ? [0]
    : level === 2 ? [-0.055, 0.055]
      : level === 3 ? [-0.095, 0, 0.095]
        : [-0.14, -0.048, 0.048, 0.14];
  const lanes = player.rapidUntil > time && level < MAX_WEAPON_LEVEL
    ? Array.from(new Set([...baseSpread, -0.16, 0.16])).sort((a, b) => a - b)
    : baseSpread;
  for (const offset of lanes) {
    const assistedAim = findAssistedAim(room, player, offset);
    const projectile = {
      id: entityId(room, "b"),
      ownerId: player.id,
      x: player.x + 23,
      y: player.y,
      angle: assistedAim.angle,
      radial: assistedAim.radial,
      depth: player.depth + 20,
      radius: 11,
      vx: 14,
      vz: 28,
      damage: level >= 4 && Math.abs(offset) < 0.06 ? 2 : 1,
      color: player.color
    };
    room.projectiles.set(projectile.id, projectile);
    io.to(room.id).emit("playerShoot", projectile);
  }
}

function findAssistedAim(room, player, offset) {
  const base = {
    angle: wrapAngle(player.angle + offset),
    radial: player.radial
  };
  let best = null;
  for (const enemy of room.enemies.values()) {
    if (enemy.depth < player.depth + 80 || enemy.depth > TUNNEL.spawnDepth + 40) {
      continue;
    }
    const angularDistance = angleDelta(base.angle, enemy.angle);
    const radialDistance = Math.abs(base.radial - enemy.radial);
    const score = angularDistance * 1.6 + radialDistance;
    if (angularDistance < 0.32 && radialDistance < 0.28 && (!best || score < best.score)) {
      best = { enemy, score };
    }
  }
  if (!best) {
    return base;
  }
  return {
    angle: wrapAngle(base.angle + signedShortestAngle(base.angle, best.enemy.angle) * 0.72),
    radial: base.radial + (best.enemy.radial - base.radial) * 0.72
  };
}

function signedShortestAngle(from, to) {
  let diff = wrapAngle(to) - wrapAngle(from);
  if (diff > Math.PI) diff -= TWO_PI;
  if (diff < -Math.PI) diff += TWO_PI;
  return diff;
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function circleRectCollision(circle, rect) {
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  const closestX = Math.max(rect.x - halfW, Math.min(circle.x, rect.x + halfW));
  const closestY = Math.max(rect.y - halfH, Math.min(circle.y, rect.y + halfH));
  const dx = circle.x - closestX;
  const dy = circle.y - closestY;
  return dx * dx + dy * dy <= circle.radius * circle.radius;
}

function damagePlayer(room, player, amount) {
  const time = now();
  if (!player.alive || player.invulnerableUntil > time) {
    return;
  }
  if (player.shieldUntil > time) {
    player.shieldUntil = 0;
    player.invulnerableUntil = time + 650;
    io.to(room.id).emit("playerDamaged", {
      playerId: player.id,
      lives: player.lives,
      shieldBlocked: true
    });
    return;
  }

  player.lives -= amount;
  player.streak = 0;
  player.invulnerableUntil = time + 900;
  io.to(room.id).emit("playerDamaged", {
    playerId: player.id,
    lives: player.lives,
    shieldBlocked: false
  });

  if (player.lives <= 0) {
    player.lives = 0;
    player.alive = false;
    player.spectator = true;
    io.to(room.id).emit("playerDied", {
      playerId: player.id,
      ranking: ranking(room)
    });
  }
}

function collectPowerUp(room, player, powerUp) {
  const time = now();
  let duration = 0;
  player.collected += 1;
  player.score += 40;
  if (powerUp.type === "upgrade") {
    player.totalUpgrades += 1;
    player.upgradeSlots = Math.min(MAX_UPGRADE_SLOTS, player.upgradeSlots + 1);
    player.weaponLevel = Math.min(MAX_WEAPON_LEVEL, player.weaponLevel + 1);
    player.score += 120 + player.upgradeSlots * 30;
    io.to(room.id).emit("weaponUpgraded", {
      playerId: player.id,
      weaponLevel: player.weaponLevel,
      upgradeSlots: player.upgradeSlots,
      maxWeaponLevel: MAX_WEAPON_LEVEL,
      maxUpgradeSlots: MAX_UPGRADE_SLOTS
    });
    if (player.upgradeSlots >= MAX_UPGRADE_SLOTS) {
      advancePhase(room, player);
    }
  } else if (powerUp.type === "shield") {
    duration = 6500;
    player.shieldUntil = time + duration;
  } else if (powerUp.type === "rapid") {
    duration = 6500;
    player.rapidUntil = time + duration;
  } else if (powerUp.type === "heal") {
    player.lives = Math.min(3, player.lives + 1);
  } else if (powerUp.type === "bonus") {
    player.score += 180;
  }
  room.powerUps.delete(powerUp.id);
  io.to(room.id).emit("powerUpCollected", {
    playerId: player.id,
    type: powerUp.type,
    duration,
    lives: player.lives,
    score: Math.floor(player.score),
    weaponLevel: player.weaponLevel
  });
  io.to(room.id).emit("scoreUpdate", {
    playerId: player.id,
    score: Math.floor(player.score),
    reason: `powerup:${powerUp.type}`
  });
}

function advancePhase(room, player) {
  room.phase += 1;
  room.phaseStartedElapsed = room.elapsed;
  room.speed = Math.max(6, room.speed * 0.58);
  room.difficulty = Math.max(1.25, room.difficulty * 0.58);
  room.spawn.enemy = Math.max(room.spawn.enemy, 900);
  room.spawn.obstacle = Math.max(room.spawn.obstacle, 1450);
  player.upgradeSlots = 0;
  player.score += 350 + room.phase * 80;

  for (const enemy of room.enemies.values()) {
    enemy.hp += 1;
    enemy.maxHp += 1;
    enemy.speed = Math.max(6.5, enemy.speed * 0.62);
  }
  for (const obstacle of room.obstacles.values()) {
    obstacle.speed = Math.max(6.2, obstacle.speed * 0.62);
  }
  for (const powerUp of room.powerUps.values()) {
    powerUp.speed = Math.max(6, powerUp.speed * 0.62);
  }

  io.to(room.id).emit("phaseChanged", {
    phase: room.phase,
    triggeredBy: player.id,
    nickname: player.nickname
  });
  io.to(room.id).emit("weaponUpgraded", {
    playerId: player.id,
    weaponLevel: player.weaponLevel,
    upgradeSlots: player.upgradeSlots,
    maxWeaponLevel: MAX_WEAPON_LEVEL,
    maxUpgradeSlots: MAX_UPGRADE_SLOTS
  });
}

function updateRoom(room, dt) {
  if (room.status !== "running") {
    return;
  }

  room.updatedAt = now();
  room.elapsed += dt;
  room.distance += dt * room.speed * 0.055;
  const seconds = room.elapsed / 1000;
  const phaseSeconds = Math.max(0, (room.elapsed - room.phaseStartedElapsed) / 1000);
  const endurancePressure = seconds * 0.045;
  room.difficulty = 1
    + (room.phase - 1) * 0.18
    + endurancePressure * 0.16
    + phaseSeconds / 24
    + Math.pow(phaseSeconds / 95, 2);
  room.speed = 5
    + (room.phase - 1) * 0.72
    + endurancePressure
    + phaseSeconds * 0.27
    + Math.pow(phaseSeconds / 18, 1.38);

  const angularMovement = 0.112 + Math.min(0.012, room.difficulty * 0.002);
  const alivePlayers = Array.from(room.players.values()).filter((player) => player.alive);

  for (const player of room.players.values()) {
    const input = room.inputs.get(player.id) || defaultInput();
    if (!player.alive) {
      continue;
    }
    if (input.left) player.angle -= angularMovement;
    if (input.right) player.angle += angularMovement;
    player.angle = wrapAngle(player.angle);
    player.radial = LANE_RADIAL;

    player.x = WORLD.width / 2 + Math.cos(player.angle) * TUNNEL.tubeRadius * player.radial;
    player.y = WORLD.height / 2 + Math.sin(player.angle) * TUNNEL.tubeRadius * player.radial * 0.72;
    player.x = Math.max(55, Math.min(WORLD.width * 0.48, player.x));
    player.y = Math.max(38, Math.min(WORLD.height - 38, player.y));
    player.distance = room.distance;
    player.score += dt * 0.018 * room.difficulty;
    if (input.shooting) shoot(room, player);
  }

  room.spawn.enemy -= dt;
  room.spawn.obstacle -= dt;
  room.spawn.powerUp -= dt;
  if (room.spawn.enemy <= 0) {
    const waveSize = Math.min(10, 1 + Math.floor(room.difficulty / 1.25) + Math.floor(room.speed / 18));
    for (let i = 0; i < waveSize; i += 1) {
      spawnEnemy(room);
    }
    room.spawn.enemy = Math.max(70, 780 - room.difficulty * 78 - room.speed * 7 - room.phase * 24 - Math.random() * 150);
  }
  if (room.spawn.obstacle <= 0) {
    spawnObstacle(room);
    room.spawn.obstacle = Math.max(260, 2100 - room.difficulty * 150 - room.speed * 5 - room.phase * 45 - Math.random() * 240);
  }
  if (room.spawn.powerUp <= 0) {
    spawnPowerUp(room);
    room.spawn.powerUp = Math.max(2200, 5600 - room.difficulty * 320 + Math.random() * 1100);
  }

  for (const enemy of room.enemies.values()) {
    enemy.depth -= enemy.speed;
    enemy.x = enemy.depth;
    if (room.elapsed >= ENEMY_MOTION_START_MS || room.phase > 1) {
      enemy.moving = true;
    }
    if (enemy.type === "zigzag") {
      enemy.phase += 0.12;
      enemy.angle = wrapAngle(enemy.angle + Math.sin(enemy.phase) * 0.018);
    }
    if (enemy.moving) {
      enemy.phase += 0.025;
      enemy.angle = wrapAngle(enemy.angle + enemy.orbitSpeed * (enemy.type === "fast" ? 1.45 : 1));
      enemy.radial = LANE_RADIAL;
    }
    if (enemy.depth < -80) {
      room.enemies.delete(enemy.id);
    }
  }

  for (const obstacle of room.obstacles.values()) {
    obstacle.depth -= obstacle.speed;
    obstacle.x = obstacle.depth;
    if (obstacle.depth < -90) {
      room.obstacles.delete(obstacle.id);
    }
  }

  for (const powerUp of room.powerUps.values()) {
    powerUp.depth -= powerUp.speed;
    powerUp.x = powerUp.depth;
    if (powerUp.depth < -50) {
      room.powerUps.delete(powerUp.id);
    }
  }

  for (const projectile of room.projectiles.values()) {
    projectile.depth += projectile.vz;
    projectile.x = projectile.depth;
    if (projectile.depth > TUNNEL.spawnDepth + 80) {
      room.projectiles.delete(projectile.id);
    }
  }

  for (const projectile of Array.from(room.projectiles.values())) {
    const owner = room.players.get(projectile.ownerId);
    for (const enemy of Array.from(room.enemies.values())) {
      if (projectileEnemyHit(projectile, enemy)) {
        enemy.hp -= projectile.damage;
        room.projectiles.delete(projectile.id);
        io.to(room.id).emit("hitEnemy", {
          enemyId: enemy.id,
          hp: enemy.hp,
          ownerId: projectile.ownerId
        });
        if (enemy.hp <= 0) {
          room.enemies.delete(enemy.id);
          if (owner) {
            owner.kills += 1;
            owner.streak += 1;
            owner.score += enemy.value + Math.min(80, owner.streak * 4);
            io.to(room.id).emit("scoreUpdate", {
              playerId: owner.id,
              score: Math.floor(owner.score),
              reason: "enemy"
            });
          }
        }
        break;
      }
    }
  }

  for (const player of alivePlayers) {
    for (const enemy of Array.from(room.enemies.values())) {
      if (tunnelHit(player, enemy, 34)) {
        room.enemies.delete(enemy.id);
        damagePlayer(room, player, 1);
      }
    }

    for (const obstacle of Array.from(room.obstacles.values())) {
      const obstacleRadius = obstacle.type === "barrier"
        ? obstacle.radius + obstacle.angleSpan * TUNNEL.tubeRadius * 0.42
        : obstacle.radius;
      const hit = Math.abs(player.depth - obstacle.depth) <= 36
        && tunnelSeparation(player, obstacle) <= player.radius + obstacleRadius;
      if (hit) {
        room.obstacles.delete(obstacle.id);
        damagePlayer(room, player, 1);
      }
    }

    for (const powerUp of Array.from(room.powerUps.values())) {
      if (tunnelHit(player, powerUp, 38)) {
        collectPowerUp(room, player, powerUp);
      }
    }
  }

  const anyAlive = Array.from(room.players.values()).some((player) => player.alive);
  if (!anyAlive && room.players.size > 0) {
    endRoom(room);
    return;
  }

  if (now() - room.lastStateAt > 30) {
    room.lastStateAt = now();
    io.to(room.id).emit("roomState", snapshotRoom(room));
    io.to(room.id).emit("playerState", snapshotRoom(room).players);
  }
}

function findPlayerRoom(socketId) {
  for (const room of rooms.values()) {
    if (room.players.has(socketId)) {
      return room;
    }
  }
  return null;
}

io.on("connection", (socket) => {
  socket.emit("connected", { id: socket.id });

  socket.on("joinRoom", ({ roomId, nickname, createIfMissing = false }, ack) => {
    const normalizedId = String(roomId || "").toUpperCase().trim();
    let room = normalizedId ? rooms.get(normalizedId) : null;
    if (!room && createIfMissing) {
      room = createRoom(nickname);
    }
    if (!room) {
      if (ack) ack({ ok: false, error: "Room not found" });
      return;
    }
    if (["running", "paused"].includes(room.status)) {
      if (ack) ack({ ok: false, error: "Game already running" });
      return;
    }

    socket.join(room.id);
    const player = makePlayer(socket, nickname, room);
    room.players.set(socket.id, player);
    room.inputs.set(socket.id, defaultInput());
    if (!room.hostId) {
      room.hostId = socket.id;
      room.hostNickname = player.nickname;
    }
    room.updatedAt = now();

    socket.emit("roomJoined", {
      selfId: socket.id,
      room: publicRoom(room),
      state: snapshotRoom(room)
    });
    socket.to(room.id).emit("playerJoined", {
      player,
      room: publicRoom(room)
    });
    io.to(room.id).emit("lobbyUpdate", publicRoom(room));
    if (ack) ack({ ok: true, selfId: socket.id, room: publicRoom(room) });
  });

  socket.on("startGame", ({ roomId } = {}, ack) => {
    const room = rooms.get(String(roomId || "").toUpperCase()) || findPlayerRoom(socket.id);
    if (!room) {
      if (ack) ack({ ok: false, error: "Room not found" });
      return;
    }
    if (room.hostId !== socket.id) {
      if (ack) ack({ ok: false, error: "Only the host can start" });
      return;
    }
    if (room.players.size < 1) {
      if (ack) ack({ ok: false, error: "Need at least one player" });
      return;
    }
    const started = startRoom(room);
    if (ack) ack({ ok: started });
  });

  socket.on("playerInput", (input = {}) => {
    const room = findPlayerRoom(socket.id);
    if (!room || room.status !== "running") {
      return;
    }
    room.inputs.set(socket.id, {
      left: Boolean(input.left),
      right: Boolean(input.right),
      shooting: Boolean(input.shooting)
    });
  });

  socket.on("playerShoot", () => {
    const room = findPlayerRoom(socket.id);
    const player = room && room.players.get(socket.id);
    if (room && room.status === "running" && player) {
      shoot(room, player);
    }
  });

  socket.on("pauseGame", ({ roomId } = {}, ack) => {
    const room = rooms.get(String(roomId || "").toUpperCase()) || findPlayerRoom(socket.id);
    const paused = setRoomPaused(room, true, socket.id);
    if (ack) ack({ ok: paused });
  });

  socket.on("resumeGame", ({ roomId } = {}, ack) => {
    const room = rooms.get(String(roomId || "").toUpperCase()) || findPlayerRoom(socket.id);
    const resumed = setRoomPaused(room, false, socket.id);
    if (ack) ack({ ok: resumed });
  });

  socket.on("hitEnemy", () => {
    // Collision is authoritative on the server tick.
  });

  socket.on("disconnect", () => {
    const room = findPlayerRoom(socket.id);
    if (!room) {
      return;
    }
    const player = room.players.get(socket.id);
    if (player && ["running", "paused"].includes(room.status)) {
      player.connected = false;
      player.alive = false;
      player.spectator = true;
    } else {
      room.players.delete(socket.id);
    }
    room.inputs.delete(socket.id);

    if (room.hostId === socket.id) {
      const nextHost = Array.from(room.players.values()).find((candidate) => candidate.connected);
      room.hostId = nextHost ? nextHost.id : null;
      room.hostNickname = nextHost ? nextHost.nickname : room.hostNickname;
    }

    io.to(room.id).emit("playerLeft", {
      playerId: socket.id,
      room: publicRoom(room)
    });
    io.to(room.id).emit("lobbyUpdate", publicRoom(room));

    const connectedPlayers = Array.from(room.players.values()).filter((p) => p.connected);
    if (connectedPlayers.length === 0) {
      room.status = "ended";
      room.endedAt = now();
    } else if (["running", "paused"].includes(room.status) && !connectedPlayers.some((p) => p.alive)) {
      endRoom(room);
    }
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    updateRoom(room, TICK_RATE);
    if (room.status === "ended" && now() - room.updatedAt > ROOM_TTL_MS) {
      rooms.delete(room.id);
    }
  }
}, TICK_RATE);

server.listen(PORT, () => {
  console.log(`Cosmic Velocity running at http://localhost:${PORT}`);
});
