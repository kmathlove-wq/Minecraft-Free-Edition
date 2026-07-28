// ===== 차원: 오버월드 · 네더 · 엔드 =====
import { B } from './blocks.js';
import { CHUNK_SIZE, WORLD_HEIGHT, MIN_Y, MAX_Y, idx } from './worldgen.js';

// ---------- 공용 노이즈 (worldgen 과 같은 방식) ----------
function hash2(x, z, seed) {
    let n = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 1120872981) + Math.imul(seed, 668265263)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function hash3(x, y, z, seed) {
    let n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1120872981) + Math.imul(seed, 2147483647)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
function noise2(x, z, seed) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = fade(x - ix), fz = fade(z - iz);
    return lerp(lerp(hash2(ix, iz, seed), hash2(ix + 1, iz, seed), fx),
                lerp(hash2(ix, iz + 1, seed), hash2(ix + 1, iz + 1, seed), fx), fz);
}
function noise3(x, y, z, seed) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz);
    const c = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz, seed);
    const x00 = lerp(c(0, 0, 0), c(1, 0, 0), fx), x10 = lerp(c(0, 1, 0), c(1, 1, 0), fx);
    const x01 = lerp(c(0, 0, 1), c(1, 0, 1), fx), x11 = lerp(c(0, 1, 1), c(1, 1, 1), fx);
    return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz);
}
function fbm2(x, z, seed, oct = 4) {
    let a = 1, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) { sum += noise2(x * f, z * f, seed + i * 101) * a; norm += a; a *= 0.5; f *= 2; }
    return sum / norm;
}

// ================== 네더 ==================
export const NETHER_FLOOR = 0;
export const NETHER_ROOF = 127;
export const NETHER_LAVA = 31;

export class NetherGen {
    constructor(seed) { this.seed = (seed ^ 0x4e455448) | 0; }

    /** 지표(설 수 있는 곳) 높이 — 포털 생성 위치 찾기용 */
    heightAt(wx, wz) {
        const s = this.seed;
        const base = fbm2(wx * 0.012, wz * 0.012, s, 4);
        return Math.round(NETHER_LAVA + 4 + base * 26);
    }
    biomeAt() { return 0; }

    generate(cx, cz, data, heightMap, biomeMap) {
        const s = this.seed;
        data.fill(0);
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
            for (let lx = 0; lx < CHUNK_SIZE; lx++) {
                const wx = cx * CHUNK_SIZE + lx, wz = cz * CHUNK_SIZE + lz;
                const ground = this.heightAt(wx, wz);
                const roof = NETHER_ROOF - 6 - Math.round(fbm2(wx * 0.02, wz * 0.02, s + 77, 3) * 18);
                heightMap[lz * CHUNK_SIZE + lx] = ground;
                biomeMap[lz * CHUNK_SIZE + lx] = 0;

                for (let y = NETHER_FLOOR; y <= NETHER_ROOF; y++) {
                    let blk = 0;
                    if (y <= NETHER_FLOOR + 1 + (hash2(wx * 3 + y, wz * 5, s + 7) * 2 | 0)) blk = B.BEDROCK;
                    else if (y >= NETHER_ROOF - 1 - (hash2(wx * 7, wz * 11 + y, s + 9) * 2 | 0)) blk = B.BEDROCK;
                    else if (y <= ground) blk = B.NETHERRACK;
                    else if (y >= roof) blk = B.NETHERRACK;

                    // 동굴 (네더는 크게 뚫려 있다)
                    if (blk === B.NETHERRACK) {
                        const n = noise3(wx * 0.035, y * 0.05, wz * 0.035, s + 11);
                        if (n > 0.62 && y > NETHER_FLOOR + 3 && y < NETHER_ROOF - 3) blk = 0;
                    }
                    data[idx(lx, y, lz)] = blk;
                }

                // 용암 바다
                for (let y = NETHER_FLOOR + 2; y <= NETHER_LAVA; y++) {
                    const k = idx(lx, y, lz);
                    if (data[k] === 0) data[k] = B.LAVA;
                }

                // 표면 장식: 영혼 모래 / 마그마
                const top = this._topSolid(data, lx, lz);
                if (top !== null) {
                    const r = hash2(wx * 17, wz * 23, s + 31);
                    if (r > 0.86) data[idx(lx, top, lz)] = B.SOUL_SAND;
                    else if (r < 0.05 && top <= NETHER_LAVA + 2) data[idx(lx, top, lz)] = B.MAGMA_BLOCK;
                }
            }
        }
        this._decorate(cx, cz, data);
    }

    _topSolid(data, lx, lz) {
        for (let y = NETHER_ROOF - 8; y >= NETHER_FLOOR + 2; y--) {
            if (data[idx(lx, y, lz)] === B.NETHERRACK) return y;
        }
        return null;
    }

    /** 석영 광석 · 천장 발광석 */
    _decorate(cx, cz, data) {
        let r = (cx * 341873128 + cz * 132897987 + this.seed) | 0;
        const rnd = () => { r = (Math.imul(r, 1103515245) + 12345) | 0; return ((r >>> 8) & 0xffffff) / 0xffffff; };
        // 석영
        for (let v = 0; v < 16; v++) {
            let x = (rnd() * CHUNK_SIZE) | 0, y = NETHER_FLOOR + 4 + ((rnd() * (NETHER_ROOF - 10)) | 0), z = (rnd() * CHUNK_SIZE) | 0;
            for (let i = 0; i < 12; i++) {
                if (x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE && y > NETHER_FLOOR && y < NETHER_ROOF) {
                    const k = idx(x, y, z);
                    if (data[k] === B.NETHERRACK) data[k] = B.QUARTZ_ORE;
                }
                const d = (rnd() * 6) | 0;
                if (d === 0) x++; else if (d === 1) x--; else if (d === 2) y++;
                else if (d === 3) y--; else if (d === 4) z++; else z--;
            }
        }
        // 천장에 매달린 발광석 덩어리
        for (let v = 0; v < 3; v++) {
            if (rnd() > 0.5) continue;
            const cxp = 2 + ((rnd() * 12) | 0), czp = 2 + ((rnd() * 12) | 0);
            let y = NETHER_ROOF - 4;
            while (y > NETHER_FLOOR + 6 && data[idx(cxp, y, czp)] !== B.NETHERRACK) y--;
            if (y <= NETHER_FLOOR + 6) continue;
            for (let dy = 0; dy < 3; dy++)
                for (let dx = -1; dx <= 1; dx++)
                    for (let dz = -1; dz <= 1; dz++) {
                        if (Math.abs(dx) + Math.abs(dz) + dy > 2) continue;
                        const x = cxp + dx, z = czp + dz, yy = y - dy;
                        if (x < 0 || z < 0 || x >= CHUNK_SIZE || z >= CHUNK_SIZE) continue;
                        const k = idx(x, yy, z);
                        if (data[k] === 0 || data[k] === B.NETHERRACK) data[k] = B.GLOWSTONE;
                    }
        }
    }
}

