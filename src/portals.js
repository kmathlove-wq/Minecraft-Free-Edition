// ===== 차원문: 네더 포털 생성 · 엔드 포털 · 차원 이동 =====
import { B, blocks, AIR } from './blocks.js';
import { MIN_Y, MAX_Y } from './worldgen.js';
import { NETHER_LAVA, NETHER_ROOF, END_Y, DIMENSIONS } from './dimensions.js';

const NETHER_SCALE = 8;          // 마인크래프트와 동일한 1:8 비율

/**
 * 부싯돌과 부시로 불을 붙였을 때, 그 자리가 흑요석 틀 안이면 네더 차원문을 만든다.
 * 틀은 마인크래프트처럼 내부 2×3 이상, XY 또는 ZY 평면.
 * @returns {boolean} 차원문이 만들어졌으면 true
 */
export function tryLightPortal(world, x, y, z) {
    for (const axis of ['x', 'z']) {
        const inner = findPortalInterior(world, x, y, z, axis);
        if (!inner) continue;
        for (const [px, py, pz] of inner) world.setBlock(px, py, pz, B.NETHER_PORTAL);
        return true;
    }
    return false;
}

/** (x,y,z) 를 포함하는 빈 공간이 흑요석으로 완전히 둘러싸였는지 확인하고 내부 칸을 돌려준다 */
function findPortalInterior(world, x, y, z, axis) {
    const du = axis === 'x' ? [1, 0, 0] : [0, 0, 1];   // 가로 방향
    const isFrame = (a, b, c) => world.getBlock(a, b, c) === B.OBSIDIAN;
    const isEmpty = (a, b, c) => {
        const id = world.getBlock(a, b, c);
        return id === AIR || id === B.FIRE || id === B.NETHER_PORTAL;
    };
    if (!isEmpty(x, y, z)) return null;

    // 바닥 찾기
    let by = y;
    while (by > MIN_Y + 1 && isEmpty(x, by - 1, z)) by--;
    if (!isFrame(x, by - 1, z)) return null;

    // 가로 범위
    let u0 = 0, u1 = 0;
    while (u0 > -21 && isEmpty(x + du[0] * (u0 - 1), by, z + du[2] * (u0 - 1))) u0--;
    while (u1 < 21 && isEmpty(x + du[0] * (u1 + 1), by, z + du[2] * (u1 + 1))) u1++;
    const width = u1 - u0 + 1;
    if (width < 2 || width > 21) return null;

    // 세로 범위
    let h = 0;
    while (h < 21 && isEmpty(x, by + h, z)) h++;
    if (h < 3 || h > 21) return null;

    const cells = [];
    for (let u = u0; u <= u1; u++) {
        const cx = x + du[0] * u, cz = z + du[2] * u;
        // 좌우 기둥
        if (u === u0 && !isFrame(cx - du[0], by, cz - du[2])) return null;
        if (u === u1 && !isFrame(cx + du[0], by, cz + du[2])) return null;
        for (let k = 0; k < h; k++) {
            if (!isEmpty(cx, by + k, cz)) return null;
            if (!isFrame(cx - du[0] * (u === u0 ? 1 : 0), by + k, cz - du[2] * (u === u0 ? 1 : 0))) {
                if (u === u0) return null;
            }
            if (u === u1 && !isFrame(cx + du[0], by + k, cz + du[2])) return null;
            cells.push([cx, by + k, cz]);
        }
        if (!isFrame(cx, by - 1, cz)) return null;      // 아래 틀
        if (!isFrame(cx, by + h, cz)) return null;      // 위 틀
    }
    return cells;
}

/** 흑요석 4×5 틀을 세우고 안을 차원문으로 채운다 (도착지에 포털이 없을 때) */
export function buildPortal(world, x, y, z, axis = 'x') {
    const du = axis === 'x' ? [1, 0, 0] : [0, 0, 1];
    for (let u = -1; u <= 2; u++) {
        for (let k = -1; k <= 3; k++) {
            const px = x + du[0] * u, pz = z + du[2] * u, py = y + k;
            const edge = (u === -1 || u === 2 || k === -1 || k === 3);
            if (edge) world.setBlock(px, py, pz, B.OBSIDIAN);
            else world.setBlock(px, py, pz, B.NETHER_PORTAL);
        }
    }
    // 차원문 아래에 발판이 없으면 채운다
    for (let u = -1; u <= 2; u++) {
        const bx = x + du[0] * u, bz = z + du[2] * u;
        if (!world.isSolid(bx, y - 2, bz)) world.setBlock(bx, y - 2, bz, B.OBSIDIAN);
    }
}

/** 목적지 차원에서 안전한 착지 지점을 찾는다 */
function findLanding(world, x, z, dim) {
    const lo = dim === 'nether' ? NETHER_LAVA + 2 : MIN_Y + 2;
    const hi = dim === 'nether' ? NETHER_ROOF - 4 : MAX_Y - 4;
    let best = null, bestD = Infinity;
    const preferred = dim === 'nether' ? 70 : dim === 'end' ? END_Y + 1 : 70;
    for (let y = lo; y <= hi; y++) {
        if (world.getBlock(x, y, z) !== AIR || world.getBlock(x, y + 1, z) !== AIR) continue;
        const below = world.getBlock(x, y - 1, z);
        if (below === AIR || blocks[below].render === 'liquid') continue;
        const d = Math.abs(y - preferred);
        if (d < bestD) { bestD = d; best = y; }
    }
    return best;
}

