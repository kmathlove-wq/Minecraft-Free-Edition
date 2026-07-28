// ===== 월드 생성: 바이옴 · 지형 · 동굴 · 광석 · 구조물 =====
import { B } from './blocks.js';

export const CHUNK_SIZE = 16;
// 마인크래프트처럼 지하를 깊게 쓰기 위해 y = -64 ~ 191 을 사용한다.
export const MIN_Y = -64;
export const MAX_Y = 191;
export const WORLD_HEIGHT = MAX_Y - MIN_Y + 1;   // 256
export const SEA_LEVEL = 62;
export const DEEPSLATE_Y = 0;                    // 이 아래는 심층암
export const CHUNK_VOL = CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE;

/** 월드 y 를 그대로 받아 배열 인덱스로 바꾼다 (y-major: 세로 스캔이 캐시 친화적) */
export function idx(x, wy, z) { return ((wy - MIN_Y) * CHUNK_SIZE + z) * CHUNK_SIZE + x; }

// ---------- 노이즈 ----------
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
    return lerp(
        lerp(hash2(ix, iz, seed), hash2(ix + 1, iz, seed), fx),
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
// fbm 은 평균 0.545 / 표준편차 0.143 부근에 몰려 있다.
// 바이옴·지형 임계값을 직관적으로 쓰기 위해 대략 [0,1] 전 구간으로 펼친다.
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const spread = v => clamp01(0.5 + (v - 0.545) / 0.515);

function fbm2(x, z, seed, oct = 4, lac = 2, gain = 0.5) {
    let a = 1, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
        sum += noise2(x * f, z * f, seed + i * 101) * a;
        norm += a; a *= gain; f *= lac;
    }
    return sum / norm;
}

// ---------- 바이옴 ----------
export const BIOME = {
    OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, BIRCH_FOREST: 4,
    TAIGA: 5, SNOWY_PLAINS: 6, DESERT: 7, MOUNTAINS: 8, SAVANNA: 9
};
export const BIOME_INFO = [
    { name: '바다', grass: 0x8eb971, foliage: 0x71a74d, surface: 'sand', filler: 'sand', trees: 0 },
    { name: '해변', grass: 0x8eb971, foliage: 0x71a74d, surface: 'sand', filler: 'sand', trees: 0 },
    { name: '평원', grass: 0x91bd59, foliage: 0x77ab2f, surface: 'grass', filler: 'dirt', trees: 0.006, plants: 0.22 },
    { name: '숲', grass: 0x79c05a, foliage: 0x59ae30, surface: 'grass', filler: 'dirt', trees: 0.042, plants: 0.3 },
    { name: '자작나무 숲', grass: 0x88bb67, foliage: 0x6ba941, surface: 'grass', filler: 'dirt', trees: 0.038, plants: 0.28 },
    { name: '타이가', grass: 0x86b783, foliage: 0x68a464, surface: 'grass', filler: 'dirt', trees: 0.034, plants: 0.18 },
    { name: '눈 덮인 평원', grass: 0x80b497, foliage: 0x60a17b, surface: 'snowy', filler: 'dirt', trees: 0.012, plants: 0.02 },
    { name: '사막', grass: 0xbfb755, foliage: 0xaea42a, surface: 'sand', filler: 'sand', trees: 0, plants: 0.02 },
    { name: '산', grass: 0x8ab689, foliage: 0x6da36b, surface: 'stone', filler: 'stone', trees: 0.01, plants: 0.05 },
    { name: '사바나', grass: 0xbfb755, foliage: 0xaea42a, surface: 'grass', filler: 'dirt', trees: 0.012, plants: 0.25 }
];

/** 일반 광석 → 심층암 광석 (y < 0 에서 사용) */
const DEEPSLATE_ORE = {
    [B.COAL_ORE]: B.DS_COAL_ORE, [B.IRON_ORE]: B.DS_IRON_ORE, [B.COPPER_ORE]: B.DS_COPPER_ORE,
    [B.GOLD_ORE]: B.DS_GOLD_ORE, [B.REDSTONE_ORE]: B.DS_REDSTONE_ORE, [B.LAPIS_ORE]: B.DS_LAPIS_ORE,
    [B.DIAMOND_ORE]: B.DS_DIAMOND_ORE, [B.EMERALD_ORE]: B.DS_EMERALD_ORE
};

export class WorldGen {
    constructor(seed = 1337) {
        this.seed = seed | 0;
        this._hCache = new Map();
    }

