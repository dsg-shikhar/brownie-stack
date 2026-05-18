import * as THREE from 'three';
import * as CANNON from 'cannon';

// --- Game Configurations & State ---
const originalBoxSize = 3; 
const boxHeight = 0.45; 
let stack = [];
let overhangs = [];
let gameEnded = false;
let score = 0;
let highScore = 0; // Persistent high-score variable

let currentLevelSpeed = 0.07; 
const baseSpeed = 0.07;
const maxSpeed = 0.22;
let moveDirectionSign = 1; 

const cookieFlavors = [
    { name: "Milk Chocolate Chunk", baseColor: 0xD4A373, chipColor: 0x3A2312, roughness: 0.9 },
    { name: "Triple Chocolate", baseColor: 0x362216, chipColor: 0x1A0F0A, roughness: 0.85 },
    { name: "Matcha White Choc", baseColor: 0x6E7F47, chipColor: 0xFDFBF7, roughness: 0.9 },
    { name: "Cranberry White", baseColor: 0xC68B79, chipColor: 0x7E191B, roughness: 0.9 }
];

let activePowerUp = null; 
let slowMotionTurnsLeft = 0;

let scene, camera, renderer, world, proceduralBumpTexture;
const scoreElement = document.getElementById("score");
const highscoreElement = document.getElementById("highscore");
const powerupStatusElement = document.getElementById("powerup-status");

function createCookieTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 12000; i++) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        const val = Math.floor(Math.random() * 40) - 20;
        ctx.fillStyle = `rgb(${128+val},${128+val},${128+val})`;
        ctx.fillRect(x, y, 1, 1);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 2);
    return texture;
}

function cleanMeshPayload(meshGroup) {
    meshGroup.traverse(child => {
        if (child.isMesh) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) {
                child.material.forEach(mat => mat.dispose());
            } else {
                child.material.dispose();
            }
        }
    });
}

function init() {
    world = new CANNON.World();
    world.gravity.set(0, -16, 0); // slightly heavier gravity environment for punchier falls
    world.broadphase = new CANNON.NaiveBroadphase();

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xFCF6E8); 

    proceduralBumpTexture = createCookieTexture();

    // High Score Loading Routine
    highScore = parseInt(localStorage.getItem("bens_cookies_highscore")) || 0;
    highscoreElement.innerText = highScore;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(6, 12, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
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

function createCookieComponent(width, depth, flavor) {
    const containerGroup = new THREE.Group();
    const shape = new THREE.Shape();
    const r = 0.35; 
    const hw = width / 2; const hd = depth / 2;

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
        steps: 1, depth: boxHeight - 0.1,
        bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.07, bevelSegments: 4
    };

    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geometry.center();
    geometry.rotateX(Math.PI / 2);

    const baseMaterial = new THREE.MeshStandardMaterial({
        color: flavor.baseColor,
        roughness: flavor.roughness,
        metalness: 0.02,
        bumpMap: proceduralBumpTexture,
        bumpScale: 0.025
    });

    const baseMesh = new THREE.Mesh(geometry, baseMaterial);
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    containerGroup.add(baseMesh);

    const chipCount = Math.max(3, Math.floor((width * depth) * 3));
    const chipGeometry = new THREE.SphereGeometry(0.09, 4, 4);
    chipGeometry.scale(1.3, 0.5, 1.3);
    
    const chipMaterial = new THREE.MeshStandardMaterial({
        color: flavor.chipColor, roughness: 0.6
    });

    for (let i = 0; i < chipCount; i++) {
        const chipMesh = new THREE.Mesh(chipGeometry, chipMaterial);
        const rx = (Math.random() - 0.5) * (width * 0.75);
        const rz = (Math.random() - 0.5) * (depth * 0.75);
        const ry = (boxHeight / 2) - 0.03 + (Math.random() * 0.03);

        chipMesh.position.set(rx, ry, rz);
        chipMesh.rotation.set(Math.random()*0.2, Math.random()*3, Math.random()*0.2);
        chipMesh.castShadow = true;
        containerGroup.add(chipMesh);
    }

    return containerGroup;
}

function addLayer(x, z, width, depth, direction) {
    const y = stack.length * boxHeight;
    const flavor = cookieFlavors[Math.floor(Math.random() * cookieFlavors.length)];
    const meshGroup = createCookieComponent(width, depth, flavor);
    meshGroup.position.set(x, y, z);
    scene.add(meshGroup);

    stack.push({ mesh: meshGroup, x, z, width, depth, direction, flavor });
}

