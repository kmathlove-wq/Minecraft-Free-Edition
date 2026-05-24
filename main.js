import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// ===== CONFIG =====
const CHUNK_SIZE      = 16;
const RENDER_DISTANCE = 4;
const TERRAIN_DEPTH   = 4;
const MAX_INSTANCES   = 200000;

// ===== STATE =====
let camera, scene, renderer, controls;

let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let moveUp = false, moveDown = false, canJump = false;
let isFlying = false, lastJumpPressTime = 0;
const doublePressDelay = 200;
let currentSaveId = null;
let prevTime = performance.now();
const velocity  = new THREE.Vector3();
const direction = new THREE.Vector3();

let activeSlot = 0;
const inventorySlots = [];
const blockTypes = {
    0: { name: 'grass',  color: 0x44aa44 },
    1: { name: 'dirt',   color: 0x8b5a2b },
    2: { name: 'stone',  color: 0x888888 },
    3: { name: 'wood',   color: 0x634220 },
    4: { name: 'leaves', color: 0x228b22 }
};

// ===== SHARED GEOMETRY =====
const boxGeometry   = new THREE.BoxGeometry(1, 1, 1);
const edgesGeometry = new THREE.EdgesGeometry(boxGeometry);
const lineMaterial  = new THREE.LineBasicMaterial({ color: 0x000000, depthTest: true });

// ===== WORLD DATA =====
const loadedChunks = new Map();  // "cx,cz" -> { blockKeys: string[] }
const blockMap     = new Map();  // "x,y,z" -> { color, id }
const playerMods   = new Map();  // "x,y,z" -> color | null

// ===== INSTANCED MESH =====
// One InstancedMesh per color — replaces ~300k individual Mesh objects
const iMeshes = new Map();  // color -> InstancedMesh
const iRevMap = new Map();  // color -> string[] (instanceId -> bkey)
const dummy   = new THREE.Object3D();
let highlightMesh = null;
let currentTarget = null;

// Pre-allocated vectors to avoid per-frame allocation
const _vrcOrigin = new THREE.Vector3();
const _vrcDir    = new THREE.Vector3();

function getIM(color) {
    if (!iMeshes.has(color)) {
        const mat = new THREE.MeshLambertMaterial({
            color,
            polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
        });
        const im = new THREE.InstancedMesh(boxGeometry, mat, MAX_INSTANCES);
        im.count = 0;
        im.frustumCulled = false;
        scene.add(im);
        iMeshes.set(color, im);
        iRevMap.set(color, []);
    }
    return iMeshes.get(color);
}

function registerBlock(x, y, z, color) {
    const k = bkey(x, y, z);
    if (blockMap.has(k)) return null;
    const im = getIM(color);
    if (im.count >= MAX_INSTANCES) return null;
    const id = im.count++;
    dummy.position.set(x|0, y|0, z|0);
    dummy.updateMatrix();
    im.setMatrixAt(id, dummy.matrix);
    iRevMap.get(color)[id] = k;
    blockMap.set(k, { color, id });
    return k;
}

function unregisterBlock(x, y, z) {
    const k    = bkey(x, y, z);
    const info = blockMap.get(k);
    if (!info) return;
    const { color, id } = info;
    const im     = iMeshes.get(color);
    const rm     = iRevMap.get(color);
    const lastId = --im.count;
    if (id !== lastId) {
        const tmp = new THREE.Matrix4();
        im.getMatrixAt(lastId, tmp);
        im.setMatrixAt(id, tmp);
        const lastKey = rm[lastId];
        rm[id] = lastKey;
        blockMap.get(lastKey).id = id;
    }
    rm[lastId] = undefined;
    im.instanceMatrix.needsUpdate = true;
    blockMap.delete(k);
}

function flushInstances() {
    for (const im of iMeshes.values()) im.instanceMatrix.needsUpdate = true;
}

// ===== CHUNK QUEUE =====
let chunkQueue   = [];
let lastPlayerCx = null, lastPlayerCz = null;

