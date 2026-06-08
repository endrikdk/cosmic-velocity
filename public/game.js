import * as THREE from "/vendor/three/three.module.js";

const socket = window.io();
const canvas = document.getElementById("gameCanvas");
const appShell = document.querySelector(".app-shell");

const TAU = Math.PI * 2;
const TUNNEL = {
  radius: 82,
  nearDepth: 72,
  farDepth: 1050,
  sides: 10,
  ringSpacing: 86
};

const screens = {
  menu: document.getElementById("menuScreen"),
  lobby: document.getElementById("lobbyScreen"),
  game: document.getElementById("gameScreen"),
  over: document.getElementById("gameOverScreen")
};

const ui = {
  nickname: document.getElementById("nicknameInput"),
  roomCode: document.getElementById("roomCodeInput"),
  createRoom: document.getElementById("createRoomBtn"),
  joinRoom: document.getElementById("joinRoomBtn"),
  solo: document.getElementById("soloBtn"),
  startGame: document.getElementById("startGameBtn"),
  copyCode: document.getElementById("copyCodeBtn"),
  backToMenu: document.getElementById("backToMenuBtn"),
  roomCodeLabel: document.getElementById("roomCodeLabel"),
  lobbyStatus: document.getElementById("lobbyStatus"),
  playerList: document.getElementById("playerList"),
  globalLeaderboard: document.getElementById("globalLeaderboard"),
  life: document.getElementById("lifeLabel"),
  score: document.getElementById("scoreLabel"),
  distance: document.getElementById("distanceLabel"),
  phase: document.getElementById("phaseLabel"),
  weapon: document.getElementById("weaponLabel"),
  connection: document.getElementById("connectionLabel"),
  alive: document.getElementById("aliveLabel"),
  roomRanking: document.getElementById("roomRanking"),
  finalTitle: document.getElementById("finalTitle"),
  finalScore: document.getElementById("finalScore"),
  finalRanking: document.getElementById("finalRanking"),
  playAgain: document.getElementById("playAgainBtn"),
  menuAgain: document.getElementById("menuAgainBtn"),
  toast: document.getElementById("toast"),
  upgradeBars: document.getElementById("upgradeBars"),
  buffList: document.getElementById("buffList"),
  phaseBanner: document.getElementById("phaseBanner"),
  pauseOverlay: document.getElementById("pauseOverlay"),
  pauseStatus: document.getElementById("pauseStatus"),
  resumeGame: document.getElementById("resumeGameBtn"),
  pauseMenu: document.getElementById("pauseMenuBtn"),
  musicToggle: document.getElementById("musicToggleBtn"),
  musicToggleLabel: document.getElementById("musicToggleLabel")
};

const keys = new Set();
const state = {
  selfId: null,
  roomId: null,
  current: null,
  screen: "menu",
  shootingByPointer: false,
  lastInputSent: 0,
  lastFrame: performance.now(),
  frameDelta: 16.67,
  lastSnapshotAt: performance.now(),
  cameraRoll: -Math.PI / 2,
  tunnelOffset: 0,
  phase: 1,
  paused: false,
  buffPickups: [],
  musicEnabled: localStorage.getItem("cosmicMusic") !== "off"
};

const hubMusic = {
  context: null,
  master: null,
  timer: null,
  step: 0
};

const POWER_UP_INFO = {
  shield: { icon: "S", name: "Escudo", detail: "Bloqueia 1 impacto", tone: "green" },
  rapid: { icon: "R", name: "Tiro rapido", detail: "Disparos mais velozes", tone: "gold" },
  heal: { icon: "+", name: "Reparo", detail: "Recupera 1 vida", tone: "cyan" },
  bonus: { icon: "*", name: "Bonus", detail: "Pontuacao extra", tone: "pink" },
  upgrade: { icon: "W", name: "Arma", detail: "Aumenta o poder de fogo", tone: "weapon" }
};

const PHASES = [
  {
    name: "Cold Wire",
    fog: 0x070710,
    tunnel: 0xf2f2e9,
    tunnelDim: 0x555565,
    enemy: 0xff2f7a,
    fast: 0xffe66d,
    tank: 0xff5e78,
    backdropA: 0x151520,
    backdropB: 0x101019
  },
  {
    name: "Cyan Rift",
    fog: 0x03131c,
    tunnel: 0x4df7ff,
    tunnelDim: 0x245f70,
    enemy: 0x79ffea,
    fast: 0xfff16a,
    tank: 0xff6fa8,
    backdropA: 0x082332,
    backdropB: 0x061723
  },
  {
    name: "Violet Burn",
    fog: 0x13091d,
    tunnel: 0xff4de3,
    tunnelDim: 0x5a285a,
    enemy: 0xff75a8,
    fast: 0x78f7ff,
    tank: 0xff9057,
    backdropA: 0x21102d,
    backdropB: 0x12091c
  },
  {
    name: "Solar Grid",
    fog: 0x160f05,
    tunnel: 0xffe66d,
    tunnelDim: 0x735d22,
    enemy: 0xff9057,
    fast: 0x6dff8d,
    tank: 0xff3c5f,
    backdropA: 0x251806,
    backdropB: 0x120d05
  }
];

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  alpha: false,
  powerPreference: "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setClearColor(0x070710, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x070710, 0.0018);

const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.1, 1600);
camera.position.set(0, -8, 76);
camera.lookAt(0, 0, -420);

const worldRoot = new THREE.Group();
scene.add(worldRoot);

const tunnelGroup = new THREE.Group();
worldRoot.add(tunnelGroup);

const entityGroup = new THREE.Group();
worldRoot.add(entityGroup);

