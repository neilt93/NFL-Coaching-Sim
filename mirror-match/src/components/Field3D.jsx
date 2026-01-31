import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

// NFL field dimensions in yards
const FIELD_LENGTH = 120; // 100 yards + 2 end zones
const FIELD_WIDTH = 53.33;

// Team colors
const TEAM_COLORS = {
  KC: { primary: 0xE31837, secondary: 0xFFB81C },
  NE: { primary: 0x002244, secondary: 0xC60C30 },
  home: { primary: 0x002244, secondary: 0xC60C30 }, // NE
  away: { primary: 0xE31837, secondary: 0xFFB81C }, // KC
};

export default function Field3D({ play, currentFrame, onFrameCount, cameraPreset = 'behind' }) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const playersRef = useRef([]);
  const ballRef = useRef(null);
  const ballTrailRef = useRef([]);
  const losRef = useRef(null);
  const firstDownRef = useRef(null);
  const frameIdRef = useRef(null);
  const isDragging = useRef(false);
  const previousMousePosition = useRef({ x: 0, y: 0 });

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e1a);
    scene.fog = new THREE.FogExp2(0x0a0a1a, 0.006);
    sceneRef.current = scene;

    // Camera - positioned behind the offense looking downfield
    const camera = new THREE.PerspectiveCamera(
      60,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      500
    );
    camera.position.set(25, 30, FIELD_WIDTH / 2);
    camera.lookAt(60, 0, FIELD_WIDTH / 2);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404060, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(60, 50, 30);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 1;
    directionalLight.shadow.camera.far = 200;
    directionalLight.shadow.camera.left = -80;
    directionalLight.shadow.camera.right = 80;
    directionalLight.shadow.camera.top = 40;
    directionalLight.shadow.camera.bottom = -40;
    scene.add(directionalLight);

    // Stadium lights effect
    const pointLight1 = new THREE.PointLight(0xffffcc, 0.3, 150);
    pointLight1.position.set(30, 40, 0);
    scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(0xffffcc, 0.3, 150);
    pointLight2.position.set(90, 40, FIELD_WIDTH);
    scene.add(pointLight2);

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

    // Animation loop
    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);
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

    // Mouse controls for orbit
    const handleMouseDown = (e) => {
      isDragging.current = true;
      previousMousePosition.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseMove = (e) => {
      if (!isDragging.current) return;

      const deltaX = e.clientX - previousMousePosition.current.x;
      const deltaY = e.clientY - previousMousePosition.current.y;

      // Orbit around field center
      const center = new THREE.Vector3(60, 0, FIELD_WIDTH / 2);
      const offset = camera.position.clone().sub(center);

      // Horizontal rotation
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta -= deltaX * 0.005;
      spherical.phi -= deltaY * 0.005;
      spherical.phi = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, spherical.phi));

      offset.setFromSpherical(spherical);
      camera.position.copy(center).add(offset);
      camera.lookAt(center);

      previousMousePosition.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUp = () => {
      isDragging.current = false;
    };

    const handleWheel = (e) => {
      const center = new THREE.Vector3(60, 0, FIELD_WIDTH / 2);
      const direction = camera.position.clone().sub(center).normalize();
      const distance = camera.position.distanceTo(center);
      const newDistance = Math.max(20, Math.min(100, distance + e.deltaY * 0.05));
      camera.position.copy(center).add(direction.multiplyScalar(newDistance));
    };

    renderer.domElement.addEventListener('mousedown', handleMouseDown);
    renderer.domElement.addEventListener('mousemove', handleMouseMove);
    renderer.domElement.addEventListener('mouseup', handleMouseUp);
    renderer.domElement.addEventListener('mouseleave', handleMouseUp);
    renderer.domElement.addEventListener('wheel', handleWheel);

    return () => {
      cancelAnimationFrame(frameIdRef.current);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('mousedown', handleMouseDown);
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      renderer.domElement.removeEventListener('mouseup', handleMouseUp);
      renderer.domElement.removeEventListener('mouseleave', handleMouseUp);
      renderer.domElement.removeEventListener('wheel', handleWheel);
      renderer.dispose();
      containerRef.current?.removeChild(renderer.domElement);
    };
  }, []);

  // Update players when play changes
  useEffect(() => {
    console.log('Field3D: play changed', play ? `${play.players?.length} players` : 'no play');
    if (!sceneRef.current || !play) return;

    const scene = sceneRef.current;

    // Remove old players
    playersRef.current.forEach(player => scene.remove(player));
    playersRef.current = [];
    if (ballRef.current) {
      scene.remove(ballRef.current);
      ballRef.current = null;
    }

    // Create new players
    play.players.forEach(playerData => {
      const color = TEAM_COLORS[playerData.team]?.primary || 0x888888;

      // Player body - cylinder
      const geometry = new THREE.CylinderGeometry(0.5, 0.5, 2, 16);
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.6,
        metalness: 0.2,
      });
      const player = new THREE.Mesh(geometry, material);
      player.castShadow = true;
      player.receiveShadow = true;
      player.userData = playerData;

      // Position at first frame
      if (playerData.frames.length > 0) {
        const frame = playerData.frames[0];
        player.position.set(frame.x, 1, frame.y);
      }

      scene.add(player);
      playersRef.current.push(player);
    });

    // Create ball
    const ballGeometry = new THREE.SphereGeometry(0.4, 16, 16);
    const ballMaterial = new THREE.MeshStandardMaterial({
      color: 0x8B4513,
      roughness: 0.8,
      metalness: 0.1,
      emissive: 0x331100,
      emissiveIntensity: 0.2,
    });
    const ball = new THREE.Mesh(ballGeometry, ballMaterial);
    ball.castShadow = true;

    // Ball glow
    const glowLight = new THREE.PointLight(0xffff99, 0.5, 5);
    ball.add(glowLight);

    // Position ball at passer initially
    const passer = play.players?.find(p => p.role === 'Passer');
    if (passer && passer.frames.length > 0) {
      const frame = passer.frames[0];
      ball.position.set(frame.x, 1.8, frame.y);
    } else if (play.ball && play.ball.length > 0) {
      const frame = play.ball[0];
      ball.position.set(frame.x, 1, frame.y);
    }

    scene.add(ball);
    ballRef.current = ball;

    // Create ball trail (8 small spheres)
    ballTrailRef.current.forEach(t => scene.remove(t));
    ballTrailRef.current = [];
    for (let i = 0; i < 8; i++) {
      const trailGeometry = new THREE.SphereGeometry(0.15 - i * 0.015, 8, 8);
      const trailMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.5 - i * 0.06,
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
  }, [play, onFrameCount]);

  // Handle camera presets
  useEffect(() => {
    if (!cameraRef.current || !play) return;
    const camera = cameraRef.current;
    const losX = play.yardline || 35;

    switch (cameraPreset) {
      case 'behind':
        // Behind QB looking downfield
        camera.position.set(losX - 15, 20, FIELD_WIDTH / 2);
        camera.lookAt(losX + 20, 0, FIELD_WIDTH / 2);
        break;
      case 'all22':
        // High overhead view
        camera.position.set(losX + 10, 60, FIELD_WIDTH / 2);
        camera.lookAt(losX + 10, 0, FIELD_WIDTH / 2);
        break;
      case 'endzone':
        // From behind the end zone
        camera.position.set(losX + 50, 15, FIELD_WIDTH / 2);
        camera.lookAt(losX, 0, FIELD_WIDTH / 2);
        break;
      case 'sideline':
        // Sideline broadcast view
        camera.position.set(losX + 5, 15, -15);
        camera.lookAt(losX + 5, 0, FIELD_WIDTH / 2);
        break;
      default:
        break;
    }
  }, [cameraPreset, play]);

  // Update positions when frame changes
  useEffect(() => {
    if (!play || currentFrame === undefined) return;

    // Find passer and target for ball physics
    const passer = play.players?.find(p => p.role === 'Passer');
    const target = play.players?.find(p => p.role === 'Targeted Receiver');

    // Estimate throw timing based on play length
    const totalFrames = play.numFrames || 50;
    const throwFrame = Math.floor(totalFrames * 0.35); // Ball released at ~35%
    const catchFrame = Math.floor(totalFrames * 0.75); // Ball caught at ~75%

    // Update player positions
    playersRef.current.forEach(playerMesh => {
      const playerData = playerMesh.userData;
      const frameIndex = currentFrame - 1;
      const frameData = playerData.frames[frameIndex];

      if (frameData) {
        const prevX = playerMesh.position.x;
        const prevZ = playerMesh.position.z;

        playerMesh.position.x = frameData.x;
        playerMesh.position.z = frameData.y;

        const dx = playerMesh.position.x - prevX;
        const dz = playerMesh.position.z - prevZ;
        if (Math.abs(dx) > 0.1 || Math.abs(dz) > 0.1) {
          playerMesh.rotation.y = Math.atan2(dx, dz);
        }
      }
    });

    // Update ball position with parabolic arc
    if (ballRef.current) {
      const frameIndex = currentFrame - 1;

      if (currentFrame <= throwFrame && passer) {
        // Ball in QB's hands
        const passerFrame = passer.frames[frameIndex];
        if (passerFrame) {
          ballRef.current.position.x = passerFrame.x;
          ballRef.current.position.z = passerFrame.y;
          ballRef.current.position.y = 1.8; // Hand height
        }
      } else if (currentFrame > throwFrame && currentFrame <= catchFrame && passer && play.ballLandX) {
        // Ball in flight - parabolic arc
        const passerThrowFrame = passer.frames[throwFrame - 1];
        if (passerThrowFrame) {
          const startX = passerThrowFrame.x;
          const startZ = passerThrowFrame.y;
          const endX = play.ballLandX;
          const endZ = play.ballLandY || startZ;

          // Calculate arc progress (0 to 1)
          const progress = (currentFrame - throwFrame) / (catchFrame - throwFrame);

          // Linear interpolation for X and Z
          const ballX = startX + (endX - startX) * progress;
          const ballZ = startZ + (endZ - startZ) * progress;

          // Parabolic arc for Y (height)
          const distance = Math.sqrt((endX - startX) ** 2 + (endZ - startZ) ** 2);
          const arcHeight = Math.min(distance * 0.2, 12); // Max 12 yards high
          const ballY = 1.8 + Math.sin(progress * Math.PI) * arcHeight;

          ballRef.current.position.set(ballX, ballY, ballZ);
        }
      } else if (currentFrame > catchFrame && target) {
        // Ball caught - follow receiver
        const targetFrame = target.frames[frameIndex];
        if (targetFrame) {
          ballRef.current.position.x = targetFrame.x;
          ballRef.current.position.z = targetFrame.y;
          ballRef.current.position.y = 1.5;
        }
      } else if (play.ball && play.ball[frameIndex]) {
        // Fallback to ball data if available
        const ballFrame = play.ball[frameIndex];
        ballRef.current.position.x = ballFrame.x;
        ballRef.current.position.z = ballFrame.y;
        ballRef.current.position.y = 1;
      }

      // Update ball trail when in flight
      const isInFlight = currentFrame > throwFrame && currentFrame <= catchFrame;
      ballTrailRef.current.forEach((trail, i) => {
        if (isInFlight) {
          // Calculate trail position (slightly behind ball)
          const trailProgress = Math.max(0, (currentFrame - throwFrame - (i + 1) * 0.5) / (catchFrame - throwFrame));
          if (trailProgress > 0 && trailProgress < 1 && passer) {
            const passerThrowFrame = passer.frames[throwFrame - 1];
            if (passerThrowFrame && play.ballLandX) {
              const startX = passerThrowFrame.x;
              const startZ = passerThrowFrame.y;
              const endX = play.ballLandX;
              const endZ = play.ballLandY || startZ;
              const distance = Math.sqrt((endX - startX) ** 2 + (endZ - startZ) ** 2);
              const arcHeight = Math.min(distance * 0.2, 12);

              trail.position.x = startX + (endX - startX) * trailProgress;
              trail.position.z = startZ + (endZ - startZ) * trailProgress;
              trail.position.y = 1.8 + Math.sin(trailProgress * Math.PI) * arcHeight;
              trail.visible = true;
            }
          } else {
            trail.visible = false;
          }
        } else {
          trail.visible = false;
        }
      });
    }
  }, [currentFrame, play]);

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
  // Main field surface
  const fieldGeometry = new THREE.PlaneGeometry(FIELD_LENGTH, FIELD_WIDTH);
  const fieldMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a472a,
    roughness: 0.9,
    metalness: 0,
  });
  const field = new THREE.Mesh(fieldGeometry, fieldMaterial);
  field.rotation.x = -Math.PI / 2;
  field.position.set(FIELD_LENGTH / 2, 0, FIELD_WIDTH / 2);
  field.receiveShadow = true;
  scene.add(field);

  // End zones
  const endZoneGeometry = new THREE.PlaneGeometry(10, FIELD_WIDTH);

  // Left end zone (KC away)
  const leftEndZoneMaterial = new THREE.MeshStandardMaterial({
    color: 0xE31837,
    roughness: 0.9,
  });
  const leftEndZone = new THREE.Mesh(endZoneGeometry, leftEndZoneMaterial);
  leftEndZone.rotation.x = -Math.PI / 2;
  leftEndZone.position.set(5, 0.01, FIELD_WIDTH / 2);
  leftEndZone.receiveShadow = true;
  scene.add(leftEndZone);

  // Right end zone (NE home)
  const rightEndZoneMaterial = new THREE.MeshStandardMaterial({
    color: 0x002244,
    roughness: 0.9,
  });
  const rightEndZone = new THREE.Mesh(endZoneGeometry, rightEndZoneMaterial);
  rightEndZone.rotation.x = -Math.PI / 2;
  rightEndZone.position.set(115, 0.01, FIELD_WIDTH / 2);
  rightEndZone.receiveShadow = true;
  scene.add(rightEndZone);

  // Yard lines
  const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });

  for (let yard = 10; yard <= 110; yard += 5) {
    const isMainLine = (yard - 10) % 10 === 0;
    const lineGeometry = new THREE.PlaneGeometry(0.2, FIELD_WIDTH);
    const line = new THREE.Mesh(lineGeometry, lineMaterial);
    line.rotation.x = -Math.PI / 2;
    line.position.set(yard, 0.02, FIELD_WIDTH / 2);
    scene.add(line);

    // Yard numbers at every 10 yards
    if (isMainLine && yard > 10 && yard < 110) {
      const yardNumber = yard <= 60 ? yard - 10 : 110 - yard;
      // We'll skip text for now - can add sprites later
    }
  }

  // Hash marks
  const hashMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const hashY1 = FIELD_WIDTH / 2 - 18.5 / 2; // NFL hash positions
  const hashY2 = FIELD_WIDTH / 2 + 18.5 / 2;

  for (let yard = 11; yard <= 109; yard++) {
    if ((yard - 10) % 5 !== 0) {
      // Left hash
      const hash1 = new THREE.Mesh(
        new THREE.PlaneGeometry(0.1, 1),
        hashMaterial
      );
      hash1.rotation.x = -Math.PI / 2;
      hash1.position.set(yard, 0.02, hashY1);
      scene.add(hash1);

      // Right hash
      const hash2 = new THREE.Mesh(
        new THREE.PlaneGeometry(0.1, 1),
        hashMaterial
      );
      hash2.rotation.x = -Math.PI / 2;
      hash2.position.set(yard, 0.02, hashY2);
      scene.add(hash2);
    }
  }

  // Sidelines
  const sidelineGeometry = new THREE.PlaneGeometry(FIELD_LENGTH, 0.3);

  const sideline1 = new THREE.Mesh(sidelineGeometry, lineMaterial);
  sideline1.rotation.x = -Math.PI / 2;
  sideline1.position.set(FIELD_LENGTH / 2, 0.02, 0.15);
  scene.add(sideline1);

  const sideline2 = new THREE.Mesh(sidelineGeometry, lineMaterial);
  sideline2.rotation.x = -Math.PI / 2;
  sideline2.position.set(FIELD_LENGTH / 2, 0.02, FIELD_WIDTH - 0.15);
  scene.add(sideline2);

  // Goal lines
  const goalLineGeometry = new THREE.PlaneGeometry(0.3, FIELD_WIDTH);

  const goalLine1 = new THREE.Mesh(goalLineGeometry, lineMaterial);
  goalLine1.rotation.x = -Math.PI / 2;
  goalLine1.position.set(10, 0.02, FIELD_WIDTH / 2);
  scene.add(goalLine1);

  const goalLine2 = new THREE.Mesh(goalLineGeometry, lineMaterial);
  goalLine2.rotation.x = -Math.PI / 2;
  goalLine2.position.set(110, 0.02, FIELD_WIDTH / 2);
  scene.add(goalLine2);
}