// ===== NOISE =====
function hash2(x, z) {
    let n = (Math.imul(x, 374761393) + Math.imul(z, 1120872981)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1540483477);
    return ((n ^ (n >>> 15)) >>> 0) / 0xffffffff;
}
function smoothstep(t) { return t * t * (3 - 2 * t); }
function smoothNoise(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const ux = smoothstep(fx), uz = smoothstep(fz);
    return hash2(ix,iz)*(1-ux)*(1-uz) + hash2(ix+1,iz)*ux*(1-uz)
         + hash2(ix,iz+1)*(1-ux)*uz   + hash2(ix+1,iz+1)*ux*uz;
}
function getTerrainHeight(wx, wz) {
    let h  = smoothNoise(wx*0.006, wz*0.006) * 35;
    h     += smoothNoise(wx*0.025, wz*0.025) * 10;
    h     += smoothNoise(wx*0.1,   wz*0.1)   * 3;
    return Math.floor(h) + 5;
}
function isTreeSpot(wx, wz) {
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    if (lx < 3 || lx >= CHUNK_SIZE-3 || lz < 3 || lz >= CHUNK_SIZE-3) return false;
    return hash2(wx*7+3, wz*13+9) > 0.94;
}

// ===== BLOCK KEY =====
function bkey(x, y, z) { return `${x|0},${y|0},${z|0}`; }

// ===== CHUNK GENERATION =====
function getChunkBlocks(cx, cz) {
    const result = [];
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
            const wx = cx * CHUNK_SIZE + lx;
            const wz = cz * CHUNK_SIZE + lz;
            const topY = getTerrainHeight(wx, wz);
            for (let depth = 0; depth <= TERRAIN_DEPTH; depth++) {
                const y     = topY - depth;
                const color = depth === 0 ? 0x44aa44 : depth <= 2 ? 0x8b5a2b : 0x888888;
                result.push({ x: wx, y, z: wz, color });
            }
            if (isTreeSpot(wx, wz)) {
                const base = topY + 1;
                for (let ty = 0; ty < 5; ty++) {
                    result.push({ x: wx, y: base+ty, z: wz, color: 0x634220 });
                }
                for (let ly = 2; ly <= 5; ly++) {
                    const r = ly < 5 ? 2 : 1;
                    for (let dlx = -r; dlx <= r; dlx++) {
                        for (let dlz = -r; dlz <= r; dlz++) {
                            if (Math.abs(dlx)===r && Math.abs(dlz)===r) continue;
                            result.push({ x: wx+dlx, y: base+ly, z: wz+dlz, color: 0x228b22 });
                        }
                    }
                }
            }
        }
    }
    return result;
}

function loadChunk(cx, cz) {
    const key = `${cx},${cz}`;
    if (loadedChunks.has(key)) return;

    const blockKeys = [];
    const blocks    = getChunkBlocks(cx, cz);
    const minX = cx * CHUNK_SIZE, maxX = (cx+1) * CHUNK_SIZE;
    const minZ = cz * CHUNK_SIZE, maxZ = (cz+1) * CHUNK_SIZE;

    for (const { x, y, z, color } of blocks) {
        const k = bkey(x, y, z);
        if (blockMap.has(k)) continue;
        if (playerMods.has(k)) {
            const modColor = playerMods.get(k);
            if (modColor !== null) {
                const rk = registerBlock(x, y, z, modColor);
                if (rk) blockKeys.push(rk);
            }
            continue;
        }
        const rk = registerBlock(x, y, z, color);
        if (rk) blockKeys.push(rk);
    }

    for (const [k, modColor] of playerMods) {
        if (modColor === null || blockMap.has(k)) continue;
        const [bx, by, bz] = k.split(',').map(Number);
        if (bx >= minX && bx < maxX && bz >= minZ && bz < maxZ) {
            const rk = registerBlock(bx, by, bz, modColor);
            if (rk) blockKeys.push(rk);
        }
    }

    flushInstances();
    loadedChunks.set(key, { blockKeys });
}

function unloadChunk(cx, cz) {
    const key   = `${cx},${cz}`;
    const chunk = loadedChunks.get(key);
    if (!chunk) return;
    for (const k of chunk.blockKeys) {
        const [x, y, z] = k.split(',').map(Number);
        unregisterBlock(x, y, z);
    }
    loadedChunks.delete(key);
}