const playerMeshes = new Map();
const enemyMeshes = new Map();
const obstacleMeshes = new Map();
const powerUpMeshes = new Map();
const projectileMeshes = new Map();
const labelSprites = new Map();

const materials = {
  tunnel: new THREE.LineBasicMaterial({ color: 0xf2f2e9, transparent: true, opacity: 0.72 }),
  tunnelDim: new THREE.LineBasicMaterial({ color: 0x555565, transparent: true, opacity: 0.34 }),
  ship: new THREE.MeshBasicMaterial({ color: 0xf4f4ee, wireframe: true }),
  shipFill: new THREE.MeshBasicMaterial({ color: 0x10101c, side: THREE.DoubleSide }),
  enemy: new THREE.MeshBasicMaterial({ color: 0xff2f7a, wireframe: true }),
  fastEnemy: new THREE.MeshBasicMaterial({ color: 0xffe66d, wireframe: true }),
  tankEnemy: new THREE.MeshBasicMaterial({ color: 0xff5e78, wireframe: true }),
  obstacle: new THREE.MeshBasicMaterial({ color: 0xbabac6, wireframe: true }),
  barrier: new THREE.MeshBasicMaterial({ color: 0xf4f4ee, side: THREE.DoubleSide, transparent: true, opacity: 0.52 }),
  powerShield: new THREE.MeshBasicMaterial({ color: 0x6dff8d, wireframe: true }),
  powerRapid: new THREE.MeshBasicMaterial({ color: 0xffe66d, wireframe: true }),
  powerHeal: new THREE.MeshBasicMaterial({ color: 0x4df7ff, wireframe: true }),
  powerBonus: new THREE.MeshBasicMaterial({ color: 0xff4de3, wireframe: true }),
  powerUpgrade: new THREE.MeshBasicMaterial({ color: 0xfff16a, wireframe: true }),
  projectile: new THREE.MeshBasicMaterial({ color: 0xffffff })
};

buildTunnel();
createBackdropPlanes();
resizeRenderer();
window.addEventListener("resize", resizeRenderer);

function showScreen(name) {
  state.screen = name;
  appShell.dataset.screen = name;
  Object.values(screens).forEach((screen) => screen.classList.remove("screen-active"));
  screens[name].classList.add("screen-active");
  updateHubMusic();
  resizeRenderer();
}

function initHubMusic() {
  if (hubMusic.context) {
    if (hubMusic.context.state === "suspended") hubMusic.context.resume();
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    state.musicEnabled = false;
    updateMusicToggle();
    return;
  }

  const context = new AudioContextClass();
  const master = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const filter = context.createBiquadFilter();
  master.gain.value = 0;
  filter.type = "lowpass";
  filter.frequency.value = 1250;
  filter.Q.value = 0.7;
  master.connect(filter);
  filter.connect(compressor);
  compressor.connect(context.destination);
  hubMusic.context = context;
  hubMusic.master = master;

  const drone = [55, 82.41];
  drone.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = index ? "triangle" : "sine";
    oscillator.frequency.value = frequency;
    gain.gain.value = index ? 0.06 : 0.085;
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start();
  });

  scheduleHubPhrase();
  hubMusic.timer = window.setInterval(scheduleHubPhrase, 8000);
  updateHubMusic();
}

function scheduleHubPhrase() {
  const context = hubMusic.context;
  if (!context || !hubMusic.master) return;
  const chords = [
    [220, 261.63, 329.63],
    [196, 246.94, 293.66],
    [174.61, 220, 261.63],
    [196, 246.94, 329.63]
  ];
  const chord = chords[hubMusic.step % chords.length];
  const start = context.currentTime + 0.08;
  chord.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = index === 1 ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.detune.value = index === 2 ? 5 : index === 0 ? -4 : 0;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.032, start + 1.4 + index * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 7.4);
    oscillator.connect(gain);
    gain.connect(hubMusic.master);
    oscillator.start(start);
    oscillator.stop(start + 7.6);
  });
  hubMusic.step += 1;
}

function updateHubMusic() {
  if (!hubMusic.context || !hubMusic.master) return;
  const isHub = ["menu", "lobby", "over"].includes(state.screen);
  const target = state.musicEnabled ? (isHub ? 0.42 : 0.035) : 0.0001;
  const time = hubMusic.context.currentTime;
  hubMusic.master.gain.cancelScheduledValues(time);
  hubMusic.master.gain.setTargetAtTime(target, time, isHub ? 0.8 : 0.35);
}

function updateMusicToggle() {
  ui.musicToggle.setAttribute("aria-pressed", state.musicEnabled ? "true" : "false");
  ui.musicToggleLabel.textContent = state.musicEnabled ? "Som ligado" : "Som desligado";
}

function toggleHubMusic() {
  state.musicEnabled = !state.musicEnabled;
  localStorage.setItem("cosmicMusic", state.musicEnabled ? "on" : "off");
  if (state.musicEnabled) initHubMusic();
  updateMusicToggle();
  updateHubMusic();
}

function toast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => ui.toast.classList.remove("show"), 2600);
}

function nickname() {
  return ui.nickname.value.trim() || "Pilot";
}

async function fetchLeaderboard() {
  try {
    const response = await fetch("/api/leaderboard");
    const data = await response.json();
    renderLeaderboard(ui.globalLeaderboard, data.leaderboard || []);
  } catch (error) {
    renderLeaderboard(ui.globalLeaderboard, []);
  }
}

async function createRoom(joinAfterCreate) {
  const response = await fetch("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname: nickname() })
  });
  const data = await response.json();
  const roomId = data.room.id;
  ui.roomCode.value = roomId;
  if (joinAfterCreate) {
    joinRoom(roomId);
  }
}

