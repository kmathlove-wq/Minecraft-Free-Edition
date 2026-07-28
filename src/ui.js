// ===== UI: 핫바 · 인벤토리 · 제작대 · 화로 · HUD =====
import { atlas } from './textures.js';
import { itemOf, items, blocks, TOOL_MATERIALS } from './blocks.js';
import { stack, HOTBAR, MAIN_SLOTS } from './inventory.js';
import { sfx } from './audio.js';

const $ = (tag, cls, parent) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
};

function iconStyle(el, texIndex) {
    const s = atlas.css(texIndex);
    el.style.backgroundImage = s.backgroundImage;
    el.style.backgroundSize = s.backgroundSize;
    el.style.backgroundPosition = s.backgroundPosition;
    el.style.imageRendering = 'pixelated';
}

export class UI {
    constructor(game) {
        this.game = game;
        this.open = null;               // null | 'inventory' | 'crafting' | 'furnace' | 'creative'
        this.furnace = null;
        this._build();
    }

    // ---------------- DOM 구성 ----------------
    _build() {
        // 핫바
        this.hotbarEl = document.getElementById('hotbar');
        this.hotSlots = [];
        for (let i = 0; i < HOTBAR; i++) {
            const s = $('div', 'slot', this.hotbarEl);
            const ic = $('div', 'icon', s);
            const ct = $('span', 'count', s);
            const dur = $('div', 'durbar', s);
            $('div', 'durfill', dur);
            this.hotSlots.push({ el: s, icon: ic, count: ct, dur });
        }

        this.itemName = document.getElementById('item-name');
        this.healthEl = document.getElementById('health');
        this.hungerEl = document.getElementById('hunger');
        this.airEl = document.getElementById('air');
        this.debugEl = document.getElementById('debug');
        this.hotbarWrap = document.getElementById('hud');
        this.damageOverlay = document.getElementById('damage-overlay');
        this.waterOverlay = document.getElementById('water-overlay');

        // GUI 패널
        this.gui = document.getElementById('gui');
        this.guiPanel = document.getElementById('gui-panel');
        this.cursorEl = document.getElementById('cursor-item');

        document.addEventListener('mouseup', () => {
            const d = this._drag;
            this._drag = null;
            if (!d) return;
            if (d.slots.length <= 1) this._click(d.slots[0], d.button);   // 제자리 클릭
            else this._distribute(d);
        });
        document.addEventListener('mousemove', (e) => {
            if (!this.open) return;
            this.cursorEl.style.left = e.clientX + 'px';
            this.cursorEl.style.top = e.clientY + 'px';
        });
    }

    // ---------------- 화면 열기/닫기 ----------------
    openScreen(kind, furnace = null) {
        const inv = this.game.inventory;
        this.open = kind;
        this.furnace = furnace;
        inv.setCraftSize(kind === 'crafting' ? 3 : 2);
        this.gui.style.display = 'flex';
        this._renderScreen();
        sfx.click();
    }

    close() {
        if (!this.open) return;
        const inv = this.game.inventory;
        inv.clearCraft();
        if (inv.cursor) { inv.add(inv.cursor.id, inv.cursor.count); inv.cursor = null; }
        this.open = null;
        this.furnace = null;
        this.gui.style.display = 'none';
        this.cursorEl.style.display = 'none';
    }

