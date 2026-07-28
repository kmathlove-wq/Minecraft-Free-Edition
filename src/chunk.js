// ===== 청크 저장 + 메시 생성 =====
// 실제 마인크래프트처럼 "보이는 면"만 삼각형으로 만든다.
//  - 인접 블록이 불투명하면 면 제거 (face culling)
//  - 정점별 앰비언트 오클루전 (AO)
//  - 하늘빛/블록빛 BFS 전파 + 부드러운 조명 (smooth lighting)
import * as THREE from 'three';
import { atlas } from './textures.js';
import { IS_OPAQUE, BLOCKS_SKY, LIGHT_EMIT, RENDER_KIND, blocks, AIR, B } from './blocks.js';
import { CHUNK_SIZE, WORLD_HEIGHT, CHUNK_VOL, idx, BIOME_INFO } from './worldgen.js';

const PAD = CHUNK_SIZE + 2;                       // 18
const PVOL = PAD * WORLD_HEIGHT * PAD;
const pidx = (x, y, z) => (y * PAD + z) * PAD + x;

// 재사용 스크래치 버퍼 (프레임마다 재할당하지 않음)
const padBuf = new Uint8Array(PVOL);
const skyBuf = new Uint8Array(PVOL);
const blkBuf = new Uint8Array(PVOL);
const colTop = new Int16Array(PAD * PAD);
const QCAP = 1 << 19;                 // 셀이 여러 번 재삽입될 수 있어 넉넉히 잡는다
const QMASK = QCAP - 1;
const queue = new Int32Array(QCAP);

// 면 정의: dir, u축, v축 (외부에서 볼 때 u=오른쪽, v=위)
const FACE = [
    { d: [1, 0, 0],  u: [0, 0, -1], v: [0, 1, 0], shade: 0.60 }, // +X
    { d: [-1, 0, 0], u: [0, 0, 1],  v: [0, 1, 0], shade: 0.60 }, // -X
    { d: [0, 1, 0],  u: [1, 0, 0],  v: [0, 0, -1], shade: 1.00 }, // +Y
    { d: [0, -1, 0], u: [1, 0, 0],  v: [0, 0, 1], shade: 0.50 }, // -Y
    { d: [0, 0, 1],  u: [1, 0, 0],  v: [0, 1, 0], shade: 0.80 }, // +Z
    { d: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], shade: 0.80 }  // -Z
];
// 각 면의 4정점 (u,v 부호) — [0,0] [1,0] [1,1] [0,1]
const VSIGN = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const AO_LEVEL = [0.46, 0.66, 0.84, 1.0];

// 셰이더가 선형 색공간에서 곱셈하므로 바이옴 틴트도 선형으로 변환해 둔다.
const s2l = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toLinear = hex => [s2l(((hex >> 16) & 255) / 255), s2l(((hex >> 8) & 255) / 255), s2l((hex & 255) / 255)];
const TINT_GRASS = BIOME_INFO.map(b => toLinear(b.grass));
const TINT_FOLIAGE = BIOME_INFO.map(b => toLinear(b.foliage));

// 면마다 배열을 새로 만들지 않도록 아틀라스 UV 를 미리 계산
const UV_TABLE = [];
for (let i = 0; i < atlas.names.length; i++) UV_TABLE.push(atlas.uv(i));

export class Chunk {
    constructor(cx, cz) {
        this.cx = cx; this.cz = cz;
        this.data = new Uint8Array(CHUNK_VOL);
        this.heightMap = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
        this.biomeMap = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
        this.maxY = 0;
        this.generated = false;
        this.dirty = true;
        this.meshes = null;      // { solid, cross, liquid }
        this.modified = false;   // 플레이어가 손댄 청크
    }
    get(x, y, z) {
        if (y < 0 || y >= WORLD_HEIGHT) return AIR;
        return this.data[idx(x, y, z)];
    }
    set(x, y, z, v) {
        if (y < 0 || y >= WORLD_HEIGHT) return;
        this.data[idx(x, y, z)] = v;
        if (v !== AIR && y > this.maxY) this.maxY = y;
        this.dirty = true;
    }
    recomputeMaxY() {
        for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
            const base = y * CHUNK_SIZE * CHUNK_SIZE;
            for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
                if (this.data[base + i] !== AIR) { this.maxY = y; return; }
            }
        }
        this.maxY = 0;
    }
    dispose(scene) {
        if (!this.meshes) return;
        for (const m of Object.values(this.meshes)) {
            if (!m) continue;
            scene.remove(m);
            m.geometry.dispose();
        }
        this.meshes = null;
    }
}

