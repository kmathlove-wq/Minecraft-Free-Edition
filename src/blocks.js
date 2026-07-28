// ===== 블록 · 아이템 · 조합법 레지스트리 =====
// 실제 마인크래프트의 경도(hardness), 도구 등급, 채굴 속도 규칙을 따른다.
//   채굴 시간 = 경도 × (알맞은 도구 1.5 / 맨손·부적합 5) ÷ 도구속도
//   도구 속도: 나무 2, 돌 4, 철 6, 다이아 8, 금 12
import { atlas } from './textures.js';

export const AIR = 0;

// 면 순서: 0:+X 1:-X 2:+Y(위) 3:-Y(아래) 4:+Z 5:-Z
export const FACES = 6;

export const TOOL = { NONE: 'none', PICKAXE: 'pickaxe', AXE: 'axe', SHOVEL: 'shovel', SWORD: 'sword' };
export const TIER = { NONE: 0, WOOD: 1, STONE: 2, IRON: 3, DIAMOND: 4 };

export const blocks = [];
const blockByName = new Map();

const T = n => atlas.id(n);

function def(name, o = {}) {
    const id = blocks.length;
    const side = o.side ?? o.all;
    const b = {
        id, name,
        display: o.display ?? name,
        // 6면 텍스처 인덱스
        tex: [
            T(o.east ?? o.front ?? side), T(o.west ?? side),
            T(o.top ?? side), T(o.bottom ?? o.top ?? side),
            T(o.south ?? side), T(o.north ?? side)
        ],
        render: o.render ?? 'cube',        // cube | cross | liquid | none
        solid: o.solid ?? true,            // 충돌 여부
        opaque: o.opaque ?? (o.render ?? 'cube') === 'cube',  // 면 컬링 · 빛 차단
        cullSame: o.cullSame ?? true,      // 같은 블록끼리 맞닿은 면 제거
        hardness: o.hardness ?? 1,         // -1 이면 파괴 불가
        tool: o.tool ?? TOOL.NONE,
        tier: o.tier ?? TIER.NONE,         // 드롭에 필요한 최소 도구 등급
        light: o.light ?? 0,               // 자체 발광 (0~15)
        // 하늘빛이 그대로 통과하는지. 물·잎은 통과시키지 않고 한 칸마다 감쇠시킨다
        // (마인크래프트와 동일하게 깊은 물속과 나무 밑이 어두워진다)
        blocksSky: o.blocksSky ?? (o.opaque ?? (o.render ?? 'cube') === 'cube'),
        tint: o.tint ?? null,              // 'grass' | 'foliage'  → 바이옴 색 적용
        tintFace: o.tintFace ?? 'all',     // 'top' 이면 윗면만 틴트
        drop: o.drop ?? name,              // 드롭 아이템 id (null 이면 없음)
        dropCount: o.dropCount ?? 1,
        gravity: o.gravity ?? false,       // 모래·자갈 낙하
        liquid: o.render === 'liquid',
        placeable: o.placeable ?? true,
        needsSupport: o.needsSupport ?? false,
        stepSound: o.stepSound ?? 'stone'
    };
    blocks.push(b);
    blockByName.set(name, b);
    return id;
}

