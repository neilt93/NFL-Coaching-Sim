import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// NFL field dimensions in yards
const FIELD_LENGTH = 120; // 100 yards + 2 end zones
const FIELD_WIDTH = 53.33;

// Team colors
const TEAM_COLORS = {
  KC: { primary: 0xE31837, secondary: 0xFFB81C },   // Chiefs red/gold
  PHI: { primary: 0x004C54, secondary: 0xA5ACAF }, // Eagles midnight green/silver
  BUF: { primary: 0x00338D, secondary: 0xC60C30 }, // Bills blue/red
  SF: { primary: 0xAA0000, secondary: 0xB3995D },  // 49ers red/gold
  NE: { primary: 0x002244, secondary: 0xC60C30 },
  home: { primary: 0x002244, secondary: 0xC60C30 },
  away: { primary: 0xE31837, secondary: 0xFFB81C },
};

// Linear interpolation helper
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Create jersey number sprite
function createNumberSprite(number, color = '#ffffff') {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  // Background circle
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fill();

  // Number text
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 32px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number).slice(-2), 32, 34);

  const texture = new THREE.CanvasTexture(canvas);
  const spriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false
  });
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.scale.set(1, 1, 1);
  return sprite;
}

export default function Field3D({ play, currentFrame, onFrameCount, cameraPreset = 'behind', resetCamera = 0, cameraSpeed = 1, viewMode = 'replay', filteredPlays = [] }) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const playersRef = useRef([]);
  const ballRef = useRef(null);
  const ballTrailRef = useRef([]);
  const losRef = useRef(null);
  const firstDownRef = useRef(null);
  const cameraPresetRef = useRef(cameraPreset);
  const frameIdRef = useRef(null);
  const isDragging = useRef(false);
  const previousMousePosition = useRef({ x: 0, y: 0 });
  const keysPressed = useRef({});
  const cameraEuler = useRef({ yaw: Math.PI / 2, pitch: -0.3 }); // Facing +X (downfield)
  const cameraVelocity = useRef({ x: 0, y: 0, z: 0 }); // For smooth movement
  const cameraSpeedRef = useRef(cameraSpeed);
  const passChartRef = useRef(null); // Group for pass chart elements

  // Refs for render loop access to props
  const currentFrameRef = useRef(1);  // Current frame from props (now a float)
  const playRef = useRef(null);       // Current play data for render loop

  // Keep refs in sync with props
  useEffect(() => { cameraSpeedRef.current = cameraSpeed; }, [cameraSpeed]);
  useEffect(() => { currentFrameRef.current = currentFrame; }, [currentFrame]);
  useEffect(() => { playRef.current = play; }, [play]);
  useEffect(() => { cameraPresetRef.current = cameraPreset; }, [cameraPreset]);

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) return;

    // Scene with sky gradient background
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x87CEEB, 100, 400); // Light atmospheric fog
    sceneRef.current = scene;

    // Create sky dome
    createSkyAndAtmosphere(scene);

    // Camera - positioned behind the offense looking downfield
    const camera = new THREE.PerspectiveCamera(
      60,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      500
    );
    camera.position.set(25, 20, FIELD_WIDTH / 2);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = Math.PI / 2; // Face +X (downfield)
    camera.rotation.x = -0.3; // Slight downward tilt
    cameraRef.current = camera;

    // Renderer - HIGH quality
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      precision: 'highp'
    });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3)); // Up to 3x for crisp rendering
    renderer.shadowMap.enabled = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Stadium lighting - multiple lights for better coverage
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    // Main stadium lights (4 corners like real stadium)
    const stadiumLightPositions = [
      [20, 60, -20],
      [100, 60, -20],
      [20, 60, FIELD_WIDTH + 20],
      [100, 60, FIELD_WIDTH + 20],
    ];

    stadiumLightPositions.forEach(([x, y, z]) => {
      const light = new THREE.PointLight(0xffffee, 0.8, 200);
      light.position.set(x, y, z);
      scene.add(light);
    });

    // Overhead sun/key light
    const sunLight = new THREE.DirectionalLight(0xffffff, 0.7);
    sunLight.position.set(60, 80, 30);
    scene.add(sunLight);

    // Fill light from opposite side
    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.2);
    fillLight.position.set(60, 40, 50);
    scene.add(fillLight);

    // Create field
    createField(scene);

    // Create LOS line (blue with glow)
    const losMaterial = new THREE.MeshBasicMaterial({
      color: 0x3b82f6,
      transparent: true,
      opacity: 0.8
    });
    const losGeometry = new THREE.PlaneGeometry(0.3, FIELD_WIDTH);
    const los = new THREE.Mesh(losGeometry, losMaterial);
    los.rotation.x = -Math.PI / 2;
    los.position.set(0, 0.03, FIELD_WIDTH / 2);
    los.visible = false;
    scene.add(los);
    losRef.current = los;

    // Create First Down line (yellow)
    const firstDownMaterial = new THREE.MeshBasicMaterial({
      color: 0xeab308,
      transparent: true,
      opacity: 0.8
    });
    const firstDownGeometry = new THREE.PlaneGeometry(0.3, FIELD_WIDTH);
    const firstDown = new THREE.Mesh(firstDownGeometry, firstDownMaterial);
    firstDown.rotation.x = -Math.PI / 2;
    firstDown.position.set(0, 0.03, FIELD_WIDTH / 2);
    firstDown.visible = false;
    scene.add(firstDown);
    firstDownRef.current = firstDown;

    // Animation loop with smooth WASD + Q/E camera movement AND 60fps interpolation
    const baseAcceleration = 0.03; // Slower acceleration for smoother feel
    const damping = 0.92; // Higher damping = more glide
    const baseMaxSpeed = 0.8;

    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);

      // === CAMERA MOVEMENT (only when right-click is held) ===
      const keys = keysPressed.current;
      const vel = cameraVelocity.current;
      const yaw = cameraEuler.current.yaw;

      // Calculate target velocity based on keys (only if dragging/right-click held)
      let targetVelX = 0, targetVelY = 0, targetVelZ = 0;

      if (isDragging.current) {
        // Forward/back (W/S) - inverted to match camera direction
        if (keys['KeyW']) {
          targetVelX -= Math.sin(yaw);
          targetVelZ -= Math.cos(yaw);
        }
        if (keys['KeyS']) {
          targetVelX += Math.sin(yaw);
          targetVelZ += Math.cos(yaw);
        }

        // Strafe left/right (A/D)
        if (keys['KeyA']) {
          targetVelX -= Math.cos(yaw);
          targetVelZ += Math.sin(yaw);
        }
        if (keys['KeyD']) {
          targetVelX += Math.cos(yaw);
          targetVelZ -= Math.sin(yaw);
        }

        // Vertical (Q to raise, E to lower)
        if (keys['KeyQ']) {
          targetVelY += 1;
        }
        if (keys['KeyE']) {
          targetVelY -= 1;
        }
      }

      // Get current speed multiplier
      const speedMult = cameraSpeedRef.current;
      const maxSpeed = baseMaxSpeed * speedMult;
      const acceleration = baseAcceleration * (0.5 + speedMult * 0.5);

      // Accelerate toward target
      if (targetVelX !== 0 || targetVelZ !== 0 || targetVelY !== 0) {
        vel.x += (targetVelX * maxSpeed - vel.x) * acceleration;
        vel.y += (targetVelY * maxSpeed - vel.y) * acceleration;
        vel.z += (targetVelZ * maxSpeed - vel.z) * acceleration;
      } else {
        // Apply damping when no input
        vel.x *= damping;
        vel.y *= damping;
        vel.z *= damping;
      }

      // Apply velocity to position (only if not in follow mode)
      if (cameraPresetRef.current !== 'follow') {
        camera.position.x += vel.x;
        camera.position.y = Math.max(1, camera.position.y + vel.y);
        camera.position.z += vel.z;
      }

      // === FOLLOW BALL CAMERA ===
      if (cameraPresetRef.current === 'follow' && ballRef.current) {
        const ballPos = ballRef.current.position;
        const targetX = ballPos.x - 12; // Behind the ball
        const targetY = ballPos.y + 8;  // Above the ball
        const targetZ = ballPos.z;      // Same z as ball

        // Smooth follow with lerp
        camera.position.x += (targetX - camera.position.x) * 0.08;
        camera.position.y += (targetY - camera.position.y) * 0.08;
        camera.position.z += (targetZ - camera.position.z) * 0.08;

        // Look at ball
        camera.lookAt(ballPos.x + 5, ballPos.y, ballPos.z);
      }

      // === FRAME INTERPOLATION (currentFrame is now a float from App.jsx) ===
      const play = playRef.current;
      const displayFrame = currentFrameRef.current;

      // Calculate floor/ceil frames and interpolation factor
      const frameFloor = Math.floor(displayFrame);
      const frameCeil = Math.min(frameFloor + 1, play?.numFrames || frameFloor);
      const t = displayFrame - frameFloor; // Interpolation factor (0-1)

      // Update player positions with interpolation and speed trails
      if (play && playersRef.current.length > 0) {
        playersRef.current.forEach(playerGroup => {
          const playerData = playerGroup.userData;

          // Find current and next frame data
          const frameA = playerData.frames.find(f => f.f === frameFloor);
          const frameB = playerData.frames.find(f => f.f === frameCeil);

          if (frameA) {
            const prevX = playerGroup.position.x;
            const prevZ = playerGroup.position.z;

            if (frameB && frameB !== frameA) {
              // Interpolate between frames
              playerGroup.position.x = lerp(frameA.x, frameB.x, t);
              playerGroup.position.z = lerp(frameA.y, frameB.y, t);
            } else {
              // No next frame, use current
              playerGroup.position.x = frameA.x;
              playerGroup.position.z = frameA.y;
            }

            // Rotate player to face movement direction
            const dx = playerGroup.position.x - prevX;
            const dz = playerGroup.position.z - prevZ;
            if (Math.abs(dx) > 0.05 || Math.abs(dz) > 0.05) {
              playerGroup.rotation.y = Math.atan2(dx, dz);
            }

            // Update position history for speed trails
            const history = playerData.positionHistory || [];
            history.unshift({ x: playerGroup.position.x, z: playerGroup.position.z });
            if (history.length > 6) history.pop();
            playerData.positionHistory = history;

            // Update speed trail dots
            const speed = Math.sqrt(dx * dx + dz * dz);
            const trailDots = playerData.trailDots;
            if (trailDots && speed > 0.1) {
              trailDots.forEach((dot, i) => {
                if (history[i + 1]) {
                  dot.position.x = history[i + 1].x;
                  dot.position.z = history[i + 1].z;
                  dot.visible = true;
                } else {
                  dot.visible = false;
                }
              });
            } else if (trailDots) {
              trailDots.forEach(dot => dot.visible = false);
            }
          }
        });

        // Update ball position with interpolation
        if (ballRef.current) {
          const passer = play.players?.find(p => p.role === 'Passer');
          const target = play.players?.find(p => p.role === 'Targeted Receiver');

          // Use numInputFrames as throw frame (end of input data = ball release)
          const throwFrame = play.numInputFrames || Math.floor((play.numFrames || 50) * 0.35);
          const catchFrame = play.numFrames || throwFrame + 20;

          if (displayFrame <= throwFrame && passer) {
            // Ball in QB's hands - interpolate with passer position
            const passerFrameA = passer.frames.find(f => f.f === frameFloor);
            const passerFrameB = passer.frames.find(f => f.f === frameCeil);

            if (passerFrameA) {
              if (passerFrameB && passerFrameB !== passerFrameA) {
                ballRef.current.position.x = lerp(passerFrameA.x, passerFrameB.x, t);
                ballRef.current.position.z = lerp(passerFrameA.y, passerFrameB.y, t);
              } else {
                ballRef.current.position.x = passerFrameA.x;
                ballRef.current.position.z = passerFrameA.y;
              }
              ballRef.current.position.y = 1.8;
            }
          } else if (displayFrame > throwFrame && displayFrame <= catchFrame && passer && play.ballLandX) {
            // Ball in flight - parabolic arc with enhanced glow
            const passerThrowFrame = passer.frames.find(f => f.f === throwFrame);
            if (passerThrowFrame) {
              const startX = passerThrowFrame.x;
              const startZ = passerThrowFrame.y;
              const endX = play.ballLandX;
              const endZ = play.ballLandY || startZ;

              // Smooth progress through flight
              const progress = (displayFrame - throwFrame) / (catchFrame - throwFrame);

              // Linear interpolation for X and Z
              const ballX = lerp(startX, endX, progress);
              const ballZ = lerp(startZ, endZ, progress);

              // Parabolic arc for Y (height)
              const distance = Math.sqrt((endX - startX) ** 2 + (endZ - startZ) ** 2);
              const arcHeight = Math.min(distance * 0.15, 12);
              const ballY = 1.8 + Math.sin(progress * Math.PI) * arcHeight;

              ballRef.current.position.set(ballX, ballY, ballZ);

              // Enhanced glow during flight
              if (ballRef.current.userData.light) {
                ballRef.current.userData.light.intensity = 1.5; // Brighter during flight
              }
              if (ballRef.current.userData.glow) {
                ballRef.current.userData.glow.scale.setScalar(1.5);
              }
              if (ballRef.current.userData.material) {
                ballRef.current.userData.material.emissiveIntensity = 0.5;
              }
            }
          } else if (displayFrame > catchFrame && target) {
            // Ball caught - follow receiver with interpolation
            const targetFrameA = target.frames.find(f => f.f === frameFloor);
            const targetFrameB = target.frames.find(f => f.f === frameCeil);

            if (targetFrameA) {
              if (targetFrameB && targetFrameB !== targetFrameA) {
                ballRef.current.position.x = lerp(targetFrameA.x, targetFrameB.x, t);
                ballRef.current.position.z = lerp(targetFrameA.y, targetFrameB.y, t);
              } else {
                ballRef.current.position.x = targetFrameA.x;
                ballRef.current.position.z = targetFrameA.y;
              }
              ballRef.current.position.y = 1.5;

              // Catch flash effect (brief bright pulse that fades)
              const catchProgress = displayFrame - catchFrame;
              if (catchProgress < 3) {
                const flashIntensity = Math.max(0, 2 - catchProgress * 0.6);
                if (ballRef.current.userData.light) {
                  ballRef.current.userData.light.intensity = flashIntensity;
                }
                if (ballRef.current.userData.glow) {
                  ballRef.current.userData.glow.scale.setScalar(1 + flashIntensity);
                }
                if (ballRef.current.userData.material) {
                  ballRef.current.userData.material.emissiveIntensity = flashIntensity * 0.5;
                }
              } else {
                // Normal after catch
                if (ballRef.current.userData.light) {
                  ballRef.current.userData.light.intensity = 0.3;
                }
                if (ballRef.current.userData.glow) {
                  ballRef.current.userData.glow.scale.setScalar(1);
                }
                if (ballRef.current.userData.material) {
                  ballRef.current.userData.material.emissiveIntensity = 0.1;
                }
              }
            }
          } else {
            // Ball in QB's hands - dim glow
            if (ballRef.current.userData.light) {
              ballRef.current.userData.light.intensity = 0.3;
            }
            if (ballRef.current.userData.glow) {
              ballRef.current.userData.glow.scale.setScalar(1);
            }
          }

          // Update ball trail when in flight
          const isInFlight = displayFrame > throwFrame && displayFrame <= catchFrame;
          ballTrailRef.current.forEach((trail, i) => {
            if (isInFlight && passer && play.ballLandX) {
              const passerThrowFrame = passer.frames.find(f => f.f === throwFrame);
              if (passerThrowFrame) {
                const trailProgress = Math.max(0, (displayFrame - throwFrame - (i + 1) * 0.3) / (catchFrame - throwFrame));
                if (trailProgress > 0 && trailProgress < 1) {
                  const startX = passerThrowFrame.x;
                  const startZ = passerThrowFrame.y;
                  const endX = play.ballLandX;
                  const endZ = play.ballLandY || startZ;
                  const distance = Math.sqrt((endX - startX) ** 2 + (endZ - startZ) ** 2);
                  const arcHeight = Math.min(distance * 0.15, 12);

                  trail.position.x = lerp(startX, endX, trailProgress);
                  trail.position.z = lerp(startZ, endZ, trailProgress);
                  trail.position.y = 1.8 + Math.sin(trailProgress * Math.PI) * arcHeight;
                  trail.visible = true;
                } else {
                  trail.visible = false;
                }
              }
            } else {
              trail.visible = false;
            }
          });
        }
      }

      renderer.render(scene, camera);
    };
    animate();

    // Handle resize
    const handleResize = () => {
      if (!containerRef.current) return;
      camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    // Unity-style mouse look (right-click drag)
    const handleMouseDown = (e) => {
      if (e.button === 2 || e.button === 0) { // Right or left click
        isDragging.current = true;
        previousMousePosition.current = { x: e.clientX, y: e.clientY };
      }
    };

    const handleMouseMove = (e) => {
      if (!isDragging.current) return;

      const deltaX = e.clientX - previousMousePosition.current.x;
      const deltaY = e.clientY - previousMousePosition.current.y;

      // Update camera angles (yaw and pitch)
      cameraEuler.current.yaw -= deltaX * 0.003;
      cameraEuler.current.pitch -= deltaY * 0.003;
      cameraEuler.current.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, cameraEuler.current.pitch));

      // Apply rotation to camera
      camera.rotation.order = 'YXZ';
      camera.rotation.y = cameraEuler.current.yaw;
      camera.rotation.x = cameraEuler.current.pitch;

      previousMousePosition.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUp = () => {
      isDragging.current = false;
    };

    const handleWheel = (e) => {
      // Zoom: move camera forward/back
      camera.position.x += Math.sin(cameraEuler.current.yaw) * (-e.deltaY * 0.05);
      camera.position.z += Math.cos(cameraEuler.current.yaw) * (-e.deltaY * 0.05);
    };

    const handleContextMenu = (e) => {
      e.preventDefault(); // Prevent right-click menu
    };

    // Keyboard controls
    const handleKeyDown = (e) => {
      keysPressed.current[e.code] = true;
    };

    const handleKeyUp = (e) => {
      keysPressed.current[e.code] = false;
    };

    renderer.domElement.addEventListener('mousedown', handleMouseDown);
    renderer.domElement.addEventListener('mousemove', handleMouseMove);
    renderer.domElement.addEventListener('mouseup', handleMouseUp);
    renderer.domElement.addEventListener('mouseleave', handleMouseUp);
    renderer.domElement.addEventListener('wheel', handleWheel);
    renderer.domElement.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      cancelAnimationFrame(frameIdRef.current);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      renderer.domElement.removeEventListener('mousedown', handleMouseDown);
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      renderer.domElement.removeEventListener('mouseup', handleMouseUp);
      renderer.domElement.removeEventListener('mouseleave', handleMouseUp);
      renderer.domElement.removeEventListener('wheel', handleWheel);
      renderer.domElement.removeEventListener('contextmenu', handleContextMenu);
      renderer.dispose();
      containerRef.current?.removeChild(renderer.domElement);
    };
  }, []);

  // Chart/Routes Mode - show all filtered plays overlaid
  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;

    // Clean up existing overlay
    if (passChartRef.current) {
      passChartRef.current.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      scene.remove(passChartRef.current);
      passChartRef.current = null;
    }

    // Hide/show players based on view mode
    playersRef.current.forEach(p => p.visible = viewMode === 'replay');
    if (ballRef.current) ballRef.current.visible = viewMode === 'replay';
    ballTrailRef.current.forEach(t => t.visible = false);

    // Only proceed for chart or routes mode
    if ((viewMode !== 'chart' && viewMode !== 'routes') || !filteredPlays.length) return;

    // Create overlay group
    const chartGroup = new THREE.Group();
    passChartRef.current = chartGroup;

    // Track bounding box for camera centering
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    let avgLOS = 0;
    filteredPlays.forEach(p => avgLOS += (p.yardline || 30));
    avgLOS = avgLOS / filteredPlays.length;

    // === ROUTES MODE - THE WOW MOMENT ===
    // Shows ONLY the targeted receiver's route for each play
    // Plays are pre-filtered by targetPlayer in tendencyEngine
    if (viewMode === 'routes') {
      const routeColor = 0x00ffff; // Cyan for route lines

      filteredPlays.forEach((playData) => {
        // ONLY show the targeted receiver - this is the key
        const target = playData.players?.find(p => p.role === 'Targeted Receiver');
        if (!target?.frames || target.frames.length < 3) return;

        // Determine completion status
        const isComplete = playData.passResult === 'C' || playData.passResult === 'complete' ||
                          (playData.yardsGained && playData.yardsGained > 0);
        const endpointColor = isComplete ? 0x22c55e : 0xef4444; // Green for catch, red for incomplete

        // Build points from tracking frames
        const points = [];
        const sortedFrames = [...target.frames].sort((a, b) => a.f - b.f);

        // Sample every 2nd frame for smoother lines
        for (let i = 0; i < sortedFrames.length; i += 2) {
          const frame = sortedFrames[i];
          points.push(new THREE.Vector3(frame.x, 0.3, frame.y));
          // Track bounds
          minX = Math.min(minX, frame.x);
          maxX = Math.max(maxX, frame.x);
          minZ = Math.min(minZ, frame.y);
          maxZ = Math.max(maxZ, frame.y);
        }
        // Always include last frame
        const lastFrame = sortedFrames[sortedFrames.length - 1];
        points.push(new THREE.Vector3(lastFrame.x, 0.3, lastFrame.y));
        minX = Math.min(minX, lastFrame.x);
        maxX = Math.max(maxX, lastFrame.x);
        minZ = Math.min(minZ, lastFrame.y);
        maxZ = Math.max(maxZ, lastFrame.y);

        if (points.length < 2) return;

        // Create smooth curve
        const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);

        // Visible route line - overlaps accumulate brightness
        const tubeGeometry = new THREE.TubeGeometry(curve, Math.min(points.length * 3, 48), 0.12, 6, false);
        const tubeMaterial = new THREE.MeshBasicMaterial({
          color: routeColor,
          transparent: true,
          opacity: 0.35
        });
        const routeTube = new THREE.Mesh(tubeGeometry, tubeMaterial);
        chartGroup.add(routeTube);

        // FAT BRIGHT ENDPOINT DOT - Green = catch, Red = incomplete
        const endPoint = points[points.length - 1];
        const dotGeometry = new THREE.SphereGeometry(1.0, 16, 16);
        const dotMaterial = new THREE.MeshBasicMaterial({
          color: endpointColor,
          transparent: true,
          opacity: 0.95
        });
        const dot = new THREE.Mesh(dotGeometry, dotMaterial);
        dot.position.copy(endPoint);
        chartGroup.add(dot);

        // Glow around endpoint (same color as completion status)
        const glowGeometry = new THREE.SphereGeometry(1.5, 16, 16);
        const glowMaterial = new THREE.MeshBasicMaterial({
          color: endpointColor,
          transparent: true,
          opacity: 0.3
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        glow.position.copy(endPoint);
        chartGroup.add(glow);
      });

      // Add LOS line for context
      const losMaterial = new THREE.MeshBasicMaterial({
        color: 0x3b82f6,
        transparent: true,
        opacity: 0.8
      });
      const losGeometry = new THREE.PlaneGeometry(0.5, FIELD_WIDTH);
      const losLine = new THREE.Mesh(losGeometry, losMaterial);
      losLine.rotation.x = -Math.PI / 2;
      losLine.position.set(avgLOS, 0.1, FIELD_WIDTH / 2);
      chartGroup.add(losLine);
    }

    // === CHART MODE - Pass locations ===
    else if (viewMode === 'chart') {
      filteredPlays.forEach((playData, idx) => {
        if (!playData.ballLandX) return;

        const passer = playData.players?.find(p => p.role === 'Passer');
        if (!passer?.frames?.length) return;

        const throwFrame = playData.numInputFrames || Math.floor((playData.numFrames || 50) * 0.35);
        const qbFrame = passer.frames.find(f => f.f === throwFrame) || passer.frames[0];
        if (!qbFrame) return;

        const startX = qbFrame.x;
        const startZ = qbFrame.y;
        const endX = playData.ballLandX;
        const endZ = playData.ballLandY || startZ;

        // Track bounds for camera
        minX = Math.min(minX, startX, endX);
        maxX = Math.max(maxX, startX, endX);
        minZ = Math.min(minZ, startZ, endZ);
        maxZ = Math.max(maxZ, startZ, endZ);

        // Completion status - GREEN = catch, RED = incomplete
        const isComplete = playData.passResult === 'C' || playData.passResult === 'complete' ||
                          (playData.yardsGained && playData.yardsGained > 0);
        const isTouchdown = playData.isTouchdown || (endX >= 110);

        // Dot colors: green for complete, red for incomplete, gold for TD
        let dotColor = isComplete ? 0x22c55e : 0xef4444;
        if (isTouchdown) dotColor = 0xFFD700;

        // Ball trajectory - THIN line, LOW opacity (overlaps show pattern)
        const midX = (startX + endX) / 2;
        const midZ = (startZ + endZ) / 2;
        const distance = Math.sqrt((endX - startX) ** 2 + (endZ - startZ) ** 2);
        const arcHeight = Math.min(distance * 0.08, 4);

        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(startX, 0.2, startZ),
          new THREE.Vector3(midX, arcHeight, midZ),
          new THREE.Vector3(endX, 0.2, endZ)
        );

        // Visible but thin line - overlaps accumulate brightness
        const tubeGeometry = new THREE.TubeGeometry(curve, 20, 0.12, 6, false);
        const tubeMaterial = new THREE.MeshBasicMaterial({
          color: 0x66BBFF,
          transparent: true,
          opacity: 0.35
        });
        chartGroup.add(new THREE.Mesh(tubeGeometry, tubeMaterial));

        // BIG landing dot - this is what coaches look at
        // Outer ring
        const ringGeometry = new THREE.RingGeometry(1.0, 1.5, 32);
        const ringMaterial = new THREE.MeshBasicMaterial({
          color: dotColor,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(endX, 0.12, endZ);
        chartGroup.add(ring);

        // Inner fill
        const innerGeometry = new THREE.CircleGeometry(1.0, 32);
        const innerMaterial = new THREE.MeshBasicMaterial({
          color: dotColor,
          transparent: true,
          opacity: 0.7
        });
        const inner = new THREE.Mesh(innerGeometry, innerMaterial);
        inner.rotation.x = -Math.PI / 2;
        inner.position.set(endX, 0.13, endZ);
        chartGroup.add(inner);

        // White center eye
        const eyeGeometry = new THREE.CircleGeometry(0.35, 16);
        const eye = new THREE.Mesh(eyeGeometry, new THREE.MeshBasicMaterial({ color: 0xffffff }));
        eye.rotation.x = -Math.PI / 2;
        eye.position.set(endX, 0.14, endZ);
        chartGroup.add(eye);
      });
    }

    scene.add(chartGroup);

    // Set camera to center on all routes/passes
    if (cameraRef.current) {
      const camera = cameraRef.current;

      // Calculate center of all route data
      let centerX, centerZ, cameraHeight;

      if (minX !== Infinity && maxX !== -Infinity) {
        // We have valid bounds from routes - center on them
        centerX = (minX + maxX) / 2;
        centerZ = (minZ + maxZ) / 2;

        // Calculate camera height based on spread of routes
        const spanX = maxX - minX;
        const spanZ = maxZ - minZ;
        const maxSpan = Math.max(spanX, spanZ, 30);
        cameraHeight = Math.max(50, maxSpan * 1.2);
      } else {
        // Fallback to avgLOS
        centerX = avgLOS + 10;
        centerZ = FIELD_WIDTH / 2;
        cameraHeight = 70;
      }

      camera.position.set(centerX, cameraHeight, centerZ);
      cameraEuler.current = { yaw: Math.PI / 2, pitch: -Math.PI / 2.1 }; // More straight down
      camera.rotation.order = 'YXZ';
      camera.rotation.y = cameraEuler.current.yaw;
      camera.rotation.x = cameraEuler.current.pitch;
    }

  }, [viewMode, filteredPlays]);

  // Update players when play changes
  useEffect(() => {
    console.log('Field3D: play changed', play ? `${play.players?.length} players` : 'no play');
    if (!sceneRef.current || !play) return;

    const scene = sceneRef.current;

    // Remove old players (dispose geometries and materials)
    playersRef.current.forEach(playerGroup => {
      playerGroup.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      scene.remove(playerGroup);
    });
    playersRef.current = [];
    if (ballRef.current) {
      scene.remove(ballRef.current);
      ballRef.current = null;
    }

    // Create players - BIGGER, clearer colors
    play.players.forEach(playerData => {
      // Clear color scheme:
      // - Offense: bright white/blue
      // - Defense: orange/red
      // - QB (Passer): BIG glowing gold
      // - Target: BIG glowing cyan
      const isOffense = playerData.side === 'Offense';
      const isQB = playerData.role === 'Passer';
      const isTarget = playerData.role === 'Targeted Receiver';
      const isKeyPlayer = isQB || isTarget;

      // Size - key players are BIGGER
      const bodyRadius = isKeyPlayer ? 1.2 : 0.9;  // Much bigger than before (was 0.5)
      const bodyHeight = isKeyPlayer ? 2.0 : 1.6;
      const headRadius = isKeyPlayer ? 0.5 : 0.4;

      // Colors - clear distinction
      let bodyColor, emissiveColor, emissiveIntensity, headColor;

      if (isQB) {
        // QB: Bright gold, strong glow
        bodyColor = 0xFFD700;
        emissiveColor = 0xFFD700;
        emissiveIntensity = 0.6;
        headColor = 0xFFFFFF;
      } else if (isTarget) {
        // Target receiver: Bright cyan, strong glow
        bodyColor = 0x00FFFF;
        emissiveColor = 0x00FFFF;
        emissiveIntensity = 0.6;
        headColor = 0xFFFFFF;
      } else if (isOffense) {
        // Offense: Bright white/light blue
        bodyColor = 0x4488FF;
        emissiveColor = 0x4488FF;
        emissiveIntensity = 0.15;
        headColor = 0xFFFFFF;
      } else {
        // Defense: Orange/red - clearly different
        bodyColor = 0xFF6600;
        emissiveColor = 0xFF4400;
        emissiveIntensity = 0.2;
        headColor = 0xFF8800;
      }

      // Create player group
      const playerGroup = new THREE.Group();
      playerGroup.userData = { ...playerData, positionHistory: [] };

      // Body - BIGGER capsule, HIGH resolution
      const bodyGeometry = new THREE.CapsuleGeometry(bodyRadius, bodyHeight, 16, 32);
      const bodyMaterial = new THREE.MeshStandardMaterial({
        color: bodyColor,
        roughness: 0.4,
        metalness: 0.2,
        emissive: emissiveColor,
        emissiveIntensity: emissiveIntensity
      });
      const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
      body.position.y = bodyHeight / 2 + bodyRadius;
      playerGroup.add(body);

      // Head - proportional to body, HIGH resolution
      const headGeometry = new THREE.SphereGeometry(headRadius, 32, 32);
      const headMaterial = new THREE.MeshStandardMaterial({
        color: headColor,
        roughness: 0.3,
        metalness: 0.3,
        emissive: emissiveColor,
        emissiveIntensity: emissiveIntensity * 0.5
      });
      const head = new THREE.Mesh(headGeometry, headMaterial);
      head.position.y = bodyHeight + bodyRadius * 2 + headRadius * 0.8;
      playerGroup.add(head);

      // Glow ring for key players (QB and target)
      if (isKeyPlayer) {
        const ringGeometry = new THREE.RingGeometry(bodyRadius + 0.3, bodyRadius + 0.6, 48);
        const ringMaterial = new THREE.MeshBasicMaterial({
          color: emissiveColor,
          transparent: true,
          opacity: 0.4,
          side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.1;
        playerGroup.add(ring);
      }

      // Jersey number sprite
      const jerseyNumber = playerData.nflId ? playerData.nflId % 100 : Math.floor(Math.random() * 99) + 1;
      const numberColor = isOffense ? '#ffffff' : '#ffff00';
      const numberSprite = createNumberSprite(jerseyNumber, numberColor);
      numberSprite.position.set(0, bodyHeight + bodyRadius * 2 + headRadius * 2 + 0.5, 0);
      numberSprite.scale.setScalar(isKeyPlayer ? 1.5 : 1.2);
      playerGroup.add(numberSprite);

      // Point light for key players
      if (isKeyPlayer) {
        const playerLight = new THREE.PointLight(emissiveColor, 1.0, 15);
        playerLight.position.y = bodyHeight / 2;
        playerGroup.add(playerLight);
      }

      // Speed trail dots - ONLY for offensive skill players (not QB, not defense)
      const trailDots = [];
      const isOffensiveSkillPlayer = playerData.side === 'Offense' && playerData.role !== 'Passer';

      if (isOffensiveSkillPlayer) {
        for (let i = 0; i < 5; i++) {
          // Bigger dots to match bigger players
          const dotSize = isTarget ? 0.4 - i * 0.05 : 0.25 - i * 0.03;
          const dotGeometry = new THREE.SphereGeometry(dotSize, 16, 16);
          const dotMaterial = new THREE.MeshBasicMaterial({
            color: isTarget ? 0x00FFFF : bodyColor, // Cyan for target
            transparent: true,
            opacity: isTarget ? 0.6 - i * 0.1 : 0.3 - i * 0.05
          });
          const dot = new THREE.Mesh(dotGeometry, dotMaterial);
          dot.visible = false;
          dot.position.y = 0.8;
          scene.add(dot);
          trailDots.push(dot);
        }
      }
      playerGroup.userData.trailDots = trailDots;

      // Position at first frame (find frame with f=1)
      if (playerData.frames.length > 0) {
        const frame = playerData.frames.find(f => f.f === 1) || playerData.frames[0];
        playerGroup.position.set(frame.x, 0, frame.y);
      }

      scene.add(playerGroup);
      playersRef.current.push(playerGroup);
    });

    // Create ball group (ball + light + glow)
    const ballGroup = new THREE.Group();

    // Football shape - BIGGER and more visible, HIGH resolution
    const ballGeometry = new THREE.SphereGeometry(0.5, 32, 32);
    ballGeometry.scale(1.6, 1, 1); // Elongate to football shape
    const ballMaterial = new THREE.MeshStandardMaterial({
      color: 0xCC7722,
      roughness: 0.4,
      metalness: 0.3,
      emissive: 0xFFAA00,
      emissiveIntensity: 0.4,
    });
    const ballMesh = new THREE.Mesh(ballGeometry, ballMaterial);
    ballGroup.add(ballMesh);

    // Glow sphere around ball (larger, transparent)
    const glowGeometry = new THREE.SphereGeometry(0.9, 24, 24);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xFFDD44,
      transparent: true,
      opacity: 0.25
    });
    const ballGlow = new THREE.Mesh(glowGeometry, glowMaterial);
    ballGroup.add(ballGlow);
    ballGroup.userData.glow = ballGlow;

    // Point light attached to ball (lights up nearby players)
    const ballLight = new THREE.PointLight(0xFFDD88, 1.2, 20);
    ballGroup.add(ballLight);
    ballGroup.userData.light = ballLight;

    // Store material ref for catch flash effect
    ballGroup.userData.material = ballMaterial;
    ballGroup.userData.glowMaterial = glowMaterial;

    // Position ball at passer initially
    const passer = play.players?.find(p => p.role === 'Passer');
    if (passer && passer.frames.length > 0) {
      const frame = passer.frames.find(f => f.f === 1) || passer.frames[0];
      ballGroup.position.set(frame.x, 1.8, frame.y);
    } else if (play.ball && play.ball.length > 0) {
      const frame = play.ball[0];
      ballGroup.position.set(frame.x, 1, frame.y);
    }

    scene.add(ballGroup);
    ballRef.current = ballGroup;

    // Create ball trail (10 glowing spheres for better visibility)
    ballTrailRef.current.forEach(t => scene.remove(t));
    ballTrailRef.current = [];
    for (let i = 0; i < 10; i++) {
      const trailGeometry = new THREE.SphereGeometry(0.2 - i * 0.015, 12, 12);
      const trailMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffaa,
        transparent: true,
        opacity: 0.6 - i * 0.055,
      });
      const trailBall = new THREE.Mesh(trailGeometry, trailMaterial);
      trailBall.visible = false;
      scene.add(trailBall);
      ballTrailRef.current.push(trailBall);
    }

    // Report frame count
    if (onFrameCount && play.numFrames) {
      onFrameCount(play.numFrames);
    }

    // Update LOS and First Down markers
    if (losRef.current && play.yardline) {
      // yardline is absolute field position (10-110 for playing field)
      const losX = play.yardline || 30;
      losRef.current.position.x = losX;
      losRef.current.visible = true;
    }

    if (firstDownRef.current && play.yardline && play.yardsToGo) {
      // First down marker - add yards to go to LOS position
      // Direction depends on which way offense is going
      const losX = play.yardline || 30;
      const direction = play.direction === 'left' ? -1 : 1;
      const firstDownX = losX + (play.yardsToGo * direction);

      // Only show if within playing field
      if (firstDownX >= 10 && firstDownX <= 110) {
        firstDownRef.current.position.x = firstDownX;
        firstDownRef.current.visible = true;
      } else {
        firstDownRef.current.visible = false;
      }
    }

    // Center camera on the play
    if (cameraRef.current) {
      const camera = cameraRef.current;
      const losX = play.yardline || 35;

      // Position camera behind the offense looking downfield
      camera.position.set(losX - 15, 20, FIELD_WIDTH / 2);
      cameraEuler.current = { yaw: Math.PI / 2, pitch: -0.3 };
      cameraVelocity.current = { x: 0, y: 0, z: 0 };

      camera.rotation.order = 'YXZ';
      camera.rotation.y = cameraEuler.current.yaw;
      camera.rotation.x = cameraEuler.current.pitch;
    }
  }, [play, onFrameCount]);

  // Handle camera reset
  useEffect(() => {
    if (!cameraRef.current || resetCamera === 0) return;

    const camera = cameraRef.current;
    const losX = play?.yardline || 35;

    // Reset to behind QB position, facing downfield (+X direction)
    camera.position.set(losX - 15, 20, FIELD_WIDTH / 2);
    cameraEuler.current = { yaw: Math.PI / 2, pitch: -0.3 }; // 90 degrees = facing +X
    cameraVelocity.current = { x: 0, y: 0, z: 0 };

    camera.rotation.order = 'YXZ';
    camera.rotation.y = cameraEuler.current.yaw;
    camera.rotation.x = cameraEuler.current.pitch;
  }, [resetCamera, play]);

  // Handle camera presets
  useEffect(() => {
    if (!cameraRef.current || !play) return;
    const camera = cameraRef.current;
    const losX = play.yardline || 35;

    // Reset velocity when changing presets
    cameraVelocity.current = { x: 0, y: 0, z: 0 };

    switch (cameraPreset) {
      case 'behind':
        // Behind QB looking downfield (+X direction)
        camera.position.set(losX - 15, 20, FIELD_WIDTH / 2);
        cameraEuler.current = { yaw: Math.PI / 2, pitch: -0.3 };
        break;
      case 'all22':
        // High overhead view looking down at field
        camera.position.set(losX + 10, 60, FIELD_WIDTH / 2);
        cameraEuler.current = { yaw: Math.PI / 2, pitch: -1.2 };
        break;
      case 'endzone':
        // From downfield looking back toward QB (-X direction)
        // Positioned in the open area before the east stands
        camera.position.set(losX + 65, 18, FIELD_WIDTH / 2);
        cameraEuler.current = { yaw: -Math.PI / 2, pitch: -0.2 };
        break;
      case 'sideline':
        // Sideline broadcast view (from side, looking across field)
        // Positioned in the open area before the north stands
        camera.position.set(losX + 5, 18, -30);
        cameraEuler.current = { yaw: Math.PI, pitch: -0.2 };
        break;
      default:
        break;
    }

    // Apply rotation
    camera.rotation.order = 'YXZ';
    camera.rotation.y = cameraEuler.current.yaw;
    camera.rotation.x = cameraEuler.current.pitch;
  }, [cameraPreset, play]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        minHeight: '400px',
        cursor: isDragging.current ? 'grabbing' : 'grab'
      }}
    />
  );
}

