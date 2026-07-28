// ===== 몹: 동물 · 적대 몹 =====
// 상자 모델 + 배회/추적 AI + 중력/충돌 + 드롭
import * as THREE from 'three';
import { IS_SOLID, AIR } from './blocks.js';
import { WORLD_HEIGHT, MIN_Y, MAX_Y } from './worldgen.js';
import { sfx } from './audio.js';

const GRAVITY = 32;

export const MOB_TYPES = {
    pig:      { display: '돼지', hp: 10, w: 0.9, h: 0.9, speed: 1.1, hostile: false, body: 0xf0a5a2, head: 0xf0a5a2, leg: 0xd08a88, drops: [['porkchop', 2]] },
    cow:      { display: '소', hp: 10, w: 0.9, h: 1.4, speed: 1.0, hostile: false, body: 0x443626, head: 0x4c3a28, leg: 0x33291d, drops: [['beef', 2], ['leather', 1]] },
    sheep:    { display: '양', hp: 8, w: 0.9, h: 1.3, speed: 1.1, hostile: false, body: 0xe8e4dc, head: 0xd9c9b8, leg: 0xd9c9b8, drops: [['white_wool', 1]] },
    chicken:  { display: '닭', hp: 4, w: 0.4, h: 0.7, speed: 1.0, hostile: false, body: 0xe8e8e8, head: 0xe8e8e8, leg: 0xf0a020, drops: [['chicken', 1], ['feather', 2]] },
    zombie:   { display: '좀비', hp: 20, w: 0.6, h: 1.95, speed: 2.3, hostile: true, dmg: 3, body: 0x00a0a0, head: 0x4c8b3f, leg: 0x2f3f8f, drops: [['rotten_flesh', 2]] },
    skeleton: { display: '스켈레톤', hp: 20, w: 0.6, h: 1.99, speed: 2.4, hostile: true, dmg: 2, body: 0xc8c8c8, head: 0xdcdcdc, leg: 0xb4b4b4, drops: [['bone', 2]] },
    creeper:  { display: '크리퍼', hp: 20, w: 0.6, h: 1.7, speed: 2.1, hostile: true, dmg: 6, body: 0x5cb04a, head: 0x63bb52, leg: 0x4f9e3f, drops: [['gunpowder', 2]] },
    enderman: { display: '엔더맨', hp: 40, w: 0.6, h: 2.9, speed: 2.8, hostile: true, dmg: 4, body: 0x161122, head: 0x1c1630, leg: 0x161122, drops: [['ender_pearl', 1]] }
};

const box = (w, h, d, color) => new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));

const put = (g, mesh, x, y, z) => { mesh.position.set(x, y, z); g.add(mesh); return mesh; };

