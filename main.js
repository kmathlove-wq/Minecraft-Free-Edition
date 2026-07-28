// ===== 마인크래프트 스타일 게임 · 메인 =====
import * as THREE from 'three';
import { atlas } from './src/textures.js';
import { B, blocks, itemOf, breakTime, canHarvest, AIR, TOOL } from './src/blocks.js';
import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL, BIOME_INFO } from './src/worldgen.js';
import { World } from './src/world.js';
import { materials, sharedUniforms } from './src/chunk.js';
import { Player, PW, PH } from './src/player.js';
import { Inventory, Furnace, stack, HOTBAR } from './src/inventory.js';
import { UI } from './src/ui.js';
import { Sky } from './src/env.js';
import { MobManager } from './src/mobs.js';
import { sfx, resumeAudio } from './src/audio.js';
import { listSaves, saveGame, applySave, deleteSave, renameSave } from './src/save.js';

// ---------------- 렌더러 / 씬 ----------------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.06, 1000);
camera.rotation.order = 'YXZ';

// 1인칭 손(들고 있는 아이템) 전용 씬
const handScene = new THREE.Scene();
const handCamera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 10);
handScene.add(new THREE.AmbientLight(0xffffff, 1));

addEventListener('resize', () => {
    camera.aspect = handCamera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix(); handCamera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
});

// ---------------- 게임 상태 ----------------
const world = new World(scene, (Math.random() * 2147483647) | 0);
const player = new Player(world);
const inventory = new Inventory();
const sky = new Sky(scene, camera);
const mobs = new MobManager(scene, world);

const game = { world, player, inventory, sky, mobs, camera, scene };
const ui = new UI(game);
game.ui = ui;

let currentSaveId = null;
let paused = true;
let showDebug = false;
const furnaces = new Map();     // "x,y,z" -> Furnace

// ---------------- 선택 블록 표시 ----------------
const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.001, 1.001, 1.001)),
    new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 })
);
outline.visible = false;
scene.add(outline);

const crackGeo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
const crackMat = new THREE.MeshBasicMaterial({
    map: atlas.texture, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false
});
const crackMesh = new THREE.Mesh(crackGeo, crackMat);
crackMesh.visible = false;
scene.add(crackMesh);
let crackStage = -1;
function setCrackStage(s) {
    if (s === crackStage) return;
    crackStage = s;
    if (s < 0) { crackMesh.visible = false; return; }
    const [u0, v0, u1, v1] = atlas.uv(atlas.id('break' + s));
    const uv = crackGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
        const bx = i % 4;
        const ux = (bx === 1 || bx === 3) ? 1 : 0;
        const vy = (bx === 0 || bx === 1) ? 1 : 0;
        uv.setXY(i, u0 + ux * (u1 - u0), v0 + vy * (v1 - v0));
    }
    uv.needsUpdate = true;
    crackMesh.visible = true;
}

