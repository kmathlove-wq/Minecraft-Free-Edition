// ===== 하늘 · 낮/밤 사이클 · 구름 =====
// 마인크래프트 1일 = 24000틱 = 실제 20분, 낮 0~12000 / 밤 12000~24000
import * as THREE from 'three';
import { sharedUniforms } from './chunk.js';

export const DAY_TICKS = 24000;
const TICKS_PER_SEC = 20;

const COL_DAY = new THREE.Color(0x78a7ff);
const COL_SUNSET = new THREE.Color(0xf5a04a);
const COL_NIGHT = new THREE.Color(0x040614);
const FOG_DAY = new THREE.Color(0xc0d8ff);
const FOG_SUNSET = new THREE.Color(0xe8b088);
const FOG_NIGHT = new THREE.Color(0x05070f);

function makeGlowTexture(size, inner, outer) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, inner);
    grd.addColorStop(0.45, inner);
    grd.addColorStop(1, outer);
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

function makeCloudTexture() {
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const img = g.createImageData(S, S);
    // 격자 노이즈 → 부드러운 구름 덩어리
    const cell = 16, gs = S / cell;
    const grid = new Float32Array((gs + 1) * (gs + 1));
    for (let i = 0; i < grid.length; i++) grid[i] = Math.random();
    const at = (x, y) => grid[(y % gs) * (gs + 1) + (x % gs)];
    const fade = t => t * t * (3 - 2 * t);
    for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
            const gx = x / cell, gy = y / cell;
            const ix = gx | 0, iy = gy | 0;
            const fx = fade(gx - ix), fy = fade(gy - iy);
            const v = (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy)
                    + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
            const a = v > 0.58 ? Math.min(1, (v - 0.58) * 6) : 0;
            const i = (y * S + x) * 4;
            img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
            img.data[i + 3] = a * 210;
        }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.NearestFilter;
    t.repeat.set(6, 6);
    return t;
}

export class Sky {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;
        this.time = 1000;           // 아침에서 시작
        this.paused = false;

        scene.background = COL_DAY.clone();
        scene.fog = new THREE.Fog(FOG_DAY.clone(), 40, 140);

        // 카메라를 따라다니는 천구
        this.group = new THREE.Group();
        this.group.frustumCulled = false;
        scene.add(this.group);

        // 태양 / 달
        const sunMat = new THREE.MeshBasicMaterial({ map: makeGlowTexture(64, 'rgba(255,250,220,1)', 'rgba(255,240,180,0)'), transparent: true, depthWrite: false, depthTest: false, fog: false });
        this.sun = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), sunMat);
        const moonMat = new THREE.MeshBasicMaterial({ map: makeGlowTexture(64, 'rgba(230,240,255,1)', 'rgba(180,200,255,0)'), transparent: true, depthWrite: false, depthTest: false, fog: false });
        this.moon = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), moonMat);
        this.orbit = new THREE.Group();
        this.sun.position.set(0, 0, -400);
        this.moon.position.set(0, 0, 400);
        this.sun.rotation.y = Math.PI;
        this.orbit.add(this.sun, this.moon);
        this.group.add(this.orbit);

        // 별
        const N = 900;
        const pos = new Float32Array(N * 3);
        for (let i = 0; i < N; i++) {
            let x, y, z, d;
            do { x = Math.random() * 2 - 1; y = Math.random() * 2 - 1; z = Math.random() * 2 - 1; d = x * x + y * y + z * z; }
            while (d > 1 || d < 0.01);
            const s = 420 / Math.sqrt(d);
            pos[i * 3] = x * s; pos[i * 3 + 1] = y * s; pos[i * 3 + 2] = z * s;
        }
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false });
        this.stars = new THREE.Points(sg, this.starMat);
        this.stars.frustumCulled = false;
        this.group.add(this.stars);

        // 구름
        this.cloudTex = makeCloudTexture();
        this.cloudMat = new THREE.MeshBasicMaterial({ map: this.cloudTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
        this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), this.cloudMat);
        this.clouds.rotation.x = -Math.PI / 2;
        this.clouds.renderOrder = -1;
        scene.add(this.clouds);

        // 방향광 (몹/아이템 등 일반 메시용)
        this.sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
        scene.add(this.sunLight);
        this.ambient = new THREE.AmbientLight(0xffffff, 0.45);
        scene.add(this.ambient);

        this.group.renderOrder = -2;
        this.sun.renderOrder = -2; this.moon.renderOrder = -2; this.stars.renderOrder = -2;
    }

    get isNight() { return this.time >= 13000 && this.time < 23000; }
    get dayFraction() { return this.time / DAY_TICKS; }

    setTime(t) { this.time = ((t % DAY_TICKS) + DAY_TICKS) % DAY_TICKS; }

    update(dt, camPos, renderDistance) {
        if (!this.paused) this.time = (this.time + dt * TICKS_PER_SEC) % DAY_TICKS;

        // 태양 각도: 0틱=일출 직전(동쪽 아래), 6000틱=정오
        const ang = ((this.time - 6000) / DAY_TICKS) * Math.PI * 2;
        this.orbit.rotation.x = ang;

        // 밝기: 낮 1.0, 밤 0.22, 새벽/황혼에 부드럽게 전환
        const sunHeight = Math.cos(ang);          // 정오 1, 자정 -1
        const day = THREE.MathUtils.smoothstep(sunHeight, -0.12, 0.22);
        const brightness = 0.22 + 0.78 * day;
        sharedUniforms.skyBrightness.value = brightness;

        // 하늘/안개 색
        const sunset = Math.max(0, 1 - Math.abs(sunHeight) * 5) * (1 - Math.abs(sunHeight));
        const sky = COL_NIGHT.clone().lerp(COL_DAY, day).lerp(COL_SUNSET, sunset * 0.8);
        const fog = FOG_NIGHT.clone().lerp(FOG_DAY, day).lerp(FOG_SUNSET, sunset * 0.8);
        this.scene.background.copy(sky);
        this.scene.fog.color.copy(fog);
        // 마인크래프트처럼 렌더 거리 끝부분에서만 옅게 사라지도록
        const far = renderDistance * 16;
        this.scene.fog.near = far * 0.78;
        this.scene.fog.far = far * 1.02;

        this.starMat.opacity = Math.max(0, 1 - day * 1.6);
        this.sun.material.opacity = 1;
        this.moon.material.opacity = Math.max(0.15, 1 - day);

        this.sunLight.intensity = 0.15 + 0.85 * day;
        this.sunLight.position.set(Math.sin(ang) * 0.4, Math.max(0.15, sunHeight), Math.cos(ang) * 0.6).normalize();
        this.ambient.intensity = 0.2 + 0.35 * day;

        this.group.position.copy(camPos);

        // 구름 흐름
        this.clouds.position.set(camPos.x, 126, camPos.z);
        this.cloudTex.offset.x = (this.cloudTex.offset.x + dt * 0.0035) % 1;
        this.cloudMat.opacity = 0.35 + 0.45 * day;
        this.cloudMat.transparent = true;
        this.cloudMat.color.copy(fog).lerp(new THREE.Color(0xffffff), 0.6);
    }
}