// ---------- 머티리얼 ----------
const VERT = /* glsl */`
attribute vec3 acolor;
attribute vec2 alight;
varying vec3 vCol;
varying vec2 vLight;
varying vec2 vUvA;
#include <common>
#include <fog_pars_vertex>
void main() {
    vCol = acolor;
    vLight = alight;
    vUvA = uv;
    vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
}`;

const FRAG = /* glsl */`
uniform sampler2D map;
uniform float skyBrightness;
uniform float alphaCut;
uniform float opacity;
varying vec3 vCol;
varying vec2 vLight;
varying vec2 vUvA;
#include <common>
#include <fog_pars_fragment>
void main() {
    vec4 tex = texture2D( map, vUvA );
    if ( tex.a < alphaCut ) discard;
    float l = max( vLight.x * skyBrightness, vLight.y );
    l = clamp( l, 0.05, 1.0 );
    float b = l * l * 0.55 + l * 0.45;      // 마인크래프트 밝기 곡선 근사
    gl_FragColor = vec4( tex.rgb * vCol * b, tex.a * opacity );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
}`;

export const sharedUniforms = {
    map: { value: atlas.texture },
    skyBrightness: { value: 1.0 }
};

function makeMaterial(opts) {
    const mat = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([
            THREE.UniformsLib.fog,
            { map: { value: null }, skyBrightness: { value: 1 }, alphaCut: { value: opts.alphaCut }, opacity: { value: opts.opacity ?? 1 } }
        ]),
        vertexShader: VERT,
        fragmentShader: FRAG,
        fog: true,
        transparent: !!opts.transparent,
        depthWrite: opts.depthWrite !== false,
        side: opts.side ?? THREE.FrontSide
    });
    mat.uniforms.map = sharedUniforms.map;
    mat.uniforms.skyBrightness = sharedUniforms.skyBrightness;
    return mat;
}

export const materials = {
    solid: makeMaterial({ alphaCut: 0.5 }),
    cross: makeMaterial({ alphaCut: 0.5, side: THREE.DoubleSide }),
    // 물은 아래에서도 수면이 보여야 하므로 양면 렌더링
    liquid: makeMaterial({ alphaCut: 0.01, transparent: true, depthWrite: false, opacity: 1, side: THREE.DoubleSide })
};

// ---------- 메시 빌더 ----------
class Buf {
    constructor() { this.pos = []; this.uv = []; this.col = []; this.lit = []; this.idxs = []; this.n = 0; }
    quad(px, py, pz, verts, uv, cols, lights) {
        const o = this.n;
        for (let i = 0; i < 4; i++) {
            this.pos.push(px + verts[i][0], py + verts[i][1], pz + verts[i][2]);
            this.uv.push(uv[i][0], uv[i][1]);
            this.col.push(cols[i][0], cols[i][1], cols[i][2]);
            this.lit.push(lights[i][0], lights[i][1]);
        }
        // AO 가 대각으로 어긋나면 삼각형 분할 방향을 뒤집어 그라데이션 왜곡 방지
        if (cols[0][0] + cols[2][0] > cols[1][0] + cols[3][0])
            this.idxs.push(o, o + 1, o + 2, o, o + 2, o + 3);
        else
            this.idxs.push(o + 1, o + 2, o + 3, o + 1, o + 3, o);
        this.n += 4;
    }
    empty() { return this.n === 0; }
    build() {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
        g.setAttribute('acolor', new THREE.Float32BufferAttribute(this.col, 3));
        g.setAttribute('alight', new THREE.Float32BufferAttribute(this.lit, 2));
        g.setIndex(this.idxs);
        g.computeBoundingSphere();
        return g;
    }
}