// ---- 블록 정의 ----
export const B = {};
B.AIR = def('air', {
    display: '공기', all: 'stone', render: 'none', solid: false, opaque: false,
    hardness: -1, drop: null, placeable: false
});
B.STONE = def('stone', { display: '돌', all: 'stone', hardness: 1.5, tool: TOOL.PICKAXE, tier: TIER.WOOD, drop: 'cobblestone' });
B.DIRT = def('dirt', { display: '흙', all: 'dirt', hardness: 0.5, tool: TOOL.SHOVEL, stepSound: 'grass' });
B.GRASS_BLOCK = def('grass_block', {
    display: '잔디 블록', top: 'grass_top', side: 'grass_side', bottom: 'dirt',
    hardness: 0.6, tool: TOOL.SHOVEL, drop: 'dirt', tint: 'grass', tintFace: 'top', stepSound: 'grass'
});
B.SNOWY_GRASS = def('snowy_grass_block', {
    display: '눈 덮인 잔디', top: 'snow', side: 'grass_side_snow', bottom: 'dirt',
    hardness: 0.6, tool: TOOL.SHOVEL, drop: 'dirt', stepSound: 'snow'
});
B.COBBLESTONE = def('cobblestone', { display: '조약돌', all: 'cobblestone', hardness: 2, tool: TOOL.PICKAXE, tier: TIER.WOOD });
B.BEDROCK = def('bedrock', { display: '기반암', all: 'bedrock', hardness: -1, drop: null });
B.SAND = def('sand', { display: '모래', all: 'sand', hardness: 0.5, tool: TOOL.SHOVEL, gravity: true, stepSound: 'sand' });
B.GRAVEL = def('gravel', { display: '자갈', all: 'gravel', hardness: 0.6, tool: TOOL.SHOVEL, gravity: true, stepSound: 'gravel' });
B.CLAY = def('clay', { display: '점토', all: 'clay', hardness: 0.6, tool: TOOL.SHOVEL, drop: 'clay_ball', dropCount: 4 });
B.WATER = def('water', {
    display: '물', all: 'water', render: 'liquid', solid: false, opaque: false,
    blocksSky: true, hardness: -1, drop: null, placeable: false
});
B.LAVA = def('lava', {
    display: '용암', all: 'lava', render: 'liquid', solid: false, opaque: false,
    hardness: -1, light: 15, drop: null, placeable: false
});
B.OAK_LOG = def('oak_log', { display: '참나무 원목', top: 'oak_log_top', side: 'oak_log_side', hardness: 2, tool: TOOL.AXE, stepSound: 'wood' });
B.OAK_LEAVES = def('oak_leaves', {
    display: '참나무 잎', all: 'oak_leaves', hardness: 0.2, tool: TOOL.NONE,
    opaque: false, cullSame: false, blocksSky: true, tint: 'foliage', drop: null, stepSound: 'grass'
});
B.OAK_PLANKS = def('oak_planks', { display: '참나무 판자', all: 'oak_planks', hardness: 2, tool: TOOL.AXE, stepSound: 'wood' });
B.SPRUCE_LOG = def('spruce_log', { display: '가문비나무 원목', top: 'spruce_log_top', side: 'spruce_log_side', hardness: 2, tool: TOOL.AXE, stepSound: 'wood' });
B.SPRUCE_LEAVES = def('spruce_leaves', {
    display: '가문비나무 잎', all: 'spruce_leaves', hardness: 0.2,
    opaque: false, cullSame: false, blocksSky: true, tint: 'foliage', drop: null, stepSound: 'grass'
});
B.SPRUCE_PLANKS = def('spruce_planks', { display: '가문비나무 판자', all: 'spruce_planks', hardness: 2, tool: TOOL.AXE, stepSound: 'wood' });
B.BIRCH_LOG = def('birch_log', { display: '자작나무 원목', top: 'birch_log_top', side: 'birch_log_side', hardness: 2, tool: TOOL.AXE, stepSound: 'wood' });
B.BIRCH_LEAVES = def('birch_leaves', {
    display: '자작나무 잎', all: 'birch_leaves', hardness: 0.2,
    opaque: false, cullSame: false, blocksSky: true, tint: 'foliage', drop: null, stepSound: 'grass'
});
B.BIRCH_PLANKS = def('birch_planks', { display: '자작나무 판자', all: 'birch_planks', hardness: 2, tool: TOOL.AXE, stepSound: 'wood' });

B.COAL_ORE = def('coal_ore', { display: '석탄 광석', all: 'coal_ore', hardness: 3, tool: TOOL.PICKAXE, tier: TIER.WOOD, drop: 'coal' });
B.IRON_ORE = def('iron_ore', { display: '철 광석', all: 'iron_ore', hardness: 3, tool: TOOL.PICKAXE, tier: TIER.STONE, drop: 'raw_iron' });
B.COPPER_ORE = def('copper_ore', { display: '구리 광석', all: 'copper_ore', hardness: 3, tool: TOOL.PICKAXE, tier: TIER.STONE, drop: 'raw_copper', dropCount: 3 });
B.GOLD_ORE = def('gold_ore', { display: '금 광석', all: 'gold_ore', hardness: 3, tool: TOOL.PICKAXE, tier: TIER.IRON, drop: 'raw_gold' });
B.REDSTONE_ORE = def('redstone_ore', { display: '레드스톤 광석', all: 'redstone_ore', hardness: 3, tool: TOOL.PICKAXE, tier: TIER.IRON, drop: 'redstone', dropCount: 4 });
B.LAPIS_ORE = def('lapis_ore', { display: '청금석 광석', all: 'lapis_ore', hardness: 3, tool: TOOL.PICKAXE, tier: TIER.STONE, drop: 'lapis_lazuli', dropCount: 6 });
B.DIAMOND_ORE = def('diamond_ore', { display: '다이아몬드 광석', all: 'diamond_ore', hardness: 3, tool: TOOL.PICKAXE, tier: TIER.IRON, drop: 'diamond' });
B.EMERALD_ORE = def('emerald_ore', { display: '에메랄드 광석', all: 'emerald_ore', hardness: 3, tool: TOOL.PICKAXE, tier: TIER.IRON, drop: 'emerald' });

