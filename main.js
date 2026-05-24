import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// ===== CONFIG =====
const CHUNK_SIZE = 16;
const RENDER_DISTANCE = 8;
const TERRAIN_DEPTH = 4;

// ===== STATE =====
let camera, scene, renderer, controls;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2(0, 0);

let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let moveUp = false, moveDown = false, canJump = false;
let isFlying = false, lastJumpPressTime = 0;
const doublePressDelay = 200;
let currentSaveId = null;
let prevTime = performance.now();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();

let activeSlot = 0;
const inventorySlots = [];
const blockTypes = {
    0: { name: 'grass', color: 0x44aa44 },
    1: { name: 'dirt',  color: 0x8b5a2b },
    2: { name: 'stone', color: 0x888888 },
    3: { name: 'wood',  color: 0x634220 },
    4: { name: 'leaves',color: 0x228b22 }
};

// ===== SHARED GEOMETRY =====
const boxGeometry  = new THREE.BoxGeometry(1, 1, 1);
const edgesGeometry = new THREE.EdgesGeometry(boxGeometry);
const lineMaterial = new THREE.LineBasicMaterial({
    color: 0x000000, depthTest: true,
    polygonOffset: true, polygonOffsetFactor: 0.5, polygonOffsetUnits: 1.0
});

// ===== WORLD DATA =====
const loadedChunks = new Map();  // "cx,cz" -> { meshes: Mesh[] }
const blockMap     = new Map();  // "x,y,z" -> Mesh  (O(1) collision)
const playerMods   = new Map();  // "x,y,z" -> color | null (placed | destroyed)
const objects      = [];         // all Meshes for raycasting

// ===== CHUNK QUEUE =====
let chunkQueue = [];
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
    let h = smoothNoise(wx*0.006, wz*0.006) * 35;
    h    += smoothNoise(wx*0.025, wz*0.025) * 10;
    h    += smoothNoise(wx*0.1,   wz*0.1)   * 3;
    return Math.floor(h) + 5;
}
function isTreeSpot(wx, wz) {
    // keep trunk ≥3 blocks from chunk border so leaves never cross chunks
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    if (lx < 3 || lx >= CHUNK_SIZE-3 || lz < 3 || lz >= CHUNK_SIZE-3) return false;
    return hash2(wx*7+3, wz*13+9) > 0.94;
}

// ===== MATERIALS =====
const matCache = new Map();
function getMat(color) {
    if (!matCache.has(color)) {
        matCache.set(color, new THREE.MeshLambertMaterial({
            color, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
        }));
    }
    return matCache.get(color);
}

// ===== BLOCK HELPERS =====
function bkey(x, y, z) { return `${x|0},${y|0},${z|0}`; }

function createBlockMesh(x, y, z, color) {
    const mesh = new THREE.Mesh(boxGeometry, getMat(color));
    mesh.position.set(x|0, y|0, z|0);
    mesh.add(new THREE.LineSegments(edgesGeometry, lineMaterial));
    return mesh;
}

function registerBlock(mesh) {
    scene.add(mesh);
    objects.push(mesh);
    const p = mesh.position;
    blockMap.set(bkey(p.x, p.y, p.z), mesh);
}

function unregisterBlock(mesh) {
    scene.remove(mesh);
    const i = objects.indexOf(mesh);
    if (i !== -1) objects.splice(i, 1);
    const p = mesh.position;
    blockMap.delete(bkey(p.x, p.y, p.z));
}