function joinRoom(roomId, createIfMissing) {
  const targetRoom = String(roomId || ui.roomCode.value || "").trim().toUpperCase();
  socket.emit(
    "joinRoom",
    {
      roomId: targetRoom,
      nickname: nickname(),
      createIfMissing: Boolean(createIfMissing)
    },
    (reply) => {
      if (!reply || !reply.ok) {
        toast((reply && reply.error) || "Nao foi possivel entrar na sala.");
      }
    }
  );
}

function renderLobby(room) {
  if (!room) return;
  state.roomId = room.id;
  ui.roomCodeLabel.textContent = room.id;
  ui.lobbyStatus.textContent = room.playerCount >= 2
    ? "Pronto para iniciar."
    : "Aguardando outro jogador. Tambem funciona solo para teste.";
  ui.playerList.innerHTML = "";
  room.players.forEach((player) => {
    const row = document.createElement("div");
    row.className = "player-row";
    row.innerHTML = `<strong>${escapeHtml(player.nickname)}</strong><span class="status">${player.connected ? "online" : "offline"}</span>`;
    ui.playerList.appendChild(row);
  });
  ui.startGame.disabled = state.selfId !== room.hostId;
}

function renderLeaderboard(list, entries) {
  list.innerHTML = "";
  if (!entries.length) {
    const empty = document.createElement("li");
    empty.textContent = "Sem pontuacoes ainda";
    list.appendChild(empty);
    return;
  }
  entries.slice(0, 8).forEach((entry) => {
    const item = document.createElement("li");
    item.innerHTML = `<span><strong>${escapeHtml(entry.nickname)}</strong></span><span>${Math.floor(entry.score)}</span>`;
    list.appendChild(item);
  });
}

function renderRoomRanking(snapshot) {
  renderLeaderboard(ui.roomRanking, snapshot.ranking || []);
  const self = getSelf(snapshot);
  ui.life.textContent = self ? self.lives : 0;
  ui.score.textContent = self ? self.score : 0;
  ui.distance.textContent = snapshot.distance || 0;
  ui.phase.textContent = snapshot.phase || 1;
  ui.weapon.textContent = `${self ? self.weaponLevel || 1 : 1}/${snapshot.maxWeaponLevel || 4}`;
  const alive = (snapshot.players || []).filter((player) => player.alive).length;
  ui.alive.textContent = `${alive} vivos`;
  renderUpgradeBars(snapshot);
  renderBuffHub(self);
}

function addBuffPickup(type, duration = 0) {
  const info = POWER_UP_INFO[type];
  if (!info) return;
  const time = performance.now();
  state.buffPickups = state.buffPickups.filter((entry) => entry.type !== type);
  state.buffPickups.unshift({
    type,
    collectedAt: time,
    expiresAt: time + (duration || 3600)
  });
  state.buffPickups = state.buffPickups.slice(0, 4);
}

function renderBuffHub(player) {
  if (!ui.buffList) return;
  const time = performance.now();
  state.buffPickups = state.buffPickups.filter((entry) => entry.expiresAt > time);
  const entries = [];

  if (player && player.shieldRemaining > 0) {
    entries.push({ type: "shield", remaining: player.shieldRemaining, active: true });
  }
  if (player && player.rapidRemaining > 0) {
    entries.push({ type: "rapid", remaining: player.rapidRemaining, active: true });
  }
  for (const pickup of state.buffPickups) {
    if (entries.some((entry) => entry.type === pickup.type)) continue;
    entries.push({
      type: pickup.type,
      remaining: Math.max(0, pickup.expiresAt - time),
      active: false
    });
  }

  if (!entries.length) {
    ui.buffList.innerHTML = '<div class="buff-empty">Nenhum efeito ativo</div>';
    return;
  }

  ui.buffList.innerHTML = entries.slice(0, 4).map((entry) => {
    const info = POWER_UP_INFO[entry.type];
    const timeLabel = entry.active
      ? `${Math.max(0.1, entry.remaining / 1000).toFixed(1)}s`
      : "Coletado";
    const progress = entry.active ? Math.max(0, Math.min(1, entry.remaining / 6500)) : 1;
    return `
      <div class="buff-item tone-${info.tone}">
        <div class="buff-icon" aria-hidden="true">${info.icon}</div>
        <div class="buff-copy">
          <strong>${info.name}</strong>
          <span>${info.detail}</span>
          <div class="buff-timer"><i style="transform:scaleX(${progress})"></i></div>
        </div>
        <time>${timeLabel}</time>
      </div>
    `;
  }).join("");
}

function renderUpgradeBars(snapshot) {
  const players = snapshot.players || [];
  const maxSlots = snapshot.maxUpgradeSlots || 4;
  ui.upgradeBars.innerHTML = "";
  players.forEach((player) => {
    const row = document.createElement("div");
    row.className = "upgrade-row";

    const name = document.createElement("div");
    name.className = "upgrade-name";
    name.textContent = player.nickname;

    const slots = document.createElement("div");
    slots.className = "upgrade-slots";
    for (let i = 0; i < maxSlots; i += 1) {
      const slot = document.createElement("span");
      slot.className = `upgrade-slot ${i < (player.upgradeSlots || 0) ? "filled" : ""}`;
      slots.appendChild(slot);
    }

    row.append(name, slots);
    ui.upgradeBars.appendChild(row);
  });
}