/** 종류마다 실루엣이 확실히 다르도록 각각 따로 만든다 */
const MODELS = {
    pig(g, legs) {
        put(g, box(0.62, 0.62, 0.94, 0xf0a5a2), 0, 0.62, 0);          // 통통한 몸통
        const head = put(g, box(0.5, 0.5, 0.5, 0xf0a5a2), 0, 0.72, -0.68);
        const snout = box(0.26, 0.2, 0.08, 0xdb8a86);   // 납작한 코
        snout.position.set(0, -0.04, -0.29); head.add(snout);
        for (const sx of [-1, 1]) {
            const ear = box(0.14, 0.14, 0.06, 0xdb8a86);
            ear.position.set(sx * 0.17, 0.28, -0.1); head.add(ear);
            const eye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.02), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
            eye.position.set(sx * 0.14, 0.06, -0.26); head.add(eye);
        }
        for (const [sx, sz, i] of [[-1, -1, 0], [1, -1, 1], [-1, 1, 2], [1, 1, 3]])
            legs.push({ mesh: put(g, box(0.2, 0.32, 0.2, 0xd08a88), sx * 0.2, 0.16, sz * 0.3), phase: (i % 2) * Math.PI });
    },
    cow(g, legs) {
        put(g, box(0.7, 0.72, 1.05, 0x443626), 0, 0.86, 0);
        put(g, box(0.71, 0.3, 0.5, 0xe8e4dc), 0.01, 0.9, 0.1);        // 흰 반점
        const head = put(g, box(0.46, 0.46, 0.46, 0x4c3a28), 0, 1.08, -0.75);
        put(g, box(0.3, 0.18, 0.1, 0xe0d8d0), 0, 0.98, -0.98);        // 주둥이
        for (const sx of [-1, 1]) {
            const horn = box(0.1, 0.1, 0.1, 0xe8e4d8);
            horn.position.set(sx * 0.24, 0.26, 0.02); head.add(horn);
            const eye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.02), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
            eye.position.set(sx * 0.13, 0.07, -0.24); head.add(eye);
        }
        put(g, box(0.16, 0.12, 0.16, 0xe8a0a0), 0, 0.48, 0.3);        // 젖
        for (const [sx, sz, i] of [[-1, -1, 0], [1, -1, 1], [-1, 1, 2], [1, 1, 3]])
            legs.push({ mesh: put(g, box(0.2, 0.52, 0.2, 0x33291d), sx * 0.22, 0.26, sz * 0.34), phase: (i % 2) * Math.PI });
    },
    sheep(g, legs) {
        put(g, box(0.82, 0.8, 1.1, 0xe8e4dc), 0, 0.88, 0.05);         // 복슬복슬한 몸통
        put(g, box(0.9, 0.5, 0.6, 0xf2eee6), 0, 1.02, 0.1);
        const head = put(g, box(0.4, 0.44, 0.42, 0xd9c9b8), 0, 1.0, -0.7);
        for (const sx of [-1, 1]) {
            const eye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.02), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
            eye.position.set(sx * 0.12, 0.05, -0.22); head.add(eye);
        }
        for (const [sx, sz, i] of [[-1, -1, 0], [1, -1, 1], [-1, 1, 2], [1, 1, 3]])
            legs.push({ mesh: put(g, box(0.16, 0.5, 0.16, 0xd9c9b8), sx * 0.22, 0.25, sz * 0.32), phase: (i % 2) * Math.PI });
    },
    chicken(g, legs) {
        put(g, box(0.3, 0.34, 0.42, 0xe8e8e8), 0, 0.44, 0);
        const head = put(g, box(0.24, 0.24, 0.22, 0xf2f2f2), 0, 0.68, -0.18);
        put(g, box(0.1, 0.08, 0.12, 0xf0a020), 0, 0.66, -0.34);       // 부리
        put(g, box(0.06, 0.12, 0.14, 0xd03030), 0, 0.82, -0.16);      // 볏
        for (const sx of [-1, 1]) {
            const eye = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.02), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
            eye.position.set(sx * 0.08, 0.02, -0.12); head.add(eye);
            legs.push({ mesh: put(g, box(0.16, 0.3, 0.05, 0xf5f5f5), sx * 0.18, 0.5, 0.02), phase: sx > 0 ? 0 : Math.PI, wing: true });
            legs.push({ mesh: put(g, box(0.06, 0.26, 0.06, 0xf0a020), sx * 0.08, 0.13, 0.02), phase: sx > 0 ? Math.PI : 0 });
        }
    },
    zombie(g, legs) {
        put(g, box(0.55, 0.72, 0.3, 0x00a0a0), 0, 1.12, 0);           // 청록 셔츠
        const head = put(g, box(0.5, 0.5, 0.5, 0x4c8b3f), 0, 1.73, 0);
        for (const sx of [-1, 1]) {
            const eye = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.02), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
            eye.position.set(sx * 0.13, 0.04, -0.26); head.add(eye);
        }
        for (const sx of [-1, 1]) {                                    // 앞으로 뻗은 팔
            const arm = put(g, box(0.2, 0.7, 0.2, 0x4c8b3f), sx * 0.38, 1.12, -0.22);
            arm.rotation.x = -Math.PI / 2;
            legs.push({ mesh: arm, phase: sx > 0 ? 0 : Math.PI, arm: true, fixed: -Math.PI / 2 });
        }
        for (const sx of [-1, 1])
            legs.push({ mesh: put(g, box(0.22, 0.74, 0.22, 0x2f3f8f), sx * 0.13, 0.37, 0), phase: sx > 0 ? Math.PI : 0 });
    },
    skeleton(g, legs) {
        put(g, box(0.4, 0.7, 0.2, 0xc8c8c8), 0, 1.1, 0);              // 가느다란 갈비
        put(g, box(0.44, 0.1, 0.24, 0xdcdcdc), 0, 1.42, 0);
        const head = put(g, box(0.48, 0.48, 0.48, 0xdcdcdc), 0, 1.72, 0);
        for (const sx of [-1, 1]) {
            const eye = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.02), new THREE.MeshBasicMaterial({ color: 0x101010 }));
            eye.position.set(sx * 0.12, 0.03, -0.25); head.add(eye);
        }
        for (const sx of [-1, 1]) {
            const arm = put(g, box(0.11, 0.68, 0.11, 0xc8c8c8), sx * 0.3, 1.12, -0.14);
            arm.rotation.x = -1.2;
            legs.push({ mesh: arm, phase: sx > 0 ? 0 : Math.PI, arm: true, fixed: -1.2 });
        }
        for (const sx of [-1, 1])
            legs.push({ mesh: put(g, box(0.11, 0.74, 0.11, 0xb4b4b4), sx * 0.11, 0.37, 0), phase: sx > 0 ? Math.PI : 0 });
    },
    creeper(g, legs) {
        put(g, box(0.55, 1.05, 0.3, 0x5cb04a), 0, 0.85, 0);           // 팔 없는 긴 몸통
        const head = put(g, box(0.52, 0.52, 0.52, 0x63bb52), 0, 1.62, 0);
        const dark = new THREE.MeshBasicMaterial({ color: 0x0d1a0d });
        for (const sx of [-1, 1]) {                                    // 크리퍼 특유의 얼굴
            const eye = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.02), dark);
            eye.position.set(sx * 0.14, 0.08, -0.27); head.add(eye);
        }
        const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.02), dark);
        mouth.position.set(0, -0.08, -0.27); head.add(mouth);
        for (const sx of [-1, 1]) {
            const fang = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.02), dark);
            fang.position.set(sx * 0.105, -0.19, -0.27); head.add(fang);
        }
        for (const [sx, sz, i] of [[-1, -1, 0], [1, -1, 1], [-1, 1, 2], [1, 1, 3]])
            legs.push({ mesh: put(g, box(0.22, 0.32, 0.22, 0x4f9e3f), sx * 0.14, 0.16, sz * 0.16), phase: (i % 2) * Math.PI });
    },
    enderman(g, legs) {
        put(g, box(0.36, 0.9, 0.24, 0x161122), 0, 1.85, 0);            // 아주 크고 가늘다
        const head = put(g, box(0.44, 0.4, 0.44, 0x1c1630), 0, 2.5, 0);
        for (const sx of [-1, 1]) {
            const eye = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.02), new THREE.MeshBasicMaterial({ color: 0xd8b0ff }));
            eye.position.set(sx * 0.11, 0.02, -0.23); head.add(eye);
        }
        for (const sx of [-1, 1]) {
            const arm = put(g, box(0.1, 1.15, 0.1, 0x161122), sx * 0.25, 1.75, 0);
            legs.push({ mesh: arm, phase: sx > 0 ? 0 : Math.PI, arm: true });
        }
        for (const sx of [-1, 1])
            legs.push({ mesh: put(g, box(0.1, 1.4, 0.1, 0x161122), sx * 0.1, 0.7, 0), phase: sx > 0 ? Math.PI : 0 });
    }
};