B.GLASS = def('glass', { display: '유리', all: 'glass', hardness: 0.3, opaque: false, drop: null, stepSound: 'stone' });
B.SANDSTONE = def('sandstone', { display: '사암', top: 'sandstone_top', side: 'sandstone_side', bottom: 'sandstone_top', hardness: 0.8, tool: TOOL.PICKAXE, tier: TIER.WOOD });
B.SNOW_BLOCK = def('snow_block', { display: '눈 블록', all: 'snow', hardness: 0.2, tool: TOOL.SHOVEL, stepSound: 'snow' });
B.ICE = def('ice', { display: '얼음', all: 'ice', hardness: 0.5, tool: TOOL.PICKAXE, opaque: false, blocksSky: true, drop: null, stepSound: 'stone' });
B.CACTUS = def('cactus', { display: '선인장', top: 'cactus_top', side: 'cactus_side', bottom: 'cactus_top', hardness: 0.4, opaque: false, cullSame: false, needsSupport: true, stepSound: 'grass' });
B.BRICKS = def('bricks', { display: '벽돌', all: 'bricks', hardness: 2, tool: TOOL.PICKAXE, tier: TIER.WOOD });
B.STONE_BRICKS = def('stone_bricks', { display: '석재 벽돌', all: 'stone_bricks', hardness: 1.5, tool: TOOL.PICKAXE, tier: TIER.WOOD });
B.MOSSY_COBBLESTONE = def('mossy_cobblestone', { display: '이끼 낀 조약돌', all: 'mossy_cobblestone', hardness: 2, tool: TOOL.PICKAXE, tier: TIER.WOOD });
B.OBSIDIAN = def('obsidian', { display: '흑요석', all: 'obsidian', hardness: 50, tool: TOOL.PICKAXE, tier: TIER.DIAMOND });
B.GLOWSTONE = def('glowstone', { display: '발광석', all: 'glowstone', hardness: 0.3, light: 15, drop: 'glowstone_dust', dropCount: 4 });
B.TNT = def('tnt', { display: 'TNT', top: 'tnt_top', side: 'tnt_side', bottom: 'tnt_bottom', hardness: 0 });
B.BOOKSHELF = def('bookshelf', { display: '책장', top: 'oak_planks', side: 'bookshelf', bottom: 'oak_planks', hardness: 1.5, tool: TOOL.AXE, drop: 'book', dropCount: 3, stepSound: 'wood' });
B.CRAFTING_TABLE = def('crafting_table', { display: '제작대', top: 'crafting_top', side: 'crafting_side', front: 'crafting_front', bottom: 'oak_planks', hardness: 2.5, tool: TOOL.AXE, stepSound: 'wood' });
B.FURNACE = def('furnace', { display: '화로', top: 'furnace_top', side: 'furnace_side', front: 'furnace_front', bottom: 'furnace_top', hardness: 3.5, tool: TOOL.PICKAXE, tier: TIER.WOOD });
B.IRON_BLOCK = def('iron_block', { display: '철 블록', all: 'iron_block', hardness: 5, tool: TOOL.PICKAXE, tier: TIER.STONE });
B.GOLD_BLOCK = def('gold_block', { display: '금 블록', all: 'gold_block', hardness: 3, tool: TOOL.PICKAXE, tier: TIER.IRON });
B.DIAMOND_BLOCK = def('diamond_block', { display: '다이아몬드 블록', all: 'diamond_block', hardness: 5, tool: TOOL.PICKAXE, tier: TIER.IRON });
B.COAL_BLOCK = def('coal_block', { display: '석탄 블록', all: 'coal_block', hardness: 5, tool: TOOL.PICKAXE, tier: TIER.WOOD });
B.NETHERRACK = def('netherrack', { display: '네더랙', all: 'netherrack', hardness: 0.4, tool: TOOL.PICKAXE, tier: TIER.WOOD });
B.PUMPKIN = def('pumpkin', { display: '호박', top: 'pumpkin_top', side: 'pumpkin_side', hardness: 1, tool: TOOL.AXE });
B.MELON = def('melon', { display: '수박', all: 'melon_side', hardness: 1, tool: TOOL.AXE });