/** 이웃 청크까지 포함한 18×128×18 블록/조명 버퍼 구성 */
function fillPad(chunk, getChunk) {
    padBuf.fill(0);
    const SRC_STRIDE = CHUNK_SIZE * CHUNK_SIZE;   // 소스 y 스트라이드
    const DST_STRIDE = PAD * PAD;                 // 패딩 y 스트라이드
    for (let pz = 0; pz < PAD; pz++) {
        for (let px = 0; px < PAD; px++) {
            const wx = chunk.cx * CHUNK_SIZE + px - 1;
            const wz = chunk.cz * CHUNK_SIZE + pz - 1;
            const ccx = Math.floor(wx / CHUNK_SIZE), ccz = Math.floor(wz / CHUNK_SIZE);
            const src = (ccx === chunk.cx && ccz === chunk.cz) ? chunk : getChunk(ccx, ccz);
            if (!src || !src.generated) continue;
            const sd = src.data;
            let si = (wz - ccz * CHUNK_SIZE) * CHUNK_SIZE + (wx - ccx * CHUNK_SIZE);
            let di = pz * PAD + px;
            const top = src.maxY;
            for (let y = 0; y <= top; y++, si += SRC_STRIDE, di += DST_STRIDE) padBuf[di] = sd[si];
        }
    }
}

/** 하늘빛 + 블록빛 BFS */
function computeLight(maxY) {
    skyBuf.fill(0);
    blkBuf.fill(0);
    let qt = 0;
    const top = Math.min(WORLD_HEIGHT - 1, maxY + 2);

    // --- 하늘빛: 각 기둥의 최상단부터 불투명 블록을 만날 때까지 15 ---
    // colTop[col] = 그 기둥에서 하늘이 보이는 가장 낮은 y
    for (let pz = 0; pz < PAD; pz++) {
        for (let px = 0; px < PAD; px++) {
            let y = WORLD_HEIGHT - 1;
            let i = pidx(px, y, pz);
            for (; y >= 0; y--, i -= PAD * PAD) {
                if (BLOCKS_SKY[padBuf[i]]) break;      // 물·잎 아래는 BFS 로 감쇠 전파
                skyBuf[i] = 15;
            }
            colTop[pz * PAD + px] = y + 1;
        }
    }
    // 전부 밝은 영역을 큐에 넣으면 낭비이므로, 어두운 이웃이 있는 셀만 시드로 쓴다
    for (let pz = 0; pz < PAD; pz++) {
        for (let px = 0; px < PAD; px++) {
            const col = pz * PAD + px;
            let maxNb = 0;
            if (px > 0) maxNb = Math.max(maxNb, colTop[col - 1]);
            if (px < PAD - 1) maxNb = Math.max(maxNb, colTop[col + 1]);
            if (pz > 0) maxNb = Math.max(maxNb, colTop[col - PAD]);
            if (pz < PAD - 1) maxNb = Math.max(maxNb, colTop[col + PAD]);
            const hi = Math.min(maxNb - 1, top);
            for (let y = colTop[col]; y <= hi; y++) queue[qt++ & QMASK] = pidx(px, y, pz);
        }
    }
    bfs(skyBuf, qt);

    // --- 블록빛 시드 (횃불·발광석·용암) ---
    qt = 0;
    for (let y = 0; y <= top; y++)
        for (let pz = 0; pz < PAD; pz++)
            for (let px = 0; px < PAD; px++) {
                const i = pidx(px, y, pz);
                const e = LIGHT_EMIT[padBuf[i]];
                if (e > 0) { blkBuf[i] = e; queue[qt++ & QMASK] = i; }
            }
    bfs(blkBuf, qt);
}

function bfs(field, qt) {
    const STEP_Z = PAD, STEP_Y = PAD * PAD;
    let qh = 0;
    while (qh < qt) {
        const i = queue[qh++ & QMASK];
        const l = field[i];
        if (l <= 1) continue;
        const y = (i / STEP_Y) | 0;
        const rem = i - y * STEP_Y;
        const pz = (rem / PAD) | 0;
        const px = rem - pz * PAD;
        const nl = l - 1;
        let j;
        if (px > 0)          { j = i - 1;      if (!IS_OPAQUE[padBuf[j]] && field[j] < nl) { field[j] = nl; queue[qt++ & QMASK] = j; } }
        if (px < PAD - 1)    { j = i + 1;      if (!IS_OPAQUE[padBuf[j]] && field[j] < nl) { field[j] = nl; queue[qt++ & QMASK] = j; } }
        if (pz > 0)          { j = i - STEP_Z; if (!IS_OPAQUE[padBuf[j]] && field[j] < nl) { field[j] = nl; queue[qt++ & QMASK] = j; } }
        if (pz < PAD - 1)    { j = i + STEP_Z; if (!IS_OPAQUE[padBuf[j]] && field[j] < nl) { field[j] = nl; queue[qt++ & QMASK] = j; } }
        if (y > 0)           { j = i - STEP_Y; if (!IS_OPAQUE[padBuf[j]] && field[j] < nl) { field[j] = nl; queue[qt++ & QMASK] = j; } }
        if (y < WORLD_HEIGHT - 1) { j = i + STEP_Y; if (!IS_OPAQUE[padBuf[j]] && field[j] < nl) { field[j] = nl; queue[qt++ & QMASK] = j; } }
    }
}

