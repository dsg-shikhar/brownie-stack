import * as THREE from 'three';
import * as CANNON from 'cannon';

// --- Game Configurations & State ---
const originalBoxSize = 3; 
const boxHeight = 0.45; // Sleeker cookie profile
let stack = [];
let overhangs = [];
let gameEnded = false;
let score = 0;

// Proper Variable Separation for Pacing Control
let currentLevelSpeed = 0.07; // Starts smooth and accessible
const baseSpeed = 0.07;
const maxSpeed = 0.22;
let moveDirectionSign = 1; // Explicitly separates direction from absolute speed

// Ben's Cookies Flavor Palettes with realistic baking specular values
const cookieFlavors = [
    { name: "Milk Chocolate Chunk", baseColor: 0xD4A373, chipColor: 0x4A3728 },
    { name: "Triple Chocolate", baseColor: 0x3D2314, chipColor: 0x1A0F08 },
    { name: "Matcha White Choc", baseColor: 0x708238, chipColor: 0xFDFBF7 },
    { name: "Cranberry White", baseColor: 0xC17967, chipColor: 0x7B1113 }
];

// Power-up States
let activePowerUp = null; 
let slowMotionTurnsLeft = 0;

let scene, camera, renderer, world;
const scoreElement = document.getElementById("score");
const powerupStatusElement = document.getElementById("powerup-status");

function init() {
    // 1. Physics Engine Setup
    world = new CANNON.World();
    world.gravity.set(0, -14, 0); // Crisp falling physics
    world.broadphase = new CANNON.NaiveBroadphase();

    // 2. Scene Setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xF5EBE0); // Warm bakery aesthetic

    // Soft Ambient lighting + Sharp directional light to cast shadows
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(8, 15, 6);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    scene.add(dirLight);

    // Camera Configuration
    const aspect = window.innerWidth / window.innerHeight;
    const d = 4.5;
    camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 0.1, 100);
    camera.position.set(5, 5, 5);
    camera.lookAt(0, 1, 0);

    // Renderer Configuration
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    // Action Triggers
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

// --- Procedural Mesh Generation (Making them look like real cookies) ---
function createCookieMesh(width, depth, flavor) {
    const cookieGroup = new THREE.Group();

    // 1. Create Rounded Square Base Path
    const shape = new THREE.Shape();
    const radius = 0.25; // Controls edge smoothness
    const x = -width / 2;
    const z = -depth / 2;

    shape.moveTo(x, z + radius);
    shape.lineTo(x, z + depth - radius);
    shape.quadraticCurveTo(x, z + depth, x + radius, z + depth);
    shape.lineTo(x + width - radius, z + depth);
    shape.quadraticCurveTo(x + width, z + depth, x + width, z + depth - radius);
    shape.lineTo(x + width, z + radius);
    shape.quadraticCurveTo(x + width, z, x + width - radius, z);
    shape.lineTo(x + radius, z);
    shape.quadraticCurveTo(x, z, x, z + radius);

    // 2. Extrude 2D shape into a soft 3D volume
    const extrudeSettings = {
        steps: 1,
        depth: boxHeight - 0.1,
        bevelEnabled: true,
        bevelThickness: 0.08,
        bevelSize: 0.06,
        bevelSegments: 3
    };

    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geometry.center(); // Center local pivot point
    geometry.rotateX(Math.PI / 2); // Orient upright

    const cookieMaterial = new THREE.MeshStandardMaterial({
        color: flavor.baseColor,
        roughness: 0.9,  // Matte texture resembles real dough
        metalness: 0.05
    });

    const baseMesh = new THREE.Mesh(geometry, cookieMaterial);
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    cookieGroup.add(baseMesh);

    // 3. Scatter Procedural Chocolate Chips inside the cookie bounds
    const chipCount = Math.floor((width * depth) * 2.5);
    const chipGeo = new THREE.SphereGeometry(0.09, 4, 4);
    chipGeo.scale(1.3, 0.6, 1.3); // Flattens chips out slightly
    
    const chipMat = new THREE.MeshStandardMaterial({
        color: flavor.chipColor,
        roughness: 0.6,
        metalness: 0.1
    });

    for (let i = 0; i < chipCount; i++) {
        const chip = new THREE.Mesh(chipGeo, chipMat);
        // Distribute uniformly while respecting edge safety margins
        const rx = (Math.random() - 0.5) * (width - 0.4);
        const rz = (Math.random() - 0.5) * (depth - 0.4);
        const ry = (boxHeight / 2) - 0.02 + (Math.random() * 0.03); // Slightly peeking out the top

        chip.position.set(rx, ry, rz);
        chip.rotation.set(Math.random(), Math.random(), Math.random());
        chip.castShadow = true;
        cookieGroup.add(chip);
    }

    return cookieGroup;
}