function getSelf(snapshot) {
  return snapshot && snapshot.players && snapshot.players.find((player) => player.id === state.selfId);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function currentInput() {
  return {
    left: keys.has("KeyA") || keys.has("ArrowLeft"),
    right: keys.has("KeyS") || keys.has("KeyD") || keys.has("ArrowRight"),
    shooting: keys.has("Space") || state.shootingByPointer
  };
}

function sendInput(time) {
  if (state.screen !== "game" || state.paused || !state.roomId || time - state.lastInputSent < 34) {
    return;
  }
  state.lastInputSent = time;
  socket.emit("playerInput", currentInput());
}

function buildTunnel() {
  const rings = new THREE.Group();
  const ringGeometry = new THREE.BufferGeometry();
  const ringPositions = [];

  for (let i = 0; i <= TUNNEL.sides; i += 1) {
    const angle = (i / TUNNEL.sides) * TAU;
    ringPositions.push(
      Math.cos(angle) * TUNNEL.radius,
      Math.sin(angle) * TUNNEL.radius,
      0
    );
  }
  ringGeometry.setAttribute("position", new THREE.Float32BufferAttribute(ringPositions, 3));

  for (let z = -TUNNEL.nearDepth; z > -TUNNEL.farDepth; z -= TUNNEL.ringSpacing) {
    const ring = new THREE.Line(ringGeometry, materials.tunnel);
    ring.position.z = z;
    rings.add(ring);
  }

  const railPositions = [];
  for (let i = 0; i < TUNNEL.sides; i += 1) {
    const angle = (i / TUNNEL.sides) * TAU;
    const x = Math.cos(angle) * TUNNEL.radius;
    const y = Math.sin(angle) * TUNNEL.radius;
    railPositions.push(x, y, -TUNNEL.nearDepth, x, y, -TUNNEL.farDepth);
  }
  const railGeometry = new THREE.BufferGeometry();
  railGeometry.setAttribute("position", new THREE.Float32BufferAttribute(railPositions, 3));
  const rails = new THREE.LineSegments(railGeometry, materials.tunnelDim);

  tunnelGroup.add(rings, rails);
}

function createBackdropPlanes() {
  const shape = new THREE.Shape();
  shape.moveTo(-900, -500);
  shape.lineTo(900, -500);
  shape.lineTo(900, 500);
  shape.lineTo(-900, 500);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);

  for (let i = 0; i < 5; i += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: i % 2 ? 0x151520 : 0x101019,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.36
    });
    const plane = new THREE.Mesh(geometry, material);
    plane.position.z = -620 - i * 180;
    plane.position.y = i % 2 ? 145 : -145;
    plane.rotation.z = i * 0.47;
    plane.userData.backdrop = true;
    plane.userData.backdropIndex = i;
    scene.add(plane);
  }
}

function phasePalette(phase) {
  return PHASES[((phase || 1) - 1) % PHASES.length];
}

function applyPhasePalette(phase) {
  if (state.phase === phase) return;
  state.phase = phase;
  const palette = phasePalette(phase);
  scene.fog.color.setHex(palette.fog);
  renderer.setClearColor(palette.fog, 1);
  materials.tunnel.color.setHex(palette.tunnel);
  materials.tunnelDim.color.setHex(palette.tunnelDim);

  scene.children.forEach((child) => {
    if (child.userData.backdrop && child.material) {
      child.material.color.setHex(child.userData.backdropIndex % 2 ? palette.backdropA : palette.backdropB);
    }
  });
  recolorEnemyMeshes(phase);
}

function showPhaseBanner(phase) {
  ui.phaseBanner.textContent = `Fase ${phase}`;
  ui.phaseBanner.classList.add("show");
  window.clearTimeout(showPhaseBanner.timer);
  showPhaseBanner.timer = window.setTimeout(() => {
    ui.phaseBanner.classList.remove("show");
  }, 1300);
}

function showPauseOverlay(show, message = "A sala esta pausada.") {
  state.paused = show;
  if (!ui.pauseOverlay) return;
  ui.pauseOverlay.classList.toggle("show", show);
  ui.pauseOverlay.setAttribute("aria-hidden", show ? "false" : "true");
  if (ui.pauseStatus) {
    ui.pauseStatus.textContent = message;
  }
}

function requestPause() {
  if (state.screen !== "game" || !state.roomId) return;
  socket.emit("pauseGame", { roomId: state.roomId }, (reply) => {
    if (!reply || !reply.ok) {
      toast("Nao foi possivel pausar agora.");
    }
  });
}

function requestResume() {
  if (state.screen !== "game" || !state.roomId) return;
  socket.emit("resumeGame", { roomId: state.roomId }, (reply) => {
    if (!reply || !reply.ok) {
      toast("Nao foi possivel continuar agora.");
    }
  });
}

function togglePause() {
  if (state.paused || (state.current && state.current.status === "paused")) {
    requestResume();
  } else {
    requestPause();
  }
}

function enemyColorForType(type, phase = state.phase) {
  const palette = phasePalette(phase);
  if (type === "tank") return palette.tank;
  if (type === "fast") return palette.fast;
  return palette.enemy;
}

function recolorEnemyMeshes(phase) {
  for (const mesh of enemyMeshes.values()) {
    const color = enemyColorForType(mesh.userData.enemyType, phase);
    mesh.traverse((node) => {
      if (!node.material) return;
      node.userData.baseColor = color;
      if (node.material.userData) node.material.userData.baseColor = color;
      node.material.color.setHex(color);
    });
  }
}

function resizeRenderer() {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.floor(rect.width || 960));
  const height = Math.max(180, Math.floor(rect.height || 540));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function tunnelPosition(entity) {
  const angle = Number.isFinite(entity.angle) ? entity.angle : Math.PI / 2;
  const radial = Number.isFinite(entity.radial) ? entity.radial : 0.82;
  const depth = Number.isFinite(entity.depth) ? entity.depth : entity.x || TUNNEL.nearDepth;
  return new THREE.Vector3(
    Math.cos(angle) * TUNNEL.radius * radial,
    Math.sin(angle) * TUNNEL.radius * radial,
    -depth
  );
}

