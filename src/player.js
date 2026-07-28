// ===== 플레이어: AABB 충돌 · 이동 · 생존 스탯 =====
// 이동/점프 수치는 실제 마인크래프트 값을 따른다.
//   걷기 4.317 m/s · 달리기 5.612 m/s · 웅크리기 1.295 m/s
//   점프 높이 1.25블록 (v = sqrt(2·g·1.25), g = 32 m/s²)
import { IS_SOLID, RENDER_KIND, blocks, AIR, B } from './blocks.js';
import { WORLD_HEIGHT } from './worldgen.js';

export const PW = 0.6;                 // 폭
export const PH = 1.8;                 // 키
export const PH_SNEAK = 1.5;
export const EYE = 1.62;
export const EYE_SNEAK = 1.27;

const GRAVITY = 32;
const JUMP_V = Math.sqrt(2 * GRAVITY * 1.25);   // ≈ 8.944
const TERMINAL = -78.4;
const SPEED_WALK = 4.317, SPEED_SPRINT = 5.612, SPEED_SNEAK = 1.295;
const SPEED_FLY = 10.89, SPEED_FLY_FAST = 21.78;
const ACCEL_GROUND = 14, ACCEL_AIR = 3;   // 지수 수렴 계수 (1/s)
const EPS = 1e-3;

export class Player {
    constructor(world) {
        this.world = world;
        this.pos = { x: 0, y: 80, z: 0 };     // 발 위치
        this.vel = { x: 0, y: 0, z: 0 };
        this.yaw = 0; this.pitch = 0;

        this.onGround = false;
        this.inWater = false;
        this.headInWater = false;
        this.sprinting = false;
        this.sneaking = false;
        this.flying = false;
        this.gamemode = 'survival';          // survival | creative

        this.health = 20;
        this.food = 20;
        this.saturation = 5;
        this.exhaustion = 0;
        this.air = 300;                      // 틱 단위 (15초)
        this.fallStart = null;
        this.hurtTimer = 0;
        this.dead = false;
        this.spawn = { x: 0, y: 80, z: 0 };

        this._tickAcc = 0;
        this._regenAcc = 0;
        this._stepDist = 0;
        this.onStep = null;                  // (blockId) => void
        this.onHurt = null;
    }

    get height() { return this.sneaking && this.onGround ? PH_SNEAK : PH; }
    get eyeY() { return this.pos.y + (this.sneaking && this.onGround ? EYE_SNEAK : EYE); }

    // ---------- 충돌 ----------
    _collides(x, y, z, h = this.height) {
        const hw = PW / 2;
        const x0 = Math.floor(x - hw + EPS), x1 = Math.floor(x + hw - EPS);
        const z0 = Math.floor(z - hw + EPS), z1 = Math.floor(z + hw - EPS);
        const y0 = Math.floor(y + EPS), y1 = Math.floor(y + h - EPS);
        for (let by = y0; by <= y1; by++) {
            if (by < 0 || by >= WORLD_HEIGHT) continue;
            for (let bx = x0; bx <= x1; bx++)
                for (let bz = z0; bz <= z1; bz++)
                    if (IS_SOLID[this.world.getBlock(bx, by, bz)]) return true;
        }
        return false;
    }

    /** 발밑이 비어 있는지 (스니크 낙하 방지용) */
    _supported(x, z) {
        const hw = PW / 2;
        const by = Math.floor(this.pos.y - 0.06);
        for (let bx = Math.floor(x - hw + EPS); bx <= Math.floor(x + hw - EPS); bx++)
            for (let bz = Math.floor(z - hw + EPS); bz <= Math.floor(z + hw - EPS); bz++)
                if (IS_SOLID[this.world.getBlock(bx, by, bz)]) return true;
        return false;
    }

