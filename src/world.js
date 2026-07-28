// ===== 월드 매니저: 청크 로드/언로드 · 블록 수정 · 레이캐스트 =====
import * as THREE from 'three';
import { Chunk, buildChunkMesh } from './chunk.js';
import { WorldGen, CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL, idx, BIOME_INFO } from './worldgen.js';
import { AIR, B, IS_SOLID, blocks, RENDER_KIND } from './blocks.js';

const ckey = (cx, cz) => cx + ',' + cz;

export class World {
    constructor(scene, seed = 1337) {
        this.scene = scene;
        this.gen = new WorldGen(seed);
        this.seed = seed;
        this.chunks = new Map();
        /** 플레이어 변경분: chunkKey -> Map(localKey -> blockId) */
        this.mods = new Map();
        this.renderDistance = 6;
        this.genQueue = [];
        this.meshQueue = [];
        this._lastCx = null; this._lastCz = null;
        this.stats = { chunks: 0, meshMs: 0, genMs: 0 };
    }

    // ---------- 청크 접근 ----------
    getChunk(cx, cz) { return this.chunks.get(ckey(cx, cz)); }

    getBlock(wx, wy, wz) {
        if (wy < 0 || wy >= WORLD_HEIGHT) return AIR;
        const cx = Math.floor(wx / CHUNK_SIZE), cz = Math.floor(wz / CHUNK_SIZE);
        const c = this.chunks.get(ckey(cx, cz));
        if (!c || !c.generated) return AIR;
        return c.data[idx(wx - cx * CHUNK_SIZE, wy, wz - cz * CHUNK_SIZE)];
    }

    isSolid(wx, wy, wz) { return IS_SOLID[this.getBlock(wx, wy, wz)] === 1; }
    isLiquid(wx, wy, wz) { return RENDER_KIND[this.getBlock(wx, wy, wz)] === 3; }

    biomeAt(wx, wz) {
        const cx = Math.floor(wx / CHUNK_SIZE), cz = Math.floor(wz / CHUNK_SIZE);
        const c = this.chunks.get(ckey(cx, cz));
        if (!c || !c.generated) return this.gen.biomeAt(wx, wz);
        return c.biomeMap[(wz - cz * CHUNK_SIZE) * CHUNK_SIZE + (wx - cx * CHUNK_SIZE)];
    }
    biomeNameAt(wx, wz) { return BIOME_INFO[this.biomeAt(wx, wz)].name; }

    /** 블록 설치/파괴. record=false 면 저장 대상에서 제외(월드 생성 중 사용) */
    setBlock(wx, wy, wz, id, record = true) {
        if (wy < 0 || wy >= WORLD_HEIGHT) return false;
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

        // 광원이 바뀌면 빛이 최대 15칸 퍼지므로 주변 3x3 청크를 모두 갱신,
        // 그 외에는 경계에 닿은 이웃만 갱신해 리메시 비용을 줄인다.
        this._touch(cx, cz);
        if (blocks[id].light > 0 || blocks[prev].light > 0) {
            for (let dx = -1; dx <= 1; dx++)
                for (let dz = -1; dz <= 1; dz++) this._touch(cx + dx, cz + dz);
        } else {
            const ex = lx === 0 ? -1 : lx === CHUNK_SIZE - 1 ? 1 : 0;
            const ez = lz === 0 ? -1 : lz === CHUNK_SIZE - 1 ? 1 : 0;
            if (ex) this._touch(cx + ex, cz);
            if (ez) this._touch(cx, cz + ez);
            if (ex && ez) this._touch(cx + ex, cz + ez);
        }
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
                if (y < 0 || y >= WORLD_HEIGHT) continue;
                c.data[idx(lx, y, lz)] = id;
            }
            c.recomputeMaxY();
            c.modified = true;
        }
        this.chunks.set(ckey(cx, cz), c);
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

    clear() {
        for (const c of this.chunks.values()) c.dispose(this.scene);
        this.chunks.clear();
        this.mods.clear();
        this.genQueue = [];
        this._lastCx = this._lastCz = null;
    }

    /** 지표면 Y (해당 좌표에서 설 수 있는 가장 높은 곳) */
    surfaceY(wx, wz) {
        const cx = Math.floor(wx / CHUNK_SIZE), cz = Math.floor(wz / CHUNK_SIZE);
        const c = this.chunks.get(ckey(cx, cz));
        if (c && c.generated) {
            for (let y = WORLD_HEIGHT - 1; y > 0; y--) {
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
            if (def.gravity && this.getBlock(x, y - 1, z) === AIR && y > 0) {
                this.setBlock(x, y, z, AIR);
                let ny = y - 1;
                while (ny > 0 && this.getBlock(x, ny - 1, z) === AIR) ny--;
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
