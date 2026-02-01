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

// Create player name label sprite
function createNameSprite(name, position, bgColor = '#00ffff') {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  // Build display text
  const displayText = `${name}${position ? ' · ' + position : ''}`;

  // Background pill
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(8, 8, 240, 48, 24);
  ctx.fill();

  // Border
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Name text
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 28px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(displayText, 128, 34);

  const texture = new THREE.CanvasTexture(canvas);
  const spriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false
  });
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.scale.set(6, 1.5, 1);
  return sprite;
}

export default function Field3D({ play, currentFrame, onFrameCount, cameraPreset = 'behind', resetCamera = 0, cameraSpeed = 1, viewMode = 'replay', filteredPlays = [], highlightPlayer = null }) {
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
          // Check if we have direct ball tracking data
          if (play.ball && play.ball.length > 0) {
            // Use actual ball tracking data from the play
            const ballFrameA = play.ball.find(f => f.f === frameFloor);
            const ballFrameB = play.ball.find(f => f.f === frameCeil);

            if (ballFrameA) {
              // Interpolate X/Z position from tracking data
              if (ballFrameB && ballFrameB !== ballFrameA) {
                ballRef.current.position.x = lerp(ballFrameA.x, ballFrameB.x, t);
                ballRef.current.position.z = lerp(ballFrameA.y, ballFrameB.y, t);
              } else {
                ballRef.current.position.x = ballFrameA.x;
                ballRef.current.position.z = ballFrameA.y;
              }

              // Detect throw and catch by analyzing ball speed from tracking data
              const throwFrame = play.numInputFrames || Math.floor((play.numFrames || 50) * 0.3);

              // Find catch frame by detecting when ball slows down (reaches receiver)
              // Ball moves fast during throw, slows when caught
              let catchFrame = play.numFrames || 50;
              const ballFrames = play.ball.filter(f => f.f > throwFrame).sort((a, b) => a.f - b.f);
              for (let i = 1; i < ballFrames.length - 1; i++) {
                const prev = ballFrames[i - 1];
                const curr = ballFrames[i];
                const speed = Math.sqrt((curr.x - prev.x) ** 2 + (curr.y - prev.y) ** 2);
                // Ball slows significantly when caught (speed drops below threshold)
                if (speed < 0.5 && curr.f > throwFrame + 5) {
                  catchFrame = curr.f;
                  break;
                }
              }
              // Ensure catch frame is reasonable (not too late)
              catchFrame = Math.min(catchFrame, throwFrame + 25, (play.numFrames || 50) - 3);

              // Calculate ball height based on phase
              if (displayFrame <= throwFrame) {
                // PRE-THROW: Ball in QB's hands
                ballRef.current.position.y = 1.8;
                if (ballRef.current.userData.light) ballRef.current.userData.light.intensity = 0.3;
                if (ballRef.current.userData.glow) ballRef.current.userData.glow.scale.setScalar(1);
              } else if (displayFrame < catchFrame) {
                // IN FLIGHT: Parabolic arc from throw to catch
                const flightDuration = catchFrame - throwFrame;
                const flightProgress = (displayFrame - throwFrame) / flightDuration;

                // Parabolic arc - starts at 1.8 (hand), peaks in middle, ends at 1.5 (catch height)
                const peakHeight = 6; // Max height of arc
                const arcHeight = Math.sin(flightProgress * Math.PI) * peakHeight;
                const baseHeight = lerp(1.8, 1.5, flightProgress); // Descend from throw to catch height
                ballRef.current.position.y = baseHeight + arcHeight;

                // Bright glow during flight
                if (ballRef.current.userData.light) ballRef.current.userData.light.intensity = 1.5;
                if (ballRef.current.userData.glow) ballRef.current.userData.glow.scale.setScalar(1.5);
                if (ballRef.current.userData.material) ballRef.current.userData.material.emissiveIntensity = 0.5;
              } else {
                // CAUGHT: Ball at receiver height, follows receiver
                ballRef.current.position.y = 1.5;

                // Brief catch flash effect
                const catchProgress = displayFrame - catchFrame;
                if (catchProgress < 3) {
                  const flash = Math.max(0, 2 - catchProgress * 0.6);
                  if (ballRef.current.userData.light) ballRef.current.userData.light.intensity = flash;
                  if (ballRef.current.userData.glow) ballRef.current.userData.glow.scale.setScalar(1 + flash * 0.5);
                } else {
                  if (ballRef.current.userData.light) ballRef.current.userData.light.intensity = 0.3;
                  if (ballRef.current.userData.glow) ballRef.current.userData.glow.scale.setScalar(1);
                  if (ballRef.current.userData.material) ballRef.current.userData.material.emissiveIntensity = 0.1;
                }
              }

              // Update ball trail (only during flight)
              const isInFlight = displayFrame > throwFrame && displayFrame < catchFrame;
              ballTrailRef.current.forEach((trail, i) => {
                if (isInFlight) {
                  const trailFrame = Math.floor(displayFrame - (i + 1) * 1.5);
                  const trailBallFrame = play.ball.find(f => f.f === trailFrame);
                  if (trailBallFrame && trailFrame > throwFrame) {
                    trail.position.x = trailBallFrame.x;
                    trail.position.z = trailBallFrame.y;
                    // Calculate trail height
                    const flightDuration = catchFrame - throwFrame;
                    const trailProgress = (trailFrame - throwFrame) / flightDuration;
                    const arcHeight = Math.sin(trailProgress * Math.PI) * 6;
                    const baseHeight = lerp(1.8, 1.5, trailProgress);
                    trail.position.y = baseHeight + arcHeight;
                    trail.visible = true;
                  } else {
                    trail.visible = false;
                  }
                } else {
                  trail.visible = false;
                }
              });
            }
          } else {
            // Fallback: use player-based ball animation if no tracking data
            const passer = play.players?.find(p => p.role === 'Passer');
            const target = play.players?.find(p =>
              p.role === 'Targeted Receiver' ||
              (play.targetNflId && p.nflId === play.targetNflId)
            );

            const throwFrame = play.numInputFrames || Math.floor((play.numFrames || 50) * 0.35);
            const catchFrame = play.numFrames || throwFrame + 20;

            if (displayFrame <= throwFrame && passer) {
              // Ball in QB's hands
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
            } else if (target) {
              // After throw - follow target if we have one
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
              }
            }

            // Hide trails when no tracking data
            ballTrailRef.current.forEach(trail => trail.visible = false);
          }
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
    // Shows routes ONLY for highlighted player (e.g., Kelce) - NO FALLBACK to all players
    if (viewMode === 'routes') {
      // MUST have a target player for routes mode - no spaghetti
      if (!highlightPlayer) {
        console.log('Routes mode requires a target player - skipping');
        return;
      }

      filteredPlays.forEach((playData) => {
        // Determine completion status for this play
        const isComplete = playData.passResult === 'C' || playData.passResult === 'complete' ||
                          (playData.yardsGained && playData.yardsGained > 0);

        // Find ONLY the highlighted player
        const playerName = highlightPlayer.toLowerCase();
        const targetPlayers = playData.players?.filter(p => {
          const name = (p.name || p.displayName || '').toLowerCase();
          return name.includes(playerName);
        }) || [];

        // Skip this play if target player not found
        if (targetPlayers.length === 0) return;

        targetPlayers.forEach((player) => {
          if (!player.frames || player.frames.length < 3) return;

          // Build points from tracking frames
          const points = [];
          const sortedFrames = [...player.frames].sort((a, b) => a.f - b.f);

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

          // BRIGHT route line - cyan/yellow, thick, high opacity
          const routeColor = highlightPlayer ? 0x00ffff : 0xffff00; // Cyan for highlighted, yellow otherwise
          const tubeGeometry = new THREE.TubeGeometry(curve, Math.min(points.length * 3, 48), 0.25, 8, false);
          const tubeMaterial = new THREE.MeshBasicMaterial({
            color: routeColor,
            transparent: true,
            opacity: 0.85
          });
          const routeTube = new THREE.Mesh(tubeGeometry, tubeMaterial);
          chartGroup.add(routeTube);

          // Endpoint dot - green = catch, red = incomplete
          const endpointColor = isComplete ? 0x22c55e : 0xef4444;
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
        });
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

    // === FIND KEY PLAYERS FOR FOCUS MODE ===
    // When highlighting a player, dim everyone except: target, QB, nearest defender
    let highlightedPlayerData = null;
    let nearestDefenderId = null;

    if (highlightPlayer) {
      // Find the highlighted player
      highlightedPlayerData = play.players.find(p => {
        const name = (p.name || p.displayName || '').toLowerCase();
        return name.includes(highlightPlayer.toLowerCase());
      });

      // Find nearest defender to highlighted player (at frame 1)
      if (highlightedPlayerData) {
        const hpFrame = highlightedPlayerData.frames?.find(f => f.f === 1);
        if (hpFrame) {
          let minDist = Infinity;
          play.players.forEach(p => {
            if (p.side === 'Defense') {
              const defFrame = p.frames?.find(f => f.f === 1);
              if (defFrame) {
                const dist = Math.sqrt((hpFrame.x - defFrame.x) ** 2 + (hpFrame.y - defFrame.y) ** 2);
                if (dist < minDist) {
                  minDist = dist;
                  nearestDefenderId = p.nflId;
                }
              }
            }
          });
        }
      }
    }

    // Create players - FOCUS MODE when highlighting
    play.players.forEach(playerData => {
      // Check player roles
      const playerName = (playerData.name || playerData.displayName || '').toLowerCase();
      const isHighlightedPlayer = highlightPlayer && playerName.includes(highlightPlayer.toLowerCase());
      const isOffense = playerData.side === 'Offense';
      const isQB = playerData.role === 'Passer';
      const isTarget = playerData.role === 'Targeted Receiver' ||
        (play.targetNflId && playerData.nflId === play.targetNflId);
      const isMatchupDefender = nearestDefenderId && playerData.nflId === nearestDefenderId;

      // === FOCUS MODE: Dim everyone except key players ===
      let opacity = 1.0;
      let showLabel = false;
      let showGlow = false;

      if (highlightPlayer) {
        // FOCUS MODE ACTIVE
        if (isHighlightedPlayer) {
          // THE STAR: Bright, glowing, label
          opacity = 1.0;
          showLabel = true;
          showGlow = true;
        } else if (isQB) {
          // QB: Visible but secondary
          opacity = 0.7;
          showLabel = true;
          showGlow = false;
        } else if (isMatchupDefender) {
          // MATCHUP DEFENDER: Shows the coverage
          opacity = 0.6;
          showLabel = true;
          showGlow = false;
        } else {
          // GHOST everyone else
          opacity = 0.15;
          showLabel = false;
          showGlow = false;
        }
      } else {
        // NO FOCUS - normal mode
        if (isQB || isTarget) {
          showLabel = true;
          showGlow = true;
        }
      }

      // Uniform size for all players
      const bodyRadius = 0.85;
      const bodyHeight = 1.7;
      const headRadius = 0.38;

      // Colors based on role
      let bodyColor, emissiveColor, emissiveIntensity, headColor;

      if (isHighlightedPlayer) {
        // HIGHLIGHTED: Bright cyan (not magenta - cyan pops more)
        bodyColor = 0x00FFFF;
        emissiveColor = 0x00FFFF;
        emissiveIntensity = 0.8;
        headColor = 0xFFFFFF;
      } else if (isQB) {
        // QB: Gold
        bodyColor = 0xFFD700;
        emissiveColor = 0xFFD700;
        emissiveIntensity = highlightPlayer ? 0.3 : 0.6;
        headColor = 0xFFFFFF;
      } else if (isMatchupDefender) {
        // MATCHUP DEFENDER: Dim red
        bodyColor = 0xFF4444;
        emissiveColor = 0xFF2222;
        emissiveIntensity = 0.3;
        headColor = 0xFFAAAA;
      } else if (isTarget && !highlightPlayer) {
        // Target (normal mode only)
        bodyColor = 0x00FFFF;
        emissiveColor = 0x00FFFF;
        emissiveIntensity = 0.6;
        headColor = 0xFFFFFF;
      } else if (isOffense) {
        // Offense: Blue (dimmed in focus mode)
        bodyColor = 0x4488FF;
        emissiveColor = 0x4488FF;
        emissiveIntensity = highlightPlayer ? 0.05 : 0.15;
        headColor = 0xFFFFFF;
      } else {
        // Defense: Orange/red (dimmed in focus mode)
        bodyColor = 0xFF6600;
        emissiveColor = 0xFF4400;
        emissiveIntensity = highlightPlayer ? 0.05 : 0.2;
        headColor = 0xFF8800;
      }

      // Create player group
      const playerGroup = new THREE.Group();
      playerGroup.userData = { ...playerData, positionHistory: [], isHighlighted: isHighlightedPlayer };

      // Body capsule
      const bodyGeometry = new THREE.CapsuleGeometry(bodyRadius, bodyHeight, 12, 24);
      const bodyMaterial = new THREE.MeshStandardMaterial({
        color: bodyColor,
        roughness: 0.4,
        metalness: 0.2,
        emissive: emissiveColor,
        emissiveIntensity: emissiveIntensity,
        transparent: opacity < 1.0,
        opacity: opacity
      });
      const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
      body.position.y = bodyHeight / 2 + bodyRadius;
      playerGroup.add(body);

      // Head
      const headGeometry = new THREE.SphereGeometry(headRadius, 24, 24);
      const headMaterial = new THREE.MeshStandardMaterial({
        color: headColor,
        transparent: opacity < 1.0,
        opacity: opacity,
        roughness: 0.3,
        metalness: 0.3,
        emissive: emissiveColor,
        emissiveIntensity: emissiveIntensity * 0.5
      });
      const head = new THREE.Mesh(headGeometry, headMaterial);
      head.position.y = bodyHeight + bodyRadius * 2 + headRadius * 0.8;
      playerGroup.add(head);

      // Glow ring (only for players with showGlow)
      if (showGlow) {
        const ringGeometry = new THREE.RingGeometry(bodyRadius + 0.2, bodyRadius + 0.5, 32);
        const ringMaterial = new THREE.MeshBasicMaterial({
          color: emissiveColor,
          transparent: true,
          opacity: isHighlightedPlayer ? 0.6 : 0.3,
          side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.1;
        playerGroup.add(ring);
      }

      // Labels - only for key players in focus mode
      if (showLabel && isHighlightedPlayer) {
        // NAME LABEL for highlighted player
        const displayName = playerData.name || playerData.displayName || highlightPlayer;
        const nameSprite = createNameSprite(displayName, playerData.position, '#00FFFF');
        nameSprite.position.set(0, bodyHeight + bodyRadius * 2 + headRadius * 2 + 1.5, 0);
        playerGroup.add(nameSprite);
      } else if (showLabel && (isQB || isMatchupDefender)) {
        // Short label for QB and matchup defender
        const labelText = isQB ? 'QB' : (playerData.position || 'DEF');
        const jerseyNumber = playerData.jersey || (playerData.nflId ? playerData.nflId % 100 : '');
        const numberSprite = createNumberSprite(jerseyNumber, isQB ? '#FFD700' : '#FF4444');
        numberSprite.position.set(0, bodyHeight + bodyRadius * 2 + headRadius * 2 + 0.5, 0);
        numberSprite.scale.setScalar(1.2);
        playerGroup.add(numberSprite);
      } else if (!highlightPlayer) {
        // Normal mode - show jersey numbers for everyone
        const jerseyNumber = playerData.jersey || (playerData.nflId ? playerData.nflId % 100 : Math.floor(Math.random() * 99) + 1);
        const numberColor = isOffense ? '#ffffff' : '#ffff00';
        const numberSprite = createNumberSprite(jerseyNumber, numberColor);
        numberSprite.position.set(0, bodyHeight + bodyRadius * 2 + headRadius * 2 + 0.5, 0);
        numberSprite.scale.setScalar(1.0);
        playerGroup.add(numberSprite);
      }

      // Point light (only for glowing players)
      if (showGlow) {
        const playerLight = new THREE.PointLight(emissiveColor, isHighlightedPlayer ? 2.5 : 0.8, isHighlightedPlayer ? 30 : 12);
        playerLight.position.y = bodyHeight / 2;
        playerGroup.add(playerLight);
      }

      // Speed trail dots - ONLY for highlighted player in focus mode
      const trailDots = [];

      if (isHighlightedPlayer) {
        for (let i = 0; i < 5; i++) {
          const dotSize = 0.4 - i * 0.05;
          const dotGeometry = new THREE.SphereGeometry(dotSize, 12, 12);
          const dotMaterial = new THREE.MeshBasicMaterial({
            color: 0x00FFFF,
            transparent: true,
            opacity: 0.7 - i * 0.12
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

    // Camera is controlled by resetCamera and cameraPreset effects only
    // Don't reset camera here when play changes
  }, [play, onFrameCount, highlightPlayer]);

  // Handle camera reset - center on ball position (only when resetCamera changes)
  useEffect(() => {
    if (!cameraRef.current || resetCamera === 0) return;

    const camera = cameraRef.current;
    const currentPlay = playRef.current;

    // Find ball position at frame 1 (or use yardline as fallback)
    let centerX = currentPlay?.yardline || 35;
    let centerZ = FIELD_WIDTH / 2;

    if (currentPlay?.ball && currentPlay.ball.length > 0) {
      const ballFrame = currentPlay.ball.find(b => b.f === 1) || currentPlay.ball[0];
      if (ballFrame) {
        centerX = ballFrame.x || centerX;
        centerZ = ballFrame.y || centerZ;
      }
    }

    // Reset to behind ball position, facing downfield (+X direction)
    camera.position.set(centerX - 15, 20, centerZ);
    cameraEuler.current = { yaw: Math.PI / 2, pitch: -0.3 }; // 90 degrees = facing +X
    cameraVelocity.current = { x: 0, y: 0, z: 0 };

    camera.rotation.order = 'YXZ';
    camera.rotation.y = cameraEuler.current.yaw;
    camera.rotation.x = cameraEuler.current.pitch;
  }, [resetCamera]); // Only trigger on explicit reset, not play change

  // Handle camera presets - only when preset changes, NOT when play changes
  useEffect(() => {
    if (!cameraRef.current) return;
    const camera = cameraRef.current;

    // Use center of field as default - don't depend on play
    const centerX = 50;
    const centerZ = FIELD_WIDTH / 2;

    // Reset velocity when changing presets
    cameraVelocity.current = { x: 0, y: 0, z: 0 };

    switch (cameraPreset) {
      case 'behind':
        // Behind ball looking downfield (+X direction)
        camera.position.set(centerX - 15, 20, centerZ);
        cameraEuler.current = { yaw: Math.PI / 2, pitch: -0.3 };
        break;
      case 'all22':
        // High overhead view looking down at ball
        camera.position.set(centerX + 10, 60, centerZ);
        cameraEuler.current = { yaw: Math.PI / 2, pitch: -1.2 };
        break;
      case 'endzone':
        // From downfield looking back toward ball (-X direction)
        camera.position.set(centerX + 65, 18, centerZ);
        cameraEuler.current = { yaw: -Math.PI / 2, pitch: -0.2 };
        break;
      case 'sideline':
        // Sideline broadcast view (from side, looking across field)
        camera.position.set(centerX + 5, 18, -30);
        cameraEuler.current = { yaw: Math.PI, pitch: -0.2 };
        break;
      default:
        break;
    }

    // Apply rotation
    camera.rotation.order = 'YXZ';
    camera.rotation.y = cameraEuler.current.yaw;
    camera.rotation.x = cameraEuler.current.pitch;
  }, [cameraPreset]); // Only trigger on preset change, not play change

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