    _renderScreen() {
        const p = this.guiPanel;
        p.innerHTML = '';
        this._slotEls = [];
        const kind = this.open;

        if (kind === 'creative') {
            $('h3', null, p).textContent = '크리에이티브 아이템';
            const grid = $('div', 'grid creative-grid', p);
            for (const [id, it] of items) {
                const el = this._slotEl({ area: 'creative', id });
                grid.appendChild(el);
            }
        } else if (kind === 'furnace') {
            $('h3', null, p).textContent = '화로';
            const row = $('div', 'furnace-row', p);
            const left = $('div', 'furnace-col', row);
            left.appendChild(this._slotEl({ area: 'furnace', key: 'input' }));
            this.fireEl = $('div', 'fire', left);
            left.appendChild(this._slotEl({ area: 'furnace', key: 'fuel' }));
            this.arrowEl = $('div', 'arrow', row);
            $('div', 'arrow-fill', this.arrowEl);
            const right = $('div', 'furnace-col', row);
            right.appendChild(this._slotEl({ area: 'furnace', key: 'output' }));
        } else {
            $('h3', null, p).textContent = kind === 'crafting' ? '제작대' : '인벤토리';
            const size = kind === 'crafting' ? 3 : 2;
            const craftRow = $('div', 'craft-row', p);
            const cg = $('div', 'grid', craftRow);
            cg.style.gridTemplateColumns = `repeat(${size}, 44px)`;
            for (let y = 0; y < size; y++)
                for (let x = 0; x < size; x++)
                    cg.appendChild(this._slotEl({ area: 'craft', index: y * 3 + x }));
            $('div', 'arrow', craftRow);
            craftRow.appendChild(this._slotEl({ area: 'output' }));
        }

        const hint = $('div', 'gui-hint', p);
        hint.textContent = '좌클릭 전부 · 우클릭 반/한 개 · Shift+클릭 빠른 이동 · 누른 채 끌기 나눠담기';
        if (kind !== 'creative') $('div', 'sep', p);
        // 인벤토리 본체 (27) + 핫바 (9)
        const main = $('div', 'grid inv-grid', p);
        for (let i = HOTBAR; i < MAIN_SLOTS; i++) main.appendChild(this._slotEl({ area: 'inv', index: i }));
        $('div', 'sep', p);
        const hot = $('div', 'grid inv-grid', p);
        for (let i = 0; i < HOTBAR; i++) hot.appendChild(this._slotEl({ area: 'inv', index: i }));

        this._refreshScreen();
    }

    _slotEl(desc) {
        const el = $('div', 'slot gslot');
        $('div', 'icon', el);
        $('span', 'count', el);
        const d = $('div', 'durbar', el);
        $('div', 'durfill', d);
        el._desc = desc;
        el.addEventListener('mousedown', (e) => {
            e.preventDefault();
            if (e.shiftKey) { this._quickMove(desc); return; }
            // 아이템을 든 채 누르면 드래그 분배를 시작한다.
            // 끌지 않고 그대로 떼면 일반 클릭으로 처리한다.
            if (this.game.inventory.cursor && desc.area !== 'output' && desc.area !== 'creative') {
                this._drag = { mode: e.button === 2 ? 'one' : 'even', slots: [desc], button: e.button };
                return;
            }
            this._click(desc, e.button);
        });
        el.addEventListener('mouseenter', () => {
            this._hover(desc, el);
            if (this._drag && !this._drag.slots.includes(desc)
                && desc.area !== 'output' && desc.area !== 'creative') {
                this._drag.slots.push(desc);
            }
        });
        el.addEventListener('mouseleave', () => { this.itemName.style.opacity = 0; });
        if (!this._slotEls) this._slotEls = [];
        this._slotEls.push(el);
        return el;
    }

    _hover(desc, el) {
        const s = this._get(desc);
        if (!s) return;
        const it = itemOf(s.id);
        if (!it) return;
        this.itemName.textContent = it.display;
        this.itemName.style.opacity = 1;
    }

    // 슬롯 접근자
    _get(d) {
        const inv = this.game.inventory;
        switch (d.area) {
            case 'inv': return inv.slots[d.index];
            case 'craft': return inv.craft[d.index];
            case 'output': { const r = inv.craftResult(); return r ? { id: r.id, count: r.count } : null; }
            case 'furnace': return this.furnace ? this.furnace[d.key] : null;
            case 'creative': return { id: d.id, count: 1, creative: true };
        }
        return null;
    }
    _set(d, v) {
        const inv = this.game.inventory;
        if (d.area === 'inv') inv.slots[d.index] = v;
        else if (d.area === 'craft') inv.craft[d.index] = v;
        else if (d.area === 'furnace') this.furnace[d.key] = v;
    }