/**
 * 차원 이동. 좌표 축척(네더 1:8)을 적용하고 도착지에 포털을 만든다.
 * @returns {{x,y,z}} 새 위치
 */
export function travel(game, from, to) {
    const world = game.world, player = game.player;
    let x = Math.floor(player.pos.x), z = Math.floor(player.pos.z);

    if (from === 'overworld' && to === 'nether') { x = Math.round(x / NETHER_SCALE); z = Math.round(z / NETHER_SCALE); }
    else if (from === 'nether' && to === 'overworld') { x *= NETHER_SCALE; z *= NETHER_SCALE; }
    else if (to === 'end') { x = 0; z = 0; }

    world.setDimension(to);
    game.sky.setDimension(to);
    world.forceLoad(x, z, 2);

    // 기존 차원문 찾기 (반경 24)
    let px = null, py = null, pz = null;
    outer: for (let r = 0; r <= 24; r += 2) {
        for (let dx = -r; dx <= r; dx += 2)
            for (let dz = -r; dz <= r; dz += 2) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) !== r && r > 0) continue;
                const sx = x + dx, sz = z + dz;
                for (let y = MIN_Y + 2; y <= MAX_Y - 2; y++) {
                    if (world.getBlock(sx, y, sz) === B.NETHER_PORTAL) { px = sx; py = y; pz = sz; break outer; }
                }
            }
    }

    if (px === null) {
        const y = findLanding(world, x, z, to) ?? (DIMENSIONS[to].spawnY ?? 70);
        if (to !== 'end') {
            // 착지 지점에 발판을 깔고 그 위에 차원문을 세운다
            const ground = to === 'nether' ? B.NETHERRACK : B.STONE;
            for (let dx = -3; dx <= 4; dx++)
                for (let dz = -3; dz <= 3; dz++) {
                    world.setBlock(x + dx, y, z + dz, ground);
                    for (let k = 1; k <= 4; k++) world.setBlock(x + dx, y + k, z + dz, AIR);
                }
            buildPortal(world, x, y + 1, z, 'x');
            px = x; py = y + 1; pz = z;
        } else {
            // 엔드는 섬 위에 흑요석 플랫폼
            for (let dx = -3; dx <= 3; dx++)
                for (let dz = -3; dz <= 3; dz++) {
                    world.setBlock(x + dx, END_Y, z + dz, B.OBSIDIAN);
                    for (let k = 1; k <= 4; k++) world.setBlock(x + dx, END_Y + k, z + dz, AIR);
                }
            px = x; py = END_Y + 1; pz = z;
        }
    }

    // 차원문 안에 서면 화면이 가려지므로 바로 앞의 빈 칸으로 내보낸다
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1]]) {
        const ax = px + dx, az = pz + dz;
        if (world.getBlock(ax, py, az) === AIR && world.getBlock(ax, py + 1, az) === AIR
            && world.isSolid(ax, py - 1, az)) { px = ax; pz = az; break; }
    }

    player.pos = { x: px + 0.5, y: py, z: pz + 0.5 };
    player.vel = { x: 0, y: 0, z: 0 };
    player.fallStart = null;
    world.forceLoad(px, pz, 2);
    return player.pos;
}

/** 엔드 차원문 틀 12개가 모두 채워졌는지 확인하고 3×3 차원문을 연다 */
export function tryActivateEndPortal(world, x, y, z) {
    // (x,y,z) 는 방금 눈을 끼운 틀. 주변에서 3×3 중심을 찾는다
    for (let dx = -3; dx <= 3; dx++) {
        for (let dz = -3; dz <= 3; dz++) {
            const cx = x + dx, cz = z + dz;
            let ok = true;
            const frames = [];
            for (let fx = -2; fx <= 2 && ok; fx++) {
                for (let fz = -2; fz <= 2; fz++) {
                    const edge = Math.abs(fx) === 2 || Math.abs(fz) === 2;
                    const corner = Math.abs(fx) === 2 && Math.abs(fz) === 2;
                    if (corner) continue;
                    const id = world.getBlock(cx + fx, y, cz + fz);
                    if (edge) {
                        if (id !== B.END_PORTAL_FRAME_EYE) { ok = false; break; }
                        frames.push([cx + fx, cz + fz]);
                    } else if (id !== AIR && id !== B.END_PORTAL) { ok = false; break; }
                }
            }
            if (ok && frames.length === 12) {
                for (let fx = -1; fx <= 1; fx++)
                    for (let fz = -1; fz <= 1; fz++)
                        world.setBlock(cx + fx, y, cz + fz, B.END_PORTAL);
                return true;
            }
        }
    }
    return false;
}
