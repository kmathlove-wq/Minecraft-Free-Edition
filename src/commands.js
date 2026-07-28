// ===== 채팅 · 명령어 =====
// T 로 채팅, / 로 명령어 입력을 연다. 마인크래프트의 대표 명령어들을 흉내낸다.
import { items, itemOf, blocks, blockByNameOf, B } from './blocks.js';
import { MOB_TYPES } from './mobs.js';
import { DAY_TICKS } from './env.js';
import { WORLD_HEIGHT } from './worldgen.js';
import { stack } from './inventory.js';
import { sfx } from './audio.js';

const GAMEMODES = {
    survival: 'survival', s: 'survival', 0: 'survival', '서바이벌': 'survival',
    creative: 'creative', c: 'creative', 1: 'creative', '크리에이티브': 'creative',
    spectator: 'spectator', sp: 'spectator', 6: 'spectator', '관전': 'spectator', '관전자': 'spectator'
};
const GAMEMODE_KO = { survival: '서바이벌', creative: '크리에이티브', spectator: '관전자' };

const TIME_PRESETS = { day: 1000, noon: 6000, night: 13000, midnight: 18000, sunrise: 23000, sunset: 12000, 낮: 1000, 밤: 13000, 정오: 6000, 자정: 18000 };

export class Console {
    constructor(game) {
        this.game = game;
        this.el = document.getElementById('chat');
        this.logEl = document.getElementById('chat-log');
        this.inputEl = document.getElementById('chat-input');
        this.open = false;
        this.history = [];
        this.historyIndex = -1;

        this.inputEl.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.code === 'Enter') {
                const text = this.inputEl.value.trim();
                this.close();
                if (text) {
                    this.history.unshift(text);
                    if (this.history.length > 50) this.history.pop();
                    this.submit(text);
                }
            } else if (e.code === 'Escape') {
                this.close();
            } else if (e.code === 'ArrowUp') {
                e.preventDefault();
                if (this.historyIndex < this.history.length - 1) {
                    this.historyIndex++;
                    this.inputEl.value = this.history[this.historyIndex];
                }
            } else if (e.code === 'ArrowDown') {
                e.preventDefault();
                if (this.historyIndex > 0) { this.historyIndex--; this.inputEl.value = this.history[this.historyIndex]; }
                else { this.historyIndex = -1; this.inputEl.value = ''; }
            } else if (e.code === 'Tab') {
                e.preventDefault();
                this.complete();
            }
        });
    }

    // ---------- 화면 ----------
    show(prefill = '') {
        this.open = true;
        this.historyIndex = -1;
        this.el.classList.add('open');
        this.inputEl.value = prefill;
        this.inputEl.focus();
        // 커서를 끝으로
        this.inputEl.setSelectionRange(prefill.length, prefill.length);
    }
    close() {
        if (!this.open) return;
        this.open = false;
        this.el.classList.remove('open');
        this.inputEl.value = '';
        this.inputEl.blur();
        this.onClose?.();
    }

    log(msg, kind = 'info') {
        const d = document.createElement('div');
        d.className = 'chat-line ' + kind;
        d.textContent = msg;
        this.logEl.appendChild(d);
        while (this.logEl.childElementCount > 60) this.logEl.removeChild(this.logEl.firstChild);
        this.logEl.scrollTop = this.logEl.scrollHeight;
        // 채팅이 닫혀 있으면 잠시 후 흐려진다
        setTimeout(() => d.classList.add('faded'), 9000);
    }
    err(msg) { this.log(msg, 'err'); }

    /** Tab 자동완성: 명령어 이름과 아이템/몹 이름 */
    complete() {
        const v = this.inputEl.value;
        if (!v.startsWith('/')) return;
        const parts = v.slice(1).split(' ');
        let pool, prefix;
        if (parts.length === 1) { pool = Object.keys(COMMANDS); prefix = parts[0]; }
        else if (parts[0] === 'give') { pool = [...items.keys()]; prefix = parts[parts.length - 1]; }
        else if (parts[0] === 'summon') { pool = Object.keys(MOB_TYPES); prefix = parts[parts.length - 1]; }
        else if (parts[0] === 'setblock') { pool = blocks.map(b => b.name); prefix = parts[parts.length - 1]; }
        else if (parts[0] === 'gamemode') { pool = ['survival', 'creative', 'spectator']; prefix = parts[parts.length - 1]; }
        else return;

        const hits = pool.filter(n => n.startsWith(prefix));
        if (hits.length === 0) return;
        if (hits.length === 1) {
            parts[parts.length - 1] = hits[0];
            this.inputEl.value = '/' + parts.join(' ') + ' ';
        } else {
            this.log(hits.slice(0, 24).join('  '));
        }
    }

    // ---------- 실행 ----------
    submit(text) {
        if (!text.startsWith('/')) { this.log('<나> ' + text); return; }
        const parts = text.slice(1).split(/\s+/);
        const name = parts[0].toLowerCase();
        const cmd = COMMANDS[name];
        if (!cmd) { this.err(`알 수 없는 명령어: /${name}  (/help 로 목록 확인)`); return; }
        try {
            cmd.run(this.game, parts.slice(1), this);
        } catch (e) {
            this.err('오류: ' + e.message);
        }
    }
}

