// ===== 절차적 텍스처 아틀라스 =====
// 마인크래프트와 동일한 16x16 픽셀아트를 코드로 생성해 하나의 아틀라스에 배치한다.
// 외부 리소스 의존이 없고, 로딩 비용이 0에 가깝다.
import * as THREE from 'three';

export const TILE = 16;
export const COLS = 16;
const ATLAS = TILE * COLS;

// ---- 유틸 ----
function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const RD = h => (h >> 16) & 255, GN = h => (h >> 8) & 255, BL = h => h & 255;

/** 16x16 픽셀 버퍼 */
function newTile() { return new Uint8ClampedArray(TILE * TILE * 4); }

function mk(buf) {
    return {
        buf,
        set(x, y, hex, a = 255, shade = 0) {
            if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
            const i = (y * TILE + x) * 4;
            buf[i]     = RD(hex) + shade;
            buf[i + 1] = GN(hex) + shade;
            buf[i + 2] = BL(hex) + shade;
            buf[i + 3] = a;
        },
        get(x, y) { const i = (y * TILE + x) * 4; return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]; },
        mul(x, y, f) {
            const i = (y * TILE + x) * 4;
            buf[i] *= f; buf[i + 1] *= f; buf[i + 2] *= f;
        }
    };
}

/** 균일 노이즈 채우기 */
function fill(p, r, hex, amp, a = 255) {
    for (let y = 0; y < TILE; y++)
        for (let x = 0; x < TILE; x++)
            p.set(x, y, hex, a, ((r() * 2 - 1) * amp) | 0);
}
/** 얼룩 뿌리기 */
function specks(p, r, n, hex, amp = 10, size = 1) {
    for (let i = 0; i < n; i++) {
        const x = (r() * TILE) | 0, y = (r() * TILE) | 0;
        for (let dy = 0; dy < size; dy++)
            for (let dx = 0; dx < size; dx++)
                p.set(x + dx, y + dy, hex, 255, ((r() * 2 - 1) * amp) | 0);
    }
}

// ---- 개별 텍스처 생성기 ----
const plain = (hex, amp, sp, spHex) => (p, r) => {
    fill(p, r, hex, amp);
    if (sp) specks(p, r, sp, spHex, 8);
};

/** 광석: 돌 바탕 + 광물 덩어리 */
const ore = (hex, blobs = 5) => (p, r) => {
    fill(p, r, 0x7d7d7d, 14);
    specks(p, r, 8, 0x6d6d6d, 6);
    for (let i = 0; i < blobs; i++) {
        const cx = 1 + ((r() * 13) | 0), cy = 1 + ((r() * 13) | 0);
        const w = 2 + ((r() * 2) | 0), h = 2 + ((r() * 2) | 0);
        for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
                if (r() < 0.15) continue;
                p.set(cx + x, cy + y, hex, 255, ((r() * 2 - 1) * 22) | 0);
            }
    }
};

/** 자갈/조약돌류: 불규칙 덩어리 + 어두운 틈새 */
const cobble = (hex, mortar) => (p, r) => {
    fill(p, r, mortar, 8);
    const cells = [[0, 0, 7, 5], [8, 0, 8, 8], [0, 6, 5, 5], [6, 6, 5, 4], [12, 9, 4, 7],
                   [0, 12, 6, 4], [7, 11, 5, 5], [6, 0, 0, 0]];
    for (const [cx, cy, cw, ch] of cells) {
        if (cw < 2) continue;
        const tone = ((r() * 2 - 1) * 18) | 0;
        for (let y = 0; y < ch; y++)
            for (let x = 0; x < cw; x++) {
                if (x === 0 || y === 0 || x === cw - 1 || y === ch - 1) {
                    if (r() < 0.35) continue;
                }
                p.set(cx + x, cy + y, hex, 255, tone + (((r() * 2 - 1) * 10) | 0));
            }
    }
};

/** 원목 옆면: 세로 결 */
const logSide = (hex, dark) => (p, r) => {
    fill(p, r, hex, 10);
    for (let x = 0; x < TILE; x++) {
        if (r() < 0.45) continue;
        const d = r() < 0.5 ? dark : hex;
        for (let y = 0; y < TILE; y++) {
            if (r() < 0.12) continue;
            p.set(x, y, d, 255, ((r() * 2 - 1) * 12) | 0);
        }
    }
};

/** 원목 윗면: 나이테 */
const logTop = (hex, dark, bark) => (p, r) => {
    fill(p, r, hex, 8);
    for (let y = 0; y < TILE; y++)
        for (let x = 0; x < TILE; x++) {
            const d = Math.hypot(x - 7.5, y - 7.5);
            if (d > 7.0) { p.set(x, y, bark, 255, ((r() * 2 - 1) * 10) | 0); continue; }
            const ring = Math.abs(Math.sin(d * 1.5)) < 0.28;
            if (ring) p.set(x, y, dark, 255, ((r() * 2 - 1) * 8) | 0);
        }
};