function colorFromHex(value, fallback = 0xf4f4ee) {
  if (!value || typeof value !== "string") return fallback;
  return Number.parseInt(value.replace("#", ""), 16) || fallback;
}

function disposeMesh(mesh) {
  entityGroup.remove(mesh);
  mesh.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    if (node.material && !Object.values(materials).includes(node.material)) {
      if (node.material.map) node.material.map.dispose();
      node.material.dispose();
    }
  });
}

function moveSmooth(mesh, target, amount) {
  if (!mesh.userData.initialized) {
    mesh.position.copy(target);
    mesh.userData.initialized = true;
    return;
  }
  const normalized = 1 - Math.pow(1 - amount, state.frameDelta / 16.67);
  mesh.position.lerp(target, Math.max(0.01, Math.min(0.92, normalized)));
}

function createShipMesh(player) {
  const group = new THREE.Group();

  const shape = new THREE.Shape();
  shape.moveTo(0, 7.2);
  shape.lineTo(-8.8, -6.8);
  shape.lineTo(0, -2.8);
  shape.lineTo(8.8, -6.8);
  shape.closePath();

  const fill = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    materials.shipFill.clone()
  );
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 7.2, 0),
      new THREE.Vector3(-8.8, -6.8, 0),
      new THREE.Vector3(0, -2.8, 0),
      new THREE.Vector3(8.8, -6.8, 0)
    ]),
    materials.ship.clone()
  );
  outline.material.color.setHex(colorFromHex(player.color));

  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(3.2, 11, 3),
    new THREE.MeshBasicMaterial({ color: 0xff9057, wireframe: true })
  );
  flame.position.y = -13;
  flame.rotation.x = Math.PI;

  group.add(fill, outline, flame);
  group.userData.outline = outline;
  group.userData.flame = flame;
  return group;
}

function createEnemyMesh(enemy) {
  const color = enemyColorForType(enemy.type);
  const group = new THREE.Group();
  group.userData.enemyType = enemy.type;

  const coreGeometry = enemy.type === "tank"
    ? new THREE.DodecahedronGeometry(8.8, 0)
    : new THREE.OctahedronGeometry(enemy.type === "fast" ? 5.8 : 7.2, 0);
  const core = new THREE.Mesh(coreGeometry, new THREE.MeshBasicMaterial({ color, wireframe: true }));
  core.userData.baseColor = color;

  const wingMaterial = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.96 });
  wingMaterial.userData = { baseColor: color };
  const wingSpan = enemy.type === "tank" ? 18 : 13;
  const wingGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-wingSpan, 0, 0),
    new THREE.Vector3(0, 5.5, 0),
    new THREE.Vector3(wingSpan, 0, 0),
    new THREE.Vector3(0, -5.5, 0),
    new THREE.Vector3(-wingSpan, 0, 0)
  ]);
  const wings = new THREE.Line(wingGeometry, wingMaterial);

  const antennaGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, enemy.type === "fast" ? 18 : 13, 0)
  ]);
  const antenna = new THREE.Line(antennaGeometry, wingMaterial.clone());
  antenna.material.userData = { baseColor: color };

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(enemy.type === "tank" ? 12 : 9, 0.8, 4, 16),
    new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.72 })
  );
  halo.userData.baseColor = color;

  group.add(core, wings, antenna, halo);
  group.userData.core = core;
  group.userData.wings = wings;
  group.userData.antenna = antenna;
  group.userData.halo = halo;
  return group;
}

function createObstacleMesh(obstacle) {
  if (obstacle.type === "barrier") {
    const group = new THREE.Group();
    const span = obstacle.angleSpan || 0.36;
    const points = [];
    for (let i = -1; i <= 1; i += 0.25) {
      const angle = (obstacle.angle || 0) + span * i;
      points.push(new THREE.Vector3(
        Math.cos(angle) * TUNNEL.radius * (obstacle.radial || 0.9),
        Math.sin(angle) * TUNNEL.radius * (obstacle.radial || 0.9),
        0
      ));
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0xf4f4ee, transparent: true, opacity: 0.95 })
    );
    group.add(line);
    group.userData.absoluteTunnel = true;
    return group;
  }
  return new THREE.Mesh(
    new THREE.IcosahedronGeometry(10, 0),
    materials.obstacle.clone()
  );
}

function createGlowSprite(color) {
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = 128;
  glowCanvas.height = 128;
  const context = glowCanvas.getContext("2d");
  const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 62);
  gradient.addColorStop(0, "rgba(255,255,255,0.95)");
  gradient.addColorStop(0.18, color);
  gradient.addColorStop(0.48, color.replace("1)", "0.34)"));
  gradient.addColorStop(1, "rgba(255,220,70,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(glowCanvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  }));
  sprite.scale.set(46, 46, 1);
  return sprite;
}

function createPowerUpMesh(powerUp) {
  const material = {
    upgrade: materials.powerUpgrade,
    shield: materials.powerShield,
    rapid: materials.powerRapid,
    heal: materials.powerHeal,
    bonus: materials.powerBonus
  }[powerUp.type] || materials.powerBonus;
  if (powerUp.type === "upgrade") {
    const group = new THREE.Group();
    const glow = createGlowSprite("rgba(255,214,64,1)");
    const outerRing = new THREE.Mesh(
      new THREE.TorusGeometry(13.5, 0.7, 6, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true })
    );
    outerRing.userData.baseColor = 0xffffff;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(9.5, 1.7, 8, 32), material.clone());
    ring.userData.baseColor = 0xfff16a;
    const inner = new THREE.Mesh(
      new THREE.OctahedronGeometry(5.8, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.86 })
    );
    inner.userData.baseColor = 0xffffff;
    const beacon = new THREE.Mesh(
      new THREE.RingGeometry(15.5, 17, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffe66d,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.46
      })
    );
    beacon.userData.baseColor = 0xffe66d;
    group.add(glow, outerRing, ring, inner, beacon);
    group.userData.powerType = "upgrade";
    group.userData.glow = glow;
    group.userData.outerRing = outerRing;
    group.userData.ring = ring;
    group.userData.inner = inner;
    group.userData.beacon = beacon;
    return group;
  }
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(7, 1.8, 6, 16), material.clone());
  mesh.userData.powerType = powerUp.type;
  mesh.userData.baseColor = mesh.material.color.getHex();
  return mesh;
}