    _moveAxis(dx, dy, dz) {
        const hw = PW / 2, h = this.height;

        if (dy !== 0) {
            const ny = this.pos.y + dy;
            if (this._collides(this.pos.x, ny, this.pos.z, h)) {
                if (dy < 0) {
                    this.pos.y = Math.floor(ny + EPS) + 1;
                    this.onGround = true;
                } else {
                    this.pos.y = Math.floor(ny + h - EPS) - h - EPS;
                }
                this.vel.y = 0;
            } else {
                this.pos.y = ny;
                if (dy < 0) this.onGround = false;
            }
        }

        if (dx !== 0) {
            const nx = this.pos.x + dx;
            // 웅크리는 중에는 모서리 밖으로 나가지 않음
            if (this.sneaking && this.onGround && !this._supported(nx, this.pos.z)) {
                // 이동 취소
            } else if (this._collides(nx, this.pos.y, this.pos.z, h)) {
                this.pos.x = dx > 0 ? Math.floor(nx + hw) - hw - EPS : Math.floor(nx - hw) + 1 + hw + EPS;
                this.vel.x = 0;
            } else this.pos.x = nx;
        }

        if (dz !== 0) {
            const nz = this.pos.z + dz;
            if (this.sneaking && this.onGround && !this._supported(this.pos.x, nz)) {
                // 이동 취소
            } else if (this._collides(this.pos.x, this.pos.y, nz, h)) {
                this.pos.z = dz > 0 ? Math.floor(nz + hw) - hw - EPS : Math.floor(nz - hw) + 1 + hw + EPS;
                this.vel.z = 0;
            } else this.pos.z = nz;
        }
    }

