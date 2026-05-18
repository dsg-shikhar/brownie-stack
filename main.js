import * as THREE from 'three';
import * as CANNON from 'cannon';

// --- Game Configurations & State ---
const originalBoxSize = 3; 
const boxHeight = 0.6; // Slightly flatter to look like gourmet square cookies
let stack = [];
let overhangs = [];
let gameEnded = false;
let score = 0;
let speed = 0.15;
const baseSpeed = 0.15;
const maxSpeed = 0.45;

// Ben's Cookies Flavor Palettes (Colors mapped to textures)
const cookieFlavors = [
    { name: "Milk Chocolate Chunk", color: 0xD4A373 },
    { name: "Triple Chocolate", color: 0x4A3728 },
    { name: "Matcha & White Chocolate", color: 0x606C38 },
    { name: "Cranberry & White Chocolate", color: 0xBC4749 },
    { name: "Double Chocolate Walnut", color: 0x5C4033 },
    { name: "Lemon Fudge", color: 0xE9D8A6 }
];

// Power-up States
let activePowerUp = null; // 'STICKY', 'SLOW_MOTION', 'FLAVOR_RUSH'
let slowMotionTurnsLeft = 0;

// Three.js & Cannon.js globals
let scene, camera, renderer, world;
const scoreElement = document.getElementById("score");
const powerupStatusElement = document.getElementById("powerup-status");