function createProjectileMesh(projectile) {
  const geometry = new THREE.CylinderGeometry(0.9, 0.9, 16, 5);
  const material = materials.projectile.clone();
  material.color.setHex(colorFromHex(projectile.color, 0xffffff));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function syncCollection(collection, meshes, createMesh, updateMesh) {
  const seen = new Set();
  collection.forEach((entity) => {
    seen.add(entity.id);
    if (!meshes.has(entity.id)) {
      const mesh = createMesh(entity);
      meshes.set(entity.id, mesh);
      entityGroup.add(mesh);
    }
    updateMesh(meshes.get(entity.id), entity);
  });

  for (const [id, mesh] of meshes) {
    if (!seen.has(id)) {
      disposeMesh(mesh);
      meshes.delete(id);
    }
  }
}

function updateShip(mesh, player) {
  mesh.visible = player.connected !== false;
  const target = tunnelPosition(player);
  moveSmooth(mesh, target, player.id === state.selfId ? 0.42 : 0.26);
  mesh.scale.setScalar(player.id === state.selfId ? 1.25 : 0.92);
  const targetRoll = (player.angle || 0) - Math.PI / 2;
  mesh.rotation.z += signedAngleDelta(targetRoll, mesh.rotation.z) * 0.32;
  mesh.rotation.x += (-0.28 - mesh.rotation.x) * 0.24;
  mesh.userData.outline.material.color.setHex(colorFromHex(player.color));
  mesh.userData.flame.visible = player.alive;
  mesh.children.forEach((child) => {
    child.material.opacity = player.alive ? 1 : 0.32;
    child.material.transparent = !player.alive;
  });
}

function updateEntity(mesh, entity) {
  const now = performance.now();
  if (mesh.userData.absoluteTunnel) {
    const target = new THREE.Vector3(0, 0, -(entity.depth || TUNNEL.farDepth));
    moveSmooth(mesh, target, 0.32);
  } else {
    const target = tunnelPosition(entity);
    moveSmooth(mesh, target, entity.ownerId ? 0.55 : 0.3);
    const frameScale = state.frameDelta / 16.67;
    mesh.rotation.x += 0.035 * frameScale;
    mesh.rotation.y += 0.025 * frameScale;
  }
  const scale = Math.max(0.7, 1.8 - (entity.depth || 0) / 900);
  const difficultyScale = entity.sizeScale || 1;
  mesh.scale.setScalar(scale * difficultyScale);

  if (mesh.userData.enemyType) {
    animateEnemyMesh(mesh, entity, now);
  }
  if (mesh.userData.powerType) {
    animatePowerUpMesh(mesh, entity, now);
  }

  const flashing = mesh.userData.flashUntil > now;
  mesh.traverse((node) => {
    if (!node.material) return;
    const baseColor = node.userData.baseColor || node.material.userData?.baseColor || mesh.userData.baseColor;
    if (baseColor) {
      node.material.color.setHex(flashing ? 0xffffff : baseColor);
    }
  });
}

function animateEnemyMesh(mesh, entity, time) {
  const t = time * 0.006 + (entity.phase || 0);
  const frameScale = state.frameDelta / 16.67;
  if (mesh.userData.enemyType === "fast") {
    mesh.userData.halo.rotation.z += 0.16 * frameScale;
    mesh.userData.halo.scale.setScalar(1 + Math.sin(t * 2.2) * 0.18);
    mesh.userData.antenna.rotation.z = Math.sin(t * 3.1) * 0.32;
  } else if (mesh.userData.enemyType === "tank") {
    mesh.userData.halo.rotation.x += 0.035 * frameScale;
    mesh.userData.halo.rotation.y += 0.02 * frameScale;
    mesh.userData.wings.scale.x = 1.15 + Math.sin(t) * 0.08;
  } else {
    mesh.userData.halo.rotation.z -= 0.07 * frameScale;
    mesh.userData.wings.rotation.z = Math.sin(t * 1.7) * 0.18;
    mesh.userData.core.scale.setScalar(1 + Math.sin(t * 2.4) * 0.08);
  }
}

function animatePowerUpMesh(mesh, entity, time) {
  const t = time * 0.006 + (entity.phase || 0);
  const frameScale = state.frameDelta / 16.67;
  if (mesh.userData.powerType === "upgrade") {
    mesh.userData.ring.rotation.z += 0.16 * frameScale;
    mesh.userData.outerRing.rotation.z -= 0.09 * frameScale;
    mesh.userData.outerRing.rotation.x = Math.sin(t * 0.8) * 0.42;
    mesh.userData.inner.rotation.x += 0.11 * frameScale;
    mesh.userData.inner.rotation.y -= 0.075 * frameScale;
    mesh.userData.beacon.rotation.z += 0.045 * frameScale;
    mesh.userData.glow.material.opacity = 0.68 + Math.sin(t * 2.6) * 0.22;
    mesh.userData.glow.scale.setScalar(45 + Math.sin(t * 2.6) * 7);
    mesh.scale.multiplyScalar(1.18 + Math.sin(t * 2.2) * 0.045);
  } else {
    mesh.rotation.z += 0.08 * frameScale;
    mesh.rotation.x = Math.sin(t) * 0.35;
  }
}

function syncScene(snapshot) {
  if (!snapshot) return;
  applyPhasePalette(snapshot.phase || 1);
  const visualSnapshot = makeVisualSnapshot(snapshot);
  const self = getSelf(visualSnapshot);
  if (self && Number.isFinite(self.angle)) {
    const target = -self.angle - Math.PI / 2;
    state.cameraRoll += signedAngleDelta(target, state.cameraRoll) * 0.16;
  }

  tunnelGroup.rotation.z = state.cameraRoll;
  entityGroup.rotation.z = state.cameraRoll;

  syncCollection(visualSnapshot.players || [], playerMeshes, createShipMesh, updateShip);
  syncCollection(visualSnapshot.enemies || [], enemyMeshes, createEnemyMesh, updateEntity);
  syncCollection(visualSnapshot.obstacles || [], obstacleMeshes, createObstacleMesh, updateEntity);
  syncCollection(visualSnapshot.powerUps || [], powerUpMeshes, createPowerUpMesh, updateEntity);
  syncCollection(visualSnapshot.projectiles || [], projectileMeshes, createProjectileMesh, updateEntity);
}

function makeVisualSnapshot(snapshot) {
  const ageTicks = state.paused
    ? 0
    : Math.min(6, Math.max(0, (performance.now() - state.lastSnapshotAt) / 33.33));
  const input = currentInput();
  const players = (snapshot.players || []).map((player) => {
    if (player.id !== state.selfId || !player.alive) return player;
    const predicted = { ...player };
    const turn = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    predicted.angle = wrapAngle((predicted.angle || 0) + turn * 0.13);
    predicted.radial = 0.82;
    return predicted;
  });

  return {
    ...snapshot,
    players,
    enemies: (snapshot.enemies || []).map((enemy) => ({
      ...enemy,
      depth: Math.max(-90, (enemy.depth || 0) - (enemy.speed || 0) * ageTicks),
      angle: enemy.moving
        ? wrapAngle((enemy.angle || 0) + (enemy.orbitSpeed || 0) * ageTicks)
        : enemy.angle,
      radial: 0.82
    })),
    obstacles: (snapshot.obstacles || []).map((obstacle) => ({
      ...obstacle,
      depth: Math.max(-90, (obstacle.depth || 0) - (obstacle.speed || 0) * ageTicks)
    })),
    powerUps: (snapshot.powerUps || []).map((powerUp) => ({
      ...powerUp,
      depth: Math.max(-90, (powerUp.depth || 0) - (powerUp.speed || 0) * ageTicks)
    })),
    projectiles: (snapshot.projectiles || []).map((projectile) => ({
      ...projectile,
      depth: Math.min(1130, (projectile.depth || 0) + (projectile.vz || 0) * ageTicks)
    }))
  };
}

function animate(time) {
  state.frameDelta = Math.min(50, Math.max(8, time - state.lastFrame));
  state.lastFrame = time;
  const frameScale = state.frameDelta / 16.67;
  sendInput(time);
  const speed = state.paused ? 0 : state.current ? state.current.speed : 5;
  state.tunnelOffset = (state.tunnelOffset + speed * 0.46 * frameScale) % TUNNEL.ringSpacing;
  tunnelGroup.children.forEach((child) => {
    if (child.type === "Line") {
      child.position.z += speed * 0.46 * frameScale;
      if (child.position.z > -TUNNEL.nearDepth + TUNNEL.ringSpacing) {
        child.position.z -= TUNNEL.ringSpacing * 12;
      }
    }
  });

  scene.children.forEach((child) => {
    if (child.userData.backdrop) {
      child.rotation.z += 0.0004 * speed * frameScale;
      child.position.z += 0.08 * speed * frameScale;
      if (child.position.z > -230) child.position.z = -1180;
    }
  });

  if (state.current) {
    syncScene(state.current);
    renderRoomRanking(state.current);
  } else {
    const demoPlayer = {
      id: "demo",
      nickname: "",
      color: "#f4f4ee",
      alive: true,
      connected: true,
      angle: Math.PI / 2 + Math.sin(time * 0.001) * 0.45,
      radial: 0.82,
      depth: 80
    };
    syncCollection([demoPlayer], playerMeshes, createShipMesh, updateShip);
    syncCollection([], enemyMeshes, createEnemyMesh, updateEntity);
    syncCollection([], obstacleMeshes, createObstacleMesh, updateEntity);
    syncCollection([], powerUpMeshes, createPowerUpMesh, updateEntity);
    syncCollection([], projectileMeshes, createProjectileMesh, updateEntity);
    tunnelGroup.rotation.z += 0.003;
    entityGroup.rotation.z = tunnelGroup.rotation.z;
  }

  renderer.render(scene, camera);
  window.requestAnimationFrame(animate);
}

function wrapAngle(angle) {
  return ((angle % TAU) + TAU) % TAU;
}

function signedAngleDelta(target, current) {
  let diff = wrapAngle(target) - wrapAngle(current);
  if (diff > Math.PI) diff -= TAU;
  if (diff < -Math.PI) diff += TAU;
  return diff;
}

ui.createRoom.addEventListener("click", () => createRoom(true));
ui.joinRoom.addEventListener("click", () => joinRoom());
ui.solo.addEventListener("click", () => createRoom(true));
ui.startGame.addEventListener("click", () => {
  socket.emit("startGame", { roomId: state.roomId }, (reply) => {
    if (!reply || !reply.ok) {
      toast((reply && reply.error) || "Nao foi possivel iniciar.");
    }
  });
});
ui.copyCode.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(state.roomId || "");
    toast("Codigo copiado.");
  } catch (error) {
    toast(`Codigo da sala: ${state.roomId}`);
  }
});
ui.musicToggle.addEventListener("click", () => toggleHubMusic());
ui.backToMenu.addEventListener("click", () => window.location.reload());
ui.resumeGame.addEventListener("click", () => requestResume());
ui.pauseMenu.addEventListener("click", () => window.location.reload());
ui.playAgain.addEventListener("click", () => {
  showScreen("lobby");
  socket.emit("startGame", { roomId: state.roomId });
});
ui.menuAgain.addEventListener("click", () => window.location.reload());