// ===== CHUNK UPDATE =====
function updateChunks(px, pz) {
    const cx = Math.floor(px / CHUNK_SIZE);
    const cz = Math.floor(pz / CHUNK_SIZE);

    if (cx !== lastPlayerCx || cz !== lastPlayerCz) {
        lastPlayerCx = cx; lastPlayerCz = cz;

        for (const [key] of loadedChunks) {
            const [kcx, kcz] = key.split(',').map(Number);
            if (Math.abs(kcx-cx) > RENDER_DISTANCE+1 || Math.abs(kcz-cz) > RENDER_DISTANCE+1) {
                unloadChunk(kcx, kcz);
            }
        }

        chunkQueue = [];
        for (let dcx = -RENDER_DISTANCE; dcx <= RENDER_DISTANCE; dcx++) {
            for (let dcz = -RENDER_DISTANCE; dcz <= RENDER_DISTANCE; dcz++) {
                const ncx = cx+dcx, ncz = cz+dcz;
                if (!loadedChunks.has(`${ncx},${ncz}`)) {
                    chunkQueue.push({ cx: ncx, cz: ncz, d: Math.abs(dcx)+Math.abs(dcz) });
                }
            }
        }
        chunkQueue.sort((a, b) => a.d - b.d);
    }

    // Load 1-2 chunks per frame to avoid spikes
    const loadRate = chunkQueue.length > 20 ? 2 : 1;
    for (let i = 0; i < loadRate && chunkQueue.length > 0; i++) {
        const { cx: lcx, cz: lcz } = chunkQueue.shift();
        loadChunk(lcx, lcz);
    }
}

// ===== DDA VOXEL RAYCAST =====
// O(range) instead of O(scene_objects) — replaces Three.js raycaster on large arrays
// Blocks are centered at integers (occupy n±0.5), so we use Math.round for the starting
// block and ±0.5 boundaries — NOT Math.floor which is misaligned with block centers.
function voxelRaycast(maxDist) {
    camera.getWorldPosition(_vrcOrigin);
    camera.getWorldDirection(_vrcDir);
    const ox = _vrcOrigin.x, oy = _vrcOrigin.y, oz = _vrcOrigin.z;
    const dx = _vrcDir.x,    dy = _vrcDir.y,    dz = _vrcDir.z;

    // Block at integer n occupies [n-0.5, n+0.5]; use round to find correct starting block
    let x = Math.round(ox), y = Math.round(oy), z = Math.round(oz);

    const sx = dx >= 0 ? 1 : -1;
    const sy = dy >= 0 ? 1 : -1;
    const sz = dz >= 0 ? 1 : -1;

    const tdx = Math.abs(dx) > 1e-9 ? Math.abs(1/dx) : 1e9;
    const tdy = Math.abs(dy) > 1e-9 ? Math.abs(1/dy) : 1e9;
    const tdz = Math.abs(dz) > 1e-9 ? Math.abs(1/dz) : 1e9;

    // Distance to the first block-face boundary (at x±0.5) in each direction
    let tmx = dx >= 0 ? (x + 0.5 - ox)*tdx : (ox - x + 0.5)*tdx;
    let tmy = dy >= 0 ? (y + 0.5 - oy)*tdy : (oy - y + 0.5)*tdy;
    let tmz = dz >= 0 ? (z + 0.5 - oz)*tdz : (oz - z + 0.5)*tdz;

    let fx = 0, fy = 0, fz = 0;

    for (let i = 0; i < maxDist * 4 + 4; i++) {
        if (blockMap.has(bkey(x, y, z))) {
            return { x, y, z, face: new THREE.Vector3(fx, fy, fz) };
        }
        if (tmx < tmy && tmx < tmz) {
            if (tmx > maxDist) break;
            x += sx; tmx += tdx; fx = -sx; fy = 0;  fz = 0;
        } else if (tmy < tmz) {
            if (tmy > maxDist) break;
            y += sy; tmy += tdy; fx = 0;  fy = -sy; fz = 0;
        } else {
            if (tmz > maxDist) break;
            z += sz; tmz += tdz; fx = 0;  fy = 0;  fz = -sz;
        }
    }
    return null;
}