function buildModel(type) {
    const g = new THREE.Group();
    const legs = [];
    (MODELS[type] ?? MODELS.pig)(g, legs);
    return { group: g, legs };
}

export class Mob {
    constructor(type, x, y, z) {
        const t = MOB_TYPES[type];
        this.type = type;
        this.def = t;
        this.pos = { x, y, z };
        this.vel = { x: 0, y: 0, z: 0 };
        this.hp = t.hp;
        this.yaw = Math.random() * Math.PI * 2;
        this.onGround = false;
        this.wanderTimer = 0;
        this.moveX = 0; this.moveZ = 0;
        this.attackCd = 0;
        this.soundCd = 2 + Math.random() * 10;
        this.walkPhase = 0;
        this.dead = false;
        this.hurtFlash = 0;
        const m = buildModel(type);
        this.mesh = m.group;
        this.legs = m.legs;
    }

    _collides(world, x, y, z) {
        const hw = this.def.w / 2, h = this.def.h;
        for (let bx = Math.floor(x - hw); bx <= Math.floor(x + hw - 1e-3); bx++)
            for (let bz = Math.floor(z - hw); bz <= Math.floor(z + hw - 1e-3); bz++)
                for (let by = Math.floor(y); by <= Math.floor(y + h - 1e-3); by++) {
                    if (by < MIN_Y || by > MAX_Y) continue;
                    if (IS_SOLID[world.getBlock(bx, by, bz)]) return true;
                }
        return false;
    }

