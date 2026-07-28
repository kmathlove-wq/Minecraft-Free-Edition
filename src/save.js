// ===== 저장 / 불러오기 =====
// v3: 시드 + 변경 블록 + 인벤토리 + 플레이어 상태
// v2(구버전, 색상 기반 블록)도 그대로 읽어들인다.
import { B, blocks } from './blocks.js';

const KEY = 'minecraft_saves';
export const SAVE_VERSION = 3;

// 구버전 v2 의 색상 → 신 블록 id
const LEGACY_COLOR = new Map([
    [0x44aa44, B.GRASS_BLOCK],
    [0x8b5a2b, B.DIRT],
    [0x888888, B.STONE],
    [0x634220, B.OAK_LOG],
    [0x228b22, B.OAK_LEAVES]
]);

export function listSaves() {
    try {
        const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
        return Array.isArray(arr) ? arr : [];
    } catch { return []; }
}
function writeSaves(arr) { localStorage.setItem(KEY, JSON.stringify(arr)); }

export function deleteSave(id) { writeSaves(listSaves().filter(s => s.id !== id)); }

export function renameSave(id, name) {
    const arr = listSaves();
    const s = arr.find(x => x.id === id);
    if (!s) return;
    s.name = name;
    writeSaves(arr);
}

/** 게임 상태를 직렬화 */
export function serialize(game, name, id) {
    const mods = {};
    for (const [ckey, m] of game.world.mods) {
        if (m.size === 0) continue;
        const list = [];
        for (const [lk, blockId] of m) {
            const [lx, y, lz] = lk.split(',');
            list.push(+lx, +y, +lz, blockId);
        }
        mods[ckey] = list;
    }
    const p = game.player;
    return {
        version: SAVE_VERSION,
        id: id ?? Date.now(),
        name: name || new Date().toLocaleString(),
        timestamp: new Date().toLocaleString(),
        seed: game.world.seed,
        time: Math.round(game.sky.time),
        gamemode: p.gamemode,
        player: {
            pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z },
            yaw: p.yaw, pitch: p.pitch,
            health: p.health, food: p.food, saturation: p.saturation, air: p.air,
            spawn: { ...p.spawn }, flying: p.flying
        },
        inventory: game.inventory.toJSON(),
        mods
    };
}

export function saveGame(game, name, id) {
    const data = serialize(game, name, id);
    const arr = listSaves();
    const i = arr.findIndex(s => s.id === data.id);
    if (i >= 0) arr[i] = data; else arr.push(data);
    try {
        writeSaves(arr);
        return data.id;
    } catch (e) {
        alert('저장 실패: 저장 공간이 부족합니다.');
        return null;
    }
}

/** 저장 데이터를 게임에 적용한다 */
export function applySave(game, data) {
    game.world.clear();
    game.mobs.clear();

    if (data.version >= 3) {
        game.world.seed = data.seed ?? 1337;
        game.world.gen.seed = game.world.seed | 0;
        for (const [ckey, list] of Object.entries(data.mods || {})) {
            const m = new Map();
            for (let i = 0; i < list.length; i += 4) m.set(`${list[i]},${list[i + 1]},${list[i + 2]}`, list[i + 3]);
            game.world.mods.set(ckey, m);
        }
        game.inventory.fromJSON(data.inventory);
        game.sky.setTime(data.time ?? 1000);
        const p = data.player;
        game.player.gamemode = data.gamemode || 'survival';
        game.player.pos = { ...p.pos };
        game.player.yaw = p.yaw ?? 0;
        game.player.pitch = p.pitch ?? 0;
        game.player.health = p.health ?? 20;
        game.player.food = p.food ?? 20;
        game.player.saturation = p.saturation ?? 5;
        game.player.air = p.air ?? 300;
        game.player.spawn = p.spawn ?? { ...p.pos };
        game.player.flying = !!p.flying && game.player.gamemode === 'creative';
    } else {
        // ---- 구버전 v2 ----
        for (const mod of (data.mods || [])) {
            const wx = Math.round(mod.p.x), wy = Math.round(mod.p.y), wz = Math.round(mod.p.z);
            const id = mod.c === null ? 0 : (LEGACY_COLOR.get(mod.c) ?? B.STONE);
            const cx = Math.floor(wx / 16), cz = Math.floor(wz / 16);
            const key = cx + ',' + cz;
            let m = game.world.mods.get(key);
            if (!m) { m = new Map(); game.world.mods.set(key, m); }
            m.set(`${wx - cx * 16},${wy},${wz - cz * 16}`, id);
        }
        const p = data.player || { pos: { x: 8, y: 80, z: 8 }, rot: { x: 0, y: 0 } };
        game.player.pos = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
        game.player.yaw = p.rot?.y ?? 0;
        game.player.pitch = p.rot?.x ?? 0;
        game.player.spawn = { ...game.player.pos };
        game.sky.setTime(1000);
    }

    game.player.vel = { x: 0, y: 0, z: 0 };
    game.player.dead = false;

    // 지형 로드 후 지면 위로 올려 끼임 방지
    game.world.forceLoad(game.player.pos.x, game.player.pos.z, 2);
    const gy = game.world.surfaceY(Math.floor(game.player.pos.x), Math.floor(game.player.pos.z));
    if (game.player.pos.y < gy - 1 || game.player.pos.y > 200) game.player.pos.y = gy + 0.1;
}