// ===== BLOCK INTERACTION =====
function addBlock(nx, ny, nz, color) {
    const k = bkey(nx, ny, nz);
    if (blockMap.has(k)) return;
    registerBlock(nx, ny, nz, color);
    flushInstances();
    playerMods.set(k, color);
    const cxb   = Math.floor(nx/CHUNK_SIZE), czb = Math.floor(nz/CHUNK_SIZE);
    const chunk = loadedChunks.get(`${cxb},${czb}`);
    if (chunk) chunk.blockKeys.push(k);
}

function destroyBlock(x, y, z) {
    const k = bkey(x, y, z);
    if (playerMods.has(k) && playerMods.get(k) !== null) playerMods.delete(k);
    else playerMods.set(k, null);
    unregisterBlock(x, y, z);
    const cxb   = Math.floor(x/CHUNK_SIZE), czb = Math.floor(z/CHUNK_SIZE);
    const chunk = loadedChunks.get(`${cxb},${czb}`);
    if (chunk) {
        const idx = chunk.blockKeys.indexOf(k);
        if (idx !== -1) chunk.blockKeys.splice(idx, 1);
    }
}

// ===== COLLISION =====
const LEAF_COLOR = 0x228b22;

function checkHorizontalCollision(px, py, pz) {
    const minBx = Math.floor(px - 0.25), maxBx = Math.floor(px + 0.25);
    const minBz = Math.floor(pz - 0.25), maxBz = Math.floor(pz + 0.25);
    const minBy = Math.ceil(py - 1.55),  maxBy = Math.floor(py + 0.15);
    for (let bx = minBx; bx <= maxBx; bx++) {
        for (let bz = minBz; bz <= maxBz; bz++) {
            for (let by = minBy; by <= maxBy; by++) {
                const info = blockMap.get(bkey(bx, by, bz));
                if (info && info.color !== LEAF_COLOR) return true;
            }
        }
    }
    return false;
}

// Move in one horizontal axis with automatic 1-block step-up
function moveWithStepUp(moveFn, fallback) {
    const player = controls.getObject();
    moveFn();
    const px = player.position.x, py = player.position.y, pz = player.position.z;
    if (!checkHorizontalCollision(px, py, pz)) return true;
    // Try stepping up over a 1-block obstacle
    if (canJump) {
        player.position.y += 0.51;
        if (!checkHorizontalCollision(player.position.x, player.position.y, player.position.z)) {
            velocity.y = 0;
            return true;
        }
        player.position.y -= 0.51;
    }
    player.position.copy(fallback);
    return false;
}

// ===== SAVE / LOAD =====
function saveGame() {
    const saves = JSON.parse(localStorage.getItem('minecraft_saves') || '[]');
    let saveName = '';

    if (currentSaveId) {
        const existing = saves.find(s => s.id === currentSaveId);
        if (existing) {
            const overwrite = confirm(`'${existing.name || existing.timestamp}' 월드에 덮어쓰시겠습니까?`);
            if (!overwrite) {
                currentSaveId = null;
            } else {
                saveName = prompt("저장할 이름을 입력하세요:", existing.name || '');
                if (saveName === null) return;
            }
        }
    }
    if (!currentSaveId) {
        saveName = prompt("새로운 저장 이름을 입력하세요:", "새 월드");
        if (saveName === null) return;
    }

    const loadingOverlay = document.getElementById('loading-overlay');
    loadingOverlay.style.display = 'flex';

    setTimeout(() => {
        const player  = controls.getObject();
        const modData = [];
        for (const [k, color] of playerMods) {
            const [x, y, z] = k.split(',').map(Number);
            modData.push({ p: { x, y, z }, c: color });
        }

        const newId    = currentSaveId || Date.now();
        const saveData = {
            version: 2,
            name: saveName || new Date().toLocaleString(),
            timestamp: new Date().toLocaleString(),
            id: newId,
            player: {
                pos: { x: player.position.x, y: player.position.y, z: player.position.z },
                rot: { x: camera.rotation.x, y: player.rotation.y },
                isFlying
            },
            mods: modData
        };

        if (currentSaveId) {
            const idx = saves.findIndex(s => s.id === currentSaveId);
            if (idx !== -1) saves[idx] = saveData;
            else saves.push(saveData);
        } else {
            saves.push(saveData);
            currentSaveId = newId;
        }

        localStorage.setItem('minecraft_saves', JSON.stringify(saves));
        loadingOverlay.style.display = 'none';
        alert('게임이 저장되었습니다!');
    }, 300);
}