/** 정점 하나의 AO 등급 (0~3) */
function vertexAO(s1, s2, c) {
    if (s1 && s2) return 0;
    return 3 - (s1 + s2 + c);
}

const _uvTmp = [[0, 0], [0, 0], [0, 0], [0, 0]];
const _colTmp = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
const _litTmp = [[0, 0], [0, 0], [0, 0], [0, 0]];
const _vTmp = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];

/**
 * 청크 메시 생성. 이웃 청크가 필요하므로 getChunk 를 받는다.
 * @returns {{solid:THREE.Mesh|null, cross:THREE.Mesh|null, liquid:THREE.Mesh|null}}
 */
export function buildChunkMesh(chunk, getChunk) {
    fillPad(chunk, getChunk);
    computeLight(chunk.maxY);

    const solid = new Buf(), cross = new Buf(), liquid = new Buf();
    const top = Math.min(WORLD_HEIGHT - 1, chunk.maxY);

    for (let y = 0; y <= top; y++) {
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
            for (let lx = 0; lx < CHUNK_SIZE; lx++) {
                const blk = chunk.data[idx(lx, y, lz)];
                if (blk === AIR) continue;
                const kind = RENDER_KIND[blk];
                if (kind === 0) continue;
                const def = blocks[blk];
                const px = lx + 1, pz = lz + 1;

                // 바이옴 틴트
                let tr = 1, tg = 1, tb = 1;
                if (def.tint) {
                    const bid = chunk.biomeMap[lz * CHUNK_SIZE + lx];
                    const c = def.tint === 'grass' ? TINT_GRASS[bid] : TINT_FOLIAGE[bid];
                    tr = c[0]; tg = c[1]; tb = c[2];
                }

                if (kind === 2) { emitCross(cross, chunk, lx, y, lz, def, tr, tg, tb); continue; }

                const buf = kind === 3 ? liquid : solid;
                for (let f = 0; f < FACE.length; f++) {
                    const F = FACE[f];
                    const nx = px + F.d[0], ny = y + F.d[1], nz = pz + F.d[2];
                    if (ny < 0) continue;                       // 월드 바닥면은 그리지 않음
                    const nb = ny >= WORLD_HEIGHT ? AIR : padBuf[pidx(nx, ny, nz)];
                    if (IS_OPAQUE[nb]) continue;
                    if (nb === blk && def.cullSame) continue;
                    if (kind === 3 && RENDER_KIND[nb] === 3) continue;

                    const [u0, v0, u1, v1] = UV_TABLE[def.tex[f]];
                    _uvTmp[0][0] = u0; _uvTmp[0][1] = v0;
                    _uvTmp[1][0] = u1; _uvTmp[1][1] = v0;
                    _uvTmp[2][0] = u1; _uvTmp[2][1] = v1;
                    _uvTmp[3][0] = u0; _uvTmp[3][1] = v1;

                    const useTint = def.tint && (def.tintFace === 'all' || (def.tintFace === 'top' && f === 2));
                    const cr = useTint ? tr : 1, cg = useTint ? tg : 1, cb = useTint ? tb : 1;
                    const liquidTop = kind === 3 ? 0.9 : 1;   // 물 표면 살짝 낮춤 대신 밝기 보정

                    // 면 앞쪽 3x3 이웃을 한 번만 샘플링해 4개 정점이 공유한다
                    for (let a = -1; a <= 1; a++) {
                        for (let b = -1; b <= 1; b++) {
                            const k = (a + 1) * 3 + (b + 1);
                            const i = safeIdx(nx + a * F.u[0] + b * F.v[0],
                                              ny + a * F.u[1] + b * F.v[1],
                                              nz + a * F.u[2] + b * F.v[2]);
                            if (i < 0) { _nOp[k] = 0; _nSky[k] = 15; _nBlk[k] = 0; }
                            else { _nOp[k] = IS_OPAQUE[padBuf[i]]; _nSky[k] = skyBuf[i]; _nBlk[k] = blkBuf[i]; }
                        }
                    }

                    for (let i = 0; i < 4; i++) {
                        const su = VSIGN[i][0], sv = VSIGN[i][1];
                        // 정점 위치
                        _vTmp[i][0] = 0.5 + (F.d[0] + su * F.u[0] + sv * F.v[0]) * 0.5;
                        _vTmp[i][1] = 0.5 + (F.d[1] + su * F.u[1] + sv * F.v[1]) * 0.5;
                        _vTmp[i][2] = 0.5 + (F.d[2] + su * F.u[2] + sv * F.v[2]) * 0.5;

                        const kC = 4;                              // (0,0)
                        const k1 = (su + 1) * 3 + 1;               // (su,0)
                        const k2 = 3 + (sv + 1);                   // (0,sv)
                        const kD = (su + 1) * 3 + (sv + 1);        // (su,sv)
                        const o0 = _nOp[kC], o1 = _nOp[k1], o2 = _nOp[k2], oc = _nOp[kD];
                        const ao = AO_LEVEL[vertexAO(o1, o2, oc)];

                        // 인접 4셀(불투명 제외)의 빛 평균 → 부드러운 조명
                        let sSum = 0, bSum = 0, cnt = 0;
                        if (!o0) { sSum += _nSky[kC]; bSum += _nBlk[kC]; cnt++; }
                        if (!o1) { sSum += _nSky[k1]; bSum += _nBlk[k1]; cnt++; }
                        if (!o2) { sSum += _nSky[k2]; bSum += _nBlk[k2]; cnt++; }
                        if (!oc) { sSum += _nSky[kD]; bSum += _nBlk[kD]; cnt++; }
                        if (cnt === 0) cnt = 1;

                        const shade = F.shade * ao * liquidTop;
                        _colTmp[i][0] = cr * shade;
                        _colTmp[i][1] = cg * shade;
                        _colTmp[i][2] = cb * shade;
                        _litTmp[i][0] = (sSum / cnt) / 15;
                        _litTmp[i][1] = (bSum / cnt) / 15;
                    }
                    buf.quad(lx, y, lz, _vTmp, _uvTmp, _colTmp, _litTmp);
                }
            }
        }
    }

    const out = { solid: null, cross: null, liquid: null };
    const mk = (buf, mat) => {
        if (buf.empty()) return null;
        const m = new THREE.Mesh(buf.build(), mat);
        m.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
        m.matrixAutoUpdate = false;
        m.updateMatrix();
        return m;
    };
    out.solid = mk(solid, materials.solid);
    out.cross = mk(cross, materials.cross);
    out.liquid = mk(liquid, materials.liquid);
    return out;
}