    update(dt, world, player, isNight) {
        if (this.dead) return;
        const t = this.def;
        this.attackCd = Math.max(0, this.attackCd - dt);
        this.hurtFlash = Math.max(0, this.hurtFlash - dt);

        const dxp = player.pos.x - this.pos.x, dzp = player.pos.z - this.pos.z;
        const dist = Math.hypot(dxp, dzp, player.pos.y - this.pos.y);

        // --- AI ---
        let target = null;
        if (t.hostile && dist < 16 && player.gamemode === 'survival' && !player.dead) target = player;

        if (target) {
            const d = Math.hypot(dxp, dzp) || 1;
            this.moveX = dxp / d; this.moveZ = dzp / d;
            this.yaw = Math.atan2(this.moveX, this.moveZ);
            if (dist < 1.6 && this.attackCd <= 0) {
                this.attackCd = 1.0;
                player.damage(t.dmg ?? 2);
                if (this.type === 'creeper') { this.dead = true; sfx.explode(); }
            }
        } else {
            this.wanderTimer -= dt;
            if (this.wanderTimer <= 0) {
                this.wanderTimer = 3 + Math.random() * 6;
                if (Math.random() < 0.4) { this.moveX = this.moveZ = 0; }
                else {
                    const a = Math.random() * Math.PI * 2;
                    this.moveX = Math.sin(a); this.moveZ = Math.cos(a);
                    this.yaw = a;
                }
            }
        }

        // --- 물리 ---
        const speed = t.speed * (target ? 1 : 0.55);
        const vx = this.moveX * speed, vz = this.moveZ * speed;
        this.vel.y -= GRAVITY * dt;
        if (this.vel.y < -60) this.vel.y = -60;

        const step = (ax, az, ay) => {
            if (ay !== 0) {
                const ny = this.pos.y + ay;
                if (this._collides(world, this.pos.x, ny, this.pos.z)) {
                    if (ay < 0) { this.pos.y = Math.floor(ny) + 1; this.onGround = true; }
                    this.vel.y = 0;
                } else { this.pos.y = ny; if (ay < 0) this.onGround = false; }
            }
            if (ax !== 0) {
                if (!this._collides(world, this.pos.x + ax, this.pos.y, this.pos.z)) this.pos.x += ax;
                else if (this.onGround && !this._collides(world, this.pos.x + ax, this.pos.y + 1, this.pos.z)) this.vel.y = 8.5;
                else this.moveX = -this.moveX;
            }
            if (az !== 0) {
                if (!this._collides(world, this.pos.x, this.pos.y, this.pos.z + az)) this.pos.z += az;
                else if (this.onGround && !this._collides(world, this.pos.x, this.pos.y + 1, this.pos.z + az)) this.vel.y = 8.5;
                else this.moveZ = -this.moveZ;
            }
        };
        const n = Math.max(1, Math.ceil(Math.abs(this.vel.y * dt) / 0.4));
        for (let i = 0; i < n; i++) step(vx * dt / n, vz * dt / n, this.vel.y * dt / n);

        if (this.pos.y < MIN_Y - 8) this.dead = true;

        // --- 애니메이션 ---
        const moving = Math.hypot(vx, vz) > 0.05;
        if (moving) this.walkPhase += dt * (this.type === 'chicken' ? 14 : 8);
        for (const l of this.legs) {
            const sw = moving ? Math.sin(this.walkPhase + l.phase) * 0.5 : 0;
            if (l.wing) l.mesh.rotation.z = moving ? Math.sin(this.walkPhase * 2) * 0.6 : 0;
            else if (l.fixed !== undefined) l.mesh.rotation.x = l.fixed + sw * 0.2;
            else l.mesh.rotation.x = sw * (l.arm ? 0.7 : 1);
        }
        this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
        this.mesh.rotation.y = this.yaw + Math.PI;

        // --- 소리 ---
        this.soundCd -= dt;
        if (this.soundCd <= 0) {
            this.soundCd = 8 + Math.random() * 20;
            if (dist < 24) sfx.mob(this.type);
        }

        // 적대 몹은 낮에 불타서 사라짐(간략화: 사라짐)
        // 낮에 하늘이 뚫린 곳에 있으면 불타 사라진다 (동굴 안에서는 안전)
        if (t.hostile && !isNight && this.type !== 'creeper'
            && world.getSkyLight(Math.floor(this.pos.x), Math.ceil(this.pos.y + t.h), Math.floor(this.pos.z)) >= 14) {
            this.hp -= dt * 3;
            if (this.hp <= 0) this.dead = true;
        }
    }