    // ---- 지형 높이 ----
    heightAt(wx, wz) {
        const s = this.seed;
        const cont = spread(fbm2(wx * 0.0016, wz * 0.0016, s, 4));
        const hilly = fbm2(wx * 0.0062, wz * 0.0062, s + 991, 4);
        const detail = fbm2(wx * 0.031, wz * 0.031, s + 1777, 3);
        const mountain = spread(fbm2(wx * 0.0009, wz * 0.0009, s + 555, 3));

        // 대륙성(continentalness) 스플라인: 바다 / 해안 / 내륙을 뚜렷하게 나눈다
        let h, land;
        if (cont < 0.28) {
            // 깊은 바다: 해저 평원에서 해구까지
            const t = cont / 0.28;
            h = 24 + t * t * 34;                     // 24 ~ 58
            land = 0;
        } else if (cont < 0.36) { h = 58 + ((cont - 0.28) / 0.08) * 8; land = (cont - 0.28) / 0.08; }
        else { h = 66 + ((cont - 0.36) / 0.64) * 24; land = 1; }

        h += (hilly - 0.5) * 26 * land;
        h += (detail - 0.5) * 5 * (0.4 + 0.6 * land);

        // 해저 지형: 언덕과 해구로 평평하지 않게 만든다
        if (land < 1) {
            const floor1 = fbm2(wx * 0.011, wz * 0.011, s + 313, 4);
            const floor2 = fbm2(wx * 0.004, wz * 0.004, s + 727, 3);
            const trench = Math.max(0, 1 - Math.abs(spread(floor2) - 0.5) * 6);   // 능선 형태의 해구
            h += (floor1 - 0.5) * 22 * (1 - land);
            h -= trench * trench * 16 * (1 - land);
        }

        // 산악 마스크: 높은 지역을 더 높게 (능선)
        const m = Math.max(0, (mountain - 0.62) / 0.38) * land;
        if (m > 0) {
            const ridge = 1 - Math.abs(hilly - 0.5) * 2;
            h += m * m * (30 + ridge * 34);
        }
        return Math.max(MIN_Y + 6, Math.min(MAX_Y - 6, Math.round(h)));
    }

    temperatureAt(wx, wz) { return spread(fbm2(wx * 0.0011, wz * 0.0011, this.seed + 4242, 3)); }
    humidityAt(wx, wz) { return spread(fbm2(wx * 0.0013, wz * 0.0013, this.seed + 8181, 3)); }

    biomeAt(wx, wz, h = this.heightAt(wx, wz)) {
        if (h < SEA_LEVEL - 1) return BIOME.OCEAN;
        const t = this.temperatureAt(wx, wz), hum = this.humidityAt(wx, wz);
        if (h <= SEA_LEVEL + 1) return t < 0.28 ? BIOME.SNOWY_PLAINS : BIOME.BEACH;
        if (h > 96) return BIOME.MOUNTAINS;
        if (t < 0.28) return hum > 0.5 ? BIOME.TAIGA : BIOME.SNOWY_PLAINS;
        if (t > 0.68 && hum < 0.35) return BIOME.DESERT;
        if (t > 0.58 && hum < 0.46) return BIOME.SAVANNA;
        if (hum > 0.62) return t > 0.5 ? BIOME.FOREST : BIOME.TAIGA;
        if (hum > 0.46) return BIOME.BIRCH_FOREST;
        return BIOME.PLAINS;
    }