// 면 앞쪽 3x3 이웃 캐시 (불투명 여부 / 하늘빛 / 블록빛)
const _nOp = new Uint8Array(9), _nSky = new Uint8Array(9), _nBlk = new Uint8Array(9);

function safeIdx(px, y, pz) {
    if (y < 0 || y >= WORLD_HEIGHT || px < 0 || px >= PAD || pz < 0 || pz >= PAD) return -1;
    return pidx(px, y, pz);
}
/** 십자형 식물 (2장의 교차 평면) */
function emitCross(buf, chunk, lx, y, lz, def, tr, tg, tb) {
    const i = safeIdx(lx + 1, y, lz + 1);
    const sky = i < 0 ? 15 : skyBuf[i], bl = i < 0 ? 0 : blkBuf[i];
    const [u0, v0, u1, v1] = UV_TABLE[def.tex[0]];
    const uvs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    const cols = [];
    const lits = [];
    const use = def.tint ? [tr, tg, tb] : [1, 1, 1];
    for (let k = 0; k < 4; k++) { cols.push([use[0], use[1], use[2]]); lits.push([sky / 15, bl / 15]); }

    const A = [[0.02, 0, 0.02], [0.98, 0, 0.98], [0.98, 1, 0.98], [0.02, 1, 0.02]];
    const Bq = [[0.02, 0, 0.98], [0.98, 0, 0.02], [0.98, 1, 0.02], [0.02, 1, 0.98]];
    buf.quad(lx, y, lz, A, uvs, cols, lits);
    buf.quad(lx, y, lz, Bq, uvs, cols, lits);
}