function createField(scene) {
  // Stadium ground (dark surface under everything) - expanded for larger stadium
  const groundGeometry = new THREE.PlaneGeometry(300, 250, 1, 1);
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1a2e,
    roughness: 0.9
  });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(FIELD_LENGTH / 2, -0.1, FIELD_WIDTH / 2);
  scene.add(ground);

  // Main field surface - higher resolution with grass texture simulation
  const fieldGeometry = new THREE.PlaneGeometry(FIELD_LENGTH, FIELD_WIDTH, 120, 54);
  const fieldMaterial = new THREE.MeshStandardMaterial({
    color: 0x228B22,  // Brighter green
    roughness: 0.8,
    metalness: 0.0
  });
  const field = new THREE.Mesh(fieldGeometry, fieldMaterial);
  field.rotation.x = -Math.PI / 2;
  field.position.set(FIELD_LENGTH / 2, 0, FIELD_WIDTH / 2);
  scene.add(field);

  // Alternating grass stripes (lighter/darker green every 5 yards)
  for (let yard = 10; yard < 110; yard += 10) {
    const stripeGeometry = new THREE.PlaneGeometry(5, FIELD_WIDTH, 1, 1);
    const stripeMaterial = new THREE.MeshStandardMaterial({
      color: 0x1e7b1e, // Slightly darker green
      roughness: 0.8
    });
    const stripe = new THREE.Mesh(stripeGeometry, stripeMaterial);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(yard + 2.5, 0.005, FIELD_WIDTH / 2);
    scene.add(stripe);
  }

  // End zones with BRIGHT team colors
  const endZoneGeometry = new THREE.PlaneGeometry(10, FIELD_WIDTH, 10, 54);

  // Left end zone (home team) - BRIGHT RED
  const leftEndZoneMaterial = new THREE.MeshStandardMaterial({
    color: 0xFF4444,
    roughness: 0.6,
    emissive: 0xFF2222,
    emissiveIntensity: 0.15
  });
  const leftEndZone = new THREE.Mesh(endZoneGeometry, leftEndZoneMaterial);
  leftEndZone.rotation.x = -Math.PI / 2;
  leftEndZone.position.set(5, 0.01, FIELD_WIDTH / 2);
  scene.add(leftEndZone);

  // Right end zone (away team) - BRIGHT BLUE
  const rightEndZoneMaterial = new THREE.MeshStandardMaterial({
    color: 0x3366CC,
    roughness: 0.6,
    emissive: 0x2244AA,
    emissiveIntensity: 0.15
  });
  const rightEndZone = new THREE.Mesh(endZoneGeometry, rightEndZoneMaterial);
  rightEndZone.rotation.x = -Math.PI / 2;
  rightEndZone.position.set(115, 0.01, FIELD_WIDTH / 2);
  scene.add(rightEndZone);

  // Yard lines (crisp white)
  const lineMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.5,
    emissive: 0xffffff,
    emissiveIntensity: 0.1
  });

  for (let yard = 10; yard <= 110; yard += 5) {
    const lineGeometry = new THREE.PlaneGeometry(0.25, FIELD_WIDTH);
    const line = new THREE.Mesh(lineGeometry, lineMaterial);
    line.rotation.x = -Math.PI / 2;
    line.position.set(yard, 0.02, FIELD_WIDTH / 2);
    scene.add(line);
  }

  // Hash marks
  const hashMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  const hashY1 = FIELD_WIDTH / 2 - 18.5 / 2;
  const hashY2 = FIELD_WIDTH / 2 + 18.5 / 2;

  for (let yard = 11; yard <= 109; yard++) {
    if ((yard - 10) % 5 !== 0) {
      const hash1 = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 1.2), hashMaterial);
      hash1.rotation.x = -Math.PI / 2;
      hash1.position.set(yard, 0.02, hashY1);
      scene.add(hash1);

      const hash2 = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 1.2), hashMaterial);
      hash2.rotation.x = -Math.PI / 2;
      hash2.position.set(yard, 0.02, hashY2);
      scene.add(hash2);
    }
  }

  // Sidelines
  const sidelineGeometry = new THREE.PlaneGeometry(FIELD_LENGTH, 0.4);
  const sideline1 = new THREE.Mesh(sidelineGeometry, lineMaterial);
  sideline1.rotation.x = -Math.PI / 2;
  sideline1.position.set(FIELD_LENGTH / 2, 0.02, 0.2);
  scene.add(sideline1);

  const sideline2 = new THREE.Mesh(sidelineGeometry, lineMaterial);
  sideline2.rotation.x = -Math.PI / 2;
  sideline2.position.set(FIELD_LENGTH / 2, 0.02, FIELD_WIDTH - 0.2);
  scene.add(sideline2);

  // Goal lines
  const goalLineGeometry = new THREE.PlaneGeometry(0.4, FIELD_WIDTH);
  const goalLine1 = new THREE.Mesh(goalLineGeometry, lineMaterial);
  goalLine1.rotation.x = -Math.PI / 2;
  goalLine1.position.set(10, 0.02, FIELD_WIDTH / 2);
  scene.add(goalLine1);

  const goalLine2 = new THREE.Mesh(goalLineGeometry, lineMaterial);
  goalLine2.rotation.x = -Math.PI / 2;
  goalLine2.position.set(110, 0.02, FIELD_WIDTH / 2);
  scene.add(goalLine2);

  // Sideline areas (team benches area) - expanded for larger stadium
  const sidelineAreaGeometry = new THREE.PlaneGeometry(FIELD_LENGTH + 40, 35);
  const sidelineAreaMaterial = new THREE.MeshStandardMaterial({
    color: 0x2d3748,
    roughness: 0.9
  });

  const sidelineArea1 = new THREE.Mesh(sidelineAreaGeometry, sidelineAreaMaterial);
  sidelineArea1.rotation.x = -Math.PI / 2;
  sidelineArea1.position.set(FIELD_LENGTH / 2, 0.001, -17);
  scene.add(sidelineArea1);

  const sidelineArea2 = new THREE.Mesh(sidelineAreaGeometry, sidelineAreaMaterial);
  sidelineArea2.rotation.x = -Math.PI / 2;
  sidelineArea2.position.set(FIELD_LENGTH / 2, 0.001, FIELD_WIDTH + 17);
  scene.add(sidelineArea2);

  // Stadium bowl / stands
  createStadiumBowl(scene);

  // Egg crowd!
  createEggCrowd(scene);
}

