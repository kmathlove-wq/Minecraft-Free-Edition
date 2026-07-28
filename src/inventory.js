// ===== 인벤토리 · 아이템 스택 · 조합 =====
import { itemOf, matchRecipe, smelting } from './blocks.js';

export const HOTBAR = 9;
export const MAIN_SLOTS = 36;   // 0~8 핫바, 9~35 인벤토리

export function stack(id, count = 1) {
    const it = itemOf(id);
    if (!it) return null;
    return { id, count, dur: it.tool ? it.tool.durability : undefined };
}

export class Inventory {
    constructor() {
        this.slots = new Array(MAIN_SLOTS).fill(null);
        this.craft = new Array(9).fill(null);     // 제작 격자 (2x2 는 앞 4칸을 3x3 좌상단으로 취급)
        this.craftSize = 2;
        this.cursor = null;                       // 마우스로 집은 스택
        this.selected = 0;
    }

    held() { return this.slots[this.selected]; }
    heldItem() { const s = this.held(); return s ? itemOf(s.id) : null; }

    /** 스택을 인벤토리에 추가. 남은 개수를 반환 */
    add(id, count = 1) {
        const it = itemOf(id);
        if (!it) return count;
        const max = it.maxStack;
        // 1) 같은 아이템에 합치기 (핫바 우선)
        for (let i = 0; i < MAIN_SLOTS && count > 0; i++) {
            const s = this.slots[i];
            if (s && s.id === id && s.count < max && s.dur === undefined) {
                const n = Math.min(max - s.count, count);
                s.count += n; count -= n;
            }
        }
        // 2) 빈 칸에 넣기
        for (let i = 0; i < MAIN_SLOTS && count > 0; i++) {
            if (this.slots[i]) continue;
            const n = Math.min(max, count);
            this.slots[i] = stack(id, n);
            count -= n;
        }
        return count;
    }

    has(id, count = 1) {
        let n = 0;
        for (const s of this.slots) if (s && s.id === id) n += s.count;
        return n >= count;
    }

    countOf(id) {
        let n = 0;
        for (const s of this.slots) if (s && s.id === id) n += s.count;
        return n;
    }

    /** 손에 든 아이템 1개 소모 */
    consumeHeld(n = 1) {
        const s = this.held();
        if (!s) return false;
        s.count -= n;
        if (s.count <= 0) this.slots[this.selected] = null;
        return true;
    }

    /** 도구 내구도 소모 */
    damageHeld(n = 1) {
        const s = this.held();
        if (!s || s.dur === undefined) return;
        s.dur -= n;
        if (s.dur <= 0) this.slots[this.selected] = null;
    }

    // ---------- 제작 ----------
    setCraftSize(n) {
        this.craftSize = n;
    }
    /** 현재 격자에서 나오는 결과물 */
    craftResult() {
        const size = this.craftSize;
        const grid = new Array(size * size).fill(null);
        for (let y = 0; y < size; y++)
            for (let x = 0; x < size; x++) {
                const s = this.craft[y * 3 + x];
                grid[y * size + x] = s ? s.id : null;
            }
        return matchRecipe(grid, size);
    }
    /** 제작 실행 (재료 1세트 소모) */
    takeCraft() {
        const res = this.craftResult();
        if (!res) return null;
        const size = this.craftSize;
        for (let y = 0; y < size; y++)
            for (let x = 0; x < size; x++) {
                const i = y * 3 + x;
                const s = this.craft[i];
                if (!s) continue;
                s.count--;
                if (s.count <= 0) this.craft[i] = null;
            }
        return stack(res.id, res.count);
    }
    /** 제작 격자에 남은 재료를 인벤토리로 되돌린다 */
    clearCraft() {
        for (let i = 0; i < 9; i++) {
            const s = this.craft[i];
            if (!s) continue;
            const left = this.add(s.id, s.count);
            this.craft[i] = left > 0 ? stack(s.id, left) : null;
        }
    }

    // ---------- 직렬화 ----------
    toJSON() {
        return {
            selected: this.selected,
            slots: this.slots.map(s => s ? { id: s.id, c: s.count, d: s.dur } : null)
        };
    }
    fromJSON(o) {
        if (!o) return;
        this.selected = o.selected ?? 0;
        this.slots = new Array(MAIN_SLOTS).fill(null);
        (o.slots || []).forEach((s, i) => {
            if (!s || i >= MAIN_SLOTS) return;
            if (!itemOf(s.id)) return;         // 알 수 없는 아이템은 버림
            this.slots[i] = { id: s.id, count: s.c, dur: s.d };
        });
    }
}

// ---------- 화로 ----------
export class Furnace {
    constructor() {
        this.input = null; this.fuel = null; this.output = null;
        this.burnTime = 0; this.burnMax = 0; this.progress = 0;
    }
    tick(dt) {
        const canSmelt = this.input && smelting.has(this.input.id) &&
            (!this.output || (this.output.id === smelting.get(this.input.id) && this.output.count < 64));

        if (this.burnTime > 0) this.burnTime -= dt;
        if (this.burnTime <= 0 && canSmelt && this.fuel) {
            const f = itemOf(this.fuel.id);
            if (f && f.fuel > 0) {
                this.burnMax = this.burnTime = f.fuel;
                this.fuel.count--;
                if (this.fuel.count <= 0) this.fuel = null;
            }
        }
        if (this.burnTime > 0 && canSmelt) {
            this.progress += dt;
            if (this.progress >= 10) {          // 마인크래프트와 동일하게 10초
                this.progress = 0;
                const out = smelting.get(this.input.id);
                this.input.count--;
                if (this.input.count <= 0) this.input = null;
                if (this.output) this.output.count++;
                else this.output = stack(out, 1);
            }
        } else {
            this.progress = Math.max(0, this.progress - dt);
        }
    }
}