// --- Layer Addition Mechanics ---
function addLayer(x, z, width, depth, direction) {
    const y = stack.length * boxHeight;
    const flavor = cookieFlavors[Math.floor(Math.random() * cookieFlavors.length)];
    
    const meshGroup = createCookieMesh(width, depth, flavor);
    meshGroup.position.set(x, y, z);
    scene.add(meshGroup);

    stack.push({ mesh: meshGroup, x, z, width, depth, direction, flavor });
}

function spawnOverhang(x, z, width, depth, flavor) {
    const y = (stack.length - 1) * boxHeight;
    const meshGroup = createCookieMesh(width, depth, flavor);
    meshGroup.position.set(x, y, z);
    scene.add(meshGroup);

    const shape = new CANNON.Box(new CANNON.Vec3(width / 2, boxHeight / 2, depth / 2));
    const body = new CANNON.Body({ mass: 4, shape: shape });
    body.position.set(x, y, z);
    world.addBody(body);

    overhangs.push({ mesh: meshGroup, body });
}

// --- Gameplay Progression Systems (With Repaired Difficulty Matrix) ---
function startNewGame() {
    stack.forEach(layer => scene.remove(layer.mesh));
    overhangs.forEach(o => { scene.remove(o.mesh); world.remove(o.body); });
    
    stack = [];
    overhangs = [];
    score = 0;
    currentLevelSpeed = baseSpeed; // Starts at a comfortable pace
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
    // Gradual Difficulty Progression Curve based on actual performance milestones
    currentLevelSpeed = Math.min(baseSpeed + (score * 0.007), maxSpeed);

    const topLayer = stack[stack.length - 1];
    const direction = Math.random() > 0.5 ? 'x' : 'z';
    
    const boundaryOffset = -4.5;
    const startX = direction === 'x' ? boundaryOffset : topLayer.x;
    const startZ = direction === 'z' ? boundaryOffset : topLayer.z;

    // Reset standard directional tracking sign for the incoming block
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

    const isPerfect = Math.abs(delta) < 0.15; // Fair tolerance threshold for mobile interactions
    
    if (isPerfect || activePowerUp === 'STICKY') {
        activeLayer[dir] = previousLayer[dir];
        activeLayer.mesh.position[dir] = previousLayer[dir];
        scoreIncrement(true);
        if (activePowerUp === 'STICKY') activePowerUp = null;
    } else {
        const newSize = overlap;
        activeLayer[dir === 'x' ? 'width' : 'depth'] = newSize;
        
        // Dynamic re-scaling logic optimized for nested groups
        const scaleFactor = newSize / oldSize;
        activeLayer.mesh.scale[dir] = scaleFactor;
        
        const centerOffset = previousLayer[dir] + delta / 2;
        activeLayer[dir] = centerOffset;
        activeLayer.mesh.position[dir] = centerOffset;

        let fallingSize = oldSize - newSize;
        let fallingSign = delta > 0 ? 1 : -1;
        let fallingPos = centerOffset + (newSize / 2 + fallingSize / 2) * fallingSign;

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

// --- Frame Processing Engine Loop ---
function animationLoop() {
    world.step(1 / 60);

    overhangs.forEach(o => {
        o.mesh.position.copy(o.body.position);
        o.mesh.quaternion.copy(o.body.quaternion);
    });

    if (!gameEnded && stack.length > 1) {
        const activeLayer = stack[stack.length - 1];
        const dir = activeLayer.direction;

        // Apply clean calculation modifiers for active slow-motion states
        let computedSpeed = currentLevelSpeed;
        if (activePowerUp === 'SLOW_MOTION' && slowMotionTurnsLeft > 0) {
            computedSpeed *= 0.45;
            powerupStatusElement.innerText = `Slow Motion Active (${slowMotionTurnsLeft} moves remaining)`;
        }

        // Advance layer positions cleanly along its active timeline vector axis
        activeLayer[dir] += computedSpeed * moveDirectionSign;
        activeLayer.mesh.position[dir] = activeLayer[dir];

        // Ping-pong boundary check logic cleanly isolated from speed calculations
        if (activeLayer[dir] > 4.5) {
            moveDirectionSign = -1;
        } else if (activeLayer[dir] < -4.5) {
            moveDirectionSign = 1;
        }
    }

    // Camera Panning interpolation
    if (stack.length > 3) {
        const targetY = (stack.length - 3) * boxHeight + 4.5;
        camera.position.y += (targetY - camera.position.y) * 0.1;
    }

    renderer.render(scene, camera);
}

init();