/** 나뭇잎: 알파 구멍이 있는 잎사귀 (회색조 → 바이옴 틴트 적용) */
const leaves = (hex) => (p, r) => {
    for (let y = 0; y < TILE; y++)
        for (let x = 0; x < TILE; x++) {
            if (r() < 0.14) { p.set(x, y, 0, 0); continue; }
            const cl = r() < 0.35 ? 0x000000 : 0x000000;
            p.set(x, y, hex, 255, ((r() * 2 - 1) * 26) | 0);
            if (r() < 0.18) p.mul(x, y, 0.72);
        }
};

/** 나무 판자: 가로 판재 + 세로 결 */
const planks = (hex, dark) => (p, r) => {
    fill(p, r, hex, 9);
    for (let y = 0; y < TILE; y++) {
        if (y % 4 === 3) for (let x = 0; x < TILE; x++) p.set(x, y, dark, 255, ((r() * 2 - 1) * 6) | 0);
    }
    for (let i = 0; i < 22; i++) {
        const x = (r() * TILE) | 0, y = (r() * TILE) | 0, len = 1 + ((r() * 3) | 0);
        for (let k = 0; k < len; k++) if (((y + k) % 4) !== 3) p.mul(x, y + k < TILE ? y + k : TILE - 1, 0.9);
    }
    // 판재 이음새(세로)
    for (const [x0, y0, y1] of [[5, 0, 3], [11, 4, 7], [3, 8, 11], [9, 12, 15]])
        for (let y = y0; y <= y1; y++) p.set(x0, y, dark, 255, -4);
};

/** 벽돌 패턴 */
const brick = (hex, mortar) => (p, r) => {
    fill(p, r, mortar, 6);
    for (let row = 0; row < 4; row++) {
        const off = row % 2 === 0 ? 0 : -4;
        for (let b = -1; b < 3; b++) {
            const bx = off + b * 8, by = row * 4;
            for (let y = 0; y < 3; y++)
                for (let x = 0; x < 7; x++)
                    p.set(bx + x, by + y, hex, 255, ((r() * 2 - 1) * 12) | 0);
        }
    }
};

/** 십자 식물 스프라이트 */
const plant = (stem, petal, kind) => (p, r) => {
    for (let i = 0; i < TILE * TILE * 4; i++) p.buf[i] = 0;
    if (kind === 'grass') {
        // 가느다란 풀잎 몇 가닥 (마인크래프트의 성긴 실루엣)
        for (let i = 0; i < 7; i++) {
            let x = 2 + ((r() * 12) | 0);
            const h = 6 + ((r() * 8) | 0);
            for (let y = 0; y < h; y++) {
                p.set(x, 15 - y, stem, 255, (-6 + (r() * 2 - 1) * 18) | 0);
                if (y > 3 && r() < 0.28) x += r() < 0.5 ? 1 : -1;   // 위로 갈수록 휘어짐
            }
        }
    } else if (kind === 'flower') {
        for (let y = 8; y < 15; y++) p.set(7, y, stem, 255, ((r() * 2 - 1) * 10) | 0);
        p.set(6, 12, stem, 255, -20); p.set(9, 10, stem, 255, -20);
        const pet = [[6, 4], [7, 4], [8, 4], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5],
                     [5, 6], [6, 6], [7, 6], [8, 6], [9, 6], [6, 7], [7, 7], [8, 7]];
        for (const [x, y] of pet) p.set(x, y, petal, 255, ((r() * 2 - 1) * 18) | 0);
        p.set(7, 5, 0xffe066); p.set(7, 6, 0xffe066);
    } else if (kind === 'sapling') {
        for (let y = 10; y < 16; y++) p.set(7, y, 0x6b4f2a, 255, ((r() * 2 - 1) * 10) | 0);
        for (let y = 3; y < 11; y++)
            for (let x = 3; x < 13; x++) {
                if (Math.hypot(x - 7.5, y - 7) > 4.5 || r() < 0.25) continue;
                p.set(x, y, petal, 255, ((r() * 2 - 1) * 24) | 0);
            }
    } else if (kind === 'deadbush') {
        for (let y = 6; y < 16; y++) p.set(7, y, stem, 255, ((r() * 2 - 1) * 14) | 0);
        for (const [x, y] of [[5, 8], [4, 7], [9, 9], [10, 8], [6, 11], [9, 12], [3, 10], [11, 11]])
            p.set(x, y, stem, 255, ((r() * 2 - 1) * 14) | 0);
    } else if (kind === 'cane') {
        for (let x = 5; x < 11; x++)
            for (let y = 0; y < 16; y++) {
                if (x === 5 || x === 10) { if (r() < 0.5) continue; }
                p.set(x, y, petal, 255, ((r() * 2 - 1) * 16) | 0);
            }
    }
};