    // ---- 동굴 (성긴 격자에서 샘플 후 보간 → 3D 노이즈 비용 1/64) ----
    _caveField(cx, cz) {
        const S = 4;                                  // 격자 간격
        const NX = CHUNK_SIZE / S + 1, NY = WORLD_HEIGHT / S + 1;
        const a = new Float32Array(NX * NY * NX);
        const b = new Float32Array(NX * NY * NX);
        const c = new Float32Array(NX * NY * NX);
        let i = 0;
        for (let y = 0; y < NY; y++)
            for (let z = 0; z < NX; z++)
                for (let x = 0; x < NX; x++, i++) {
                    const wx = cx * CHUNK_SIZE + x * S, wy = MIN_Y + y * S, wz = cz * CHUNK_SIZE + z * S;
                    a[i] = noise3(wx * 0.028, wy * 0.05, wz * 0.028, this.seed + 11);
                    b[i] = noise3(wx * 0.028, wy * 0.05, wz * 0.028, this.seed + 29);
                    c[i] = noise3(wx * 0.014, wy * 0.02, wz * 0.014, this.seed + 47);
                }
        return { S, NX, NY, a, b, c };
    }
    static _sample(f, arr, x, y, z) {
        const S = f.S, NX = f.NX;
        const gx = x / S, gy = (y - MIN_Y) / S, gz = z / S;
        const ix = gx | 0, iy = gy | 0, iz = gz | 0;
        const fx = gx - ix, fy = gy - iy, fz = gz - iz;
        const at = (X, Y, Z) => arr[(Y * NX + Z) * NX + X];
        const x00 = lerp(at(ix, iy, iz), at(ix + 1, iy, iz), fx);
        const x10 = lerp(at(ix, iy + 1, iz), at(ix + 1, iy + 1, iz), fx);
        const x01 = lerp(at(ix, iy, iz + 1), at(ix + 1, iy, iz + 1), fx);
        const x11 = lerp(at(ix, iy + 1, iz + 1), at(ix + 1, iy + 1, iz + 1), fx);
        return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz);
    }

    // ---- 청크 생성 ----
    /**
     * @param {number} cx @param {number} cz
     * @param {Uint8Array} data CHUNK_VOL 크기
     * @param {Int16Array} heightMap 16x16 표면 높이 (출력)
     * @param {Uint8Array} biomeMap 16x16 바이옴 (출력)
     */
    generate(cx, cz, data, heightMap, biomeMap) {
        const cave = this._caveField(cx, cz);
        const bedrockSeed = this.seed + 7;

        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
            for (let lx = 0; lx < CHUNK_SIZE; lx++) {
                const wx = cx * CHUNK_SIZE + lx, wz = cz * CHUNK_SIZE + lz;
                const h = this.heightAt(wx, wz);
                const biome = this.biomeAt(wx, wz, h);
                const info = BIOME_INFO[biome];
                heightMap[lz * CHUNK_SIZE + lx] = h;
                biomeMap[lz * CHUNK_SIZE + lx] = biome;

                const underwater = h < SEA_LEVEL;
                let surface, filler;
                if (info.surface === 'grass') { surface = B.GRASS_BLOCK; filler = B.DIRT; }
                else if (info.surface === 'snowy') { surface = B.SNOWY_GRASS; filler = B.DIRT; }
                else if (info.surface === 'sand') { surface = B.SAND; filler = B.SAND; }
                else { surface = B.STONE; filler = B.STONE; }
                if (underwater) { surface = hash2(wx, wz, this.seed + 3) < 0.25 ? B.GRAVEL : B.SAND; filler = surface; }
                if (biome === BIOME.MOUNTAINS && h > 108) { surface = B.SNOW_BLOCK; filler = B.STONE; }

                for (let y = MIN_Y; y <= h; y++) {
                    let blk;
                    if (y === MIN_Y || y <= MIN_Y + 1 + (hash2(wx * 3 + y, wz * 5, bedrockSeed) * 3 | 0)) blk = B.BEDROCK;
                    else if (y === h) blk = surface;
                    else if (y >= h - 3) blk = filler === B.SAND && y < h - 1 ? B.SANDSTONE : filler;
                    else blk = y < DEEPSLATE_Y ? B.DEEPSLATE : B.STONE;

                    // 동굴 파내기
                    if (blk !== B.BEDROCK && y > MIN_Y + 4 && y < h - 1) {
                        const safeUnderSea = underwater && y > h - 6;
                        if (!safeUnderSea) {
                            const na = WorldGen._sample(cave, cave.a, lx, y, lz) - 0.5;
                            const nb = WorldGen._sample(cave, cave.b, lx, y, lz) - 0.5;
                            const nc = WorldGen._sample(cave, cave.c, lx, y, lz);
                            const tunnel = Math.abs(na) < 0.055 && Math.abs(nb) < 0.055;
                            const cheese = y < 8 && nc > 0.83;
                            if (tunnel || cheese) blk = B.AIR;
                        }
                    }
                    data[idx(lx, y, lz)] = blk;
                }

                // 바다 채우기
                if (h < SEA_LEVEL) {
                    for (let y = h + 1; y <= SEA_LEVEL; y++) data[idx(lx, y, lz)] = B.WATER;
                    if (biome === BIOME.SNOWY_PLAINS || this.temperatureAt(wx, wz) < 0.3)
                        data[idx(lx, SEA_LEVEL, lz)] = B.ICE;
                }
            }
        }

        this._ores(cx, cz, data);
        this._features(cx, cz, data, heightMap, biomeMap);
    }

    // ---- 광석 ----
    _ores(cx, cz, data) {
        const veins = [
            [B.COAL_ORE, 20, 17, 0, 128],
            [B.IRON_ORE, 20, 9, -24, 64],
            [B.COPPER_ORE, 12, 10, 28, 76],
            [B.GOLD_ORE, 4, 9, -48, 32],
            [B.REDSTONE_ORE, 10, 8, -60, 16],
            [B.LAPIS_ORE, 2, 7, -32, 32],
            [B.DIAMOND_ORE, 3, 8, -60, 12],
            [B.EMERALD_ORE, 3, 2, 40, 110]
        ];
        let r = (cx * 341873128 + cz * 132897987 + this.seed) | 0;
        const rnd = () => { r = (Math.imul(r, 1103515245) + 12345) | 0; return ((r >>> 8) & 0xffffff) / 0xffffff; };

        for (const [blk, count, size, yMin, yMax] of veins) {
            for (let v = 0; v < count; v++) {
                if (blk === B.EMERALD_ORE && rnd() > 0.25) continue;
                let x = (rnd() * CHUNK_SIZE) | 0;
        let y = yMin + ((rnd() * (yMax - yMin)) | 0);
                let z = (rnd() * CHUNK_SIZE) | 0;
                for (let i = 0; i < size; i++) {
                    if (x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE && y > MIN_Y + 2 && y <= MAX_Y) {
                        const k = idx(x, y, z);
                        // 심층암 구간에서는 심층암 광석으로 바뀐다
                        if (data[k] === B.STONE) data[k] = blk;
                        else if (data[k] === B.DEEPSLATE) data[k] = DEEPSLATE_ORE[blk] ?? blk;
                    }
                    const d = (rnd() * 6) | 0;
                    if (d === 0) x++; else if (d === 1) x--; else if (d === 2) y++;
                    else if (d === 3) y--; else if (d === 4) z++; else z--;
                }
            }
        }
    }

    // ---- 나무 · 식물 ----
    _features(cx, cz, data, heightMap, biomeMap) {
        const MARGIN = 3;  // 인접 청크의 나무 잎이 넘어올 수 있는 범위
        const minX = cx * CHUNK_SIZE - MARGIN, maxX = cx * CHUNK_SIZE + CHUNK_SIZE + MARGIN;
        const minZ = cz * CHUNK_SIZE - MARGIN, maxZ = cz * CHUNK_SIZE + CHUNK_SIZE + MARGIN;

        const set = (wx, wy, wz, blk, replace = false) => {
            const lx = wx - cx * CHUNK_SIZE, lz = wz - cz * CHUNK_SIZE;
            if (lx < 0 || lz < 0 || lx >= CHUNK_SIZE || lz >= CHUNK_SIZE) return;
            if (wy < MIN_Y || wy > MAX_Y) return;
            const k = idx(lx, wy, lz);
            if (!replace && data[k] !== B.AIR && data[k] !== B.WATER) return;
            data[k] = blk;
        };

        for (let wz = minZ; wz < maxZ; wz++) {
            for (let wx = minX; wx < maxX; wx++) {
                const inChunk = wx >= cx * CHUNK_SIZE && wx < cx * CHUNK_SIZE + CHUNK_SIZE
                             && wz >= cz * CHUNK_SIZE && wz < cz * CHUNK_SIZE + CHUNK_SIZE;
                const h = this.heightAt(wx, wz);
                if (h < SEA_LEVEL) {
                    // 물가 사탕수수
                    if (inChunk && h === SEA_LEVEL - 1) continue;
                    continue;
                }
                const biome = this.biomeAt(wx, wz, h);
                const info = BIOME_INFO[biome];
                const rTree = hash2(wx * 13 + 7, wz * 31 + 3, this.seed + 1234);

                if (info.trees > 0 && rTree < info.trees) {
                    this._tree(wx, h + 1, wz, biome, set);
                } else if (inChunk) {
                    // 식물 (해당 청크 안에서만)
                    const lx = wx - cx * CHUNK_SIZE, lz = wz - cz * CHUNK_SIZE;
                    const top = data[idx(lx, h, lz)];
                    const rp = hash2(wx * 61 + 17, wz * 43 + 29, this.seed + 555);
                    if (biome === BIOME.DESERT && top === B.SAND) {
                        if (rp < 0.006) { // 선인장
                            const ht = 1 + (hash2(wx, wz, this.seed + 88) * 3 | 0);
                            for (let i = 1; i <= ht; i++) set(wx, h + i, wz, B.CACTUS);
                        } else if (rp < 0.03) set(wx, h + 1, wz, B.DEAD_BUSH);
                    } else if ((top === B.GRASS_BLOCK || top === B.SNOWY_GRASS) && rp < (info.plants ?? 0)) {
                        const rf = hash2(wx * 91, wz * 79, this.seed + 999);
                        let plant = B.SHORT_GRASS;
                        if (rf > 0.94) plant = B.POPPY;
                        else if (rf > 0.88) plant = B.DANDELION;
                        else if (rf > 0.84) plant = B.CORNFLOWER;
                        if (top === B.SNOWY_GRASS && plant !== B.SHORT_GRASS) plant = B.SHORT_GRASS;
                        set(wx, h + 1, wz, plant);
                    }
                    // 물가 사탕수수
                    if (top === B.SAND || top === B.GRASS_BLOCK) {
                        if (h === SEA_LEVEL && rp > 0.9) {
                            const ht = 1 + (hash2(wx * 5, wz * 7, this.seed + 61) * 3 | 0);
                            for (let i = 1; i <= ht; i++) set(wx, h + i, wz, B.SUGAR_CANE);
                        }
                    }
                }
            }
        }
    }

    _tree(wx, baseY, wz, biome, set) {
        const r = (n) => hash2(wx * 17 + n, wz * 23 + n * 3, this.seed + 606);
        let log = B.OAK_LOG, leaf = B.OAK_LEAVES, height = 4 + (r(1) * 3 | 0), shape = 'oak';
        if (biome === BIOME.TAIGA || biome === BIOME.SNOWY_PLAINS) {
            log = B.SPRUCE_LOG; leaf = B.SPRUCE_LEAVES; height = 6 + (r(2) * 5 | 0); shape = 'spruce';
        } else if (biome === BIOME.BIRCH_FOREST) {
            log = B.BIRCH_LOG; leaf = B.BIRCH_LEAVES; height = 5 + (r(3) * 3 | 0); shape = 'birch';
        } else if (biome === BIOME.SAVANNA) {
            height = 5 + (r(4) * 3 | 0); shape = 'acacia';
        }

        for (let i = 0; i < height; i++) set(wx, baseY + i, wz, log, true);

        if (shape === 'spruce') {
            // 원뿔형: 아래로 갈수록 넓어지는 잎 층
            let layer = 0;
            for (let y = baseY + 2; y < baseY + height; y++, layer++) {
                const rad = ((height - (y - baseY)) > 2) ? (layer % 2 === 0 ? 2 : 1) : 1;
                for (let dx = -rad; dx <= rad; dx++)
                    for (let dz = -rad; dz <= rad; dz++) {
                        if (dx === 0 && dz === 0) continue;
                        if (Math.abs(dx) === rad && Math.abs(dz) === rad) continue;
                        set(wx + dx, y, wz + dz, leaf);
                    }
            }
            set(wx, baseY + height, wz, leaf);
            set(wx, baseY + height + 1, wz, leaf);
        } else if (shape === 'acacia') {
            const topY = baseY + height;
            for (let dx = -3; dx <= 3; dx++)
                for (let dz = -3; dz <= 3; dz++) {
                    if (Math.abs(dx) + Math.abs(dz) > 4) continue;
                    set(wx + dx, topY, wz + dz, leaf);
                    if (Math.abs(dx) + Math.abs(dz) <= 2) set(wx + dx, topY + 1, wz + dz, leaf);
                }
        } else {
            // 참나무/자작나무: 2겹 넓은 층 + 십자 꼭대기
            const topY = baseY + height - 1;
            for (let ly = 0; ly < 2; ly++)
                for (let dx = -2; dx <= 2; dx++)
                    for (let dz = -2; dz <= 2; dz++) {
                        if (Math.abs(dx) === 2 && Math.abs(dz) === 2 && r(5 + ly) < 0.6) continue;
                        set(wx + dx, topY - 1 + ly, wz + dz, leaf);
                    }
            for (let dx = -1; dx <= 1; dx++)
                for (let dz = -1; dz <= 1; dz++) {
                    if (Math.abs(dx) === 1 && Math.abs(dz) === 1) continue;
                    set(wx + dx, topY + 1, wz + dz, leaf);
                }
            set(wx, topY + 2, wz, leaf);
        }
    }
}