// ---------------- 아이템 드롭 ----------------
const dropGeo = new THREE.PlaneGeometry(0.35, 0.35);
const dropMats = new Map();
function dropMaterial(texIndex) {
    if (!dropMats.has(texIndex)) {
        const m = new THREE.MeshBasicMaterial({ map: atlas.texture, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
        // 아틀라스 타일만 사용하도록 uv 를 옮긴 전용 지오메트리를 쓴다
        dropMats.set(texIndex, m);
    }
    return dropMats.get(texIndex);
}
function dropGeometry(texIndex) {
    const g = dropGeo.clone();
    const [u0, v0, u1, v1] = atlas.uv(texIndex);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    }
    uv.needsUpdate = true;
    return g;
}

const drops = [];
function spawnDrop(id, count, x, y, z) {
    const it = itemOf(id);
    if (!it) return;
    const mesh = new THREE.Mesh(dropGeometry(it.tex), dropMaterial(it.tex));
    mesh.position.set(x, y, z);
    scene.add(mesh);
    drops.push({
        id, count, mesh, age: 0, pickup: 0.5,
        vel: { x: (Math.random() - 0.5) * 2, y: 3, z: (Math.random() - 0.5) * 2 }
    });
}

function updateDrops(dt) {
    for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        d.age += dt; d.pickup -= dt;
        d.vel.y -= 24 * dt;
        const p = d.mesh.position;
        const ny = p.y + d.vel.y * dt;
        if (d.vel.y < 0 && world.isSolid(Math.floor(p.x), Math.floor(ny - 0.15), Math.floor(p.z))) {
            p.y = Math.floor(ny - 0.15) + 1.18;
            d.vel.y = 0; d.vel.x *= 0.6; d.vel.z *= 0.6;
        } else p.y = ny;
        if (!world.isSolid(Math.floor(p.x + d.vel.x * dt), Math.floor(p.y), Math.floor(p.z))) p.x += d.vel.x * dt;
        if (!world.isSolid(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z + d.vel.z * dt))) p.z += d.vel.z * dt;
        d.vel.x *= (1 - 3 * dt); d.vel.z *= (1 - 3 * dt);

        d.mesh.rotation.y += dt * 1.6;
        d.mesh.position.y += Math.sin(d.age * 3) * 0.0015;

        // 습득 (마인크래프트처럼 가까워지면 빨려 들어온다)
        const dx = player.pos.x - p.x, dy = (player.pos.y + 0.6) - p.y, dz = player.pos.z - p.z;
        const dist = Math.hypot(dx, dy, dz);
        if (d.pickup <= 0 && dist < 2.2) {
            if (dist > 0.8) { p.x += dx * 7 * dt; p.y += dy * 7 * dt; p.z += dz * 7 * dt; }
            else {
                const left = inventory.add(d.id, d.count);
                if (left < d.count) {
                    sfx.pop();
                    if (left === 0) { scene.remove(d.mesh); d.mesh.geometry.dispose(); drops.splice(i, 1); continue; }
                    d.count = left;
                }
            }
        }
        if (d.age > 300) { scene.remove(d.mesh); d.mesh.geometry.dispose(); drops.splice(i, 1); }
    }
}

mobs.onDrop = (m) => {
    for (const [id, n] of m.def.drops) spawnDrop(id, 1 + ((Math.random() * n) | 0), m.pos.x, m.pos.y + 0.5, m.pos.z);
};

// ---------------- 손에 든 아이템 ----------------
let handMesh = null, handKey = '', swing = 0;
const handGroup = new THREE.Group();
handScene.add(handGroup);

function shadedBoxGeometry(size, def) {
    const g = new THREE.BoxGeometry(size, size, size);
    const uv = g.attributes.uv;
    const col = new Float32Array(uv.count * 3);
    const SHADE = [0.6, 0.6, 1.0, 0.5, 0.8, 0.8];
    for (let f = 0; f < 6; f++) {
        const [u0, v0, u1, v1] = atlas.uv(def.tex[f]);
        for (let k = 0; k < 4; k++) {
            const i = f * 4 + k;
            uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
            col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = SHADE[f];
        }
    }
    uv.needsUpdate = true;
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
}

function updateHandMesh() {
    const s = inventory.held();
    const key = s ? s.id : 'none';
    if (key === handKey) return;
    handKey = key;
    if (handMesh) { handGroup.remove(handMesh); handMesh.geometry.dispose(); handMesh = null; }
    if (!s) return;
    const it = itemOf(s.id);
    if (!it) return;
    if (it.block !== null && blocks[it.block].render === 'cube') {
        handMesh = new THREE.Mesh(
            shadedBoxGeometry(0.30, blocks[it.block]),
            new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, alphaTest: 0.5 })
        );
        handMesh.rotation.set(0.15, -0.5, 0.1);
    } else {
        handMesh = new THREE.Mesh(
            dropGeometry(it.tex),
            new THREE.MeshBasicMaterial({ map: atlas.texture, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide })
        );
        handMesh.scale.setScalar(1.3);
        handMesh.rotation.set(0, -0.35, -0.6);
    }
    handGroup.add(handMesh);
}

// ---------------- 입력 ----------------
const input = { forward: false, back: false, left: false, right: false, jump: false, sneak: false, sprint: false };
let mouseLeft = false, mouseRight = false;
let lastSpace = 0, lastW = 0;

const canLock = () => !paused && !ui.open;