// ---- 텍스처 테이블 (등록 순서 = 아틀라스 인덱스) ----
const TEX = {
    stone:            plain(0x7d7d7d, 14, 10, 0x6b6b6b),
    dirt:             plain(0x866043, 18, 14, 0x6f4e35),
    grass_top:        (p, r) => { // 회색조 → 바이옴 색으로 틴트
        fill(p, r, 0xe6e6e6, 20);
        specks(p, r, 26, 0xcccccc, 14);
    },
    grass_side:       (p, r) => {
        fill(p, r, 0x866043, 18);
        for (let x = 0; x < TILE; x++) {
            const h = 3 + ((r() * 3) | 0);
            for (let y = 0; y < h; y++) p.set(x, y, 0x6f9c43, 255, ((r() * 2 - 1) * 20) | 0);
        }
    },
    grass_side_snow:  (p, r) => {
        fill(p, r, 0x866043, 18);
        for (let x = 0; x < TILE; x++) {
            const h = 4 + ((r() * 3) | 0);
            for (let y = 0; y < h; y++) p.set(x, y, 0xf0f5f5, 255, ((r() * 2 - 1) * 8) | 0);
        }
    },
    cobblestone:      cobble(0x7a7a7a, 0x555555),
    mossy_cobblestone: (p, r) => { cobble(0x6f7a63, 0x4c5544)(p, r); specks(p, r, 30, 0x5f8f45, 14); },
    bedrock:          (p, r) => { fill(p, r, 0x555555, 26); specks(p, r, 40, 0x2a2a2a, 20, 2); specks(p, r, 20, 0x8a8a8a, 16); },
    sand:             plain(0xdbd3a0, 10, 10, 0xc9c08c),
    gravel:           (p, r) => { fill(p, r, 0x847e7c, 16); specks(p, r, 34, 0x6a6462, 18, 2); specks(p, r, 20, 0x9c9694, 14, 2); },
    clay:             plain(0xa4a8b8, 8, 8, 0x9296a6),
    coal_ore:         ore(0x1a1a1a, 5),
    iron_ore:         ore(0xd8af93, 5),
    copper_ore:       ore(0xd4854a, 5),
    gold_ore:         ore(0xfcee4b, 4),
    redstone_ore:     ore(0xd60000, 5),
    lapis_ore:        ore(0x2f57b8, 5),
    diamond_ore:      ore(0x5decf5, 4),
    emerald_ore:      ore(0x17dd62, 3),
    oak_log_side:     logSide(0x6b4f2a, 0x50391d),
    oak_log_top:      logTop(0xb08a56, 0x8a6a3d, 0x6b4f2a),
    oak_leaves:       leaves(0xc6c6c6),
    oak_planks:       planks(0xa47c50, 0x866040),
    spruce_log_side:  logSide(0x4a3520, 0x342414),
    spruce_log_top:   logTop(0x8f6f47, 0x6e5433, 0x4a3520),
    spruce_leaves:    leaves(0xa4a4a4),
    spruce_planks:    planks(0x7a5a34, 0x5e4527),
    birch_log_side:   (p, r) => {
        fill(p, r, 0xdcd9d2, 8);
        for (let i = 0; i < 6; i++) {
            const y = (r() * TILE) | 0, x = (r() * 12) | 0, w = 2 + ((r() * 4) | 0);
            for (let k = 0; k < w; k++) p.set(x + k, y, 0x3a3a34, 255, ((r() * 2 - 1) * 10) | 0);
        }
    },
    birch_log_top:    logTop(0xd7cfa8, 0xb8ad86, 0xdcd9d2),
    birch_leaves:     leaves(0xd2d2d2),
    birch_planks:     planks(0xc8b58a, 0xa89670),
    water:            (p, r) => {
        for (let y = 0; y < TILE; y++)
            for (let x = 0; x < TILE; x++) {
                const w = Math.sin((x + y * 0.6) * 0.9) * 8 + Math.sin(x * 1.7) * 5;
                p.set(x, y, 0x3f6fe4, 200, (w + (r() * 2 - 1) * 6) | 0);
            }
    },
    lava:             (p, r) => {
        for (let y = 0; y < TILE; y++)
            for (let x = 0; x < TILE; x++) {
                const w = Math.sin((x * 1.3 + y * 0.7)) * 26 + Math.sin(y * 2.1) * 14;
                p.set(x, y, 0xd45a12, 255, (w + (r() * 2 - 1) * 12) | 0);
            }
        specks(p, r, 16, 0xffcf3a, 20, 2);
    },
    glass:            (p, r) => {
        for (let i = 0; i < TILE * TILE * 4; i++) p.buf[i] = 0;
        for (let x = 0; x < TILE; x++) { p.set(x, 0, 0xd8f2f7, 210); p.set(x, 15, 0xd8f2f7, 210); }
        for (let y = 0; y < TILE; y++) { p.set(0, y, 0xd8f2f7, 210); p.set(15, y, 0xd8f2f7, 210); }
        for (const [x, y] of [[2, 2], [3, 2], [4, 3], [2, 3], [11, 10], [12, 10], [12, 11], [10, 4], [11, 4]])
            p.set(x, y, 0xffffff, 140);
    },
    sandstone_top:    plain(0xe0d7a8, 8),
    sandstone_side:   (p, r) => {
        fill(p, r, 0xdbd0a0, 8);
        for (let y = 0; y < 4; y++) for (let x = 0; x < TILE; x++) p.set(x, y, 0xe6ddb2, 255, ((r() * 2 - 1) * 6) | 0);
        for (let x = 0; x < TILE; x++) { p.set(x, 4, 0xc4b988, 255, -4); p.set(x, 15, 0xc4b988, 255, -4); }
    },
    snow:             plain(0xf2f8f8, 6),
    ice:              (p, r) => {
        fill(p, r, 0x7ab0f5, 10, 235);
        for (let i = 0; i < 8; i++) {
            const x = (r() * TILE) | 0, y = (r() * TILE) | 0, len = 3 + ((r() * 5) | 0);
            for (let k = 0; k < len; k++) p.set(x + k, y + ((k * 0.5) | 0), 0xa8cdfb, 235);
        }
    },
    cactus_top:       (p, r) => { fill(p, r, 0x4f7d34, 10); for (let x = 1; x < 15; x++) { p.set(x, 1, 0x3f6528); p.set(x, 14, 0x3f6528); } },
    cactus_side:      (p, r) => {
        fill(p, r, 0x54843a, 10);
        for (let y = 0; y < TILE; y++) { p.set(0, y, 0x3d6329); p.set(15, y, 0x3d6329); p.set(1, y, 0x63985f, 255, -6); }
        for (let i = 0; i < 10; i++) { const x = 3 + ((r() * 10) | 0), y = (r() * TILE) | 0; p.set(x, y, 0xdfe0c8); }
    },
    bricks:           brick(0x9a5a4b, 0xb8b0a8),
    stone_bricks:     (p, r) => {
        fill(p, r, 0x6f6f6f, 6);
        const seg = [[0, 0, 15, 7], [0, 8, 7, 7], [8, 8, 7, 7]];
        for (const [x0, y0, w, h] of seg)
            for (let y = 0; y < h; y++)
                for (let x = 0; x < w; x++)
                    p.set(x0 + x, y0 + y, 0x7d7d7d, 255, ((r() * 2 - 1) * 12) | 0);
    },
    obsidian:         (p, r) => { fill(p, r, 0x1a1024, 10); specks(p, r, 22, 0x3b2a56, 14); specks(p, r, 8, 0x0d0812, 10, 2); },
    glowstone:        (p, r) => { fill(p, r, 0xb9905c, 12); specks(p, r, 26, 0xffe98a, 20, 2); specks(p, r, 12, 0xfff6c8, 12); },
    tnt_top:          (p, r) => { fill(p, r, 0xb03020, 8); for (let x = 3; x < 13; x++) for (let y = 6; y < 10; y++) p.set(x, y, 0x40402f, 255); },
    tnt_side:         (p, r) => {
        fill(p, r, 0xa02818, 8);
        for (let y = 4; y < 10; y++) for (let x = 0; x < TILE; x++) p.set(x, y, 0xf2f2f2, 255, ((r() * 2 - 1) * 6) | 0);
        const T = [[2, 5], [3, 5], [4, 5], [3, 6], [3, 7], [3, 8]];
        const N = [[6, 5], [6, 6], [6, 7], [6, 8], [7, 6], [8, 7], [9, 5], [9, 6], [9, 7], [9, 8]];
        const T2 = [[11, 5], [12, 5], [13, 5], [12, 6], [12, 7], [12, 8]];
        for (const [x, y] of [...T, ...N, ...T2]) p.set(x, y, 0x201a10);
    },
    tnt_bottom:       plain(0x8a2414, 8),
    bookshelf:        (p, r) => {
        planks(0xa47c50, 0x866040)(p, r);
        for (let y = 1; y < 15; y++) {
            if (y >= 7 && y <= 8) continue;
            for (let x = 1; x < 15; x++) {
                if (y < 7 || y > 8) {
                    const c = [0x9a3a3a, 0x3a5a9a, 0x3a8a4a, 0xa08a3a][(x * 3 + (y < 7 ? 0 : 5)) % 4];
                    if (x % 3 === 0) continue;
                    p.set(x, y, c, 255, ((r() * 2 - 1) * 14) | 0);
                }
            }
        }
    },
    crafting_top:     (p, r) => {
        planks(0xa47c50, 0x866040)(p, r);
        for (let x = 0; x < TILE; x++) { p.set(x, 5, 0x5c4228); p.set(x, 10, 0x5c4228); }
        for (let y = 0; y < TILE; y++) { p.set(5, y, 0x5c4228); p.set(10, y, 0x5c4228); }
    },
    crafting_side:    (p, r) => {
        planks(0x8f6a44, 0x6f5030)(p, r);
        for (let y = 2; y < 6; y++) for (let x = 2; x < 14; x++) p.set(x, y, 0x6f5030, 255, ((r() * 2 - 1) * 10) | 0);
    },
    crafting_front:   (p, r) => {
        planks(0x8f6a44, 0x6f5030)(p, r);
        for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) p.set(x, y, 0x5c4228, 255, ((r() * 2 - 1) * 10) | 0);
        for (const [x, y] of [[5, 5], [8, 5], [5, 8], [8, 8], [6, 10], [9, 6]]) p.set(x, y, 0xb0b0b0);
    },
    furnace_side:     plain(0x6e6e6e, 12, 10, 0x5c5c5c),
    furnace_top:      (p, r) => { fill(p, r, 0x6e6e6e, 12); for (let x = 4; x < 12; x++) for (let y = 4; y < 12; y++) p.set(x, y, 0x5a5a5a, 255, ((r() * 2 - 1) * 8) | 0); },
    furnace_front:    (p, r) => {
        fill(p, r, 0x6e6e6e, 12);
        for (let y = 5; y < 13; y++) for (let x = 3; x < 13; x++) p.set(x, y, 0x2a2a2a, 255, ((r() * 2 - 1) * 8) | 0);
        for (let x = 3; x < 13; x++) p.set(x, 4, 0x4a4a4a);
    },
    furnace_lit:      (p, r) => {
        fill(p, r, 0x6e6e6e, 12);
        for (let y = 5; y < 13; y++) for (let x = 3; x < 13; x++) p.set(x, y, 0x2a2a2a, 255, ((r() * 2 - 1) * 8) | 0);
        for (let x = 4; x < 12; x++) for (let y = 9; y < 12; y++) if (r() > 0.25) p.set(x, y, r() < 0.5 ? 0xff9d2e : 0xffd452, 255);
        for (let x = 3; x < 13; x++) p.set(x, 4, 0x4a4a4a);
    },
    iron_block:       (p, r) => { fill(p, r, 0xd8d8d8, 8); for (let x = 0; x < TILE; x++) { p.set(x, 0, 0xa8a8a8); p.set(x, 15, 0xa8a8a8); p.set(0, x, 0xa8a8a8); p.set(15, x, 0xa8a8a8); } },
    gold_block:       (p, r) => { fill(p, r, 0xf7d94b, 10); for (let x = 0; x < TILE; x++) { p.set(x, 0, 0xc9ae2e); p.set(x, 15, 0xc9ae2e); p.set(0, x, 0xc9ae2e); p.set(15, x, 0xc9ae2e); } },
    diamond_block:    (p, r) => { fill(p, r, 0x6fe6df, 10); specks(p, r, 14, 0xa8f5f0, 14); for (let x = 0; x < TILE; x++) { p.set(x, 0, 0x49b8b2); p.set(x, 15, 0x49b8b2); p.set(0, x, 0x49b8b2); p.set(15, x, 0x49b8b2); } },
    coal_block:       plain(0x151515, 10, 14, 0x2a2a2a),
    netherrack:       (p, r) => { fill(p, r, 0x7a3131, 16); specks(p, r, 30, 0x5e2323, 14, 2); },
    pumpkin_side:     (p, r) => { fill(p, r, 0xc07615, 10); for (let x = 1; x < 15; x += 3) for (let y = 1; y < 15; y++) p.set(x, y, 0xa35f0e, 255, ((r() * 2 - 1) * 8) | 0); },
    pumpkin_top:      (p, r) => { fill(p, r, 0xb56d13, 10); for (let x = 6; x < 10; x++) for (let y = 6; y < 10; y++) p.set(x, y, 0x6b8f3a); },
    melon_side:       (p, r) => { fill(p, r, 0x3f7a26, 12); for (let i = 0; i < 40; i++) p.set((r() * TILE) | 0, (r() * TILE) | 0, 0x74a83a, 255, ((r() * 2 - 1) * 10) | 0); },
    wool_white:       plain(0xe9ecec, 8),
    wool_red:         plain(0xb02e26, 10),
    wool_blue:        plain(0x3c44aa, 10),
    wool_yellow:      plain(0xf9c628, 10),
    wool_green:       plain(0x5e7c16, 10),
    wool_black:       plain(0x1d1d21, 8),
    torch_tex:        (p, r) => {
        for (let i = 0; i < TILE * TILE * 4; i++) p.buf[i] = 0;
        for (let y = 6; y < 16; y++) { p.set(7, y, 0x8a6a3d, 255, ((r() * 2 - 1) * 10) | 0); p.set(8, y, 0x6b4f2a, 255, ((r() * 2 - 1) * 10) | 0); }
        for (const [x, y, c] of [[7, 4, 0xffd452], [8, 4, 0xffd452], [7, 5, 0xff9d2e], [8, 5, 0xff9d2e], [7, 3, 0xfff2b0], [8, 3, 0xfff2b0]]) p.set(x, y, c);
    },
    short_grass:      plant(0x77b04a, 0, 'grass'),
    dandelion:        plant(0x4f7a2a, 0xf9e547, 'flower'),
    poppy:            plant(0x4f7a2a, 0xd63a2a, 'flower'),
    cornflower:       plant(0x4f7a2a, 0x466aeb, 'flower'),
    oak_sapling:      plant(0x6b4f2a, 0x4f8f36, 'sapling'),
    dead_bush:        plant(0x8a6a3a, 0, 'deadbush'),
    sugar_cane:       plant(0, 0x8bc44a, 'cane'),
    farmland:         (p, r) => { fill(p, r, 0x6a4a2f, 14); for (let x = 0; x < TILE; x += 4) for (let y = 0; y < TILE; y++) p.set(x, y, 0x4f3620, 255, ((r() * 2 - 1) * 8) | 0); },
    // 파괴 진행 오버레이 (0~9단계)
    break0: crack(0), break1: crack(1), break2: crack(2), break3: crack(3), break4: crack(4),
    break5: crack(5), break6: crack(6), break7: crack(7), break8: crack(8), break9: crack(9),
    // 아이템 아이콘
    item_stick:       (p, r) => { clear(p); for (let i = 0; i < 10; i++) { p.set(11 - i, 4 + i, 0xa07c4a); p.set(10 - i, 4 + i, 0x6b4f2a); } },
    item_coal:        (p, r) => { clear(p); blob(p, r, 0x1c1c1c, 5); },
    item_raw_iron:    (p, r) => { clear(p); blob(p, r, 0xc9a48b, 5); },
    item_raw_copper:  (p, r) => { clear(p); blob(p, r, 0xc07a4a, 5); },
    item_raw_gold:    (p, r) => { clear(p); blob(p, r, 0xe0c04a, 5); },
    item_iron:        ingot(0xd8d8d8, 0xf2f2f2),
    item_copper:      ingot(0xc87f4a, 0xe8a878),
    item_gold:        ingot(0xf7d94b, 0xfff0a0),
    item_diamond:     (p, r) => { clear(p); gem(p, 0x4fe5df); },
    item_emerald:     (p, r) => { clear(p); gem(p, 0x2ad45f); },
    item_lapis:       (p, r) => { clear(p); blob(p, r, 0x2f57b8, 4); },
    item_redstone:    dust(0xd60000),
    item_gunpowder:   dust(0x9a9a9a),
    item_glowdust:    dust(0xf2e08a),
    item_clay_ball:   (p, r) => { clear(p); blob(p, r, 0xa4a8b8, 4); },
    item_brick:       (p, r) => { clear(p); for (let y = 6; y <= 10; y++) for (let x = 3; x <= 12; x++) p.set(x, y, 0x9a5a4b, 255, ((r() * 2 - 1) * 12) | 0); for (let x = 3; x <= 12; x++) p.set(x, 8, 0xb8b0a8, 255); },
    item_paper:       (p, r) => { clear(p); for (let y = 3; y <= 12; y++) for (let x = 3; x <= 12; x++) p.set(x, y, 0xf2f2ea, 255, ((r() * 2 - 1) * 6) | 0); for (let y = 5; y <= 10; y += 2) for (let x = 5; x <= 10; x++) p.set(x, y, 0xc8c8c0); },
    item_book:        (p, r) => { clear(p); for (let y = 2; y <= 13; y++) for (let x = 4; x <= 12; x++) p.set(x, y, 0x8a4a2a, 255, ((r() * 2 - 1) * 10) | 0); for (let y = 3; y <= 12; y++) { p.set(3, y, 0xf0ecd8); p.set(4, y, 0xf0ecd8); } },
    item_apple:       (p, r) => { clear(p); circle(p, 8, 9, 5, 0xd03030); circle(p, 6, 7, 2, 0xe86060); for (let y = 2; y < 6; y++) p.set(9, y, 0x5a3a1a); p.set(11, 3, 0x4f8f36); p.set(12, 3, 0x4f8f36); },
    item_bread:       (p, r) => { clear(p); for (let y = 5; y < 12; y++) for (let x = 2; x < 14; x++) { if ((x === 2 || x === 13) && (y === 5 || y === 11)) continue; p.set(x, y, 0xc08a3e, 255, ((r() * 2 - 1) * 12) | 0); } for (const [x, y] of [[5, 6], [8, 7], [11, 6]]) { p.set(x, y, 0x8a5a20); p.set(x, y + 1, 0x8a5a20); } },
    item_beef:        (p, r) => { clear(p); circle(p, 8, 8, 6, 0xc44a3a); circle(p, 7, 7, 3, 0xe07a6a); circle(p, 11, 11, 2, 0xf0e8d8); },
    item_cooked_beef: (p, r) => { clear(p); circle(p, 8, 8, 6, 0x8a4a2a); circle(p, 7, 7, 3, 0xb06a3a); circle(p, 11, 11, 2, 0xe0d8c8); },
    item_porkchop:    (p, r) => { clear(p); circle(p, 8, 8, 6, 0xe08a7a); circle(p, 6, 6, 2, 0xf0b0a0); circle(p, 11, 11, 2, 0xf5f0e0); },
    item_leather:     (p, r) => { clear(p); for (let y = 4; y < 13; y++) for (let x = 3; x < 14; x++) p.set(x, y, 0xa06a3a, 255, ((r() * 2 - 1) * 12) | 0); for (let x = 3; x < 14; x++) { p.set(x, 4, 0xc08a5a); p.set(x, 12, 0x7a4e28); } },
    item_string:      (p, r) => { clear(p); for (let i = 0; i < 14; i++) p.set(3 + ((Math.sin(i * 0.8) * 3 + 4) | 0), 1 + i, 0xdcdcdc); },
    item_bone:        (p, r) => { clear(p); for (let i = 0; i < 8; i++) { p.set(4 + i, 11 - i, 0xe8e4d8); p.set(5 + i, 11 - i, 0xd8d4c4); } circle(p, 3, 12, 2, 0xe8e4d8); circle(p, 12, 3, 2, 0xe8e4d8); },
    item_feather:     (p, r) => { clear(p); for (let i = 0; i < 12; i++) { p.set(4 + ((i * 0.5) | 0), 13 - i, 0xf0f0f0); p.set(5 + ((i * 0.5) | 0), 13 - i, 0xd8d8d8); } },
    item_rotten:      (p, r) => { clear(p); circle(p, 8, 8, 6, 0x6d5a3a); circle(p, 6, 7, 2, 0x8a7550); for (const [x, y] of [[10, 6], [5, 11], [11, 10]]) circle(p, x, y, 1, 0x4a3d28); },
    // 도구 아이콘
    tool_wood_pick:   toolIcon('pick', 0xa47c50),
    tool_stone_pick:  toolIcon('pick', 0x8a8a8a),
    tool_iron_pick:   toolIcon('pick', 0xd8d8d8),
    tool_gold_pick:   toolIcon('pick', 0xf7d94b),
    tool_diamond_pick: toolIcon('pick', 0x6fe6df),
    tool_wood_axe:    toolIcon('axe', 0xa47c50),
    tool_stone_axe:   toolIcon('axe', 0x8a8a8a),
    tool_iron_axe:    toolIcon('axe', 0xd8d8d8),
    tool_diamond_axe: toolIcon('axe', 0x6fe6df),
    tool_wood_shovel: toolIcon('shovel', 0xa47c50),
    tool_stone_shovel: toolIcon('shovel', 0x8a8a8a),
    tool_iron_shovel: toolIcon('shovel', 0xd8d8d8),
    tool_diamond_shovel: toolIcon('shovel', 0x6fe6df),
    tool_wood_sword:  toolIcon('sword', 0xa47c50),
    tool_stone_sword: toolIcon('sword', 0x8a8a8a),
    tool_iron_sword:  toolIcon('sword', 0xd8d8d8),
    tool_diamond_sword: toolIcon('sword', 0x6fe6df),
};