    // ---------- 업데이트 ----------
    /**
     * @param dt 초
     * @param input { forward, back, left, right, jump, sneak, sprint, up, down }
     */
    update(dt, input) {
        if (this.dead) return;
        const w = this.world;

        // 물 판정
        const feet = w.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.1), Math.floor(this.pos.z));
        const head = w.getBlock(Math.floor(this.pos.x), Math.floor(this.eyeY), Math.floor(this.pos.z));
        this.inWater = RENDER_KIND[feet] === 3;
        this.headInWater = RENDER_KIND[head] === 3;

        this.sneaking = !!input.sneak && !this.flying;
        const creative = this.gamemode === 'creative';
        if (!creative) this.flying = false;

        // 목표 수평 속도
        let target = SPEED_WALK;
        if (this.flying) target = input.sprint ? SPEED_FLY_FAST : SPEED_FLY;
        else if (this.sneaking) target = SPEED_SNEAK;
        else if (this.sprinting && input.forward) target = SPEED_SPRINT;
        if (this.inWater && !this.flying) target *= 0.5;

        // 입력 → 월드 방향
        let ix = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        let iz = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
        const len = Math.hypot(ix, iz);
        if (len > 0) { ix /= len; iz /= len; }
        // 카메라(YXZ, yaw 회전)의 전방은 -Z: forward = (-sin, -cos), right = (cos, -sin)
        const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
        const wx = ix * cos - iz * sin;
        const wz = -ix * sin - iz * cos;

        if (!input.forward) this.sprinting = false;

        // 수평: 목표 속도로 지수 수렴 (지상은 빠르게, 공중은 관성 유지)
        const k = (this.onGround || this.flying || this.inWater) ? ACCEL_GROUND : ACCEL_AIR;
        const t = 1 - Math.exp(-k * dt);
        const desiredX = wx * target, desiredZ = wz * target;
        this.vel.x += (desiredX - this.vel.x) * t;
        this.vel.z += (desiredZ - this.vel.z) * t;

        // 수직. 중력은 사다리꼴 적분(속도의 평균)을 써서 프레임률과 무관하게
        // 점프 높이가 정확히 1.25블록이 되도록 한다.
        let vyAvg;
        if (this.flying) {
            let vy = 0;
            if (input.jump) vy += target;
            if (input.sneak) vy -= target;
            this.vel.y = vyAvg = vy;
        } else if (this.inWater) {
            const v0 = this.vel.y;
            this.vel.y += (-1.4 - this.vel.y) * Math.min(1, 6 * dt);   // 부력 + 저항
            if (input.jump) this.vel.y = 3.2;
            vyAvg = (v0 + this.vel.y) * 0.5;
        } else {
            if (input.jump && this.onGround) {
                this.vel.y = JUMP_V;
                this.onGround = false;
                if (this.sprinting) { this.vel.x += wx * 3.2; this.vel.z += wz * 3.2; }
                this.exhaustion += this.sprinting ? 0.2 : 0.05;
            }
            const v0 = this.vel.y;
            this.vel.y -= GRAVITY * dt;
            if (this.vel.y < TERMINAL) this.vel.y = TERMINAL;
            vyAvg = (v0 + this.vel.y) * 0.5;
        }

        // 낙하 거리 추적
        if (!this.onGround && this.vel.y < 0 && !this.flying && !this.inWater) {
            if (this.fallStart === null) this.fallStart = this.pos.y;
        } else if (this.vel.y > 0 || this.flying || this.inWater) {
            this.fallStart = null;
        }

        // 이동 (서브스텝으로 터널링 방지)
        const dx = this.vel.x * dt, dz = this.vel.z * dt, dy = vyAvg * dt;
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.35));
        const wasGround = this.onGround;
        this.onGround = false;
        const beforeY = this.pos.y;
        for (let s = 0; s < steps; s++) this._moveAxis(dx / steps, dy / steps, dz / steps);

        // 착지 처리 (낙하 피해)
        if (this.onGround && !wasGround && this.fallStart !== null) {
            const fell = this.fallStart - this.pos.y;
            if (fell > 3 && this.gamemode === 'survival' && !this.inWater) {
                this.damage(Math.floor(fell - 3));
            }
            this.fallStart = null;
        }

        // 발소리
        if (this.onGround) {
            this._stepDist += Math.hypot(this.vel.x, this.vel.z) * dt;
            if (this._stepDist > (this.sprinting ? 1.6 : 2.2)) {
                this._stepDist = 0;
                const below = w.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.2), Math.floor(this.pos.z));
                if (below !== AIR && this.onStep) this.onStep(below);
                this.exhaustion += this.sprinting ? 0.1 * 0.1 : 0.01;
            }
        }

        this._survivalTick(dt);
        if (this.pos.y < -20) this.damage(this.gamemode === 'creative' ? 0 : 4);
    }

    // 20 tps 생존 로직
    _survivalTick(dt) {
        this._tickAcc += dt;
        while (this._tickAcc >= 0.05) {
            this._tickAcc -= 0.05;
            if (this.hurtTimer > 0) this.hurtTimer--;
            if (this.gamemode !== 'survival') { this.air = 300; continue; }

            // 익사
            if (this.headInWater) {
                this.air--;
                if (this.air <= -20) { this.air = 0; this.damage(2); }
            } else this.air = Math.min(300, this.air + 4);

            // 허기 소모
            if (this.exhaustion >= 4) {
                this.exhaustion -= 4;
                if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
                else this.food = Math.max(0, this.food - 1);
            }

            // 자연 회복 / 굶주림
            this._regenAcc++;
            if (this.food >= 18 && this.health < 20 && this._regenAcc >= 80) {
                this._regenAcc = 0;
                this.health = Math.min(20, this.health + 1);
                this.exhaustion += 6;
            } else if (this.food === 0 && this._regenAcc >= 80) {
                this._regenAcc = 0;
                this.damage(1);
            }
            if (this._regenAcc > 200) this._regenAcc = 0;
        }
    }

    damage(n) {
        if (n <= 0 || this.gamemode === 'creative' || this.dead) return;
        if (this.hurtTimer > 0) return;
        this.health = Math.max(0, this.health - n);
        this.hurtTimer = 10;
        if (this.onHurt) this.onHurt(n);
        if (this.health <= 0) this.dead = true;
    }

    heal(n) { this.health = Math.min(20, this.health + n); }

    eat(food) {
        if (this.food >= 20) return false;
        this.food = Math.min(20, this.food + food.hunger);
        this.saturation = Math.min(this.food, this.saturation + food.saturation);
        return true;
    }

    respawn() {
        this.dead = false;
        this.health = 20; this.food = 20; this.saturation = 5;
        this.exhaustion = 0; this.air = 300; this.fallStart = null;
        this.vel = { x: 0, y: 0, z: 0 };
        const y = this.world.surfaceY(Math.floor(this.spawn.x), Math.floor(this.spawn.z));
        this.pos = { x: this.spawn.x, y: y + 0.2, z: this.spawn.z };
    }
}