// --- Initialize World Systems ---
function init() {
    // 1. Cannon Physics World Setup
    world = new CANNON.World();
    world.gravity.set(0, -9.82, 0);
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 10;

    // 2. Three.js Scene Setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xFDF8F5);

    // Foundation Base Layer
    addLayer(0, 0, originalBoxSize, originalBoxSize, 'sub-base');

    // Setup Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(10, 20, 7);
    scene.add(dirLight);

    // Camera Setup (Orthographic ensures uniform appearance on mobile devices)
    const aspect = window.innerWidth / window.innerHeight;
    const d = 5;
    camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 0.1, 100);
    camera.position.set(4, 4, 4);
    camera.lookAt(0, 1, 0);

    // Renderer Setup
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.body.appendChild(renderer.domElement);

    // Event Hookups
    window.addEventListener('resize', onWindowResize);
    
    const triggerAction = () => {
        if (gameEnded) return;
        if (stack.length === 1 && score === 0) {
            // First click removes instruction panel
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

    // Run primary processing loop
    renderer.setAnimationLoop(animationLoop);
}

// --- Layer Addition Mechanics ---
function addLayer(x, z, width, depth, direction) {
    const y = stack.length * boxHeight;
    const flavor = cookieFlavors[Math.floor(Math.random() * cookieFlavors.length)];
    
    // Create soft rustic visual container mesh for the cookie
    const geometry = new THREE.BoxGeometry(width, boxHeight, depth);
    const material = new THREE.MeshStandardMaterial({ 
        color: flavor.color, 
        roughness: 0.8,
        metalness: 0.1
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    scene.add(mesh);

    stack.push({ mesh, x, z, width, depth, direction });
}

function spawnOverhang(x, z, width, depth) {
    const y = (stack.length - 1) * boxHeight;
    const flavor = cookieFlavors[Math.floor(Math.random() * cookieFlavors.length)];

    // Visual Mesh representation
    const geometry = new THREE.BoxGeometry(width, boxHeight, depth);
    const material = new THREE.MeshStandardMaterial({ color: flavor.color, roughness: 0.9 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    scene.add(mesh);

    // Physical Body Representation
    const shape = new CANNON.Box(new CANNON.Vec3(width/2, boxHeight/2, depth/2));
    const body = new CANNON.Body({ mass: 5, shape: shape });
    body.position.set(x, y, z);
    world.addBody(body);

    overhangs.push({ mesh, body });
}

// --- Core Gameplay Progression Systems ---
function startNewGame() {
    // Teardown previous states cleanly
    stack.forEach(layer => scene.remove(layer.mesh));
    overhangs.forEach(o => { scene.remove(o.mesh); world.remove(o.body); });
    
    stack = [];
    overhangs = [];
    score = 0;
    speed = baseSpeed;
    gameEnded = false;
    activePowerUp = null;
    slowMotionTurnsLeft = 0;
    
    scoreElement.innerText = score;
    powerupStatusElement.innerText = "";

    // Generate baseline operational platform
    addLayer(0, 0, originalBoxSize, originalBoxSize, 'static');
    spawnNextMovingCookie();
}

function spawnNextMovingCookie() {
    // Dynamic Difficulty Evaluation: Increase speed incrementally as score climbs
    speed = Math.min(baseSpeed + (score * 0.012), maxSpeed);

    // Apply active power-up adjustments
    if (activePowerUp === 'SLOW_MOTION' && slowMotionTurnsLeft > 0) {
        speed *= 0.4; // 60% speed reduction
        slowMotionTurnsLeft--;
        powerupStatusElement.innerText = `Slow Motion Active (${slowMotionTurnsLeft} moves left)`;
        if (slowMotionTurnsLeft === 0) activePowerUp = null;
    } else if (!activePowerUp) {
        powerupStatusElement.innerText = "";
    }

    const topLayer = stack[stack.length - 1];
    const direction = Math.random() > 0.5 ? 'x' : 'z';
    
    // Offset the starting vector so it glides in from the bounds outer edge
    const offset = -5;
    const startX = direction === 'x' ? offset : topLayer.x;
    const startZ = direction === 'z' ? offset : topLayer.z;

    addLayer(startX, startZ, topLayer.width, topLayer.depth, direction);
}

function handlePlacement() {
    const activeLayer = stack[stack.length - 1];
    const previousLayer = stack[stack.length - 2];
    const dir = activeLayer.direction;

    let delta = activeLayer[dir] - previousLayer[dir];
    const overlap = previousLayer[dir === 'x' ? 'width' : 'depth'] - Math.abs(delta);

    // 1. Fail condition check
    if (overlap <= 0) {
        // Fallback strategy check: "Sticky Cookie" save condition
        if (activePowerUp === 'STICKY') {
            activeLayer[dir] = previousLayer[dir];
            activeLayer.mesh.position[dir] = previousLayer[dir];
            activePowerUp = null;
            powerupStatusElement.innerText = "Sticky Save Activated!";
            scoreIncrement(true);
            spawnNextMovingCookie();
            return;
        }
        handleGameOver();
        return;
    }

    // 2. Evaluate Slice calculations
    const isPerfect = Math.abs(delta) < 0.12; // Perfect tolerance threshold
    
    if (isPerfect || activePowerUp === 'STICKY') {
        // Snap to perfect alignment
        activeLayer[dir] = previousLayer[dir];
        activeLayer.mesh.position[dir] = previousLayer[dir];
        scoreIncrement(true);
        if (activePowerUp === 'STICKY') activePowerUp = null;
    } else {
        // Regular slice calculation
        const newSize = overlap;
        const oldSize = previousLayer[dir === 'x' ? 'width' : 'depth'];
        
        // Resize Active Layer
        activeLayer[dir === 'x' ? 'width' : 'depth'] = newSize;
        activeLayer.mesh.scale[dir] = newSize / oldSize;
        
        // Recenter layer to rest cleanly over the remaining footprint
        const centerOffset = previousLayer[dir] + delta / 2;
        activeLayer[dir] = centerOffset;
        activeLayer.mesh.position[dir] = centerOffset;

        // Generate debris physics object
        let fallingSize = oldSize - newSize;
        let fallingSign = delta > 0 ? 1 : -1;
        let fallingPos = centerOffset + (newSize / 2 + fallingSize / 2) * fallingSign;

        if (dir === 'x') {
            spawnOverhang(fallingPos, activeLayer.z, fallingSize, activeLayer.depth);
        } else {
            spawnOverhang(activeLayer.x, fallingPos, activeLayer.width, fallingSize);
        }
        scoreIncrement(false);
    }

    // Roll for random Power-ups drops on successful structural placements
    rollForPowerUp();
    spawnNextMovingCookie();
}

// --- Reward & Power-Up Engines ---
function scoreIncrement(isPerfect) {
    let points = 1;
    if (isPerfect) {
        points = (activePowerUp === 'FLAVOR_RUSH') ? 3 : 2;
        if (activePowerUp === 'FLAVOR_RUSH') {
            activePowerUp = null; // Single use drop consumption
        }
    } else {
        // Standard placement resets Flavor Rush streak cleanly
        if (activePowerUp === 'FLAVOR_RUSH') activePowerUp = null;
    }
    
    score += points;
    scoreElement.innerText = score;
}

function rollForPowerUp() {
    if (activePowerUp !== null) return; // Prevent powerup stacking overrides

    const roll = Math.random();
    if (roll < 0.08) {
        activePowerUp = 'STICKY';
        powerupStatusElement.innerText = "Power-Up: Sticky Cookie Active!";
    } else if (roll >= 0.08 && roll < 0.15) {
        activePowerUp = 'SLOW_MOTION';
        slowMotionTurnsLeft = 3;
    } else if (roll >= 0.15 && roll < 0.22) {
        activePowerUp = 'FLAVOR_RUSH';
        powerupStatusElement.innerText = "Power-Up: Flavor Rush Ready (3x on Perfect)!";
    }
}

function handleGameOver() {
    gameEnded = true;
    // Drop current layer into physics space
    const failingLayer = stack[stack.length - 1];
    scene.remove(failingLayer.mesh);
    spawnOverhang(failingLayer.x, failingLayer.z, failingLayer.width, failingLayer.depth);
    
    document.getElementById("results").classList.remove("hidden");
}

// --- Window Scaler Integration ---
function onWindowResize() {
    const aspect = window.innerWidth / window.innerHeight;
    const d = 5;
    camera.left = -d * aspect;
    camera.right = d * aspect;
    camera.top = d;
    camera.bottom = -d;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Processing Loop Engine ---
function animationLoop(time) {
    // Run physics evaluation update
    world.step(1 / 60);

    // Reconcile Three.js display structures with matching Cannon simulation data
    overhangs.forEach(o => {
        o.mesh.position.copy(o.body.position);
        o.mesh.quaternion.copy(o.body.quaternion);
    });

    // Move Active Floating Stack Layer
    if (!gameEnded && stack.length > 1) {
        const activeLayer = stack[stack.length - 1];
        if (activeLayer.direction === 'x' || activeLayer.direction === 'z') {
            const dir = activeLayer.direction;
            
            // Dynamic back-and-forth movement boundary loop logic
            activeLayer[dir] += speed;
            if (activeLayer[dir] > 5) {
                speed = -Math.abs(speed);
            } else if (activeLayer[dir] < -5) {
                speed = Math.abs(speed);
            }
            activeLayer.mesh.position[dir] = activeLayer[dir];
        }
    }

    // Smoothly pan camera up as the structural stack height scales
    if (stack.length > 3) {
        const targetY = (stack.length - 3) * boxHeight + 4;
        camera.position.y += (targetY - camera.position.y) * 0.1;
    }

    renderer.render(scene, camera);
}

// Initialize on execution call
init();