document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') return;                 // pointerlock 이 처리
    if (e.repeat && e.code !== 'Space') return;

    switch (e.code) {
        case 'KeyW': case 'ArrowUp': {
            input.forward = true;
            const now = performance.now();
            if (now - lastW < 300) player.sprinting = true;
            lastW = now;
            break;
        }
        case 'KeyS': case 'ArrowDown': input.back = true; break;
        case 'KeyA': case 'ArrowLeft': input.left = true; break;
        case 'KeyD': case 'ArrowRight': input.right = true; break;
        case 'ShiftLeft': case 'ShiftRight': input.sneak = true; break;
        case 'ControlLeft': case 'ControlRight': if (input.forward) player.sprinting = true; break;
        case 'Space': {
            if (e.repeat) { input.jump = true; break; }
            input.jump = true;
            const now = performance.now();
            if (now - lastSpace < 300 && player.gamemode === 'creative') {
                player.flying = !player.flying;
                player.vel.y = 0;
            }
            lastSpace = now;
            break;
        }
        case 'KeyE':
            if (ui.open) closeGui();
            else if (!paused) openGui(player.gamemode === 'creative' ? 'creative' : 'inventory');
            break;
        case 'KeyQ': dropHeld(); break;
        case 'F3': e.preventDefault(); showDebug = !showDebug; ui.debugEl.style.display = showDebug ? 'block' : 'none'; break;
        case 'KeyF': toggleGamemode(); break;
        case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5':
        case 'Digit6': case 'Digit7': case 'Digit8': case 'Digit9':
            selectSlot(+e.code.slice(5) - 1); break;
    }
});

document.addEventListener('keyup', (e) => {
    switch (e.code) {
        case 'KeyW': case 'ArrowUp': input.forward = false; player.sprinting = false; break;
        case 'KeyS': case 'ArrowDown': input.back = false; break;
        case 'KeyA': case 'ArrowLeft': input.left = false; break;
        case 'KeyD': case 'ArrowRight': input.right = false; break;
        case 'ShiftLeft': case 'ShiftRight': input.sneak = false; break;
        case 'Space': input.jump = false; break;
    }
});

document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== document.body) return;
    const s = 0.0022;
    player.yaw -= e.movementX * s;
    player.pitch -= e.movementY * s;
    player.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, player.pitch));
});

// 포인터 락 중에는 마우스 이벤트가 잠긴 요소(document.body)로 전달되므로
// 캔버스가 아니라 document 에 붙여야 한다.
document.addEventListener('mousedown', (e) => {
    if (document.pointerLockElement !== document.body) return;
    if (e.button === 0) { mouseLeft = true; tryAttack(); }
    if (e.button === 2) { mouseRight = true; useHeld(); }
});
addEventListener('mouseup', (e) => {
    if (e.button === 0) { mouseLeft = false; resetBreak(); }
    if (e.button === 2) { mouseRight = false; eatTimer = 0; }
});
addEventListener('contextmenu', e => e.preventDefault());

addEventListener('wheel', (e) => {
    if (!canLock() || document.pointerLockElement !== document.body) return;
    selectSlot((inventory.selected + (e.deltaY > 0 ? 1 : HOTBAR - 1)) % HOTBAR);
}, { passive: true });

function selectSlot(i) {
    inventory.selected = i;
    const s = inventory.held();
    if (s) ui.showItemName(itemOf(s.id)?.display ?? s.id);
    resetBreak();
}

function dropHeld() {
    const s = inventory.held();
    if (!s || ui.open) return;
    const dir = getLookDir();
    spawnDrop(s.id, 1, player.pos.x + dir.x, player.eyeY - 0.3, player.pos.z + dir.z);
    const d = drops[drops.length - 1];
    if (d) { d.vel.x = dir.x * 6; d.vel.y = 2.5; d.vel.z = dir.z * 6; d.pickup = 1.2; }
    inventory.consumeHeld(1);
}

function toggleGamemode() {
    player.gamemode = player.gamemode === 'survival' ? 'creative' : 'survival';
    if (player.gamemode === 'survival') player.flying = false;
    ui.showItemName('게임 모드: ' + (player.gamemode === 'creative' ? '크리에이티브' : '서바이벌'));
}

