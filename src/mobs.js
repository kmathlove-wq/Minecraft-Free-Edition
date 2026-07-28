// ===== 몹: 동물 · 적대 몹 =====
// 상자 모델 + 배회/추적 AI + 중력/충돌 + 드롭
import * as THREE from 'three';
import { IS_SOLID, AIR } from './blocks.js';
import { WORLD_HEIGHT } from './worldgen.js';
import { sfx } from './audio.js';

const GRAVITY = 32;

export const MOB_TYPES = {
    pig:      { display: '돼지', hp: 10, w: 0.9, h: 0.9, speed: 1.1, hostile: false, body: 0xf0a5a2, head: 0xf0a5a2, leg: 0xd08a88, drops: [['porkchop', 2]] },
    cow:      { display: '소', hp: 10, w: 0.9, h: 1.4, speed: 1.0, hostile: false, body: 0x443626, head: 0x4c3a28, leg: 0x33291d, drops: [['beef', 2], ['leather', 1]] },
    sheep:    { display: '양', hp: 8, w: 0.9, h: 1.3, speed: 1.1, hostile: false, body: 0xe8e4dc, head: 0xd9c9b8, leg: 0xd9c9b8, drops: [['white_wool', 1]] },
    chicken:  { display: '닭', hp: 4, w: 0.4, h: 0.7, speed: 1.0, hostile: false, body: 0xe8e8e8, head: 0xe8e8e8, leg: 0xf0a020, drops: [['chicken', 1], ['feather', 2]] },
    zombie:   { display: '좀비', hp: 20, w: 0.6, h: 1.95, speed: 2.3, hostile: true, dmg: 3, body: 0x00a0a0, head: 0x4c8b3f, leg: 0x2f3f8f, drops: [['rotten_flesh', 2]] },
    skeleton: { display: '스켈레톤', hp: 20, w: 0.6, h: 1.99, speed: 2.4, hostile: true, dmg: 2, body: 0xc8c8c8, head: 0xdcdcdc, leg: 0xb4b4b4, drops: [['bone', 2]] },
    creeper:  { display: '크리퍼', hp: 20, w: 0.6, h: 1.7, speed: 2.1, hostile: true, dmg: 6, body: 0x5cb04a, head: 0x63bb52, leg: 0x4f9e3f, drops: [['gunpowder', 2]] }
};

const box = (w, h, d, color) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
    return m;
};

function buildModel(type) {
    const t = MOB_TYPES[type];
    const g = new THREE.Group();
    const legs = [];
    if (t.hostile) {
        // 사람형: 몸통 + 머리 + 팔 2 + 다리 2
        const body = box(0.55, 0.75, 0.28, t.body); body.position.y = 1.13; g.add(body);
        const head = box(0.5, 0.5, 0.5, t.head); head.position.y = 1.75; g.add(head);
        const eyeMat = new THREE.MeshBasicMaterial({ color: type === 'creeper' ? 0x101010 : 0x201010 });
        for (const sx of [-0.12, 0.12]) {
            const e = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.02), eyeMat);
            e.position.set(sx, 0.05, -0.26);
            head.add(e);
        }
        for (const sx of [-0.4, 0.4]) {
            const arm = box(0.22, 0.72, 0.22, t.head); arm.position.set(sx, 1.13, type === 'zombie' ? -0.2 : 0);
            if (type === 'zombie') arm.rotation.x = -Math.PI / 2;
            g.add(arm); legs.push({ mesh: arm, phase: sx > 0 ? 0 : Math.PI, arm: true });
        }
        for (const sx of [-0.14, 0.14]) {
            const leg = box(0.22, 0.75, 0.22, t.leg); leg.position.set(sx, 0.38, 0);
            g.add(leg); legs.push({ mesh: leg, phase: sx > 0 ? Math.PI : 0 });
        }
    } else {
        // 네발 동물
        const bh = t.h * 0.45, by = t.h * 0.62;
        const body = box(t.w * 0.8, bh, t.h * 0.95, t.body); body.position.y = by; g.add(body);
        const head = box(t.w * 0.7, t.w * 0.7, t.w * 0.7, t.head);
        head.position.set(0, by + bh * 0.3, -t.h * 0.6); g.add(head);
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0x151515 });
        for (const sx of [-0.16, 0.16]) {
            const e = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.02), eyeMat);
            e.position.set(sx * t.w, 0.06, -t.w * 0.36); head.add(e);
        }
        const legH = by - bh / 2;
        let n = 0;
        for (const sx of [-0.28, 0.28])
            for (const sz of [-0.32, 0.32]) {
                const leg = box(t.w * 0.28, legH, t.w * 0.28, t.leg);
                leg.position.set(sx * t.w * 1.2, legH / 2, sz * t.h);
                g.add(leg); legs.push({ mesh: leg, phase: (n++ % 2) * Math.PI, base: legH / 2 });
            }
    }
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
                    if (by < 0 || by >= WORLD_HEIGHT) continue;
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

        if (this.pos.y < -10) this.dead = true;

        // --- 애니메이션 ---
        const moving = Math.hypot(vx, vz) > 0.05;
        if (moving) this.walkPhase += dt * (this.type === 'chicken' ? 14 : 8);
        for (const l of this.legs) {
            const sw = moving ? Math.sin(this.walkPhase + l.phase) * 0.5 : 0;
            if (l.arm && this.type === 'zombie') l.mesh.rotation.x = -Math.PI / 2 + sw * 0.2;
            else l.mesh.rotation.x = sw;
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
        const HOSTILE = ['zombie', 'zombie', 'skeleton', 'creeper'];
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
                y = Math.max(2, Math.min(WORLD_HEIGHT - 3, y));
                // 해당 기둥에서 발판이 있는 곳까지 내려간다
                let found = -1;
                for (let k = 0; k < 20; k++) {
                    const yy = y - k;
                    if (yy < 2) break;
                    if (w.getBlock(x, yy, z) === AIR && w.getBlock(x, yy + 1, z) === AIR
                        && IS_SOLID[w.getBlock(x, yy - 1, z)]) { found = yy; break; }
                }
                if (found < 0) continue;
                y = found;
            } else {
                y = w.surfaceY(x, z);
                if (y <= 1 || y >= WORLD_HEIGHT - 3) continue;
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