function clear(p) { for (let i = 0; i < TILE * TILE * 4; i++) p.buf[i] = 0; }
function circle(p, cx, cy, rad, hex) {
    for (let y = 0; y < TILE; y++)
        for (let x = 0; x < TILE; x++)
            if (Math.hypot(x - cx, y - cy) <= rad) p.set(x, y, hex);
}
function blob(p, r, hex, rad) {
    for (let y = 0; y < TILE; y++)
        for (let x = 0; x < TILE; x++) {
            const d = Math.hypot(x - 8, y - 8);
            if (d <= rad + (r() < 0.5 ? 0 : 1)) p.set(x, y, hex, 255, ((r() * 2 - 1) * 20) | 0);
        }
}
function gem(p, hex) {
    const rows = [[6, 9, 3], [5, 10, 4], [4, 11, 5], [4, 11, 6], [4, 11, 7], [5, 10, 8], [5, 10, 9], [6, 9, 10], [7, 8, 11]];
    for (const [x0, x1, y] of rows) for (let x = x0; x <= x1; x++) p.set(x, y, hex);
    for (let x = 6; x <= 8; x++) p.set(x, 5, hex);
    p.set(6, 6, 0xffffff, 200); p.set(7, 6, 0xffffff, 160);
}
/** 파괴 크랙 오버레이 */
function crack(stage) {
    return (p) => {
        clear(p);
        const r = mulberry32(1234);
        const density = (stage + 1) / 10;
        // 중앙에서 뻗어나가는 균열
        const lines = 3 + stage;
        for (let i = 0; i < lines; i++) {
            let x = 8, y = 8;
            const ang = (i / lines) * Math.PI * 2 + 0.4;
            const len = 3 + stage * 1.2;
            for (let k = 0; k < len; k++) {
                x += Math.cos(ang) + (r() - 0.5);
                y += Math.sin(ang) + (r() - 0.5);
                p.set(x | 0, y | 0, 0x000000, 190);
                if (density > 0.5) p.set((x | 0) + 1, y | 0, 0x000000, 120);
            }
        }
    };
}
/** 도구 아이콘: 16x16 픽셀 패턴 (H=머리, s=손잡이, d=손잡이 그림자) */
const TOOL_ART = {
    pick: [
        '................',
        '....HHH..HHH....',
        '...H...HH...H...',
        '...H..HddH..H...',
        '...HHH.dd.HHH...',
        '.......dd.......',
        '......ds........',
        '......ds........',
        '.....ds.........',
        '.....ds.........',
        '....ds..........',
        '....ds..........',
        '...ds...........',
        '...ds...........',
        '...d............',
        '................'
    ],
    axe: [
        '................',
        '.......HHH......',
        '......HHHHH.....',
        '.....HHHHHHH....',
        '.....HHHHdHH....',
        '.....HHHHdd.....',
        '......HHds......',
        '.......ds.......',
        '......ds........',
        '......ds........',
        '.....ds.........',
        '.....ds.........',
        '....ds..........',
        '....ds..........',
        '...d............',
        '................'
    ],
    shovel: [
        '................',
        '.........HHH....',
        '........HHHHH...',
        '........HHHHH...',
        '........HHHHH...',
        '.........HHH....',
        '.........dd.....',
        '........ds......',
        '.......ds.......',
        '......ds........',
        '.....ds.........',
        '.....ds.........',
        '....ds..........',
        '....ds..........',
        '...d............',
        '................'
    ],
    sword: [
        '................',
        '............HH..',
        '...........HHH..',
        '..........HHH...',
        '.........HHH....',
        '........HHH.....',
        '.......HHH......',
        '......HHH.......',
        '.....HHH........',
        '..d.HHH.........',
        '..dsHH..........',
        '.dsdsd..........',
        '..ds.ds.........',
        '.ds...d.........',
        '................',
        '................'
    ]
};
function toolIcon(kind, headHex) {
    // TOOL_ART 는 TEX 테이블보다 아래에 선언되므로 그리는 시점에 조회한다
    return (p, r) => {
        const art = TOOL_ART[kind];
        clear(p);
        const stick = 0xa07c4a, dark = 0x6b4f2a;
        for (let y = 0; y < TILE; y++) {
            const row = art[y];
            for (let x = 0; x < TILE; x++) {
                const ch = row[x];
                if (ch === 'H') p.set(x, y, headHex, 255, ((r() * 2 - 1) * 16) | 0);
                else if (ch === 's') p.set(x, y, stick, 255, ((r() * 2 - 1) * 10) | 0);
                else if (ch === 'd') p.set(x, y, dark, 255, ((r() * 2 - 1) * 10) | 0);
            }
        }
    };
}

