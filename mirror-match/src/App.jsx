import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Field3D from './components/Field3D';
import ChatInterface from './components/ChatInterface';
import { filterPlays, computeTendencies, getRepresentativePlay } from './engine/tendencyEngine';
import './App.css';

function App() {
  // All plays from data file
  const [allPlays, setAllPlays] = useState([]);
  const [tendencies, setTendencies] = useState(null);
  const [loading, setLoading] = useState(true);

  // Query-driven state - start with KC plays as default
  const [activeFilters, setActiveFilters] = useState({ offense: 'KC' });
  const [queryLabel, setQueryLabel] = useState('KC Plays');
  const [selectedTeam, setSelectedTeam] = useState('KC');

  // Playback state
  const [currentPlayIndex, setCurrentPlayIndex] = useState(0);
  const [currentFrame, setCurrentFrame] = useState(1);
  const [totalFrames, setTotalFrames] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [cameraPreset, setCameraPreset] = useState('behind');
  const [resetCameraFlag, setResetCameraFlag] = useState(0);
  const [cameraSpeed, setCameraSpeed] = useState(1);

  // View mode: 'replay' (animated single play) or 'chart' (all plays overlaid) or 'routes'
  const [viewMode, setViewMode] = useState('replay');

  // Portal state: start open with default sim
  const [portalOpen, setPortalOpen] = useState(true);

  // Refs for animation
  const totalFramesRef = useRef(totalFrames);
  const playbackSpeedRef = useRef(playbackSpeed);

  useEffect(() => { totalFramesRef.current = totalFrames; }, [totalFrames]);
  useEffect(() => { playbackSpeedRef.current = playbackSpeed; }, [playbackSpeed]);

  // Filtered plays based on active query
  const filteredPlays = useMemo(() => {
    if (!allPlays.length) {
      console.log('filteredPlays: no allPlays');
      return [];
    }

    if (!activeFilters) {
      // No query - show team's plays
      const result = filterPlays(allPlays, { offense: selectedTeam });
      console.log('filteredPlays (no filters):', result.length, 'for team', selectedTeam);
      return result;
    }

    const result = filterPlays(allPlays, activeFilters);
    console.log('filteredPlays (with filters):', result.length, 'filters:', activeFilters);
    return result;
  }, [allPlays, activeFilters, selectedTeam]);

  // Computed tendencies for filtered plays
  const filteredTendencies = useMemo(() => {
    return computeTendencies(filteredPlays);
  }, [filteredPlays]);

  // Current play
  const currentPlay = filteredPlays[currentPlayIndex];

  // Load play data and tendencies
  useEffect(() => {
    console.log('Loading data...');

    fetch('/plays.json')
      .then(res => res.json())
      .then(playsData => {
        console.log('Raw plays:', playsData.plays?.length);

        const gameInfo = playsData.game || {};
        const homeTeam = gameInfo.home || 'HOME';
        const awayTeam = gameInfo.away || 'AWAY';
        console.log('Teams:', homeTeam, 'vs', awayTeam);

        // Simple preprocessing
        const processedPlays = (playsData.plays || []).map(play => ({
          ...play,
          offense: play.possession || awayTeam,
          defense: play.possession === homeTeam ? awayTeam : homeTeam,
          players: (play.players || []).map(player => ({
            ...player,
            team: player.team === 'home' ? homeTeam : player.team === 'away' ? awayTeam : player.team,
            side: (player.team === 'home' ? homeTeam : awayTeam) === play.possession ? 'Offense' : 'Defense',
            role: player.position === 'QB' ? 'Passer' : null,
          }))
        }));

        console.log('Processed plays:', processedPlays.length);

        const validPlays = processedPlays.filter(p => p.players?.length > 0 && p.numFrames > 0);
        console.log('Valid plays:', validPlays.length);

        setAllPlays(validPlays);
        if (validPlays.length > 0) {
          setTotalFrames(validPlays[0].numFrames);
          // Auto-play on load - delay to ensure play data is rendered first
          setTimeout(() => {
            setResetCameraFlag(1);
            setTimeout(() => setIsPlaying(true), 100);
          }, 800);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load:', err);
        setLoading(false);
      });

    // Load tendencies separately
    fetch('/tendencies.json')
      .then(res => res.json())
      .then(data => setTendencies(data))
      .catch(() => console.log('No tendencies file'));
  }, []);

  // Continuous animation loop using requestAnimationFrame
  useEffect(() => {
    if (!isPlaying) return;

    let lastTime = performance.now();
    let animationId;

    const animate = (currentTime) => {
      const deltaTime = (currentTime - lastTime) / 1000; // seconds
      lastTime = currentTime;

      // Advance frame based on elapsed time (10 fps = 0.1 sec per frame)
      // At 1x speed: 10 frames per second
      const framesPerSecond = 10 * playbackSpeedRef.current;
      const frameAdvance = deltaTime * framesPerSecond;

      setCurrentFrame(prev => {
        const nextFrame = prev + frameAdvance;
        if (nextFrame >= totalFramesRef.current) {
          setIsPlaying(false);
          return totalFramesRef.current;
        }
        return nextFrame;
      });

      animationId = requestAnimationFrame(animate);
    };

    animationId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationId);
  }, [isPlaying]);

  // Handle query from chat - THIS IS THE KEY FUNCTION
  const handleQuery = useCallback((filters, label, newViewMode = 'replay') => {
    console.log('Query received:', filters, label, 'viewMode:', newViewMode);

    setActiveFilters(filters);
    setQueryLabel(label);

    // Update team if specified in filters
    if (filters.offense) {
      setSelectedTeam(filters.offense);
    }

    // Set view mode from Gemini response
    setViewMode(newViewMode);

    // OPEN THE PORTAL - 3D visualization appears
    setPortalOpen(true);

    // Reset to first matching play and auto-play
    setCurrentPlayIndex(0);
    setCurrentFrame(1);

    // Reset camera to center on the play
    setResetCameraFlag(prev => prev + 1);

    // Set appropriate camera for view mode
    if (newViewMode === 'chart' || newViewMode === 'routes') {
      setCameraPreset('all22'); // Overhead view for charts/routes
    }

    // Auto-play after short delay (only for replay mode)
    if (newViewMode === 'replay') {
      setTimeout(() => {
        setIsPlaying(true);
      }, 300);
    } else {
      setIsPlaying(false);
    }
  }, []);

  // Close the portal
  const closePortal = useCallback(() => {
    setPortalOpen(false);
    setIsPlaying(false);
  }, []);

  // Clear query / show all plays
  const clearQuery = useCallback(() => {
    setActiveFilters(null);
    setQueryLabel(null);
    setCurrentPlayIndex(0);
    setCurrentFrame(1);
    setIsPlaying(false);
  }, []);

  // Frame count from Field3D
  const handleFrameCount = useCallback((count) => {
    setTotalFrames(count);
  }, []);

  // Playback controls
  const togglePlay = useCallback(() => {
    setCurrentFrame(prev => {
      if (prev >= totalFramesRef.current) return 1;
      return prev;
    });
    setIsPlaying(prev => !prev);
  }, []);

  const nextPlay = useCallback(() => {
    if (currentPlayIndex < filteredPlays.length - 1) {
      setCurrentPlayIndex(prev => prev + 1);
      setCurrentFrame(1);
      setIsPlaying(false);
    }
  }, [currentPlayIndex, filteredPlays.length]);

  const prevPlay = useCallback(() => {
    if (currentPlayIndex > 0) {
      setCurrentPlayIndex(prev => prev - 1);
      setCurrentFrame(1);
      setIsPlaying(false);
    }
  }, [currentPlayIndex]);

  const stepFrame = useCallback((delta) => {
    setCurrentFrame(prev => Math.max(1, Math.min(totalFramesRef.current, prev + delta)));
  }, []);

  // Reset camera
  const resetCamera = useCallback(() => {
    setResetCameraFlag(prev => prev + 1);
    setCameraPreset('behind');
  }, []);

  // Keyboard shortcuts (only when not in input)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // Don't capture WASD/QE - those are for camera
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(e.code)) return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          break;
        case 'BracketLeft':
          e.preventDefault();
          stepFrame(-1);
          break;
        case 'BracketRight':
          e.preventDefault();
          stepFrame(1);
          break;
        case 'Comma':
          e.preventDefault();
          prevPlay();
          break;
        case 'Period':
          e.preventDefault();
          nextPlay();
          break;
        case 'KeyR':
          e.preventDefault();
          resetCamera();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, stepFrame, prevPlay, nextPlay, resetCamera]);

  if (loading) {
    return (
      <div className="app loading">
        <div className="loader">
          <div className="loader-spinner"></div>
          <p>Loading NFL tracking data...</p>
          <p className="loader-sub">Analyzing 4000+ plays from 2023 season</p>
        </div>
      </div>
    );
  }

  if (!allPlays.length) {
    return (
      <div className="app loading">
        <div className="loader error">
          <p>No play data available</p>
          <p className="loader-sub">Check that plays_filtered.json is in the public folder</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`app ${portalOpen ? 'split-view' : ''}`}>
      {/* LEFT: Chat Interface */}
      <div className="chat-panel">
        <header className="header">
          <h1>COACH AI</h1>
          <span className="header-tagline">AI Coaching Assistant</span>
        </header>

        <ChatInterface
          plays={allPlays}
          tendencies={tendencies}
          selectedTeam={selectedTeam}
          onQuery={handleQuery}
        />
      </div>

      {/* RIGHT: Inline Simulation (appears when filters active) */}
      {portalOpen && (
        <div className="sim-panel">
          <div className="sim-header">
            <div className="sim-info">
              <span className="sim-label">{queryLabel || 'Play Viewer'}</span>
              <span className="sim-count">{filteredPlays.length} plays</span>
            </div>
            <button className="sim-close" onClick={closePortal}>✕</button>
          </div>

          <div className="sim-content">
            <Field3D
              play={currentPlay}
              currentFrame={currentFrame}
              onFrameCount={handleFrameCount}
              cameraPreset={cameraPreset}
              resetCamera={resetCameraFlag}
              cameraSpeed={cameraSpeed}
              viewMode={viewMode}
              filteredPlays={filteredPlays}
              highlightPlayer={activeFilters?.targetPlayer}
            />

            {/* View Mode Toggle */}
          </div>

          {/* Sim Controls */}
          <div className="sim-controls">
            {/* View mode toggle */}
            <div className="view-toggle">
              {['replay', 'routes'].map(mode => (
                <button
                  key={mode}
                  onClick={() => {
                    setViewMode(mode);
                    if (mode !== 'replay') {
                      setCameraPreset('all22');
                      setIsPlaying(false);
                    }
                  }}
                  className={viewMode === mode ? 'active' : ''}
                >
                  {mode === 'replay' ? '▶ Replay' : '◯ Routes'}
                </button>
              ))}
            </div>

            {/* Play navigation */}
            <div className="play-nav">
              <button onClick={prevPlay} disabled={currentPlayIndex === 0}>◀</button>
              <span>{currentPlayIndex + 1} / {filteredPlays.length}</span>
              <button onClick={nextPlay} disabled={currentPlayIndex >= filteredPlays.length - 1}>▶</button>
            </div>

            {/* Playback controls - only in replay mode */}
            {viewMode === 'replay' && (
              <div className="playback-controls">
                <button onClick={togglePlay} className="play-btn">
                  {isPlaying ? '⏸' : '▶'}
                </button>
                <input
                  type="range"
                  min={1}
                  max={totalFrames}
                  step={0.1}
                  value={currentFrame}
                  onChange={(e) => setCurrentFrame(parseFloat(e.target.value))}
                />
                <div className="speed-btns">
                  {[0.5, 1, 2].map(speed => (
                    <button
                      key={speed}
                      onClick={() => setPlaybackSpeed(speed)}
                      className={playbackSpeed === speed ? 'active' : ''}
                    >
                      {speed}x
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