B.WHITE_WOOL = def('white_wool', { display: '하얀 양털', all: 'wool_white', hardness: 0.8, stepSound: 'wool' });
B.RED_WOOL = def('red_wool', { display: '빨간 양털', all: 'wool_red', hardness: 0.8, stepSound: 'wool' });
B.BLUE_WOOL = def('blue_wool', { display: '파란 양털', all: 'wool_blue', hardness: 0.8, stepSound: 'wool' });
B.YELLOW_WOOL = def('yellow_wool', { display: '노란 양털', all: 'wool_yellow', hardness: 0.8, stepSound: 'wool' });
B.GREEN_WOOL = def('green_wool', { display: '초록 양털', all: 'wool_green', hardness: 0.8, stepSound: 'wool' });
B.BLACK_WOOL = def('black_wool', { display: '검은 양털', all: 'wool_black', hardness: 0.8, stepSound: 'wool' });

B.TORCH = def('torch', {
    display: '횃불', all: 'torch_tex', render: 'cross', solid: false, opaque: false,
    hardness: 0, light: 14, needsSupport: true, stepSound: 'wood'
});
B.SHORT_GRASS = def('short_grass', {
    display: '풀', all: 'short_grass', render: 'cross', solid: false, opaque: false,
    hardness: 0, tint: 'grass', drop: null, needsSupport: true, stepSound: 'grass'
});
B.DANDELION = def('dandelion', { display: '민들레', all: 'dandelion', render: 'cross', solid: false, opaque: false, hardness: 0, needsSupport: true, stepSound: 'grass' });
B.POPPY = def('poppy', { display: '양귀비', all: 'poppy', render: 'cross', solid: false, opaque: false, hardness: 0, needsSupport: true, stepSound: 'grass' });
B.CORNFLOWER = def('cornflower', { display: '수레국화', all: 'cornflower', render: 'cross', solid: false, opaque: false, hardness: 0, needsSupport: true, stepSound: 'grass' });
B.OAK_SAPLING = def('oak_sapling', { display: '참나무 묘목', all: 'oak_sapling', render: 'cross', solid: false, opaque: false, hardness: 0, needsSupport: true, stepSound: 'grass' });
B.DEAD_BUSH = def('dead_bush', { display: '죽은 덤불', all: 'dead_bush', render: 'cross', solid: false, opaque: false, hardness: 0, drop: 'stick', needsSupport: true, stepSound: 'grass' });
B.SUGAR_CANE = def('sugar_cane', { display: '사탕수수', all: 'sugar_cane', render: 'cross', solid: false, opaque: false, hardness: 0, needsSupport: true, stepSound: 'grass' });
B.FARMLAND = def('farmland', { display: '경작지', top: 'farmland', side: 'dirt', bottom: 'dirt', hardness: 0.6, tool: TOOL.SHOVEL, drop: 'dirt', stepSound: 'grass' });

export function block(id) { return blocks[id]; }
export function blockByNameOf(name) { return blockByName.get(name); }

// 렌더/물리 판정용 룩업 테이블 (핫 루프에서 객체 접근 대신 사용)
export const IS_OPAQUE = new Uint8Array(blocks.length);
export const BLOCKS_SKY = new Uint8Array(blocks.length);
export const IS_SOLID = new Uint8Array(blocks.length);
export const LIGHT_EMIT = new Uint8Array(blocks.length);
export const RENDER_KIND = new Uint8Array(blocks.length); // 0 none 1 cube 2 cross 3 liquid
for (const b of blocks) {
    IS_OPAQUE[b.id] = b.opaque ? 1 : 0;
    BLOCKS_SKY[b.id] = b.blocksSky ? 1 : 0;
    IS_SOLID[b.id] = b.solid && b.render !== 'none' ? 1 : 0;
    LIGHT_EMIT[b.id] = b.light;
    RENDER_KIND[b.id] = { none: 0, cube: 1, cross: 2, liquid: 3 }[b.render];
}

