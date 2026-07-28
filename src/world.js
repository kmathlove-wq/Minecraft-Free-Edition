// ===== 월드 매니저: 청크 로드/언로드 · 블록 수정 · 레이캐스트 =====
import * as THREE from 'three';
import { Chunk, buildChunkMesh } from './chunk.js';
import { WorldGen, CHUNK_SIZE, WORLD_HEIGHT, MIN_Y, MAX_Y, SEA_LEVEL, idx, BIOME_INFO } from './worldgen.js';
import { AIR, B, IS_SOLID, IS_OPAQUE, BLOCKS_SKY, LIGHT_EMIT, blocks, RENDER_KIND } from './blocks.js';
import { NetherGen, EndGen, DIMENSIONS } from './dimensions.js';

const ckey = (cx, cz) => cx + ',' + cz;
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export class World {
    constructor(scene, seed = 1337) {
        this.scene = scene;
        this.seed = seed;
        this.dimension = 'overworld';
        this.gens = {
            overworld: new WorldGen(seed),
            nether: new NetherGen(seed),
            end: new EndGen(seed)
        };
        this.gen = this.gens.overworld;
        this.chunks = new Map();
        /** 차원별 플레이어 변경분 */
        this.modsByDim = { overworld: new Map(), nether: new Map(), end: new Map() };
        this.mods = this.modsByDim.overworld;
        this.renderDistance = 6;
        this.genQueue = [];
        this.meshQueue = [];
        this._lastCx = null; this._lastCz = null;
        this._cCx = NaN; this._cCz = NaN; this._cChunk = null;
        this.stats = { chunks: 0, meshMs: 0, genMs: 0 };
    }

    /** 차원을 바꾼다. 지형은 시드에서 다시 생성되고, 변경분만 차원별로 보관된다. */
    setDimension(name) {
        if (!DIMENSIONS[name] || name === this.dimension) return DIMENSIONS[this.dimension];
        for (const c of this.chunks.values()) c.dispose(this.scene);
        this.chunks.clear();
        this._invalidateCache();
        this.dimension = name;
        this.mods = this.modsByDim[name] ??= new Map();
        this.gen = this.gens[name];
        this.genQueue = [];
        this._lastCx = null; this._lastCz = null;
        return DIMENSIONS[name];
    }

    // ---------- 청크 접근 ----------
    getChunk(cx, cz) { return this.chunks.get(ckey(cx, cz)); }

    /** 조명 BFS 는 인접 좌표를 연달아 훑으므로 마지막 청크를 캐싱하면 크게 빨라진다 */
    _chunkOf(cx, cz) {
        if (cx === this._cCx && cz === this._cCz) return this._cChunk;
        const c = this.chunks.get(ckey(cx, cz));
        this._cCx = cx; this._cCz = cz; this._cChunk = c;
        return c;
    }
    _invalidateCache() { this._cCx = NaN; this._cCz = NaN; this._cChunk = null; }

    getBlock(wx, wy, wz) {
        if (wy < MIN_Y || wy > MAX_Y) return AIR;
        const cx = wx >> 4, cz = wz >> 4;
        const c = this._chunkOf(cx, cz);
        if (!c || !c.generated) return AIR;
        return c.data[idx(wx - (cx << 4), wy, wz - (cz << 4))];
    }

    isSolid(wx, wy, wz) { return IS_SOLID[this.getBlock(wx, wy, wz)] === 1; }
    isLiquid(wx, wy, wz) { return RENDER_KIND[this.getBlock(wx, wy, wz)] === 3; }

    // ================== 조명 ==================
    // 청크 단위로 계산하면 빛이 경계에서 잘리므로, 월드 전체를 대상으로 BFS 전파한다.
    // chunk.light 는 상위 4비트=하늘빛, 하위 4비트=블록빛.

    getSkyLight(wx, wy, wz) {
        if (wy > MAX_Y) return 15;
        if (wy < MIN_Y) return 0;
        const cx = wx >> 4, cz = wz >> 4;
        const c = this._chunkOf(cx, cz);
        if (!c) return 15;
        return c.light[idx(wx - (cx << 4), wy, wz - (cz << 4))] >> 4;
    }
    getBlockLight(wx, wy, wz) {
        if (wy < MIN_Y || wy > MAX_Y) return 0;
        const cx = wx >> 4, cz = wz >> 4;
        const c = this._chunkOf(cx, cz);
        if (!c) return 0;
        return c.light[idx(wx - (cx << 4), wy, wz - (cz << 4))] & 15;
    }
    /** 플레이어·몹 스폰 판정용 실효 밝기 (0~15) */
    lightAt(wx, wy, wz, skyFactor = 1) {
        return Math.max(Math.round(this.getSkyLight(wx, wy, wz) * skyFactor), this.getBlockLight(wx, wy, wz));
    }

    _setLight(wx, wy, wz, value, sky) {
        if (wy < MIN_Y || wy > MAX_Y) return false;
        const cx = wx >> 4, cz = wz >> 4;
        const c = this._chunkOf(cx, cz);
        if (!c || !c.generated) return false;
        const i = idx(wx - (cx << 4), wy, wz - (cz << 4));
        const cur = c.light[i];
        const next = sky ? ((value << 4) | (cur & 15)) : ((cur & 0xf0) | value);
        if (cur === next) return true;
        c.light[i] = next;
        c.dirty = true;
        // 경계 셀이면 이웃 청크 메시도 갱신해야 한다
        const lx = wx - (cx << 4), lz = wz - (cz << 4);
        if (lx === 0) this._touch(cx - 1, cz);
        else if (lx === CHUNK_SIZE - 1) this._touch(cx + 1, cz);
        if (lz === 0) this._touch(cx, cz - 1);
        else if (lz === CHUNK_SIZE - 1) this._touch(cx, cz + 1);
        return true;
    }

    /**
     * 밝은 셀에서 바깥으로 빛을 퍼뜨린다.
     * queue 는 [x,y,z, x,y,z, ...] 형태의 평탄한 숫자 배열
     * (좌표마다 배열을 만들면 GC 부담이 커서 평탄화했다)
     */
    _lightAdd(queue, sky) {
        for (let head = 0; head < queue.length; head += 3) {
            const x = queue[head], y = queue[head + 1], z = queue[head + 2];
            const l = sky ? this.getSkyLight(x, y, z) : this.getBlockLight(x, y, z);
            if (l <= 1) continue;
            for (let d = 0; d < 6; d++) {
                const dir = DIRS[d];
                const nx = x + dir[0], ny = y + dir[1], nz = z + dir[2];
                if (ny < MIN_Y || ny > MAX_Y) continue;
                const nb = this.getBlock(nx, ny, nz);
                if (sky ? BLOCKS_SKY[nb] : IS_OPAQUE[nb]) continue;
                // 하늘빛은 수직으로 내려갈 때 감쇠하지 않는다 (마인크래프트와 동일)
                const nl = (sky && dir[1] === -1 && l === 15) ? 15 : l - 1;
                const cur = sky ? this.getSkyLight(nx, ny, nz) : this.getBlockLight(nx, ny, nz);
                if (cur >= nl) continue;
                if (!this._setLight(nx, ny, nz, nl, sky)) continue;
                queue.push(nx, ny, nz);
            }
        }
    }

    /** 사라진 광원 주변의 빛을 지우고 남은 빛으로 다시 채운다. queue 는 [x,y,z,이전밝기, ...] */
    _lightRemove(queue, sky) {
        const relight = [];
        for (let head = 0; head < queue.length; head += 4) {
            const x = queue[head], y = queue[head + 1], z = queue[head + 2], lvl = queue[head + 3];
            for (let d = 0; d < 6; d++) {
                const dir = DIRS[d];
                const nx = x + dir[0], ny = y + dir[1], nz = z + dir[2];
                if (ny < MIN_Y || ny > MAX_Y) continue;
                const cur = sky ? this.getSkyLight(nx, ny, nz) : this.getBlockLight(nx, ny, nz);
                if (cur === 0) continue;
                const straightDown = sky && dir[1] === -1 && lvl === 15;
                if (cur < lvl || (straightDown && cur === 15)) {
                    if (this._setLight(nx, ny, nz, 0, sky)) queue.push(nx, ny, nz, cur);
                } else {
                    relight.push(nx, ny, nz);
                }
            }
        }
        if (relight.length) this._lightAdd(relight, sky);
    }

    /** 한 기둥의 하늘 노출 높이를 다시 계산한다 */
    _recalcSkyColumn(wx, wz) {
        const cx = Math.floor(wx / CHUNK_SIZE), cz = Math.floor(wz / CHUNK_SIZE);
        const c = this.chunks.get(ckey(cx, cz));
        if (!c || !c.generated) return;
        const lx = wx - cx * CHUNK_SIZE, lz = wz - cz * CHUNK_SIZE;

        let top = MAX_Y;
        while (top >= MIN_Y && !BLOCKS_SKY[c.data[idx(lx, top, lz)]]) top--;
        top += 1;   // top 이상이 하늘에 직접 노출

        const addQ = [], remQ = [];
        for (let y = MIN_Y; y <= MAX_Y; y++) {
            const i = idx(lx, y, lz);
            const cur = c.light[i] >> 4;
            if (y >= top) {
                if (cur < 15) { this._setLight(wx, y, wz, 15, true); addQ.push(wx, y, wz); }
            } else if (cur === 15) {
                this._setLight(wx, y, wz, 0, true);
                remQ.push(wx, y, wz, 15);
            }
        }
        if (remQ.length) this._lightRemove(remQ, true);
        if (addQ.length) this._lightAdd(addQ, true);
    }

    /** 새로 만들어진 청크의 조명 초기화 (이웃과 빛을 주고받는다) */
    _initChunkLight(c) {
        c.light.fill(0);
        const ox = c.cx * CHUNK_SIZE, oz = c.cz * CHUNK_SIZE;
        const skyQ = [], blkQ = [];

        // 1) 각 기둥의 하늘 노출 구간을 15로 채운다
        const colTop = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
            for (let lx = 0; lx < CHUNK_SIZE; lx++) {
                let y = MAX_Y;
                for (; y >= MIN_Y; y--) {
                    const i = idx(lx, y, lz);
                    if (BLOCKS_SKY[c.data[i]]) break;
                    c.light[i] = 15 << 4;
                }
                colTop[lz * CHUNK_SIZE + lx] = y + 1;
            }
        }
        // 옆으로 퍼져야 하는 구간(주변 기둥이 더 높은 곳)만 시드로 넣는다
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
            for (let lx = 0; lx < CHUNK_SIZE; lx++) {
                const col = lz * CHUNK_SIZE + lx;
                let maxNb = 0;
                for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nx = lx + dx, nz = lz + dz;
                    maxNb = Math.max(maxNb, (nx >= 0 && nx < CHUNK_SIZE && nz >= 0 && nz < CHUNK_SIZE)
                        ? colTop[nz * CHUNK_SIZE + nx] : MAX_Y + 1);
                }
                for (let y = colTop[col]; y < maxNb; y++) skyQ.push(ox + lx, y, oz + lz);
            }
        }

        // 2) 이 청크 안의 광원
        for (let y = MIN_Y; y <= c.maxY + 1 && y <= MAX_Y; y++)
            for (let lz = 0; lz < CHUNK_SIZE; lz++)
                for (let lx = 0; lx < CHUNK_SIZE; lx++) {
                    const i = idx(lx, y, lz);
                    const e = LIGHT_EMIT[c.data[i]];
                    if (e > 0) { c.light[i] |= e; blkQ.push(ox + lx, y, oz + lz); }
                }

        // 3) 이웃 청크의 경계 빛 중, 이쪽이 더 어두운 셀만 시드로 넣는다
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const n = this.chunks.get(ckey(c.cx + dx, c.cz + dz));
            if (!n || !n.generated) continue;
            const yTop = Math.min(MAX_Y, Math.max(n.maxY, c.maxY) + 2);
            for (let t = 0; t < CHUNK_SIZE; t++) {
                const nlx = dx === 1 ? 0 : dx === -1 ? CHUNK_SIZE - 1 : t;
                const nlz = dz === 1 ? 0 : dz === -1 ? CHUNK_SIZE - 1 : t;
                const clx = dx === 1 ? CHUNK_SIZE - 1 : dx === -1 ? 0 : t;
                const clz = dz === 1 ? CHUNK_SIZE - 1 : dz === -1 ? 0 : t;
                const wx = n.cx * CHUNK_SIZE + nlx, wz = n.cz * CHUNK_SIZE + nlz;
                for (let y = MIN_Y; y <= yTop; y++) {
                    const L = n.light[idx(nlx, y, nlz)];
                    const M = c.light[idx(clx, y, clz)];
                    if ((L >> 4) > (M >> 4) + 1) skyQ.push(wx, y, wz);
                    if ((L & 15) > (M & 15) + 1) blkQ.push(wx, y, wz);
                }
            }
        }

        this._lightAdd(skyQ, true);
        this._lightAdd(blkQ, false);
    }

    /** 블록이 바뀐 뒤 조명을 갱신한다 */
    _updateLight(wx, wy, wz, prev, id) {
        // --- 블록빛 ---
        const oldEmit = LIGHT_EMIT[prev], newEmit = LIGHT_EMIT[id];
        const oldLevel = this.getBlockLight(wx, wy, wz);
        if (oldLevel > 0) {
            this._setLight(wx, wy, wz, 0, false);
            this._lightRemove([wx, wy, wz, oldLevel], false);
        }
        if (newEmit > 0) {
            this._setLight(wx, wy, wz, newEmit, false);
            this._lightAdd([wx, wy, wz], false);
        }
        if (!IS_OPAQUE[id]) {
            // 새로 뚫린 공간으로 주변 빛이 흘러들어오도록
            const q = [];
            for (const [dx, dy, dz] of DIRS) {
                const nx = wx + dx, ny = wy + dy, nz = wz + dz;
                if (this.getBlockLight(nx, ny, nz) > 1) q.push(nx, ny, nz);
            }
            if (q.length) this._lightAdd(q, false);
        }

        // --- 하늘빛 ---
        if (BLOCKS_SKY[prev] !== BLOCKS_SKY[id]) this._recalcSkyColumn(wx, wz);
        if (!BLOCKS_SKY[id]) {
            const q = [];
            for (const [dx, dy, dz] of DIRS) {
                const nx = wx + dx, ny = wy + dy, nz = wz + dz;
                if (this.getSkyLight(nx, ny, nz) > 1) q.push(nx, ny, nz);
            }
            if (q.length) this._lightAdd(q, true);
        } else if (this.getSkyLight(wx, wy, wz) > 0) {
            const lv = this.getSkyLight(wx, wy, wz);
            this._setLight(wx, wy, wz, 0, true);
            this._lightRemove([wx, wy, wz, lv], true);
        }
    }

    biomeAt(wx, wz) {
        const cx = Math.floor(wx / CHUNK_SIZE), cz = Math.floor(wz / CHUNK_SIZE);
        const c = this.chunks.get(ckey(cx, cz));
        if (!c || !c.generated) return this.gen.biomeAt(wx, wz);
        return c.biomeMap[(wz - cz * CHUNK_SIZE) * CHUNK_SIZE + (wx - cx * CHUNK_SIZE)];
    }
    biomeNameAt(wx, wz) { return BIOME_INFO[this.biomeAt(wx, wz)].name; }

    /** 블록 설치/파괴. record=false 면 저장 대상에서 제외(월드 생성 중 사용) */
    setBlock(wx, wy, wz, id, record = true) {
        if (wy < MIN_Y || wy > MAX_Y) return false;
        const cx = Math.floor(wx / CHUNK_SIZE), cz = Math.floor(wz / CHUNK_SIZE);
        const c = this.chunks.get(ckey(cx, cz));
        if (!c || !c.generated) return false;
        const lx = wx - cx * CHUNK_SIZE, lz = wz - cz * CHUNK_SIZE;
        const k = idx(lx, wy, lz);
        const prev = c.data[k];
        if (prev === id) return false;
        c.data[k] = id;
        if (id !== AIR && wy > c.maxY) c.maxY = wy;
        else if (id === AIR && wy === c.maxY) c.recomputeMaxY();
        c.dirty = true;
        c.modified = true;

        if (record) {
            const key = ckey(cx, cz);
            let m = this.mods.get(key);
            if (!m) { m = new Map(); this.mods.set(key, m); }
            m.set(lx + ',' + wy + ',' + lz, id);
        }

        // 경계에 닿았으면 이웃 청크도 다시 메시를 만들어야 한다.
        // (조명 변화로 인한 추가 갱신은 _setLight 안에서 처리된다)
        this._touch(cx, cz);
        const ex = lx === 0 ? -1 : lx === CHUNK_SIZE - 1 ? 1 : 0;
        const ez = lz === 0 ? -1 : lz === CHUNK_SIZE - 1 ? 1 : 0;
        if (ex) this._touch(cx + ex, cz);
        if (ez) this._touch(cx, cz + ez);
        if (ex && ez) this._touch(cx + ex, cz + ez);

        this._updateLight(wx, wy, wz, prev, id);
        return true;
    }

    _touch(cx, cz) {
        const c = this.chunks.get(ckey(cx, cz));
        if (c && c.generated) c.dirty = true;
    }

    // ---------- 로딩 ----------
    update(px, pz, budgetMs = 8) {
        const cx = Math.floor(px / CHUNK_SIZE), cz = Math.floor(pz / CHUNK_SIZE);
        if (cx !== this._lastCx || cz !== this._lastCz) {
            this._lastCx = cx; this._lastCz = cz;
            this._rebuildQueues(cx, cz);
            this._unloadFar(cx, cz);
        }
        this._processQueues(cx, cz, budgetMs);
        this.stats.chunks = this.chunks.size;
    }

    _rebuildQueues(cx, cz) {
        const R = this.renderDistance + 1;   // 메시 이웃 확보용으로 1칸 더 생성
        const list = [];
        for (let dx = -R; dx <= R; dx++)
            for (let dz = -R; dz <= R; dz++) {
                const d = dx * dx + dz * dz;
                if (d > R * R) continue;
                list.push({ cx: cx + dx, cz: cz + dz, d });
            }
        list.sort((a, b) => a.d - b.d);
        this.genQueue = list;
    }

    _unloadFar(cx, cz) {
        const R = this.renderDistance + 3;
        for (const [key, c] of this.chunks) {
            if (Math.abs(c.cx - cx) > R || Math.abs(c.cz - cz) > R) {
                c.dispose(this.scene);
                this.chunks.delete(key);
                this._invalidateCache();
            }
        }
    }

    _processQueues(cx, cz, budgetMs) {
        const t0 = performance.now();

        // 1) 생성
        while (this.genQueue.length) {
            if (performance.now() - t0 > budgetMs) return;
            const { cx: gx, cz: gz } = this.genQueue[0];
            const key = ckey(gx, gz);
            if (this.chunks.has(key)) { this.genQueue.shift(); continue; }
            this.genQueue.shift();
            this._createChunk(gx, gz);
        }

        // 2) 메시 생성 (가까운 것부터)
        const R = this.renderDistance;
        let best = null, bestD = Infinity;
        for (let pass = 0; pass < 8; pass++) {
            if (performance.now() - t0 > budgetMs) return;
            best = null; bestD = Infinity;
            for (const c of this.chunks.values()) {
                if (!c.dirty || !c.generated) continue;
                const dx = c.cx - cx, dz = c.cz - cz;
                const d = dx * dx + dz * dz;
                if (d > R * R) continue;
                if (!this._neighborsReady(c)) continue;
                if (d < bestD) { bestD = d; best = c; }
            }
            if (!best) return;
            this._remesh(best);
        }
    }

    _neighborsReady(c) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const n = this.chunks.get(ckey(c.cx + dx, c.cz + dz));
            if (!n || !n.generated) return false;
        }
        return true;
    }

    _createChunk(cx, cz) {
        const c = new Chunk(cx, cz);
        const t = performance.now();
        this.gen.generate(cx, cz, c.data, c.heightMap, c.biomeMap);
        this.stats.genMs = performance.now() - t;
        c.generated = true;
        c.recomputeMaxY();

        // 저장된 플레이어 변경분 적용
        const m = this.mods.get(ckey(cx, cz));
        if (m) {
            for (const [lk, id] of m) {
                const [lx, y, lz] = lk.split(',').map(Number);
                if (y < MIN_Y || y > MAX_Y) continue;
                c.data[idx(lx, y, lz)] = id;
            }
            c.recomputeMaxY();
            c.modified = true;
        }
        this.chunks.set(ckey(cx, cz), c);
        this._invalidateCache();
        this._initChunkLight(c);
        // 이웃 메시도 갱신 필요
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) this._touch(cx + dx, cz + dz);
        return c;
    }

    _remesh(c) {
        const t = performance.now();
        const meshes = buildChunkMesh(c, (a, b) => this.chunks.get(ckey(a, b)));
        c.dispose(this.scene);
        c.meshes = meshes;
        for (const m of Object.values(meshes)) if (m) this.scene.add(m);
        c.dirty = false;
        this.stats.meshMs = performance.now() - t;
    }

    /** 즉시(동기) 로딩 — 스폰/불러오기 직후 사용 */
    forceLoad(px, pz, radius = 2) {
        const cx = Math.floor(px / CHUNK_SIZE), cz = Math.floor(pz / CHUNK_SIZE);
        for (let dx = -radius - 1; dx <= radius + 1; dx++)
            for (let dz = -radius - 1; dz <= radius + 1; dz++)
                if (!this.chunks.has(ckey(cx + dx, cz + dz))) this._createChunk(cx + dx, cz + dz);
        for (let dx = -radius; dx <= radius; dx++)
            for (let dz = -radius; dz <= radius; dz++) {
                const c = this.chunks.get(ckey(cx + dx, cz + dz));
                if (c && c.dirty && this._neighborsReady(c)) this._remesh(c);
            }
    }

    setSeed(seed) {
        this.seed = seed | 0;
        this.gens.overworld = new WorldGen(this.seed);
        this.gens.nether = new NetherGen(this.seed);
        this.gens.end = new EndGen(this.seed);
        this.gen = this.gens[this.dimension];
    }

    clear() {
        for (const c of this.chunks.values()) c.dispose(this.scene);
        this.chunks.clear();
        this._invalidateCache();
        for (const m of Object.values(this.modsByDim)) m.clear();
        this.genQueue = [];
        this._lastCx = this._lastCz = null;
    }

    /** 지표면 Y (해당 좌표에서 설 수 있는 가장 높은 곳) */
    surfaceY(wx, wz) {
        const cx = Math.floor(wx / CHUNK_SIZE), cz = Math.floor(wz / CHUNK_SIZE);
        const c = this.chunks.get(ckey(cx, cz));
        if (c && c.generated) {
            for (let y = MAX_Y; y > MIN_Y; y--) {
                if (IS_SOLID[c.data[idx(wx - cx * CHUNK_SIZE, y, wz - cz * CHUNK_SIZE)]]) return y + 1;
            }
        }
        return Math.max(SEA_LEVEL + 1, this.gen.heightAt(wx, wz) + 1);
    }

    // ---------- DDA 복셀 레이캐스트 ----------
    /**
     * @returns {{x,y,z, nx,ny,nz, block}|null} nx/ny/nz 는 맞은 면의 법선
     */
    raycast(origin, dir, maxDist = 5) {
        let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
        const sx = dir.x > 0 ? 1 : -1, sy = dir.y > 0 ? 1 : -1, sz = dir.z > 0 ? 1 : -1;
        const tdx = Math.abs(dir.x) < 1e-8 ? Infinity : Math.abs(1 / dir.x);
        const tdy = Math.abs(dir.y) < 1e-8 ? Infinity : Math.abs(1 / dir.y);
        const tdz = Math.abs(dir.z) < 1e-8 ? Infinity : Math.abs(1 / dir.z);
        let tmx = tdx === Infinity ? Infinity : (dir.x > 0 ? (x + 1 - origin.x) : (origin.x - x)) * tdx;
        let tmy = tdy === Infinity ? Infinity : (dir.y > 0 ? (y + 1 - origin.y) : (origin.y - y)) * tdy;
        let tmz = tdz === Infinity ? Infinity : (dir.z > 0 ? (z + 1 - origin.z) : (origin.z - z)) * tdz;
        let nx = 0, ny = 0, nz = 0;

        for (let i = 0; i < 512; i++) {
            const b = this.getBlock(x, y, z);
            if (b !== AIR && RENDER_KIND[b] !== 3 && RENDER_KIND[b] !== 0) {
                return { x, y, z, nx, ny, nz, block: b };
            }
            if (tmx < tmy && tmx < tmz) {
                if (tmx > maxDist) break;
                x += sx; tmx += tdx; nx = -sx; ny = 0; nz = 0;
            } else if (tmy < tmz) {
                if (tmy > maxDist) break;
                y += sy; tmy += tdy; nx = 0; ny = -sy; nz = 0;
            } else {
                if (tmz > maxDist) break;
                z += sz; tmz += tdz; nx = 0; ny = 0; nz = -sz;
            }
        }
        return null;
    }

    // ---------- 블록 업데이트 (중력 · 지지 블록) ----------
    /** 한 지점 주변의 중력 블록/식물 지지를 확인한다 */
    blockUpdate(wx, wy, wz, depth = 0) {
        if (depth > 24) return;
        for (const [dx, dy, dz] of [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
            const x = wx + dx, y = wy + dy, z = wz + dz;
            const id = this.getBlock(x, y, z);
            if (id === AIR) continue;
            const def = blocks[id];
            if (def.gravity && this.getBlock(x, y - 1, z) === AIR && y > MIN_Y) {
                this.setBlock(x, y, z, AIR);
                let ny = y - 1;
                while (ny > MIN_Y && this.getBlock(x, ny - 1, z) === AIR) ny--;
                this.setBlock(x, ny, z, id);
                this.blockUpdate(x, y, z, depth + 1);
            } else if (def.needsSupport) {
                const below = this.getBlock(x, y - 1, z);
                const ok = below === id || IS_SOLID[below] === 1;
                if (!ok) { this.setBlock(x, y, z, AIR); this.blockUpdate(x, y, z, depth + 1); }
            }
        }
    }
}
