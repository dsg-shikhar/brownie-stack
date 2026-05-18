import * as THREE from 'three';
import * as CANNON from 'cannon';

// --- Game Configurations & State ---
const originalBoxSize = 3; 
const boxHeight = 0.45; 
let stack = [];
let overhangs = [];
let gameEnded = false;
let score = 0;

let currentLevelSpeed = 0.07; 
const baseSpeed = 0.07;
const maxSpeed = 0.22;
let moveDirectionSign = 1; 

const cookieFlavors = [
    { name: "Milk Chocolate Chunk", baseColor: 0xD4A373, chipColor: 0x3A2312, roughness: 0.9 },
    { name: "Triple Chocolate", baseColor: 0x2B1A10, chipColor: 0x120A06, roughness: 0.85 },
    { name: "Matcha White Choc", baseColor: 0x606C38, chipColor: 0xF5F3E9, roughness: 0.9 },
    { name: "Double Chocolate Walnut", color: 0x5C4033, chipColor: 0x221100, roughness: 0.9 }
];

let activePowerUp = null; 
let slowMotionTurnsLeft = 0;

let scene, camera, renderer, world, proceduralBumpTexture;
const scoreElement = document.getElementById("score");
const powerupStatusElement = document.getElementById("powerup-status");

// --- Procedural High-Fidelity Cookie Texture Generator ---
function createCookieTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    
    // Create a high-frequency grain noise to simulate baked flour pores
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 256, 256);
    
    for (let i = 0; i < 15000; i++) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        const val = Math.floor(Math.random() * 60) - 30; // High/low variance values
        ctx.fillStyle = `rgb(${128+val},${128+val},${128+val})`;
        ctx.fillRect(x, y, 1, 1);
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 2);
    return texture;
}

function init() {
    world = new CANNON.World();
    world.gravity.set(0, -14, 0); 
    world.broadphase = new CANNON.NaiveBroadphase();

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xFDF6EE); 

    proceduralBumpTexture = createCookieTexture();

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.75);
    dirLight.position.set(7, 14, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.bias = -0.0005;
    scene.add(dirLight);

    const aspect = window.innerWidth / window.innerHeight;
    const d = 4.5;
    camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 0.1, 100);
    camera.position.set(5, 5, 5);
    camera.lookAt(0, 1, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    window.addEventListener('resize', onWindowResize);
    
    const triggerAction = () => {
        if (gameEnded) return;
        if (stack.length === 1 && score === 0) {
            document.getElementById("instructions").classList.add("hidden");
            startNewGame();
        } else {
            handlePlacement();
        }
    };

    window.addEventListener('pointerdown', triggerAction);
    window.addEventListener('keydown', (e) => { if (e.code === 'Space') triggerAction(); });

    document.getElementById("start-btn").addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById("instructions").classList.add("hidden");
        startNewGame();
    });

    document.getElementById("restart-btn").addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById("results").classList.add("hidden");
        startNewGame();
    });

    renderer.setAnimationLoop(animationLoop);
}

// --- High-Fidelity Cookie Factory Function ---
function createCookieComponent(width, depth, flavor) {
    const containerGroup = new THREE.Group();

    // 1. Generate Soft Rounded Base Slab Geometry
    const shape = new THREE.Shape();
    const r = 0.35; // Pronounced corner rounding for a natural cookie look
    const hw = width / 2;
    const hd = depth / 2;

    shape.moveTo(-hw + r, -hd);
    shape.lineTo(hw - r, -hd);
    shape.quadraticCurveTo(hw, -hd, hw, -hd + r);
    shape.lineTo(hw, hd - r);
    shape.quadraticCurveTo(hw, hd, hw - r, hd);
    shape.lineTo(-hw + r, hd);
    shape.quadraticCurveTo(-hw, hd, -hw, hd - r);
    shape.lineTo(-hw, -hd + r);
    shape.quadraticCurveTo(-hw, -hd, -hw + r, -hd);

    const extrudeSettings = {
        steps: 1,
        depth: boxHeight - 0.1,
        bevelEnabled: true,
        bevelThickness: 0.08,
        bevelSize: 0.08,
        bevelSegments: 4
    };

    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geometry.center();
    geometry.rotateX(Math.PI / 2);

    const baseMaterial = new THREE.MeshStandardMaterial({
        color: flavor.baseColor,
        roughness: flavor.roughness,
        metalness: 0.02,
        bumpMap: proceduralBumpTexture,
        bumpScale: 0.03 // Subtle micro-surface cracks
    });

    const baseMesh = new THREE.Mesh(geometry, baseMaterial);
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    
    // Explicitly name the base slab to target it for clean slicing modifications
    baseMesh.name = "cookie_slab"; 
    containerGroup.add(baseMesh);

    // 2. Generate Isolated, Scale-Protected Chocolate Chips
    const densityFactor = 3.2; 
    const chipCount = Math.max(3, Math.floor((width * depth) * densityFactor));
    
    const chipGeometry = new THREE.SphereGeometry(0.1, 5, 5);
    chipGeometry.scale(1.4, 0.6, 1.4); // Realistic chip profiles
    
    const chipMaterial = new THREE.MeshStandardMaterial({
        color: flavor.chipColor,
        roughness: 0.5,
        metalness: 0.08
    });

    for (let i = 0; i < chipCount; i++) {
        const chipMesh = new THREE.Mesh(chipGeometry, chipMaterial);
        
        // Safety margin keeps chips from clipping through outer walls
        const rx = (Math.random() - 0.5) * (width * 0.75);
        const rz = (Math.random() - 0.5) * (depth * 0.75);
        const ry = (boxHeight / 2) - 0.03 + (Math.random() * 0.04);

        chipMesh.position.set(rx, ry, rz);
        chipMesh.rotation.set(Math.random() * 0.2, Math.random() * 3, Math.random() * 0.2);
        chipMesh.castShadow = true;
        containerGroup.add(chipMesh);
    }

    return containerGroup;
}