    _click(d, button) {
        const inv = this.game.inventory;
        const right = button === 2;

        // 크리에이티브 아이템 목록: 클릭하면 한 스택 집기
        if (d.area === 'creative') {
            const it = itemOf(d.id);
            inv.cursor = stack(d.id, right ? 1 : it.maxStack);
            this._refreshScreen();
            return;
        }
        // 제작 결과칸
        if (d.area === 'output') {
            const res = inv.craftResult();
            if (!res) return;
            if (inv.cursor && (inv.cursor.id !== res.id || inv.cursor.count + res.count > itemOf(res.id).maxStack)) return;
            const made = inv.takeCraft();
            if (!made) return;
            if (inv.cursor) inv.cursor.count += made.count;
            else inv.cursor = made;
            sfx.craft();
            this._refreshScreen();
            return;
        }
        // 화로 결과칸은 꺼내기만 가능
        if (d.area === 'furnace' && d.key === 'output') {
            const s = this.furnace.output;
            if (!s) return;
            if (inv.cursor) {
                if (inv.cursor.id !== s.id) return;
                inv.cursor.count += s.count;
            } else inv.cursor = s;
            this.furnace.output = null;
            this._refreshScreen();
            return;
        }

        const cur = inv.cursor;
        const slot = this._get(d);

        if (cur && !slot) {
            if (right) {
                this._set(d, stack(cur.id, 1));
                cur.count--;
                if (cur.count <= 0) inv.cursor = null;
            } else { this._set(d, cur); inv.cursor = null; }
        } else if (cur && slot) {
            const max = itemOf(slot.id).maxStack;
            if (slot.id === cur.id && slot.dur === undefined) {
                const n = right ? Math.min(1, max - slot.count) : Math.min(cur.count, max - slot.count);
                slot.count += n; cur.count -= n;
                if (cur.count <= 0) inv.cursor = null;
            } else if (!right) { this._set(d, cur); inv.cursor = slot; }
        } else if (!cur && slot) {
            if (right) {
                const half = Math.ceil(slot.count / 2);
                inv.cursor = { id: slot.id, count: half, dur: slot.dur };
                slot.count -= half;
                if (slot.count <= 0) this._set(d, null);
            } else { inv.cursor = slot; this._set(d, null); }
        }
        this._refreshScreen();
    }

    /** Shift+클릭: 인벤토리 ↔ 핫바 ↔ 제작칸 사이로 스택을 통째로 옮긴다 */
    _quickMove(d) {
        const inv = this.game.inventory;
        const src = this._get(d);
        if (!src || d.area === 'creative') {
            if (d.area === 'creative') { inv.add(d.id, itemOf(d.id).maxStack); this._refreshScreen(); }
            return;
        }
        if (d.area === 'output') {   // 결과칸은 만들 수 있는 만큼 계속 만든다
            let made = null, guard = 0;
            while ((made = inv.takeCraft()) && guard++ < 64) {
                if (inv.add(made.id, made.count) > 0) break;
            }
            sfx.craft();
            this._refreshScreen();
            return;
        }
        this._set(d, null);
        let left;
        if (d.area === 'inv') {
            // 핫바(0~8) ↔ 인벤토리(9~35) 로 반대편에 넣는다
            const toHotbar = d.index >= HOTBAR;
            left = this._addRange(src, toHotbar ? 0 : HOTBAR, toHotbar ? HOTBAR : MAIN_SLOTS);
        } else {
            left = inv.add(src.id, src.count);
        }
        if (left > 0) this._set(d, stack(src.id, left));
        sfx.click();
        this._refreshScreen();
    }

    _addRange(src, from, to) {
        const inv = this.game.inventory;
        const max = itemOf(src.id).maxStack;
        let n = src.count;
        if (src.dur === undefined) {
            for (let i = from; i < to && n > 0; i++) {
                const s = inv.slots[i];
                if (s && s.id === src.id && s.dur === undefined && s.count < max) {
                    const move = Math.min(max - s.count, n);
                    s.count += move; n -= move;
                }
            }
        }
        for (let i = from; i < to && n > 0; i++) {
            if (inv.slots[i]) continue;
            const move = Math.min(max, n);
            inv.slots[i] = { id: src.id, count: move, dur: src.dur };
            n -= move;
        }
        return n;
    }

    /**
     * 드래그로 지나간 칸들에 아이템을 나눠 담는다.
     *  - 좌클릭 드래그: 균등 분배 (마인크래프트와 동일)
     *  - 우클릭 드래그: 칸마다 한 개씩
     */
    _distribute(drag) {
        const inv = this.game.inventory;
        const cur = inv.cursor;
        if (!cur) return;

        // 실제로 담을 수 있는 칸만 추린다
        const targets = drag.slots.filter(d => {
            const s = this._get(d);
            if (!s) return true;
            return s.id === cur.id && s.dur === undefined && s.count < itemOf(s.id).maxStack;
        });
        if (targets.length === 0) return;

        const max = itemOf(cur.id).maxStack;
        const per = drag.mode === 'one' ? 1 : Math.max(1, Math.floor(cur.count / targets.length));

        for (const d of targets) {
            if (cur.count <= 0) break;
            const s = this._get(d);
            const room = s ? max - s.count : max;
            const n = Math.min(per, cur.count, room);
            if (n <= 0) continue;
            if (s) s.count += n;
            else this._set(d, stack(cur.id, n));
            cur.count -= n;
        }
        if (cur.count <= 0) inv.cursor = null;
        sfx.click();
        this._refreshScreen();
    }