/** 주괴 (철·금·구리) */
function ingot(hex, hi) {
    return (p, r) => {
        clear(p);
        for (let y = 5; y <= 10; y++) {
            const inset = y <= 6 ? 4 : y >= 10 ? 3 : 2;
            for (let x = inset; x < TILE - inset; x++) p.set(x, y, hex, 255, ((r() * 2 - 1) * 10) | 0);
        }
        for (let x = 5; x <= 10; x++) p.set(x, 6, hi, 255);
        for (let x = 4; x <= 11; x++) p.set(x, 10, hex, 255, -28);
    };
}
/** 가루 (레드스톤·화약·발광석) */
function dust(hex) {
    return (p, r) => {
        clear(p);
        for (let i = 0; i < 46; i++) {
            const x = 2 + ((r() * 12) | 0), y = 5 + ((r() * 9) | 0);
            p.set(x, y, hex, 255, ((r() * 2 - 1) * 40) | 0);
        }
        for (let x = 3; x < 13; x++) p.set(x, 13, hex, 255, -30);
    };
}

// ---- 아틀라스 빌드 ----
const names = Object.keys(TEX);
const index = new Map();
const pixelCache = new Map();
let canvas = null, texture = null, dataURL = '';

function build() {
    canvas = document.createElement('canvas');
    canvas.width = canvas.height = ATLAS;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    ctx.clearRect(0, 0, ATLAS, ATLAS);

    names.forEach((name, i) => {
        index.set(name, i);
        const buf = newTile();
        const p = mk(buf);
        TEX[name](p, mulberry32(i * 9176 + 13));
        const img = new ImageData(buf, TILE, TILE);
        ctx.putImageData(img, (i % COLS) * TILE, ((i / COLS) | 0) * TILE);
    });

    texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;   // 밉맵 없음 → 타일 블리딩 방지
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    dataURL = canvas.toDataURL('image/png');
}
build();