// --- Structural Game Engine Routines ---
function addLayer(x, z, width, depth, direction) {
    const y = stack.length * boxHeight;
    const flavor = cookieFlavors[Math.floor(Math.random() * cookieFlavors.length)];
    
    const meshGroup = createCookieComponent(width, depth, flavor);
    meshGroup.position.set(x, y, z);
    scene.add(meshGroup);

    stack.push({ mesh: meshGroup, x, z, width, depth, direction, flavor });
}

function spawnOverhang(x, z, width, depth, flavor) {
    const y = (stack.length - 1) * boxHeight;
    const meshGroup = createCookieComponent(width, depth, flavor);
    meshGroup.position.set(x, y, z);
    scene.add(meshGroup);

    const shape = new CANNON.Box(new CANNON.Vec3(width / 2, boxHeight / 2, depth / 2));
    const body = new CANNON.Body({ mass: 4, shape: shape });
    body.position.set(x, y, z);
    world.addBody(body);

    overhangs.push({ mesh: meshGroup, body });
}

function startNewGame() {
    stack.forEach(layer => scene.remove(layer.mesh));
    overhangs.forEach(o => { scene.remove(o.mesh); world.remove(o.body); });
    
    stack = [];
    overhangs = [];
    score = 0;
    currentLevelSpeed = baseSpeed; 
    moveDirectionSign = 1;
    gameEnded = false;
    activePowerUp = null;
    slowMotionTurnsLeft = 0;
    
    scoreElement.innerText = score;
    powerupStatusElement.innerText = "";

    addLayer(0, 0, originalBoxSize, originalBoxSize, 'static');
    spawnNextMovingCookie();
}

function spawnNextMovingCookie() {
    // Dynamic Level Scaling Matrix
    currentLevelSpeed = Math.min(baseSpeed + (score * 0.0075), maxSpeed);

    const topLayer = stack[stack.length - 1];
    const direction = Math.random() > 0.5 ? 'x' : 'z';
    
    const boundaryOffset = -4.5;
    const startX = direction === 'x' ? boundaryOffset : topLayer.x;
    const startZ = direction === 'z' ? boundaryOffset : topLayer.z;

    moveDirectionSign = 1;
    addLayer(startX, startZ, topLayer.width, topLayer.depth, direction);
}