function openLoadMenu() {
    const loadMenu = document.getElementById('load-menu');
    const saveList = document.getElementById('save-list');
    saveList.innerHTML = '';
    const saves = JSON.parse(localStorage.getItem('minecraft_saves') || '[]');
    if (saves.length === 0) {
        saveList.innerHTML = '<p>저장된 게임이 없습니다.</p>';
    } else {
        saves.sort((a, b) => b.id - a.id).forEach(save => {
            const div = document.createElement('div');
            div.className = 'save-item';
            div.innerHTML = `
                <div style="text-align:left;flex-grow:1;">
                    <div style="font-weight:bold;">${save.name || '이름 없음'}</div>
                    <div style="font-size:0.8em;color:#ccc;">${save.timestamp}${save.version !== 2 ? ' (구버전)' : ''}</div>
                </div>
                <div style="display:flex;gap:5px;">
                    <button onclick="window.loadSpecificSave(${save.id})" style="background-color:#2196F3;">플레이</button>
                    <button onclick="window.renameSave(${save.id})" style="background-color:#FF9800;">이름 변경</button>
                    <button onclick="window.deleteSave(${save.id})" style="background-color:#f44336;">삭제</button>
                </div>`;
            saveList.appendChild(div);
        });
    }
    loadMenu.style.display = 'flex';
}

window.renameSave = function(id) {
    const saves = JSON.parse(localStorage.getItem('minecraft_saves') || '[]');
    const idx   = saves.findIndex(s => s.id === id);
    if (idx === -1) return;
    const newName = prompt("새로운 월드 이름을 입력하세요:", saves[idx].name || '');
    if (newName !== null && newName.trim() !== '') {
        saves[idx].name = newName.trim();
        localStorage.setItem('minecraft_saves', JSON.stringify(saves));
        openLoadMenu();
    }
};

window.deleteSave = function(id) {
    const saves = JSON.parse(localStorage.getItem('minecraft_saves') || '[]');
    const save  = saves.find(s => s.id === id);
    if (!save) return;
    if (confirm(`'${save.name || save.timestamp}' 월드를 삭제하시겠습니까?`)) {
        localStorage.setItem('minecraft_saves', JSON.stringify(saves.filter(s => s.id !== id)));
        if (currentSaveId === id) currentSaveId = null;
        openLoadMenu();
    }
};

window.loadSpecificSave = function(id) {
    const loadingOverlay = document.getElementById('loading-overlay');
    loadingOverlay.style.display = 'flex';
    document.getElementById('load-menu').style.display = 'none';

    setTimeout(() => {
        const saves    = JSON.parse(localStorage.getItem('minecraft_saves') || '[]');
        const saveData = saves.find(s => s.id === id);
        if (!saveData) { loadingOverlay.style.display = 'none'; return; }

        currentSaveId = id;

        for (const [key] of [...loadedChunks]) {
            const [cx, cz] = key.split(',').map(Number);
            unloadChunk(cx, cz);
        }
        playerMods.clear();
        lastPlayerCx = null; lastPlayerCz = null;
        chunkQueue   = [];

        if (saveData.version === 2) {
            for (const mod of (saveData.mods || [])) {
                playerMods.set(bkey(mod.p.x, mod.p.y, mod.p.z), mod.c);
            }
        } else {
            alert('구버전 저장 파일입니다. 플레이어 위치만 복원됩니다.');
        }

        const player = controls.getObject();
        player.position.set(saveData.player.pos.x, saveData.player.pos.y, saveData.player.pos.z);
        player.rotation.set(0, saveData.player.rot.y, 0);
        camera.rotation.set(saveData.player.rot.x || 0, 0, 0);
        isFlying = saveData.player.isFlying;
        velocity.set(0, 0, 0);

        const pcx = Math.floor(saveData.player.pos.x / CHUNK_SIZE);
        const pcz = Math.floor(saveData.player.pos.z / CHUNK_SIZE);
        for (let dcx = -2; dcx <= 2; dcx++) {
            for (let dcz = -2; dcz <= 2; dcz++) {
                loadChunk(pcx+dcx, pcz+dcz);
            }
        }

        loadingOverlay.style.display = 'none';
        controls.lock();
    }, 500);
};