    hurt(n) {
        this.hp -= n;
        this.hurtFlash = 0.3;
        sfx.mob(this.type);
        if (this.hp <= 0) this.dead = true;
    }
}

export class MobManager {
    constructor(scene, world) {
        this.scene = scene;
        this.world = world;
        this.mobs = [];
        this.spawnTimer = 0;
        this.maxMobs = 24;
        this.enabled = true;
    }

    spawn(type, x, y, z) {
        const m = new Mob(type, x, y, z);
        this.mobs.push(m);
        this.scene.add(m.mesh);
        return m;
    }

    update(dt, player, isNight, skyFactor = 1) {
        if (!this.enabled) return;
        for (let i = this.mobs.length - 1; i >= 0; i--) {
            const m = this.mobs[i];
            m.update(dt, this.world, player, isNight);
            const d = Math.hypot(m.pos.x - player.pos.x, m.pos.z - player.pos.z);
            if (m.dead || d > 72) {
                if (m.dead && d < 48) this.onDrop?.(m);
                this.scene.remove(m.mesh);
                m.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); });
                this.mobs.splice(i, 1);
            }
        }

        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
            this.spawnTimer = 3;
            this._trySpawn(player, isNight, skyFactor);
        }
    }

    /**
     * 마인크래프트와 같은 규칙:
     *  - 적대 몹은 밝기 0인 곳(밤의 지표, 동굴 속)에 생성
     *  - 동물은 낮의 밝은 잔디 위에 생성
     */
    _trySpawn(player, isNight, skyFactor = 1) {
        if (this.mobs.length >= this.maxMobs) return;
        const w = this.world;
        const HOSTILE = ['zombie', 'zombie', 'skeleton', 'creeper', 'enderman'];
        const PASSIVE = ['pig', 'cow', 'sheep', 'chicken'];

        for (let tries = 0; tries < 24; tries++) {
            const a = Math.random() * Math.PI * 2;
            const r = 16 + Math.random() * 28;
            const x = Math.floor(player.pos.x + Math.cos(a) * r);
            const z = Math.floor(player.pos.z + Math.sin(a) * r);

            // 절반은 플레이어 높이 근처(동굴), 절반은 지표
            let y;
            if (tries % 2 === 0) {
                y = Math.floor(player.pos.y) + ((Math.random() * 32) | 0) - 16;
                y = Math.max(MIN_Y + 2, Math.min(MAX_Y - 3, y));
                // 해당 기둥에서 발판이 있는 곳까지 내려간다
                let found = -1;
                for (let k = 0; k < 20; k++) {
                    const yy = y - k;
                    if (yy < MIN_Y + 2) break;
                    if (w.getBlock(x, yy, z) === AIR && w.getBlock(x, yy + 1, z) === AIR
                        && IS_SOLID[w.getBlock(x, yy - 1, z)]) { found = yy; break; }
                }
                if (found < 0) continue;
                y = found;
            } else {
                y = w.surfaceY(x, z);
                if (y <= MIN_Y + 1 || y >= MAX_Y - 3) continue;
                if (w.getBlock(x, y, z) !== AIR || w.getBlock(x, y + 1, z) !== AIR) continue;
                if (!IS_SOLID[w.getBlock(x, y - 1, z)]) continue;
            }

            // 플레이어 바로 옆에는 생성하지 않는다
            if (Math.hypot(x + 0.5 - player.pos.x, y - player.pos.y, z + 0.5 - player.pos.z) < 12) continue;

            const blockLight = w.getBlockLight(x, y, z);
            const skyLight = w.getSkyLight(x, y, z);
            const effective = Math.max(Math.round(skyLight * skyFactor), blockLight);

            let pool = null;
            if (blockLight === 0 && effective <= 3) pool = HOSTILE;          // 어두운 곳 → 적대 몹
            else if (!isNight && effective >= 9 && skyLight >= 9) {
                const ground = w.getBlock(x, y - 1, z);
                if (ground === 3 /* grass_block */ || ground === 4 /* snowy grass */) pool = PASSIVE;
            }
            if (!pool) continue;

            this.spawn(pool[(Math.random() * pool.length) | 0], x + 0.5, y, z + 0.5);
            return;
        }
    }

    /** 시선 방향에서 가장 가까운 몹을 찾는다 */
    pick(origin, dir, maxDist = 4) {
        let best = null, bestT = maxDist;
        for (const m of this.mobs) {
            const hw = m.def.w / 2 + 0.15, h = m.def.h;
            const t = rayBox(origin, dir,
                m.pos.x - hw, m.pos.y, m.pos.z - hw,
                m.pos.x + hw, m.pos.y + h, m.pos.z + hw);
            if (t !== null && t < bestT) { bestT = t; best = m; }
        }
        return best;
    }

    clear() {
        for (const m of this.mobs) { this.scene.remove(m.mesh); }
        this.mobs = [];
    }
}

function rayBox(o, d, x0, y0, z0, x1, y1, z1) {
    let tmin = 0, tmax = Infinity;
    const ax = [[o.x, d.x, x0, x1], [o.y, d.y, y0, y1], [o.z, d.z, z0, z1]];
    for (const [oo, dd, a, b] of ax) {
        if (Math.abs(dd) < 1e-9) { if (oo < a || oo > b) return null; continue; }
        let t1 = (a - oo) / dd, t2 = (b - oo) / dd;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
    }
    return tmin;
}