function handlePlacement() {
    const activeLayer = stack[stack.length - 1];
    const previousLayer = stack[stack.length - 2];
    const dir = activeLayer.direction;

    let delta = activeLayer[dir] - previousLayer[dir];
    const oldSize = previousLayer[dir === 'x' ? 'width' : 'depth'];
    const overlap = oldSize - Math.abs(delta);

    if (overlap <= 0) {
        if (activePowerUp === 'STICKY') {
            activeLayer[dir] = previousLayer[dir];
            activeLayer.mesh.position[dir] = previousLayer[dir];
            activePowerUp = null;
            powerupStatusElement.innerText = "Sticky Save!";
            scoreIncrement(true);
            spawnNextMovingCookie();
            return;
        }
        handleGameOver();
        return;
    }

    const isPerfect = Math.abs(delta) < 0.14; 
    
    if (isPerfect || activePowerUp === 'STICKY') {
        activeLayer[dir] = previousLayer[dir];
        activeLayer.mesh.position[dir] = previousLayer[dir];
        scoreIncrement(true);
        if (activePowerUp === 'STICKY') activePowerUp = null;
    } else {
        const newSize = overlap;
        
        // Capture global coordinates before reconstructing the mesh
        const targetX = previousLayer.x + (dir === 'x' ? delta / 2 : 0);
        const targetZ = previousLayer.z + (dir === 'z' ? delta / 2 : 0);
        const targetWidth = dir === 'x' ? newSize : activeLayer.width;
        const targetDepth = dir === 'z' ? newSize : activeLayer.depth;

        // Visual Deconstruction Fix: Remove the old group entirely
        scene.remove(activeLayer.mesh);

        // Regenerate a brand new cookie component with perfect proportions
        const pristineGroup = createCookieComponent(targetWidth, targetDepth, activeLayer.flavor);
        pristineGroup.position.set(targetX, activeLayer.mesh.position.y, targetZ);
        scene.add(pristineGroup);

        // Reassign reference pointers to the clean, non-distorted asset
        activeLayer.mesh = pristineGroup;
        activeLayer.x = targetX;
        activeLayer.z = targetZ;
        activeLayer.width = targetWidth;
        activeLayer.depth = targetDepth;

        // Calculate and drop sliced debris chunks
        let fallingSize = oldSize - newSize;
        let fallingSign = delta > 0 ? 1 : -1;
        let fallingPos = (dir === 'x' ? targetX : targetZ) + (newSize / 2 + fallingSize / 2) * fallingSign;

        if (dir === 'x') {
            spawnOverhang(fallingPos, activeLayer.z, fallingSize, activeLayer.depth, activeLayer.flavor);
        } else {
            spawnOverhang(activeLayer.x, fallingPos, activeLayer.width, fallingSize, activeLayer.flavor);
        }
        scoreIncrement(false);
    }

    rollForPowerUp();
    spawnNextMovingCookie();
}

function scoreIncrement(isPerfect) {
    let points = 1;
    if (isPerfect) {
        points = (activePowerUp === 'FLAVOR_RUSH') ? 3 : 2;
        if (activePowerUp === 'FLAVOR_RUSH') activePowerUp = null;
    } else {
        if (activePowerUp === 'FLAVOR_RUSH') activePowerUp = null;
    }
    score += points;
    scoreElement.innerText = score;
}

function rollForPowerUp() {
    if (activePowerUp !== null) return;

    const roll = Math.random();
    if (roll < 0.07) {
        activePowerUp = 'STICKY';
        powerupStatusElement.innerText = "Power-Up: Sticky Cookie!";
    } else if (roll >= 0.07 && roll < 0.14) {
        activePowerUp = 'SLOW_MOTION';
        slowMotionTurnsLeft = 3;
    } else if (roll >= 0.14 && roll < 0.20) {
        activePowerUp = 'FLAVOR_RUSH';
        powerupStatusElement.innerText = "Power-Up: Flavor Rush (3x on Perfect)!";
    }
}

function handleGameOver() {
    gameEnded = true;
    const failingLayer = stack[stack.length - 1];
    scene.remove(failingLayer.mesh);
    spawnOverhang(failingLayer.x, failingLayer.z, failingLayer.width, failingLayer.depth, failingLayer.flavor);
    document.getElementById("results").classList.remove("hidden");
}

function onWindowResize() {
    const aspect = window.innerWidth / window.innerHeight;
    const d = 4.5;
    camera.left = -d * aspect;
    camera.right = d * aspect;
    camera.top = d;
    camera.bottom = -d;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Frame Execution Loop ---
function animationLoop() {
    world.step(1 / 60);

    overhangs.forEach(o => {
        o.mesh.position.copy(o.body.position);
        o.mesh.quaternion.copy(o.body.quaternion);
    });

    if (!gameEnded && stack.length > 1) {
        const activeLayer = stack[stack.length - 1];
        const dir = activeLayer.direction;

        let computedSpeed = currentLevelSpeed;
        if (activePowerUp === 'SLOW_MOTION' && slowMotionTurnsLeft > 0) {
            computedSpeed *= 0.45;
            powerupStatusElement.innerText = `Slow Motion Active (${slowMotionTurnsLeft} moves left)`;
        }

        activeLayer[dir] += computedSpeed * moveDirectionSign;
        activeLayer.mesh.position[dir] = activeLayer[dir];

        if (activeLayer[dir] > 4.5) {
            moveDirectionSign = -1;
        } else if (activeLayer[dir] < -4.5) {
            moveDirectionSign = 1;
        }
    }

    if (stack.length > 3) {
        const targetY = (stack.length - 3) * boxHeight + 4.5;
        camera.position.y += (targetY - camera.position.y) * 0.1;
    }

    renderer.render(scene, camera);
}

init();