window.addEventListener("pointerdown", () => {
  if (state.musicEnabled) initHubMusic();
}, { once: true, capture: true });
window.addEventListener("keydown", () => {
  if (state.musicEnabled) initHubMusic();
}, { once: true, capture: true });

window.addEventListener("keydown", (event) => {
  if (["Space", "ArrowLeft", "ArrowRight", "Escape"].includes(event.code)) {
    event.preventDefault();
  }
  if ((event.code === "Escape" || event.code === "KeyP") && !keys.has(event.code) && state.screen === "game") {
    togglePause();
  }
  if (event.code === "Space" && !keys.has("Space") && state.screen === "game") {
    socket.emit("playerShoot");
  }
  keys.add(event.code);
});
window.addEventListener("keyup", (event) => keys.delete(event.code));
canvas.addEventListener("pointerdown", () => {
  state.shootingByPointer = true;
  if (state.screen === "game") {
    socket.emit("playerShoot");
  }
});
window.addEventListener("pointerup", () => {
  state.shootingByPointer = false;
});

socket.on("connect", () => {
  ui.connection.textContent = "Online";
});
socket.on("disconnect", () => {
  ui.connection.textContent = "Reconectando";
  toast("Conexao perdida.");
});
socket.on("roomJoined", ({ selfId, room, state: snapshot }) => {
  state.selfId = selfId;
  state.roomId = room.id;
  state.current = snapshot;
  renderLobby(room);
  showScreen("lobby");
  fetchLeaderboard();
});
socket.on("lobbyUpdate", (room) => {
  if (!state.current) state.current = {};
  state.current.hostId = room.hostId;
  renderLobby(room);
});
socket.on("playerJoined", ({ room }) => {
  renderLobby(room);
  toast("Novo piloto entrou na sala.");
});
socket.on("playerLeft", ({ room }) => {
  renderLobby(room);
  toast("Um piloto saiu da sala.");
});
socket.on("gameStarted", (snapshot) => {
  state.current = snapshot;
  state.buffPickups = [];
  showPauseOverlay(false);
  state.lastSnapshotAt = performance.now();
  showScreen("game");
});
socket.on("roomState", (snapshot) => {
  state.current = snapshot;
  state.lastSnapshotAt = performance.now();
  if (snapshot.status === "paused") {
    showPauseOverlay(true);
  } else if (snapshot.status === "running") {
    showPauseOverlay(false);
  }
});
socket.on("playerState", (players) => {
  if (state.current) {
    state.current.players = players;
  }
});
socket.on("playerDamaged", ({ shieldBlocked }) => {
  toast(shieldBlocked ? "Escudo absorveu o impacto." : "Dano recebido.");
});
socket.on("playerDied", ({ playerId }) => {
  if (playerId === state.selfId) {
    toast("Sua nave caiu. Voce esta no modo espectador.");
  }
});
socket.on("weaponUpgraded", ({ playerId, weaponLevel, maxWeaponLevel }) => {
  if (playerId === state.selfId) {
    toast(`Arma ${weaponLevel}/${maxWeaponLevel}`);
  }
});
socket.on("powerUpCollected", ({ playerId, type, duration }) => {
  if (playerId !== state.selfId) return;
  addBuffPickup(type, duration);
  const info = POWER_UP_INFO[type];
  if (info) {
    toast(`${info.name}: ${info.detail}`);
  }
});
socket.on("phaseChanged", ({ phase, nickname }) => {
  toast(`Fase ${phase}: velocidade reduzida, nova escalada iniciada`);
  showPhaseBanner(phase);
  applyPhasePalette(phase);
});
socket.on("hitEnemy", ({ enemyId, hp }) => {
  const mesh = enemyMeshes.get(enemyId);
  if (!mesh) return;
  mesh.userData.flashUntil = performance.now() + 140;
  mesh.scale.multiplyScalar(1.25);
  if (hp <= 0) {
    disposeMesh(mesh);
    enemyMeshes.delete(enemyId);
  }
});
socket.on("scoreUpdate", () => {});
socket.on("gamePaused", ({ nickname, state: snapshot }) => {
  state.current = snapshot || state.current;
  showPauseOverlay(true, `${nickname || "Um piloto"} pausou a corrida.`);
});
socket.on("gameResumed", ({ state: snapshot }) => {
  state.current = snapshot || state.current;
  showPauseOverlay(false);
  toast("Corrida retomada.");
});
socket.on("gameOver", ({ ranking, leaderboard }) => {
  showPauseOverlay(false);
  const self = (ranking || []).find((entry) => entry.id === state.selfId);
  ui.finalScore.textContent = `Sua pontuacao: ${self ? self.score : 0}`;
  ui.finalTitle.textContent = ranking && ranking[0] ? `${ranking[0].nickname} venceu` : "Resultado";
  renderLeaderboard(ui.finalRanking, ranking || []);
  renderLeaderboard(ui.globalLeaderboard, leaderboard || []);
  showScreen("over");
});

fetchLeaderboard();
updateMusicToggle();
window.requestAnimationFrame(animate);