export const atlas = {
    texture,
    canvas,
    dataURL,
    names,
    /** 아틀라스 인덱스 → 텍스처 이름 */
    nameOf(i) { return names[i]; },
    /** 타일 하나의 픽셀 데이터 (RGBA, 16x16) — 아이템 입체 렌더링용 */
    pixels(i) {
        if (!pixelCache.has(i)) {
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            const c = i % COLS, r = (i / COLS) | 0;
            pixelCache.set(i, ctx.getImageData(c * TILE, r * TILE, TILE, TILE).data);
        }
        return pixelCache.get(i);
    },
    /** 텍스처 이름 → 아틀라스 인덱스 */
    id(name) {
        const i = index.get(name);
        if (i === undefined) throw new Error('unknown texture: ' + name);
        return i;
    },
    /** 인덱스 → [u0, v0, u1, v1] (flipY=true 기준) */
    uv(i) {
        const c = i % COLS, r = (i / COLS) | 0;
        const u0 = c / COLS, u1 = (c + 1) / COLS;
        const v1 = 1 - r / COLS, v0 = 1 - (r + 1) / COLS;
        return [u0, v0, u1, v1];
    },
    /** DOM 아이콘용 CSS (background-position/size) */
    css(i) {
        const c = i % COLS, r = (i / COLS) | 0;
        return {
            backgroundImage: `url(${dataURL})`,
            backgroundSize: `${COLS * 100}% ${COLS * 100}%`,
            backgroundPosition: `${(c / (COLS - 1)) * 100}% ${(r / (COLS - 1)) * 100}%`,
            imageRendering: 'pixelated'
        };
    }
};

export const BREAK_TEX_BASE = atlas.id('break0');