// ================== 아이템 ==================
export const items = new Map();

function item(id, o) {
    const it = {
        id,
        display: o.display ?? id,
        tex: T(o.tex),
        maxStack: o.maxStack ?? 64,
        block: o.block ?? null,       // 설치 가능한 블록 id
        tool: o.tool ?? null,         // { type, tier, speed, durability }
        food: o.food ?? null,         // { hunger, saturation }
        damage: o.damage ?? 1,        // 공격력
        fuel: o.fuel ?? 0             // 화로 연료 시간(초)
    };
    items.set(id, it);
    return it;
}

// 블록 아이템 자동 등록
for (const b of blocks) {
    if (!b.placeable || b.id === AIR) continue;
    item(b.name, {
        display: b.display,
        tex: atlas.nameOf(b.tex[0]),   // 아이콘은 옆면 텍스처 사용
        block: b.id,
        fuel: /planks|log|crafting_table|bookshelf/.test(b.name) ? 15 : 0,
        damage: 1
    });
}

// 원자재
item('stick', { display: '막대기', tex: 'item_stick', fuel: 5 });
item('coal', { display: '석탄', tex: 'item_coal', fuel: 80 });
item('charcoal', { display: '목탄', tex: 'item_coal', fuel: 80 });
item('raw_iron', { display: '철 원석', tex: 'item_iron' });
item('iron_ingot', { display: '철괴', tex: 'item_iron' });
item('raw_copper', { display: '구리 원석', tex: 'item_gold' });
item('copper_ingot', { display: '구리 주괴', tex: 'item_gold' });
item('raw_gold', { display: '금 원석', tex: 'item_gold' });
item('gold_ingot', { display: '금괴', tex: 'item_gold' });
item('diamond', { display: '다이아몬드', tex: 'item_diamond' });
item('emerald', { display: '에메랄드', tex: 'item_emerald' });
item('lapis_lazuli', { display: '청금석', tex: 'item_lapis' });
item('redstone', { display: '레드스톤 가루', tex: 'item_redstone' });
item('glowstone_dust', { display: '발광석 가루', tex: 'item_gold' });
item('clay_ball', { display: '점토 덩이', tex: 'item_leather' });
item('brick', { display: '벽돌', tex: 'item_beef' });
item('paper', { display: '종이', tex: 'item_bread' });
item('book', { display: '책', tex: 'item_leather' });
item('leather', { display: '가죽', tex: 'item_leather' });
item('string', { display: '실', tex: 'item_string' });
item('bone', { display: '뼈', tex: 'item_bone' });
item('feather', { display: '깃털', tex: 'item_feather' });
item('gunpowder', { display: '화약', tex: 'item_redstone' });
item('rotten_flesh', { display: '썩은 살점', tex: 'item_beef', food: { hunger: 4, saturation: 0.8 } });

// 음식
item('apple', { display: '사과', tex: 'item_apple', food: { hunger: 4, saturation: 2.4 } });
item('bread', { display: '빵', tex: 'item_bread', food: { hunger: 5, saturation: 6 } });
item('beef', { display: '소고기', tex: 'item_beef', food: { hunger: 3, saturation: 1.8 } });
item('cooked_beef', { display: '스테이크', tex: 'item_cooked_beef', food: { hunger: 8, saturation: 12.8 } });
item('porkchop', { display: '돼지고기', tex: 'item_porkchop', food: { hunger: 3, saturation: 1.8 } });
item('cooked_porkchop', { display: '익힌 돼지고기', tex: 'item_cooked_beef', food: { hunger: 8, saturation: 12.8 } });
item('chicken', { display: '닭고기', tex: 'item_porkchop', food: { hunger: 2, saturation: 1.2 } });
item('cooked_chicken', { display: '구운 닭고기', tex: 'item_cooked_beef', food: { hunger: 6, saturation: 7.2 } });