// ================== 엔드 ==================
export const END_Y = 60;
const END_RADIUS = 90;

export class EndGen {
    constructor(seed) { this.seed = (seed ^ 0x454e4421) | 0; }

    heightAt(wx, wz) {
        const d = Math.hypot(wx, wz);
        if (d > END_RADIUS) return MIN_Y;                 // 허공
        const edge = Math.min(1, (END_RADIUS - d) / 24);
        const n = fbm2(wx * 0.02, wz * 0.02, this.seed, 4);
        return Math.round(END_Y + n * 10 * edge);
    }
    biomeAt() { return 0; }

    generate(cx, cz, data, heightMap, biomeMap) {
        data.fill(0);
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
            for (let lx = 0; lx < CHUNK_SIZE; lx++) {
                const wx = cx * CHUNK_SIZE + lx, wz = cz * CHUNK_SIZE + lz;
                const d = Math.hypot(wx, wz);
                heightMap[lz * CHUNK_SIZE + lx] = END_Y;
                biomeMap[lz * CHUNK_SIZE + lx] = 0;
                if (d > END_RADIUS) continue;

                const top = this.heightAt(wx, wz);
                const edge = Math.min(1, (END_RADIUS - d) / 24);
                const thickness = Math.round(6 + edge * 22);
                for (let y = top - thickness; y <= top; y++) {
                    if (y < MIN_Y || y > MAX_Y) continue;
                    data[idx(lx, y, lz)] = B.END_STONE;
                }
            }
        }
        this._pillars(cx, cz, data);
    }

    /** 중앙 섬을 둘러싼 흑요석 기둥 */
    _pillars(cx, cz, data) {
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const px = Math.round(Math.cos(a) * 46), pz = Math.round(Math.sin(a) * 46);
            const rad = 2 + (i % 3);
            const h = 16 + (i % 4) * 6;
            for (let dx = -rad; dx <= rad; dx++)
                for (let dz = -rad; dz <= rad; dz++) {
                    if (dx * dx + dz * dz > rad * rad) continue;
                    const wx = px + dx, wz = pz + dz;
                    const lx = wx - cx * CHUNK_SIZE, lz = wz - cz * CHUNK_SIZE;
                    if (lx < 0 || lz < 0 || lx >= CHUNK_SIZE || lz >= CHUNK_SIZE) continue;
                    for (let y = END_Y; y <= END_Y + h; y++) data[idx(lx, y, lz)] = B.OBSIDIAN;
                }
        }
    }
}

// ================== 차원 설정 ==================
export const DIMENSIONS = {
    overworld: {
        name: '오버월드',
        ambient: 0.05,          // 완전 어둠에서의 최소 밝기
        hasSky: true,
        fog: 0x000000,          // 하늘 모듈이 시간대에 따라 계산
        spawnY: null
    },
    nether: {
        name: '네더',
        ambient: 0.30,
        hasSky: false,
        fog: 0x3a0f0c,
        skyColor: 0x2a0a08,
        spawnY: NETHER_LAVA + 6
    },
    end: {
        name: '엔드',
        ambient: 0.16,
        hasSky: false,
        fog: 0x14101f,
        skyColor: 0x0a0812,
        spawnY: END_Y + 2
    }
};