/** "~" 또는 "~5" 같은 상대 좌표 처리 */
function coord(token, base) {
    if (token === undefined) throw new Error('좌표가 부족합니다');
    if (token.startsWith('~')) {
        const off = token.length === 1 ? 0 : Number(token.slice(1));
        if (Number.isNaN(off)) throw new Error('잘못된 좌표: ' + token);
        return base + off;
    }
    const v = Number(token);
    if (Number.isNaN(v)) throw new Error('잘못된 좌표: ' + token);
    return v;
}

export const COMMANDS = {
    help: {
        usage: '/help',
        desc: '명령어 목록',
        run(game, args, con) {
            con.log('─── 명령어 ───');
            for (const [n, c] of Object.entries(COMMANDS)) con.log(`${c.usage}  —  ${c.desc}`);
        }
    },
    kill: {
        usage: '/kill [mobs]',
        desc: '자신을 죽인다. mobs 를 붙이면 주변 몹을 모두 제거',
        run(game, args, con) {
            if (args[0] === 'mobs' || args[0] === '몹') {
                const n = game.mobs.mobs.length;
                game.mobs.clear();
                con.log(`몹 ${n}마리를 제거했습니다.`);
                return;
            }
            if (game.player.gamemode !== 'survival') {
                con.err('서바이벌 모드에서만 죽을 수 있습니다.');
                return;
            }
            game.player.health = 0;
            game.player.dead = true;
            con.log('죽었습니다.');
        }
    },
    tp: {
        usage: '/tp <x> <y> <z>',
        desc: '좌표로 이동 (~ 는 현재 위치 기준)',
        run(game, args, con) {
            const p = game.player;
            if (args.length < 3) throw new Error('사용법: /tp <x> <y> <z>');
            const x = coord(args[0], p.pos.x);
            const y = coord(args[1], p.pos.y);
            const z = coord(args[2], p.pos.z);
            game.world.forceLoad(x, z, 1);
            p.pos = { x, y: Math.max(-30, Math.min(WORLD_HEIGHT + 60, y)), z };
            p.vel = { x: 0, y: 0, z: 0 };
            p.fallStart = null;
            con.log(`이동: ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`);
        }
    },
    top: {
        usage: '/top',
        desc: '현재 위치의 지표면으로 이동',
        run(game, args, con) {
            const p = game.player;
            const y = game.world.surfaceY(Math.floor(p.pos.x), Math.floor(p.pos.z));
            p.pos.y = y + 0.2;
            p.vel = { x: 0, y: 0, z: 0 };
            p.fallStart = null;
            con.log(`지표면(y=${y})으로 이동했습니다.`);
        }
    },
    gamemode: {
        usage: '/gamemode <survival|creative|spectator>',
        desc: '게임 모드 변경 (s / c / sp 축약 가능)',
        run(game, args, con) {
            const m = GAMEMODES[(args[0] || '').toLowerCase()];
            if (!m) throw new Error('사용법: /gamemode <survival|creative|spectator>');
            game.player.gamemode = m;
            if (m !== 'creative') game.player.flying = m === 'spectator';
            if (m === 'survival') game.player.dead = game.player.health <= 0;
            con.log('게임 모드: ' + GAMEMODE_KO[m]);
        }
    },
    time: {
        usage: '/time <set|add> <day|night|noon|midnight|숫자>',
        desc: '시간 변경 (하루 24000틱)',
        run(game, args, con) {
            const mode = (args[0] || 'set').toLowerCase();
            const raw = (args[1] ?? args[0] ?? '').toLowerCase();
            const v = TIME_PRESETS[raw] ?? Number(raw);
            if (Number.isNaN(v)) throw new Error('사용법: /time set <day|night|noon|midnight|숫자>');
            if (mode === 'add') game.sky.setTime(game.sky.time + v);
            else game.sky.setTime(v);
            con.log(`시간: ${Math.round(game.sky.time)} (${game.sky.isNight ? '밤' : '낮'})`);
        }
    },
    day: { usage: '/day', desc: '낮으로 변경', run: (g, a, c) => COMMANDS.time.run(g, ['set', 'day'], c) },
    night: { usage: '/night', desc: '밤으로 변경', run: (g, a, c) => COMMANDS.time.run(g, ['set', 'night'], c) },
    give: {
        usage: '/give <아이템> [개수]',
        desc: '아이템 지급 (Tab 으로 자동완성)',
        run(game, args, con) {
            const id = args[0];
            if (!id) throw new Error('사용법: /give <아이템> [개수]');
            let key = id;
            if (!items.has(key)) {
                const hit = [...items.keys()].find(k => k === id || k.includes(id));
                if (!hit) throw new Error('그런 아이템이 없습니다: ' + id);
                key = hit;
            }
            const n = Math.max(1, Math.min(999, Number(args[1] ?? 1) || 1));
            const left = game.inventory.add(key, n);
            con.log(`${itemOf(key).display} ${n - left}개를 받았습니다.` + (left ? ` (${left}개는 자리 부족)` : ''));
            sfx.pop();
        }
    },
    clear: {
        usage: '/clear',
        desc: '인벤토리 비우기',
        run(game, args, con) {
            game.inventory.slots.fill(null);
            con.log('인벤토리를 비웠습니다.');
        }
    },
    summon: {
        usage: '/summon <몹> [개수]',
        desc: '몹 소환 (pig, cow, sheep, chicken, zombie, skeleton, creeper)',
        run(game, args, con) {
            const type = args[0];
            if (!MOB_TYPES[type]) throw new Error('그런 몹이 없습니다: ' + args[0]);
            const n = Math.max(1, Math.min(20, Number(args[1] ?? 1) || 1));
            const p = game.player;
            for (let i = 0; i < n; i++) {
                const a = Math.random() * Math.PI * 2;
                const x = p.pos.x + Math.cos(a) * 3, z = p.pos.z + Math.sin(a) * 3;
                game.mobs.spawn(type, x, game.world.surfaceY(Math.floor(x), Math.floor(z)), z);
            }
            con.log(`${MOB_TYPES[type].display} ${n}마리를 소환했습니다.`);
        }
    },
    setblock: {
        usage: '/setblock <x> <y> <z> <블록>',
        desc: '해당 좌표에 블록 설치',
        run(game, args, con) {
            const p = game.player;
            const x = Math.floor(coord(args[0], p.pos.x));
            const y = Math.floor(coord(args[1], p.pos.y));
            const z = Math.floor(coord(args[2], p.pos.z));
            const def = blockByNameOf(args[3]);
            if (!def) throw new Error('그런 블록이 없습니다: ' + args[3]);
            game.world.setBlock(x, y, z, def.id);
            con.log(`(${x}, ${y}, ${z}) → ${def.display}`);
        }
    },
    spawn: {
        usage: '/spawn',
        desc: '스폰 지점으로 이동',
        run(game, args, con) {
            const p = game.player;
            game.world.forceLoad(p.spawn.x, p.spawn.z, 1);
            p.pos = { ...p.spawn };
            p.pos.y = game.world.surfaceY(Math.floor(p.spawn.x), Math.floor(p.spawn.z)) + 0.2;
            p.vel = { x: 0, y: 0, z: 0 };
            con.log('스폰 지점으로 이동했습니다.');
        }
    },
    setspawn: {
        usage: '/setspawn',
        desc: '현재 위치를 스폰 지점으로 지정',
        run(game, args, con) {
            game.player.spawn = { ...game.player.pos };
            con.log('스폰 지점을 지정했습니다.');
        }
    },
    heal: {
        usage: '/heal',
        desc: '체력과 허기를 가득 채운다',
        run(game, args, con) {
            const p = game.player;
            p.health = 20; p.food = 20; p.saturation = 20; p.air = 300; p.dead = false;
            con.log('체력과 허기를 회복했습니다.');
        }
    },
    seed: {
        usage: '/seed',
        desc: '월드 시드 확인',
        run(game, args, con) { con.log('시드: ' + game.world.seed); }
    },
    rd: {
        usage: '/rd <2~12>',
        desc: '렌더 거리 변경',
        run(game, args, con) {
            const v = Math.max(2, Math.min(12, Number(args[0]) || 6));
            game.world.renderDistance = v;
            game.world._lastCx = null;      // 큐 재구성 유도
            con.log('렌더 거리: ' + v + ' 청크');
        }
    },
    mobs: {
        usage: '/mobs <on|off>',
        desc: '몹 생성 켜기/끄기',
        run(game, args, con) {
            const on = args[0] !== 'off';
            game.mobs.enabled = on;
            if (!on) game.mobs.clear();
            con.log('몹 생성: ' + (on ? '켜짐' : '꺼짐'));
        }
    },
    pos: {
        usage: '/pos',
        desc: '현재 좌표와 밝기 확인',
        run(game, args, con) {
            const p = game.player;
            const x = Math.floor(p.pos.x), y = Math.floor(p.pos.y), z = Math.floor(p.pos.z);
            con.log(`좌표 ${x} ${y} ${z} · 바이옴 ${game.world.biomeNameAt(x, z)} · `
                + `하늘빛 ${game.world.getSkyLight(x, y, z)} 블록빛 ${game.world.getBlockLight(x, y, z)}`);
        }
    }
};