// 도구 (속도/내구도는 마인크래프트 값)
const TOOL_MAT = {
    wooden: { tier: TIER.WOOD, speed: 2, dur: 59, mat: 'oak_planks', dmg: 0 },
    stone: { tier: TIER.STONE, speed: 4, dur: 131, mat: 'cobblestone', dmg: 1 },
    iron: { tier: TIER.IRON, speed: 6, dur: 250, mat: 'iron_ingot', dmg: 2 },
    golden: { tier: TIER.WOOD, speed: 12, dur: 32, mat: 'gold_ingot', dmg: 0 },
    diamond: { tier: TIER.DIAMOND, speed: 8, dur: 1561, mat: 'diamond', dmg: 3 }
};
const TOOL_ICON = {
    wooden: { pickaxe: 'tool_wood_pick', axe: 'tool_wood_axe', shovel: 'tool_wood_shovel', sword: 'tool_wood_sword' },
    stone: { pickaxe: 'tool_stone_pick', axe: 'tool_stone_axe', shovel: 'tool_stone_shovel', sword: 'tool_stone_sword' },
    iron: { pickaxe: 'tool_iron_pick', axe: 'tool_iron_axe', shovel: 'tool_iron_shovel', sword: 'tool_iron_sword' },
    golden: { pickaxe: 'tool_gold_pick', axe: 'tool_iron_axe', shovel: 'tool_iron_shovel', sword: 'tool_iron_sword' },
    diamond: { pickaxe: 'tool_diamond_pick', axe: 'tool_diamond_axe', shovel: 'tool_diamond_shovel', sword: 'tool_diamond_sword' }
};
const TOOL_BASE_DMG = { pickaxe: 2, axe: 3, shovel: 1, sword: 4 };

export const TOOL_MATERIALS = TOOL_MAT;

for (const [mat, m] of Object.entries(TOOL_MAT)) {
    for (const kind of ['pickaxe', 'axe', 'shovel', 'sword']) {
        item(`${mat}_${kind}`, {
            display: `${{ wooden: '나무', stone: '돌', iron: '철', golden: '금', diamond: '다이아몬드' }[mat]} ${{ pickaxe: '곡괭이', axe: '도끼', shovel: '삽', sword: '검' }[kind]}`,
            tex: TOOL_ICON[mat][kind],
            maxStack: 1,
            tool: { type: kind, tier: m.tier, speed: m.speed, durability: m.dur },
            damage: TOOL_BASE_DMG[kind] + m.dmg,
            fuel: mat === 'wooden' ? 10 : 0
        });
    }
}

export function itemOf(id) { return items.get(id); }

// ================== 채굴 시간 ==================
/**
 * 실제 마인크래프트 공식.
 * @returns 초 단위 파괴 시간 (Infinity 면 파괴 불가)
 */
export function breakTime(blk, heldItem) {
    if (blk.hardness < 0) return Infinity;
    if (blk.hardness === 0) return 0;
    const tool = heldItem?.tool ?? null;
    const correct = blk.tool !== TOOL.NONE && tool && tool.type === blk.tool;
    const speed = correct ? tool.speed : 1;
    const canHarvest = blk.tier === TIER.NONE || (tool && correct && tool.tier >= blk.tier);
    return (blk.hardness * (canHarvest ? 1.5 : 5)) / speed;
}
export function canHarvest(blk, heldItem) {
    if (blk.tier === TIER.NONE) return true;
    const tool = heldItem?.tool ?? null;
    return !!(tool && tool.type === blk.tool && tool.tier >= blk.tier);
}

// ================== 조합법 ==================
// shaped: shape 배열 + key, shapeless: ingredients 배열
export const recipes = [];
function shaped(out, count, shape, key, size = 3) { recipes.push({ out, count, shape, key, size, shapeless: false }); }
function shapeless(out, count, ingredients) { recipes.push({ out, count, ingredients, shapeless: true }); }

// 판자 / 막대기
for (const [log, plank] of [['oak_log', 'oak_planks'], ['spruce_log', 'spruce_planks'], ['birch_log', 'birch_planks']])
    shapeless(plank, 4, [log]);