// ===== CHUNK GENERATION =====
function getChunkBlocks(cx, cz) {
    const result = [];
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
            const wx = cx * CHUNK_SIZE + lx;
            const wz = cz * CHUNK_SIZE + lz;
            const topY = getTerrainHeight(wx, wz);
            for (let depth = 0; depth <= TERRAIN_DEPTH; depth++) {
                const y = topY - depth;
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

    const meshes = [];
    const blocks = getChunkBlocks(cx, cz);

    for (const { x, y, z, color } of blocks) {
        const k = bkey(x, y, z);
        if (blockMap.has(k)) continue;

        if (playerMods.has(k)) {
            const modColor = playerMods.get(k);
            if (modColor !== null) {
                const mesh = createBlockMesh(x, y, z, modColor);
                registerBlock(mesh);
                meshes.push(mesh);
            }
            continue;
        }
        const mesh = createBlockMesh(x, y, z, color);
        registerBlock(mesh);
        meshes.push(mesh);
    }

    // Player-placed blocks above terrain in this chunk
    const minX = cx * CHUNK_SIZE, maxX = (cx+1) * CHUNK_SIZE;
    const minZ = cz * CHUNK_SIZE, maxZ = (cz+1) * CHUNK_SIZE;
    for (const [k, modColor] of playerMods) {
        if (modColor === null) continue;
        if (blockMap.has(k)) continue;
        const [bx, by, bz] = k.split(',').map(Number);
        if (bx >= minX && bx < maxX && bz >= minZ && bz < maxZ) {
            const mesh = createBlockMesh(bx, by, bz, modColor);
            registerBlock(mesh);
            meshes.push(mesh);
        }
    }

    loadedChunks.set(key, { meshes });
}

function unloadChunk(cx, cz) {
    const key = `${cx},${cz}`;
    const chunk = loadedChunks.get(key);
    if (!chunk) return;
    for (const mesh of chunk.meshes) unregisterBlock(mesh);
    loadedChunks.delete(key);
}

// ===== CHUNK UPDATE (called every frame) =====
function updateChunks(px, pz) {
    const cx = Math.floor(px / CHUNK_SIZE);
    const cz = Math.floor(pz / CHUNK_SIZE);

    if (cx !== lastPlayerCx || cz !== lastPlayerCz) {
        lastPlayerCx = cx;
        lastPlayerCz = cz;

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

    // Load more chunks per frame — 큐가 클수록 빠르게, 적으면 부드럽게
    const loadRate = chunkQueue.length > 30 ? 6 : chunkQueue.length > 10 ? 4 : 2;
    for (let i = 0; i < loadRate && chunkQueue.length > 0; i++) {
        const { cx: lcx, cz: lcz } = chunkQueue.shift();
        loadChunk(lcx, lcz);
    }
}

// ===== BLOCK INTERACTION =====
function addBlock(pos, color) {
    const x = Math.round(pos.x), y = Math.round(pos.y), z = Math.round(pos.z);
    const k = bkey(x, y, z);
    if (blockMap.has(k)) return;

    playerMods.set(k, color);
    const mesh = createBlockMesh(x, y, z, color);
    registerBlock(mesh);

    const cxb = Math.floor(x / CHUNK_SIZE), czb = Math.floor(z / CHUNK_SIZE);
    const chunk = loadedChunks.get(`${cxb},${czb}`);
    if (chunk) chunk.meshes.push(mesh);
}

function destroyBlock(mesh) {
    const x = Math.round(mesh.position.x);
    const y = Math.round(mesh.position.y);
    const z = Math.round(mesh.position.z);
    const k = bkey(x, y, z);

    if (playerMods.has(k) && playerMods.get(k) !== null) {
        playerMods.delete(k);
    } else {
        playerMods.set(k, null);
    }

    unregisterBlock(mesh);

    const cxb = Math.floor(x / CHUNK_SIZE), czb = Math.floor(z / CHUNK_SIZE);
    const chunk = loadedChunks.get(`${cxb},${czb}`);
    if (chunk) {
        const i = chunk.meshes.indexOf(mesh);
        if (i !== -1) chunk.meshes.splice(i, 1);
    }
}

// ===== COLLISION (O(1) via blockMap) =====
function checkHorizontalCollision(px, py, pz) {
    const minBx = Math.floor(px - 0.29), maxBx = Math.floor(px + 0.29);
    const minBz = Math.floor(pz - 0.29), maxBz = Math.floor(pz + 0.29);
    const minBy = Math.ceil(py - 1.55),  maxBy = Math.floor(py + 0.15);
    for (let bx = minBx; bx <= maxBx; bx++) {
        for (let bz = minBz; bz <= maxBz; bz++) {
            for (let by = minBy; by <= maxBy; by++) {
                if (blockMap.has(bkey(bx, by, bz))) return true;
            }
        }
    }
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
        const player = controls.getObject();
        const modData = [];
        for (const [k, color] of playerMods) {
            const [x, y, z] = k.split(',').map(Number);
            modData.push({ p: { x, y, z }, c: color });
        }

        const newId = currentSaveId || Date.now();
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
    const idx = saves.findIndex(s => s.id === id);
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
    const save = saves.find(s => s.id === id);
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
        const saves = JSON.parse(localStorage.getItem('minecraft_saves') || '[]');
        const saveData = saves.find(s => s.id === id);
        if (!saveData) { loadingOverlay.style.display = 'none'; return; }

        currentSaveId = id;

        // Unload all chunks
        for (const [key] of loadedChunks) {
            const [cx, cz] = key.split(',').map(Number);
            unloadChunk(cx, cz);
        }
        playerMods.clear();
        lastPlayerCx = null; lastPlayerCz = null;
        chunkQueue = [];

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

        // Load center chunks at new position
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
    scene.fog = new THREE.Fog(0x87ceeb, 70, 128);  // 렌더 경계(8청크=128블록)에서 완전히 가려짐

    scene.add(new THREE.AmbientLight(0xcccccc, 1.0));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(1, 1, 0.5).normalize();
    scene.add(dir);

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
            case 'ArrowUp':   case 'KeyW': moveForward  = true; break;
            case 'ArrowLeft': case 'KeyA': moveLeft     = true; break;
            case 'ArrowDown': case 'KeyS': moveBackward = true; break;
            case 'ArrowRight':case 'KeyD': moveRight    = true; break;
            case 'Space':
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
            case 'ShiftLeft': case 'ShiftRight': if (isFlying) moveDown = true; break;
        }
    });
    document.addEventListener('keyup', (e) => {
        switch (e.code) {
            case 'ArrowUp':   case 'KeyW': moveForward  = false; break;
            case 'ArrowLeft': case 'KeyA': moveLeft     = false; break;
            case 'ArrowDown': case 'KeyS': moveBackward = false; break;
            case 'ArrowRight':case 'KeyD': moveRight    = false; break;
            case 'Space': moveUp = false; break;
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

    // Block interaction
    document.addEventListener('mousedown', (e) => {
        if (!controls.isLocked) return;
        raycaster.setFromCamera(mouse, camera);
        const pp = controls.getObject().position;
        const range = 8;
        const nearby = objects.filter(o => {
            const dx = o.position.x - pp.x, dy = o.position.y - pp.y, dz = o.position.z - pp.z;
            return Math.abs(dx) < range && Math.abs(dy) < range && Math.abs(dz) < range;
        });
        const intersects = raycaster.intersectObjects(nearby, false);
        if (intersects.length > 0 && intersects[0].distance < 7) {
            if (e.button === 0) {
                destroyBlock(intersects[0].object);
            } else if (e.button === 2) {
                const blockInfo = blockTypes[activeSlot];
                if (blockInfo) {
                    const newPos = intersects[0].object.position.clone().add(
                        intersects[0].face.normal.clone().transformDirection(intersects[0].object.matrixWorld)
                    );
                    const feetY = pp.y - 1.6, headY = pp.y + 0.2;
                    const isXO = pp.x+0.4 > newPos.x-0.5 && pp.x-0.4 < newPos.x+0.5;
                    const isZO = pp.z+0.4 > newPos.z-0.5 && pp.z-0.4 < newPos.z+0.5;
                    let isYO = headY > newPos.y-0.5 && feetY < newPos.y+0.45;
                    if (isXO && isZO && feetY > newPos.y+0.1) isYO = false;
                    if (!(isXO && isZO && isYO)) addBlock(newPos, blockInfo.color);
                }
            }
        }
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Initial chunk load (5x5 around origin) — 나머지는 큐에서 처리
    for (let dcx = -2; dcx <= 2; dcx++) {
        for (let dcz = -2; dcz <= 2; dcz++) {
            loadChunk(dcx, dcz);
        }
    }

    // Spawn above terrain
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
            controls.moveForward(-velocity.z * delta);
            if (checkHorizontalCollision(player.position.x, player.position.y, player.position.z)) {
                player.position.copy(oldPos); velocity.z = 0;
            }
        }

        const posAfterZ = player.position.clone();
        if (velocity.x !== 0) {
            controls.moveRight(-velocity.x * delta);
            if (checkHorizontalCollision(player.position.x, player.position.y, player.position.z)) {
                player.position.copy(posAfterZ); velocity.x = 0;
            }
        }

        // Vertical movement
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