// ===== INIT =====
function init() {
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.rotation.order = 'YXZ';

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 40, 64);  // 4 chunks = 64 blocks

    scene.add(new THREE.AmbientLight(0xcccccc, 1.0));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(1, 1, 0.5).normalize();
    scene.add(dir);

    // Single shared wireframe for the targeted block
    highlightMesh = new THREE.LineSegments(edgesGeometry, lineMaterial);
    highlightMesh.scale.setScalar(1.005);
    highlightMesh.visible = false;
    scene.add(highlightMesh);

    controls = new PointerLockControls(camera, document.body);
    const blocker      = document.getElementById('blocker');
    const instructions = document.getElementById('instructions');
    const loadMenu     = document.getElementById('load-menu');

    blocker.addEventListener('click', (e) => { if (e.target.tagName !== 'BUTTON') controls.lock(); });
    document.getElementById('save-btn').addEventListener('click', (e) => { e.stopPropagation(); saveGame(); });
    document.getElementById('load-btn').addEventListener('click', (e) => { e.stopPropagation(); openLoadMenu(); });
    document.getElementById('close-load-btn').addEventListener('click', () => { loadMenu.style.display = 'none'; });

    controls.addEventListener('lock', () => {
        instructions.style.display = 'none';
        blocker.style.display = 'none';
    });
    controls.addEventListener('unlock', () => {
        blocker.style.display = 'flex';
        instructions.style.display = 'flex';
        loadMenu.style.display = 'none';
    });
    scene.add(controls.getObject());

    // Input
    document.addEventListener('keydown', (e) => {
        switch (e.code) {
            case 'ArrowUp':    case 'KeyW': moveForward  = true; break;
            case 'ArrowLeft':  case 'KeyA': moveLeft     = true; break;
            case 'ArrowDown':  case 'KeyS': moveBackward = true; break;
            case 'ArrowRight': case 'KeyD': moveRight    = true; break;
            case 'Space': {
                if (e.repeat) break;
                const now = performance.now();
                if (now - lastJumpPressTime < doublePressDelay) {
                    isFlying = !isFlying;
                    if (isFlying) velocity.y = 0;
                }
                lastJumpPressTime = now;
                if (isFlying) moveUp = true;
                else if (canJump) { velocity.y += 9.0; canJump = false; }
                break;
            }
            case 'ShiftLeft': case 'ShiftRight': if (isFlying) moveDown = true; break;
        }
    });
    document.addEventListener('keyup', (e) => {
        switch (e.code) {
            case 'ArrowUp':    case 'KeyW': moveForward  = false; break;
            case 'ArrowLeft':  case 'KeyA': moveLeft     = false; break;
            case 'ArrowDown':  case 'KeyS': moveBackward = false; break;
            case 'ArrowRight': case 'KeyD': moveRight    = false; break;
            case 'Space': moveUp   = false; break;
            case 'ShiftLeft': case 'ShiftRight': moveDown = false; break;
        }
    });

    // Inventory
    for (let i = 0; i < 9; i++) {
        const slot = document.querySelector(`.slot[data-slot="${i}"]`);
        if (slot) inventorySlots.push(slot);
    }
    document.addEventListener('wheel', (e) => {
        if (!controls.isLocked) return;
        inventorySlots[activeSlot].classList.remove('active');
        activeSlot = (activeSlot + (e.deltaY > 0 ? 1 : 8)) % 9;
        inventorySlots[activeSlot].classList.add('active');
    });

    // Block interaction via cached currentTarget (updated each frame)
    document.addEventListener('mousedown', (e) => {
        if (!controls.isLocked || !currentTarget) return;
        const { x, y, z, face } = currentTarget;

        if (e.button === 0) {
            destroyBlock(x, y, z);
        } else if (e.button === 2) {
            const blockInfo = blockTypes[activeSlot];
            if (!blockInfo) return;
            const nx = x + face.x, ny = y + face.y, nz = z + face.z;
            const pp    = controls.getObject().position;
            const feetY = pp.y - 1.6, headY = pp.y + 0.2;
            const isXO  = pp.x+0.4 > nx-0.5 && pp.x-0.4 < nx+0.5;
            const isZO  = pp.z+0.4 > nz-0.5 && pp.z-0.4 < nz+0.5;
            let isYO    = headY > ny-0.5 && feetY < ny+0.45;
            if (isXO && isZO && feetY > ny+0.1) isYO = false;
            if (!(isXO && isZO && isYO)) addBlock(nx, ny, nz, blockInfo.color);
        }
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    // Renderer — no antialias, capped pixel ratio
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Initial chunk load (5x5 around origin)
    for (let dcx = -2; dcx <= 2; dcx++) {
        for (let dcz = -2; dcz <= 2; dcz++) {
            loadChunk(dcx, dcz);
        }
    }

    const spawnH = getTerrainHeight(8, 8) + 3;
    controls.getObject().position.set(8, spawnH + 1.6, 8);
    prevTime = performance.now();
}

// ===== ANIMATE =====
function animate() {
    requestAnimationFrame(animate);
    const time  = performance.now();
    const delta = Math.min((time - prevTime) / 1000, 0.05);
    prevTime = time;

    const player = controls.getObject();
    updateChunks(player.position.x, player.position.z);

    // Update block highlight using DDA raycast
    currentTarget = controls.isLocked ? voxelRaycast(7) : null;
    if (currentTarget) {
        highlightMesh.position.set(currentTarget.x, currentTarget.y, currentTarget.z);
        highlightMesh.visible = true;
    } else {
        highlightMesh.visible = false;
    }

    if (controls.isLocked) {
        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;

        if (isFlying) {
            velocity.y = 0;
            if (moveUp)   velocity.y =  10;
            if (moveDown) velocity.y = -10;
        } else {
            velocity.y -= 9.8 * 4.0 * delta;
        }

        direction.z = Number(moveForward)  - Number(moveBackward);
        direction.x = Number(moveRight)    - Number(moveLeft);
        direction.normalize();

        const speed = isFlying ? 120.0 : 60.0;
        if (moveForward  || moveBackward) velocity.z -= direction.z * speed * delta;
        if (moveLeft     || moveRight)    velocity.x -= direction.x * speed * delta;

        const oldPos = player.position.clone();

        if (velocity.z !== 0) {
            if (!moveWithStepUp(() => controls.moveForward(-velocity.z * delta), oldPos)) velocity.z = 0;
        }

        const posAfterZ = player.position.clone();
        if (velocity.x !== 0) {
            if (!moveWithStepUp(() => controls.moveRight(-velocity.x * delta), posAfterZ)) velocity.x = 0;
        }

        // Vertical movement & landing
        player.position.y += velocity.y * delta;
        canJump = false;
        const px = player.position.x, py = player.position.y, pz = player.position.z;
        const minBx = Math.floor(px - 0.29), maxBx = Math.floor(px + 0.29);
        const minBz = Math.floor(pz - 0.29), maxBz = Math.floor(pz + 0.29);

        if (velocity.y <= 0) {
            const floorY = Math.floor(py - 1.6);
            outer: for (let bx = minBx; bx <= maxBx; bx++) {
                for (let bz = minBz; bz <= maxBz; bz++) {
                    if (blockMap.has(bkey(bx, floorY, bz))) {
                        const feetY = py - 1.6;
                        if (feetY <= floorY + 0.5 && feetY > floorY - 0.3) {
                            velocity.y = 0;
                            player.position.y = floorY + 0.5 + 1.6;
                            canJump = true;
                            if (!moveUp && !moveDown) isFlying = false;
                            break outer;
                        }
                    }
                }
            }
        } else {
            const ceilY = Math.floor(py + 0.2);
            outer: for (let bx = minBx; bx <= maxBx; bx++) {
                for (let bz = minBz; bz <= maxBz; bz++) {
                    if (blockMap.has(bkey(bx, ceilY, bz))) {
                        velocity.y = 0;
                        player.position.y = ceilY - 0.5 - 0.2;
                        break outer;
                    }
                }
            }
        }

        // Void respawn
        if (py < -50) {
            const sx = player.position.x, sz = player.position.z;
            player.position.set(sx, getTerrainHeight(sx, sz) + 3, sz);
            velocity.set(0, 0, 0);
            isFlying = false;
        }
    }

    renderer.render(scene, camera);
}

init();
animate();