const PLANKS = ['oak_planks', 'spruce_planks', 'birch_planks'];
for (const p of PLANKS) {
    shaped('stick', 4, ['P', 'P'], { P: p }, 2);
    shaped('crafting_table', 1, ['PP', 'PP'], { P: p }, 2);
}
shaped('furnace', 1, ['CCC', 'C C', 'CCC'], { C: 'cobblestone' });
shaped('torch', 4, ['C', 'S'], { C: 'coal', S: 'stick' }, 2);
shaped('torch', 4, ['C', 'S'], { C: 'charcoal', S: 'stick' }, 2);
shaped('stone_bricks', 4, ['SS', 'SS'], { S: 'stone' }, 2);
shaped('bricks', 1, ['BB', 'BB'], { B: 'brick' }, 2);
shaped('bookshelf', 1, ['PPP', 'BBB', 'PPP'], { P: 'oak_planks', B: 'book' });
shaped('book', 1, ['PP', 'PL'], { P: 'paper', L: 'leather' }, 2);
shaped('paper', 3, ['SSS'], { S: 'sugar_cane' });
shaped('white_wool', 1, ['SS', 'SS'], { S: 'string' }, 2);
shaped('tnt', 1, ['GSG', 'SGS', 'GSG'], { G: 'gunpowder', S: 'sand' });
shaped('glowstone', 1, ['DD', 'DD'], { D: 'glowstone_dust' }, 2);

// 압축 블록 + 되돌리기
for (const [ing, blk] of [['iron_ingot', 'iron_block'], ['gold_ingot', 'gold_block'], ['diamond', 'diamond_block'], ['coal', 'coal_block']]) {
    shaped(blk, 1, ['III', 'III', 'III'], { I: ing });
    shapeless(ing, 9, [blk]);
}

// 도구
for (const [mat, m] of Object.entries(TOOL_MAT)) {
    const M = m.mat;
    if (mat === 'wooden') {
        for (const p of PLANKS) {
            shaped(`${mat}_pickaxe`, 1, ['MMM', ' S ', ' S '], { M: p, S: 'stick' });
            shaped(`${mat}_axe`, 1, ['MM ', 'MS ', ' S '], { M: p, S: 'stick' });
            shaped(`${mat}_shovel`, 1, ['M', 'S', 'S'], { M: p, S: 'stick' });
            shaped(`${mat}_sword`, 1, ['M', 'M', 'S'], { M: p, S: 'stick' });
        }
        continue;
    }
    shaped(`${mat}_pickaxe`, 1, ['MMM', ' S ', ' S '], { M: M, S: 'stick' });
    shaped(`${mat}_axe`, 1, ['MM ', 'MS ', ' S '], { M: M, S: 'stick' });
    shaped(`${mat}_shovel`, 1, ['M', 'S', 'S'], { M: M, S: 'stick' });
    shaped(`${mat}_sword`, 1, ['M', 'M', 'S'], { M: M, S: 'stick' });
}

/**
 * 격자(문자열 id 배열, size×size)에서 일치하는 조합법을 찾는다.
 * 마인크래프트처럼 모양은 격자 안에서 자유롭게 이동 가능.
 */
export function matchRecipe(grid, size) {
    for (const r of recipes) {
        if (r.count === 0) continue;
        if (r.shapeless) {
            const need = [...r.ingredients];
            const have = grid.filter(Boolean);
            if (have.length !== need.length) continue;
            const pool = [...have];
            let ok = true;
            for (const n of need) {
                const i = pool.indexOf(n);
                if (i === -1) { ok = false; break; }
                pool.splice(i, 1);
            }
            if (ok) return { id: r.out, count: r.count };
        } else {
            if (r.size > size) continue;
            const h = r.shape.length, w = Math.max(...r.shape.map(s => s.length));
            for (let oy = 0; oy + h <= size; oy++) {
                for (let ox = 0; ox + w <= size; ox++) {
                    let ok = true;
                    for (let y = 0; y < size && ok; y++) {
                        for (let x = 0; x < size; x++) {
                            const cell = grid[y * size + x] || null;
                            const inShape = y >= oy && y < oy + h && x >= ox && x < ox + w;
                            const ch = inShape ? (r.shape[y - oy][x - ox] ?? ' ') : ' ';
                            const want = ch === ' ' ? null : r.key[ch];
                            if (cell !== want) { ok = false; break; }
                        }
                    }
                    if (ok) return { id: r.out, count: r.count };
                }
            }
        }
    }
    return null;
}

// ================== 제련 ==================
export const smelting = new Map(Object.entries({
    cobblestone: 'stone',
    sand: 'glass',
    raw_iron: 'iron_ingot',
    raw_gold: 'gold_ingot',
    raw_copper: 'copper_ingot',
    clay_ball: 'brick',
    oak_log: 'charcoal', spruce_log: 'charcoal', birch_log: 'charcoal',
    beef: 'cooked_beef',
    porkchop: 'cooked_porkchop',
    chicken: 'cooked_chicken',
    clay: 'bricks'
}));
