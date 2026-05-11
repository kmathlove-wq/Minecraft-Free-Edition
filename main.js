import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

let camera, scene, renderer, controls;

const objects = []; 
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2(0, 0);

let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;
let moveUp = false;
let moveDown = false;
let canJump = false;

// 비행 관련 상태
let isFlying = false;
let lastJumpPressTime = 0;
const doublePressDelay = 200;

let prevTime = performance.now();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();

// 인벤토리 및 블록 타입 정의
let activeSlot = 0;
const inventorySlots = [];
const blockTypes = {
    0: { name: 'grass', color: 0x44aa44 },
    1: { name: 'dirt', color: 0x8b5a2b },
    2: { name: 'stone', color: 0x888888 },
    3: { name: 'wood', color: 0x634220 },
    4: { name: 'leaves', color: 0x228b22 }
};

// 성능 최적화를 위한 공용 지오메트리/머티리얼
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const edgesGeometry = new THREE.EdgesGeometry(boxGeometry);
const lineMaterial = new THREE.LineBasicMaterial({ 
    color: 0x000000,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: 0.5,
    polygonOffsetUnits: 1.0
});

init();
animate();

function init() {
    // 1. Scene & Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.6, 0);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 20, 100);

    // 2. Lights
    const ambientLight = new THREE.AmbientLight(0xcccccc, 1.0);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(1, 1, 0.5).normalize();
    scene.add(directionalLight);

    // 3. Controls
    controls = new PointerLockControls(camera, document.body);
    const blocker = document.getElementById('blocker');
    const instructions = document.getElementById('instructions');

    blocker.addEventListener('click', () => controls.lock());
    controls.addEventListener('lock', () => {
        instructions.style.display = 'none';
        blocker.style.display = 'none';
    });
    controls.addEventListener('unlock', () => {
        blocker.style.display = 'block';
        instructions.style.display = '';
    });
    scene.add(controls.getObject());

    // 4. Input handling
    const onKeyDown = (e) => {
        switch (e.code) {
            case 'ArrowUp': case 'KeyW': moveForward = true; break;
            case 'ArrowLeft': case 'KeyA': moveLeft = true; break;
            case 'ArrowDown': case 'KeyS': moveBackward = true; break;
            case 'ArrowRight': case 'KeyD': moveRight = true; break;
            case 'Space':
                if (e.repeat) break;
                const now = performance.now();
                if (now - lastJumpPressTime < doublePressDelay) {
                    isFlying = !isFlying;
                    if (isFlying) velocity.y = 0;
                }
                lastJumpPressTime = now;
                if (isFlying) moveUp = true;
                else if (canJump) { velocity.y += 9.0; canJump = false; }
                break;
            case 'ShiftLeft': case 'ShiftRight': if (isFlying) moveDown = true; break;
        }
    };
    const onKeyUp = (e) => {
        switch (e.code) {
            case 'ArrowUp': case 'KeyW': moveForward = false; break;
            case 'ArrowLeft': case 'KeyA': moveLeft = false; break;
            case 'ArrowDown': case 'KeyS': moveBackward = false; break;
            case 'ArrowRight': case 'KeyD': moveRight = false; break;
            case 'Space': moveUp = false; break;
            case 'ShiftLeft': case 'ShiftRight': moveDown = false; break;
        }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    // 5. Inventory
    for(let i=0; i<9; i++) inventorySlots.push(document.querySelector(`.slot[data-slot="${i}"]`));
    document.addEventListener('wheel', (e) => {
        if (!controls.isLocked) return;
        inventorySlots[activeSlot].classList.remove('active');
        activeSlot = (activeSlot + (e.deltaY > 0 ? 1 : 8)) % 9;
        inventorySlots[activeSlot].classList.add('active');
    });

    // 6. Interaction
    document.addEventListener('mousedown', (e) => {
        if (!controls.isLocked) return;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(objects, false);
        if (intersects.length > 0 && intersects[0].distance < 6) {
            if (e.button === 0) { // Destroy
                scene.remove(intersects[0].object);
                objects.splice(objects.indexOf(intersects[0].object), 1);
            } else if (e.button === 2) { // Build
                const blockInfo = blockTypes[activeSlot];
                if (blockInfo) {
                    const newPos = intersects[0].object.position.clone().add(
                        intersects[0].face.normal.clone().transformDirection(intersects[0].object.matrixWorld)
                    );
                    const playerPos = controls.getObject().position;
                    const feetY = playerPos.y - 1.6;
                    const headY = playerPos.y + 0.2;
                    const isXOverlap = playerPos.x + 0.4 > newPos.x - 0.5 && playerPos.x - 0.4 < newPos.x + 0.5;
                    const isZOverlap = playerPos.z + 0.4 > newPos.z - 0.5 && playerPos.z - 0.4 < newPos.z + 0.5;
                    let isYOverlap = headY > newPos.y - 0.5 && feetY < newPos.y + 0.45;
                    if (isXOverlap && isZOverlap && feetY > newPos.y + 0.1) isYOverlap = false;
                    if (!(isXOverlap && isZOverlap && isYOverlap)) addBlock(newPos, blockInfo.color);
                }
            }
        }
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    // 7. World Generation
    for (let z = -15; z < 15; z++) {
        for (let x = -15; x < 15; x++) {
            for (let y = 0; y < 5; y++) {
                addBlock(new THREE.Vector3(x, -0.5 - y, z), (y === 0) ? 0x44aa44 : 0x8b5a2b);
            }
        }
    }
    // Parkour Pillars
    const pillarPositions = [
        { x: 5, z: 5, h: 1 }, { x: 7, z: 8, h: 2 }, { x: 10, z: 7, h: 3 }, { x: 12, z: 4, h: 4 },
        { x: 9, z: 2, h: 3 }, { x: 6, z: -2, h: 2 }, { x: 3, z: -5, h: 4 }, { x: -5, z: -5, h: 2 },
        { x: -8, z: -8, h: 3 }, { x: -12, z: -10, h: 5 }
    ];
    pillarPositions.forEach(p => {
        for(let h = 0; h < p.h; h++) addBlock(new THREE.Vector3(p.x, h + 0.5, p.z), 0x888888);
    });

    // 8. Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
    prevTime = performance.now();
}

function addBlock(pos, color = 0x44aa44) {
    const mesh = new THREE.Mesh(boxGeometry, new THREE.MeshLambertMaterial({ color }));
    mesh.position.copy(pos);
    const wireframe = new THREE.LineSegments(edgesGeometry, lineMaterial);
    mesh.add(wireframe);
    scene.add(mesh);
    objects.push(mesh);
}

function checkHorizontalCollision(x, y, z) {
    for (let i = 0; i < objects.length; i++) {
        const obj = objects[i];
        if (Math.abs(y - obj.position.y) > 1.5) continue;
        const bx = obj.position.x, by = obj.position.y, bz = obj.position.z;
        if (x + 0.3 > bx - 0.5 && x - 0.3 < bx + 0.5 && z + 0.3 > bz - 0.5 && z - 0.3 < bz + 0.5 &&
            y + 0.2 > by - 0.5 && y - 1.0 < by + 0.5) return true;
    }
    return false;
}

function animate() {
    requestAnimationFrame(animate);
    const time = performance.now();
    const delta = Math.min((time - prevTime) / 1000, 0.05);
    prevTime = time;

    if (controls.isLocked) {
        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;
        if (isFlying) {
            velocity.y = 0;
            if (moveUp) velocity.y = 10;
            if (moveDown) velocity.y = -10;
        } else velocity.y -= 9.8 * 4.0 * delta;

        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize();

        const speed = isFlying ? 120.0 : 60.0;
        if (moveForward || moveBackward) velocity.z -= direction.z * speed * delta;
        if (moveLeft || moveRight) velocity.x -= direction.x * speed * delta;

        const player = controls.getObject();
        const oldPos = player.position.clone();

        if (velocity.z !== 0) {
            controls.moveForward(-velocity.z * delta);
            if (checkHorizontalCollision(player.position.x, player.position.y, player.position.z)) {
                player.position.z = oldPos.z; player.position.x = oldPos.x; velocity.z = 0;
            }
        }
        const posAfterZ = player.position.clone();
        if (velocity.x !== 0) {
            controls.moveRight(-velocity.x * delta);
            if (checkHorizontalCollision(player.position.x, player.position.y, player.position.z)) {
                player.position.x = posAfterZ.x; player.position.z = posAfterZ.z; velocity.x = 0;
            }
        }

        player.position.y += velocity.y * delta;
        canJump = false;
        const feetY = player.position.y - 1.6;

        for (let i = 0; i < objects.length; i++) {
            const obj = objects[i];
            if (Math.abs(player.position.x - obj.position.x) > 1 || Math.abs(player.position.z - obj.position.z) > 1) continue;
            const bx = obj.position.x, by = obj.position.y, bz = obj.position.z;
            if (player.position.x + 0.3 > bx - 0.5 && player.position.x - 0.3 < bx + 0.5 &&
                player.position.z + 0.3 > bz - 0.5 && player.position.z - 0.3 < bz + 0.5) {
                if (velocity.y <= 0 && feetY <= by + 0.5 && feetY > by - 0.2) {
                    velocity.y = 0; player.position.y = by + 0.5 + 1.6; canJump = true;
                    if (!moveUp && !moveDown) isFlying = false;
                    break;
                }
                if (velocity.y > 0 && player.position.y + 0.2 > by - 0.5 && player.position.y < by) {
                    velocity.y = 0; player.position.y = by - 0.5 - 0.2;
                }
            }
        }
        if (player.position.y < -500) {
            player.position.set(0, 1.6, 0); velocity.set(0, 0, 0); isFlying = false;
            alert("재시작합니다!");
        }
    }
    renderer.render(scene, camera);
}