// ---------------- 포인터 락 / 메뉴 ----------------
const blocker = document.getElementById('blocker');
const pauseMenu = document.getElementById('pause-menu');

function lockPointer() { document.body.requestPointerLock(); }

document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === document.body;
    if (locked) {
        paused = false;
        blocker.style.display = 'none';
        resumeAudio();
    } else if (!ui.open) {
        paused = true;
        blocker.style.display = 'flex';
        mouseLeft = mouseRight = false;
        resetBreak();
    }
});

blocker.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    if (document.getElementById('load-menu').style.display === 'flex') return;
    lockPointer();
});

function openGui(kind, furnace = null) {
    ui.openScreen(kind, furnace);
    if (document.pointerLockElement) document.exitPointerLock();
    mouseLeft = mouseRight = false;
    resetBreak();
}
function closeGui() {
    ui.close();
    lockPointer();
}
document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && ui.open) { e.preventDefault(); ui.close(); paused = true; blocker.style.display = 'flex'; }
});

// ---------------- 블록 상호작용 ----------------
const _dir = new THREE.Vector3();
function getLookDir() {
    _dir.set(0, 0, -1).applyQuaternion(camera.quaternion);
    return _dir;
}

let target = null;
let breakProgress = 0, breakTarget = null;

function resetBreak() {
    breakProgress = 0; breakTarget = null;
    setCrackStage(-1);
}

function reach() { return player.gamemode === 'creative' ? 5 : 4.5; }

function updateTarget() {
    const origin = { x: player.pos.x, y: player.eyeY, z: player.pos.z };
    const d = getLookDir();
    target = world.raycast(origin, d, reach());
    if (target) {
        outline.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
        outline.visible = true;
    } else outline.visible = false;
}

function tryAttack() {
    // 몹 공격 우선
    const origin = { x: player.pos.x, y: player.eyeY, z: player.pos.z };
    const d = getLookDir();
    const mob = mobs.pick(origin, d, 3.5);
    if (mob) {
        const it = inventory.heldItem();
        mob.hurt(it ? it.damage : 1);
        if (it?.tool) inventory.damageHeld(1);
        swing = 1;
        return;
    }
    swing = 1;
}

function updateBreaking(dt) {
    if (!mouseLeft || !target || ui.open || player.dead) { if (breakTarget) resetBreak(); return; }
    const key = target.x + ',' + target.y + ',' + target.z;
    if (breakTarget !== key) { breakTarget = key; breakProgress = 0; }

    const def = blocks[target.block];
    const held = inventory.heldItem();
    const t = breakTime(def, held);
    if (t === Infinity) { setCrackStage(-1); return; }

    if (player.gamemode === 'creative') { destroyBlock(target.x, target.y, target.z); return; }

    breakProgress += dt;
    if (breakProgress >= t) { destroyBlock(target.x, target.y, target.z); return; }

    const stage = Math.min(9, Math.floor(breakProgress / t * 10));
    crackMesh.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
    setCrackStage(stage);
    if (Math.random() < dt * 6) sfx.dig(def.stepSound);
}

function destroyBlock(x, y, z) {
    const id = world.getBlock(x, y, z);
    if (id === AIR) return;
    const def = blocks[id];
    if (def.hardness < 0) return;

    world.setBlock(x, y, z, AIR);
    sfx.breakBlock(def.stepSound);

    if (player.gamemode === 'survival') {
        const held = inventory.heldItem();
        if (def.drop && canHarvest(def, held)) {
            spawnDrop(def.drop, def.dropCount, x + 0.5, y + 0.5, z + 0.5);
        }
        if (held?.tool) inventory.damageHeld(1);
        player.exhaustion += 0.005;
    }
    furnaces.delete(x + ',' + y + ',' + z);
    world.blockUpdate(x, y, z);
    resetBreak();
    swing = 1;
}