    _refreshScreen() {
        if (!this._slotEls) return;
        for (const el of this._slotEls) {
            if (!el.isConnected) continue;
            this._paint(el, this._get(el._desc));
        }
        const inv = this.game.inventory;
        if (inv.cursor) {
            this.cursorEl.style.display = 'block';
            this._paint(this.cursorEl, inv.cursor);
        } else this.cursorEl.style.display = 'none';
    }

    _paint(el, s) {
        const icon = el.querySelector('.icon');
        const count = el.querySelector('.count');
        const dur = el.querySelector('.durbar');
        if (!s) {
            icon.style.backgroundImage = '';
            count.textContent = '';
            dur.style.display = 'none';
            return;
        }
        const it = itemOf(s.id);
        if (!it) { icon.style.backgroundImage = ''; count.textContent = ''; return; }
        iconStyle(icon, it.tex);
        count.textContent = s.count > 1 ? s.count : '';
        if (s.dur !== undefined && it.tool) {
            const f = s.dur / it.tool.durability;
            dur.style.display = 'block';
            const fill = dur.querySelector('.durfill');
            fill.style.width = (f * 100) + '%';
            fill.style.background = f > 0.5 ? '#4caf50' : f > 0.25 ? '#ffc107' : '#f44336';
        } else dur.style.display = 'none';
    }

    // ---------------- HUD ----------------
    updateHud() {
        const g = this.game, inv = g.inventory, p = g.player;

        // 핫바
        for (let i = 0; i < HOTBAR; i++) {
            const h = this.hotSlots[i];
            h.el.classList.toggle('active', i === inv.selected);
            this._paint(h.el, inv.slots[i]);
        }

        // 체력 / 허기 / 산소
        if (p.gamemode === 'creative') {
            this.healthEl.style.display = 'none';
            this.hungerEl.style.display = 'none';
        } else {
            this.healthEl.style.display = 'flex';
            this.hungerEl.style.display = 'flex';
            this._bar(this.healthEl, p.health, 20, 'heart');
            this._bar(this.hungerEl, p.food, 20, 'food');
        }
        if (p.air < 300 && p.gamemode === 'survival') {
            this.airEl.style.display = 'flex';
            this._bar(this.airEl, Math.max(0, Math.ceil(p.air / 30)), 10, 'bubble');
        } else this.airEl.style.display = 'none';

        this.waterOverlay.style.opacity = p.headInWater ? 0.45 : 0;
        this.damageOverlay.style.opacity = p.hurtTimer > 0 ? 0.35 : 0;
    }

    _bar(el, value, max, cls) {
        const n = max / 2;
        if (el.childElementCount !== n) {
            el.innerHTML = '';
            for (let i = 0; i < n; i++) $('div', 'pip ' + cls, el);
        }
        for (let i = 0; i < n; i++) {
            const v = value - i * 2;
            const c = el.children[i];
            c.className = 'pip ' + cls + (v >= 2 ? ' full' : v >= 1 ? ' half' : '');
        }
    }

    showItemName(text) {
        this.itemName.textContent = text;
        this.itemName.style.opacity = 1;
        clearTimeout(this._nameTimer);
        this._nameTimer = setTimeout(() => { this.itemName.style.opacity = 0; }, 1500);
    }

    updateFurnace() {
        if (this.open !== 'furnace' || !this.furnace) return;
        const f = this.furnace;
        if (this.fireEl) this.fireEl.style.setProperty('--fill', f.burnMax ? Math.max(0, f.burnTime / f.burnMax) : 0);
        if (this.arrowEl) this.arrowEl.querySelector('.arrow-fill').style.width = (f.progress / 10 * 100) + '%';
        this._refreshScreen();
    }

    setDebug(text) {
        this.debugEl.textContent = text;
    }
}