function createSkyAndAtmosphere(scene) {
  // Sky dome with gradient
  const skyGeometry = new THREE.SphereGeometry(300, 32, 32);
  const skyMaterial = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(0x0077ff) },
      bottomColor: { value: new THREE.Color(0x87CEEB) },
      offset: { value: 20 },
      exponent: { value: 0.6 }
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + offset).y;
        gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
      }
    `,
    side: THREE.BackSide
  });
  const sky = new THREE.Mesh(skyGeometry, skyMaterial);
  scene.add(sky);

  // Sun
  const sunGeometry = new THREE.SphereGeometry(15, 32, 32);
  const sunMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    transparent: true,
    opacity: 1.0
  });
  const sun = new THREE.Mesh(sunGeometry, sunMaterial);
  sun.position.set(150, 120, -80);
  scene.add(sun);

  // Sun glow (larger transparent sphere)
  const sunGlowGeometry = new THREE.SphereGeometry(25, 32, 32);
  const sunGlowMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff88,
    transparent: true,
    opacity: 0.3
  });
  const sunGlow = new THREE.Mesh(sunGlowGeometry, sunGlowMaterial);
  sunGlow.position.copy(sun.position);
  scene.add(sunGlow);

  // Outer glow
  const sunGlow2Geometry = new THREE.SphereGeometry(40, 32, 32);
  const sunGlow2Material = new THREE.MeshBasicMaterial({
    color: 0xffffcc,
    transparent: true,
    opacity: 0.15
  });
  const sunGlow2 = new THREE.Mesh(sunGlow2Geometry, sunGlow2Material);
  sunGlow2.position.copy(sun.position);
  scene.add(sunGlow2);

  // Create multiple clouds
  const cloudPositions = [
    [80, 90, -60],
    [-40, 100, 20],
    [180, 85, 40],
    [50, 95, 100],
    [140, 88, -30],
    [-20, 92, -40],
    [200, 96, 80],
    [100, 82, 120],
  ];

  cloudPositions.forEach(([x, y, z]) => {
    const cloud = createCloud();
    cloud.position.set(x, y, z);
    cloud.rotation.y = Math.random() * Math.PI;
    scene.add(cloud);
  });
}

function createCloud() {
  const cloud = new THREE.Group();
  const cloudMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.85
  });

  // Create cloud from multiple spheres
  const puffs = [
    { x: 0, y: 0, z: 0, r: 8 },
    { x: 6, y: 1, z: 2, r: 6 },
    { x: -5, y: 0, z: 1, r: 7 },
    { x: 3, y: 2, z: -2, r: 5 },
    { x: -3, y: 1, z: -1, r: 6 },
    { x: 8, y: -1, z: 0, r: 5 },
    { x: -8, y: 0, z: 2, r: 5 },
  ];

  puffs.forEach(puff => {
    const geometry = new THREE.SphereGeometry(puff.r, 12, 12);
    const mesh = new THREE.Mesh(geometry, cloudMaterial);
    mesh.position.set(puff.x, puff.y, puff.z);
    cloud.add(mesh);
  });

  return cloud;
}

function createStadiumBowl(scene) {
  // Lower bowl (first tier) - closer to field
  const lowerBowlMaterial = new THREE.MeshStandardMaterial({
    color: 0x3d4852,
    roughness: 0.7
  });

  // Upper bowl (second tier)
  const upperBowlMaterial = new THREE.MeshStandardMaterial({
    color: 0x2d3748,
    roughness: 0.8
  });

  // Expanded stadium - push stands further from field for camera room
  const sideOffset = 45; // Distance from sideline to lower stands
  const endOffset = 55;  // Distance from endzone to lower stands

  // === NORTH SIDE (long side) ===
  // Lower tier
  const northLowerGeometry = new THREE.BoxGeometry(FIELD_LENGTH + 60, 15, 30);
  const northLower = new THREE.Mesh(northLowerGeometry, lowerBowlMaterial);
  northLower.position.set(FIELD_LENGTH / 2, 7, -sideOffset);
  scene.add(northLower);

  // Upper tier
  const northUpperGeometry = new THREE.BoxGeometry(FIELD_LENGTH + 80, 20, 35);
  const northUpper = new THREE.Mesh(northUpperGeometry, upperBowlMaterial);
  northUpper.position.set(FIELD_LENGTH / 2, 22, -sideOffset - 30);
  scene.add(northUpper);

  // === SOUTH SIDE (long side) ===
  const southLower = new THREE.Mesh(northLowerGeometry, lowerBowlMaterial);
  southLower.position.set(FIELD_LENGTH / 2, 7, FIELD_WIDTH + sideOffset);
  scene.add(southLower);

  const southUpper = new THREE.Mesh(northUpperGeometry, upperBowlMaterial);
  southUpper.position.set(FIELD_LENGTH / 2, 22, FIELD_WIDTH + sideOffset + 30);
  scene.add(southUpper);

  // === WEST END (short side - behind offense) ===
  const westLowerGeometry = new THREE.BoxGeometry(30, 12, FIELD_WIDTH + 90);
  const westLower = new THREE.Mesh(westLowerGeometry, lowerBowlMaterial);
  westLower.position.set(-endOffset + 10, 6, FIELD_WIDTH / 2);
  scene.add(westLower);

  const westUpperGeometry = new THREE.BoxGeometry(35, 18, FIELD_WIDTH + 120);
  const westUpper = new THREE.Mesh(westUpperGeometry, upperBowlMaterial);
  westUpper.position.set(-endOffset - 15, 18, FIELD_WIDTH / 2);
  scene.add(westUpper);

  // === EAST END (short side - downfield) ===
  const eastLower = new THREE.Mesh(westLowerGeometry, lowerBowlMaterial);
  eastLower.position.set(FIELD_LENGTH + endOffset - 10, 6, FIELD_WIDTH / 2);
  scene.add(eastLower);

  const eastUpper = new THREE.Mesh(westUpperGeometry, upperBowlMaterial);
  eastUpper.position.set(FIELD_LENGTH + endOffset + 15, 18, FIELD_WIDTH / 2);
  scene.add(eastUpper);

  // === CORNER SECTIONS (fill the gaps) ===
  const cornerGeometry = new THREE.BoxGeometry(25, 25, 25);
  const corners = [
    [-35, 12, -50],
    [FIELD_LENGTH + 35, 12, -50],
    [-35, 12, FIELD_WIDTH + 50],
    [FIELD_LENGTH + 35, 12, FIELD_WIDTH + 50],
  ];
  corners.forEach(([x, y, z]) => {
    const corner = new THREE.Mesh(cornerGeometry, lowerBowlMaterial);
    corner.position.set(x, y, z);
    scene.add(corner);
  });

  // === STADIUM LIGHT TOWERS ===
  createLightTowers(scene);

  // === PRESS BOX / LUXURY SUITES (on south side) ===
  const pressBoxGeometry = new THREE.BoxGeometry(100, 10, 10);
  const pressBoxMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a202c,
    roughness: 0.3,
    metalness: 0.5
  });
  const pressBox = new THREE.Mesh(pressBoxGeometry, pressBoxMaterial);
  pressBox.position.set(FIELD_LENGTH / 2, 38, FIELD_WIDTH + sideOffset + 40);
  scene.add(pressBox);

  // Press box windows (glass)
  const windowMaterial = new THREE.MeshStandardMaterial({
    color: 0x88ccff,
    roughness: 0.1,
    metalness: 0.8,
    transparent: true,
    opacity: 0.6
  });
  const windowGeometry = new THREE.PlaneGeometry(95, 6);
  const windows = new THREE.Mesh(windowGeometry, windowMaterial);
  windows.position.set(FIELD_LENGTH / 2, 38, FIELD_WIDTH + sideOffset + 35);
  scene.add(windows);

  // === SCOREBOARD (East end) ===
  const scoreboardGeometry = new THREE.BoxGeometry(3, 25, 50);
  const scoreboardMaterial = new THREE.MeshStandardMaterial({
    color: 0x111111,
    roughness: 0.5
  });
  const scoreboard = new THREE.Mesh(scoreboardGeometry, scoreboardMaterial);
  scoreboard.position.set(FIELD_LENGTH + endOffset + 25, 35, FIELD_WIDTH / 2);
  scene.add(scoreboard);

  // Scoreboard screen (glowing)
  const screenMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.8
  });
  const screenGeometry = new THREE.PlaneGeometry(22, 45);
  const screen = new THREE.Mesh(screenGeometry, screenMaterial);
  screen.rotation.y = -Math.PI / 2;
  screen.position.set(FIELD_LENGTH + endOffset + 23, 35, FIELD_WIDTH / 2);
  scene.add(screen);
}

function createLightTowers(scene) {
  const poleMaterial = new THREE.MeshStandardMaterial({
    color: 0x4a5568,
    roughness: 0.6,
    metalness: 0.3
  });

  const lightHousingMaterial = new THREE.MeshStandardMaterial({
    color: 0x2d3748,
    roughness: 0.5
  });

  // Light towers at corners of expanded stadium
  const lightPositions = [
    [-55, FIELD_WIDTH / 2 - 50],
    [-55, FIELD_WIDTH / 2 + 50],
    [FIELD_LENGTH + 55, FIELD_WIDTH / 2 - 50],
    [FIELD_LENGTH + 55, FIELD_WIDTH / 2 + 50],
  ];

  lightPositions.forEach(([x, z]) => {
    // Main pole
    const poleGeometry = new THREE.CylinderGeometry(1, 1.5, 70, 12);
    const pole = new THREE.Mesh(poleGeometry, poleMaterial);
    pole.position.set(x, 35, z);
    scene.add(pole);

    // Light housing/array at top
    const housingGeometry = new THREE.BoxGeometry(8, 4, 12);
    const housing = new THREE.Mesh(housingGeometry, lightHousingMaterial);
    housing.position.set(x, 72, z);
    // Angle toward field
    housing.lookAt(FIELD_LENGTH / 2, 0, FIELD_WIDTH / 2);
    scene.add(housing);

    // Light panels (glowing)
    const lightPanelMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffee,
      transparent: true,
      opacity: 0.9
    });
    const lightPanelGeometry = new THREE.PlaneGeometry(6, 10);
    const lightPanel = new THREE.Mesh(lightPanelGeometry, lightPanelMaterial);
    lightPanel.position.set(x, 72, z);
    lightPanel.lookAt(FIELD_LENGTH / 2, 0, FIELD_WIDTH / 2);
    scene.add(lightPanel);
  });
}

function createEggCrowd(scene) {
  // Create rows of egg-shaped spectators in the stands
  const eggGeometry = new THREE.SphereGeometry(0.6, 12, 12);
  eggGeometry.scale(0.7, 1, 0.6); // Egg shape

  // Different crowd colors for variety
  const crowdColors = [
    0xE31837, 0xFFB81C, 0x002244, 0xffffff, 0xff6b6b,
    0x4ecdc4, 0xffe66d, 0x95afc0, 0xf8b500, 0xc0392b
  ];

  // Expanded crowd positions to match new stadium
  const sideOffset = 45; // Match stadium offset
  const endOffset = 55;

  // North stands crowd (pushed back)
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 55; col++) {
      const egg = new THREE.Mesh(
        eggGeometry,
        new THREE.MeshStandardMaterial({
          color: crowdColors[Math.floor(Math.random() * crowdColors.length)],
          roughness: 0.6
        })
      );
      egg.position.set(
        5 + col * 2.2 + (Math.random() - 0.5) * 0.5,
        12 + row * 2 + Math.random() * 0.3,
        -sideOffset + 15 - row * 2.5 + (Math.random() - 0.5) * 0.5
      );
      egg.rotation.x = (Math.random() - 0.5) * 0.3;
      egg.rotation.z = (Math.random() - 0.5) * 0.2;
      scene.add(egg);
    }
  }

  // South stands crowd (pushed back)
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 55; col++) {
      const egg = new THREE.Mesh(
        eggGeometry,
        new THREE.MeshStandardMaterial({
          color: crowdColors[Math.floor(Math.random() * crowdColors.length)],
          roughness: 0.6
        })
      );
      egg.position.set(
        5 + col * 2.2 + (Math.random() - 0.5) * 0.5,
        12 + row * 2 + Math.random() * 0.3,
        FIELD_WIDTH + sideOffset - 15 + row * 2.5 + (Math.random() - 0.5) * 0.5
      );
      egg.rotation.x = (Math.random() - 0.5) * 0.3;
      egg.rotation.z = (Math.random() - 0.5) * 0.2;
      scene.add(egg);
    }
  }

  // West end zone crowd (pushed back)
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 25; col++) {
      const egg = new THREE.Mesh(
        eggGeometry,
        new THREE.MeshStandardMaterial({
          color: crowdColors[Math.floor(Math.random() * crowdColors.length)],
          roughness: 0.6
        })
      );
      egg.position.set(
        -endOffset + 20 - row * 2.5 + (Math.random() - 0.5) * 0.5,
        12 + row * 2 + Math.random() * 0.3,
        5 + col * 1.8 + (Math.random() - 0.5) * 0.5
      );
      egg.rotation.y = Math.PI / 2;
      egg.rotation.x = (Math.random() - 0.5) * 0.3;
      scene.add(egg);
    }
  }

  // East end zone crowd (pushed back)
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 25; col++) {
      const egg = new THREE.Mesh(
        eggGeometry,
        new THREE.MeshStandardMaterial({
          color: crowdColors[Math.floor(Math.random() * crowdColors.length)],
          roughness: 0.6
        })
      );
      egg.position.set(
        FIELD_LENGTH + endOffset - 20 + row * 2.5 + (Math.random() - 0.5) * 0.5,
        12 + row * 2 + Math.random() * 0.3,
        5 + col * 1.8 + (Math.random() - 0.5) * 0.5
      );
      egg.rotation.y = -Math.PI / 2;
      egg.rotation.x = (Math.random() - 0.5) * 0.3;
      scene.add(egg);
    }
  }
}