let eatTimer = 0;
function useHeld() {
    if (ui.open || player.dead) return;
    swing = 1;

    // 1) 블록 사용 (제작대 · 화로)
    if (target && !input.sneak) {
        const id = world.getBlock(target.x, target.y, target.z);
        if (id === B.CRAFTING_TABLE) { openGui('crafting'); return; }
        if (id === B.FURNACE) {
            const k = target.x + ',' + target.y + ',' + target.z;
            if (!furnaces.has(k)) furnaces.set(k, new Furnace());
            openGui('furnace', furnaces.get(k));
            return;
        }
    }

    const s = inventory.held();
    if (!s) return;
    const it = itemOf(s.id);
    if (!it) return;

    // 2) 음식
    if (it.food) { eatTimer = 0.0001; return; }

    // 3) 블록 설치
    if (it.block !== null && target) {
        const nx = target.x + target.nx, ny = target.y + target.ny, nz = target.z + target.nz;
        placeBlock(nx, ny, nz, it.block);
    }
}

function placeBlock(x, y, z, id) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const existing = world.getBlock(x, y, z);
    if (existing !== AIR && blocks[existing].render !== 'liquid') return;

    const def = blocks[id];
    // 플레이어와 겹치는지 검사
    if (def.solid) {
        const hw = PW / 2;
        const px0 = player.pos.x - hw, px1 = player.pos.x + hw;
        const pz0 = player.pos.z - hw, pz1 = player.pos.z + hw;
        const py0 = player.pos.y, py1 = player.pos.y + player.height;
        if (px1 > x && px0 < x + 1 && pz1 > z && pz0 < z + 1 && py1 > y && py0 < y + 1) return;
        for (const m of mobs.mobs) {
            const mw = m.def.w / 2;
            if (m.pos.x + mw > x && m.pos.x - mw < x + 1 && m.pos.z + mw > z && m.pos.z - mw < z + 1
                && m.pos.y + m.def.h > y && m.pos.y < y + 1) return;
        }
    }
    // 지지 블록이 필요한 블록
    if (def.needsSupport && !world.isSolid(x, y - 1, z) && world.getBlock(x, y - 1, z) !== id) return;

    if (!world.setBlock(x, y, z, id)) return;
    sfx.place(def.stepSound);
    if (player.gamemode === 'survival') inventory.consumeHeld(1);
    world.blockUpdate(x, y, z);
}

function updateEating(dt) {
    if (!mouseRight || eatTimer <= 0) { eatTimer = 0; return; }
    const s = inventory.held();
    const it = s ? itemOf(s.id) : null;
    if (!it?.food) { eatTimer = 0; return; }
    eatTimer += dt;
    if (eatTimer % 0.35 < dt) sfx.eat();
    if (eatTimer >= 1.6) {
        if (player.eat(it.food)) inventory.consumeHeld(1);
        eatTimer = 0;
    }
}

// ---------------- 메뉴 버튼 ----------------
document.getElementById('save-btn').onclick = (e) => { e.stopPropagation(); doSave(); };
document.getElementById('load-btn').onclick = (e) => { e.stopPropagation(); openLoadMenu(); };
document.getElementById('new-btn').onclick = (e) => { e.stopPropagation(); newWorld(); };
document.getElementById('close-load-btn').onclick = () => { document.getElementById('load-menu').style.display = 'none'; };

function doSave() {
    const saves = listSaves();
    let name = '';
    if (currentSaveId) {
        const ex = saves.find(s => s.id === currentSaveId);
        if (ex) {
            if (!confirm(`'${ex.name}' 월드에 덮어쓰시겠습니까?`)) currentSaveId = null;
            else name = ex.name;
        }
    }
    if (!currentSaveId) {
        name = prompt('저장할 월드 이름:', '새 월드');
        if (name === null) return;
    }
    const id = saveGame(game, name, currentSaveId);
    if (id) { currentSaveId = id; ui.showItemName('저장 완료'); alert('게임이 저장되었습니다!'); }
}