// --- Enhanced Crumble Physics Engine ---
function spawnOverhang(x, z, width, depth, flavor, dir = 'x', fallingSign = 1) {
    const y = (stack.length - 1) * boxHeight;
    const meshGroup = createCookieComponent(width, depth, flavor);
    meshGroup.position.set(x, y, z);
    scene.add(meshGroup);

    const shape = new CANNON.Box(new CANNON.Vec3(width / 2, boxHeight / 2, depth / 2));
    const body = new CANNON.Body({ 
        mass: width * depth * 2, // Mass dynamically calculated by piece scale
        shape: shape 
    });
    body.position.set(x, y, z);

    // 1. Slicing Impulse: Pushes debris outward along the slice path vector
    const lateralPushForce = 4.5 * fallingSign;
    if (dir === 'x') {
        body.velocity.set(lateralPushForce, -1.0, 0);
    } else {
        body.velocity.set(0, -1.0, lateralPushForce);
    }

    // 2. Angular Momentum Torque: Randomizes rotational tumbling speeds
    body.angularVelocity.set(
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 12
    );

    world.addBody(body);
    overhangs.push({ mesh: meshGroup, body });
}

function startNewGame() {
    stack.forEach(layer => {
        scene.remove(layer.mesh);
        cleanMeshPayload(layer.mesh);
    });
    overhangs.forEach(o => {
        scene.remove(o.mesh);
        world.remove(o.body);
        cleanMeshPayload(o.mesh);
    });
    
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

    camera.position.set(5, 5, 5);
    camera.lookAt(0, 1, 0);

    addLayer(0, 0, originalBoxSize, originalBoxSize, 'static');
    spawnNextMovingCookie();
}

function spawnNextMovingCookie() {
    currentLevelSpeed = Math.min(baseSpeed + (score * 0.008), maxSpeed);
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
            powerupStatusElement.innerText = "Sticky Save Layer!";
            scoreIncrement(true);
            spawnNextMovingCookie();
            return;
        }
        handleGameOver();
        return;
    }

    const isPerfect = Math.abs(delta) < 0.13; 
    
    if (isPerfect || activePowerUp === 'STICKY') {
        activeLayer[dir] = previousLayer[dir];
        activeLayer.mesh.position[dir] = previousLayer[dir];
        scoreIncrement(true);
        if (activePowerUp === 'STICKY') activePowerUp = null;
    } else {
        const newSize = overlap;
        const targetX = previousLayer.x + (dir === 'x' ? delta / 2 : 0);
        const targetZ = previousLayer.z + (dir === 'z' ? delta / 2 : 0);
        const targetWidth = dir === 'x' ? newSize : activeLayer.width;
        const targetDepth = dir === 'z' ? newSize : activeLayer.depth;

        scene.remove(activeLayer.mesh);
        cleanMeshPayload(activeLayer.mesh);

        const pristineGroup = createCookieComponent(targetWidth, targetDepth, activeLayer.flavor);
        pristineGroup.position.set(targetX, activeLayer.mesh.position.y, targetZ);
        scene.add(pristineGroup);

        activeLayer.mesh = pristineGroup;
        activeLayer.x = targetX; activeLayer.z = targetZ;
        activeLayer.width = targetWidth; activeLayer.depth = targetDepth;

        let fallingSize = oldSize - newSize;
        let fallingSign = delta > 0 ? 1 : -1;
        let fallingPos = (dir === 'x' ? targetX : targetZ) + (newSize / 2 + fallingSize / 2) * fallingSign;

        // Sent cutting arguments down to the reworked physics model
        if (dir === 'x') {
            spawnOverhang(fallingPos, activeLayer.z, fallingSize, activeLayer.depth, activeLayer.flavor, 'x', fallingSign);
        } else {
            spawnOverhang(activeLayer.x, fallingPos, activeLayer.width, fallingSize, activeLayer.flavor, 'z', fallingSign);
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

    // Local Storage Live Evaluation Checks
    if (score > highScore) {
        highScore = score;
        localStorage.setItem("bens_cookies_highscore", highScore);
        highscoreElement.innerText = highScore;
    }
}

function rollForPowerUp() {
    if (activePowerUp !== null) return;
    const roll = Math.random();
    if (roll < 0.06) {
        activePowerUp = 'STICKY';
        powerupStatusElement.innerText = "Sticky Cookie Active";
    } else if (roll >= 0.06 && roll < 0.12) {
        activePowerUp = 'SLOW_MOTION';
        slowMotionTurnsLeft = 3;
    } else if (roll >= 0.12 && roll < 0.18) {
        activePowerUp = 'FLAVOR_RUSH';
        powerupStatusElement.innerText = "Flavor Rush (3x Score on Perfect)";
    }
}

function handleGameOver() {
    gameEnded = true;
    const failingLayer = stack[stack.length - 1];
    scene.remove(failingLayer.mesh);
    cleanMeshPayload(failingLayer.mesh);
    
    spawnOverhang(failingLayer.x, failingLayer.z, failingLayer.width, failingLayer.depth, failingLayer.flavor, failingLayer.direction, 1);
    
    // Inject ending metric states into the layout containers
    document.getElementById("final-score").innerText = score;
    document.getElementById("final-highscore").innerText = highScore;
    document.getElementById("results").classList.remove("hidden");
}

function onWindowResize() {
    const aspect = window.innerWidth / window.innerHeight;
    const d = 4.5;
    camera.left = -d * aspect; camera.right = d * aspect;
    camera.top = d; camera.bottom = -d;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

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