function openLoadMenu() {
    const menu = document.getElementById('load-menu');
    const list = document.getElementById('save-list');
    list.innerHTML = '';
    const saves = listSaves().sort((a, b) => b.id - a.id);
    if (!saves.length) list.innerHTML = '<p>저장된 월드가 없습니다.</p>';
    for (const s of saves) {
        const div = document.createElement('div');
        div.className = 'save-item';
        div.innerHTML = `<div style="text-align:left;flex:1">
                <div style="font-weight:bold">${escapeHtml(s.name || '이름 없음')}</div>
                <div style="font-size:.8em;color:#bbb">${s.timestamp}${s.version < 3 ? ' · 구버전' : ''}</div>
            </div>`;
        const btns = document.createElement('div');
        btns.style.cssText = 'display:flex;gap:6px';
        const mk = (label, color, fn) => {
            const b = document.createElement('button');
            b.textContent = label; b.style.background = color; b.onclick = fn; btns.appendChild(b);
        };
        mk('플레이', '#2196F3', () => loadWorld(s.id));
        mk('이름변경', '#FF9800', () => { const n = prompt('새 이름:', s.name); if (n) { renameSave(s.id, n.trim()); openLoadMenu(); } });
        mk('삭제', '#f44336', () => { if (confirm('삭제하시겠습니까?')) { deleteSave(s.id); if (currentSaveId === s.id) currentSaveId = null; openLoadMenu(); } });
        div.appendChild(btns);
        list.appendChild(div);
    }
    menu.style.display = 'flex';
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function showLoading(on) { document.getElementById('loading-overlay').style.display = on ? 'flex' : 'none'; }

function loadWorld(id) {
    const data = listSaves().find(s => s.id === id);
    if (!data) return;
    showLoading(true);
    document.getElementById('load-menu').style.display = 'none';
    setTimeout(() => {
        currentSaveId = id;
        drops.length = 0;
        applySave(game, data);
        showLoading(false);
        lockPointer();
    }, 60);
}

function newWorld() {
    if (!confirm('새 월드를 생성합니다. 저장하지 않은 내용은 사라집니다.')) return;
    showLoading(true);
    setTimeout(() => {
        currentSaveId = null;
        world.clear();
        mobs.clear();
        drops.length = 0;
        world.seed = (Math.random() * 2147483647) | 0;
        world.gen.seed = world.seed;
        world.gen._hCache?.clear?.();
        inventory.slots.fill(null);
        sky.setTime(1000);
        player.health = 20; player.food = 20; player.dead = false;
        spawnPlayer();
        showLoading(false);
        lockPointer();
    }, 60);
}

const SPAWN_OK = new Set([B.GRASS_BLOCK, B.SNOWY_GRASS, B.SAND, B.STONE, B.SNOW_BLOCK, B.DIRT, B.GRAVEL]);

function spawnPlayer() {
    // 바다·나무 위가 아닌 평지를 찾는다
    let x = 8, z = 8;
    for (let i = 0; i < 400; i++) {
        if (world.gen.heightAt(x, z) > SEA_LEVEL + 1) break;
        x += 16; if (i % 8 === 7) { z += 16; x = 8; }
    }
    world.forceLoad(x, z, 2);
    let y = world.surfaceY(x, z);
    // 나무 위에 스폰되면 주변에서 맨땅을 찾는다
    if (!SPAWN_OK.has(world.getBlock(x, y - 1, z))) {
        outer: for (let r = 1; r <= 8; r++)
            for (let dx = -r; dx <= r; dx++)
                for (let dz = -r; dz <= r; dz++) {
                    const ny = world.surfaceY(x + dx, z + dz);
                    if (SPAWN_OK.has(world.getBlock(x + dx, ny - 1, z + dz))) {
                        x += dx; z += dz; y = ny; break outer;
                    }
                }
    }
    player.pos = { x: x + 0.5, y: y + 0.1, z: z + 0.5 };
    player.spawn = { ...player.pos };
    player.vel = { x: 0, y: 0, z: 0 };
    player.yaw = 0; player.pitch = 0;
}

// ---------------- 죽음 ----------------
const deathScreen = document.getElementById('death-screen');
document.getElementById('respawn-btn').onclick = () => {
    player.respawn();
    deathScreen.style.display = 'none';
    lockPointer();
};
player.onHurt = () => sfx.hurt();
player.onStep = (id) => sfx.step(blocks[id].stepSound);

// ---------------- 루프 ----------------
let prev = performance.now();
let fps = 0, fpsAcc = 0, fpsCount = 0;
let bob = 0;

function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    let dt = (now - prev) / 1000;
    prev = now;
    dt = Math.min(dt, 0.1);

    fpsAcc += dt; fpsCount++;
    if (fpsAcc > 0.5) { fps = Math.round(fpsCount / fpsAcc); fpsAcc = 0; fpsCount = 0; }

    const active = !paused && !player.dead;

    // 물리 · 월드
    if (active) {
        player.update(dt, ui.open ? { forward: false, back: false, left: false, right: false, jump: false, sneak: false } : input);
        mobs.update(dt, player, sky.isNight);
    }
    world.update(player.pos.x, player.pos.z, paused ? 12 : 6);
    updateDrops(dt);
    sky.update(paused ? dt * 0 : dt, camera.position, world.renderDistance);

    // 수중에서는 시야가 짧고 푸르게 (마인크래프트와 동일)
    if (player.headInWater) {
        scene.fog.color.setRGB(0.06, 0.17, 0.42);
        scene.background.setRGB(0.06, 0.17, 0.42);
        scene.fog.near = 0.1;
        scene.fog.far = 22;
    }

    // 카메라
    camera.rotation.set(player.pitch, player.yaw, 0);
    const speed = Math.hypot(player.vel.x, player.vel.z);
    if (player.onGround && speed > 0.5) bob += dt * speed * 1.8;
    const bobA = player.onGround ? Math.min(speed / 5, 1) * 0.045 : 0;
    camera.position.set(
        player.pos.x + Math.cos(bob) * bobA * 0.4,
        player.eyeY + Math.abs(Math.sin(bob)) * bobA,
        player.pos.z
    );

    if (active && !ui.open) {
        updateTarget();
        updateBreaking(dt);
        updateEating(dt);
    } else {
        outline.visible = false;
        setCrackStage(-1);
    }

    // 화로 진행
    for (const f of furnaces.values()) f.tick(dt);
    ui.updateFurnace();

    // 손
    updateHandMesh();
    swing = Math.max(0, swing - dt * 4);
    const sw = Math.sin(swing * Math.PI);
    handGroup.position.set(0.46 - sw * 0.1, -0.40 - sw * 0.14 + Math.abs(Math.sin(bob)) * bobA * 0.4, -0.72);
    handGroup.rotation.set(sw * 0.9, 0, -sw * 0.3);

    // 죽음
    if (player.dead && deathScreen.style.display !== 'flex') {
        deathScreen.style.display = 'flex';
        if (document.pointerLockElement) document.exitPointerLock();
        sfx.die();
    }

    // HUD
    ui.updateHud();
    if (showDebug) {
        const bx = Math.floor(player.pos.x), by = Math.floor(player.pos.y), bz = Math.floor(player.pos.z);
        ui.setDebug(
            `FPS ${fps}\n` +
            `XYZ ${player.pos.x.toFixed(2)} / ${player.pos.y.toFixed(2)} / ${player.pos.z.toFixed(2)}\n` +
            `블록 ${bx} ${by} ${bz}  청크 ${Math.floor(bx / 16)} ${Math.floor(bz / 16)}\n` +
            `바이옴 ${world.biomeNameAt(bx, bz)}\n` +
            `시간 ${Math.floor(sky.time)} (${sky.isNight ? '밤' : '낮'})\n` +
            `청크 ${world.stats.chunks}  몹 ${mobs.mobs.length}  드롭 ${drops.length}\n` +
            `메시 ${world.stats.meshMs.toFixed(1)}ms  생성 ${world.stats.genMs.toFixed(1)}ms\n` +
            `모드 ${player.gamemode}${player.flying ? ' (비행)' : ''}\n` +
            `보는 블록 ${target ? blocks[target.block].display : '-'}`
        );
    }

    // 렌더
    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(handScene, handCamera);
}

// ---------------- 시작 ----------------
function boot() {
    showLoading(true);
    spawnPlayer();
    // 시작 아이템
    inventory.add('oak_planks', 16);
    inventory.add('torch', 16);
    inventory.add('wooden_pickaxe', 1);
    inventory.add('bread', 5);
    setTimeout(() => showLoading(false), 100);
    animate();
}
boot();

// 디버그/콘솔용
window.game = game;
