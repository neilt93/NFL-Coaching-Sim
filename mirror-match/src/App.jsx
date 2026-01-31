import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Field3D from './components/Field3D';
import StatsPanel from './components/StatsPanel';
import { filterPlays, computeTendencies, getRepresentativePlay } from './engine/tendencyEngine';
import './App.css';

function App() {
  // All plays from data file
  const [allPlays, setAllPlays] = useState([]);
  const [tendencies, setTendencies] = useState(null);
  const [loading, setLoading] = useState(true);

  // Query-driven state
  const [activeFilters, setActiveFilters] = useState(null);
  const [queryLabel, setQueryLabel] = useState(null);
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

  // Portal state: whether 3D viewer is open (starts closed - chat is entry point)
  const [portalOpen, setPortalOpen] = useState(false);

  // Refs for animation
  const totalFramesRef = useRef(totalFrames);
  const playbackSpeedRef = useRef(playbackSpeed);

  useEffect(() => { totalFramesRef.current = totalFrames; }, [totalFrames]);
  useEffect(() => { playbackSpeedRef.current = playbackSpeed; }, [playbackSpeed]);

  // Filtered plays based on active query
  const filteredPlays = useMemo(() => {
    if (!allPlays.length) return [];

    if (!activeFilters) {
      // No query - show team's plays
      return filterPlays(allPlays, { offense: selectedTeam });
    }

    return filterPlays(allPlays, activeFilters);
  }, [allPlays, activeFilters, selectedTeam]);

  // Computed tendencies for filtered plays
  const filteredTendencies = useMemo(() => {
    return computeTendencies(filteredPlays);
  }, [filteredPlays]);

  // Current play
  const currentPlay = filteredPlays[currentPlayIndex];

  // Load play data
  useEffect(() => {
    console.log('Loading data...');

    fetch('/plays_filtered.json')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        console.log('Plays loaded:', data.plays?.length);

        const validPlays = data.plays.filter(p =>
          p.players && p.players.length > 0 && p.numFrames > 0
        );
        console.log('Valid plays:', validPlays.length);

        if (validPlays.length > 0) {
          setAllPlays(validPlays);
          setTotalFrames(validPlays[0].numFrames);
        }

        if (data.tendencies) {
          setTendencies(data.tendencies);
        }

        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load plays:', err);
        setLoading(false);
      });
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
    <div className="app">
      {/* SCREEN 1: Chat Interface (fullscreen, this is the app) */}
      <div className="chat-screen">
        <header className="header">
          <h1>MIRROR MATCH</h1>
          <div className="header-center">
            <span className="header-tagline">AI Coaching Assistant</span>
          </div>
          <div className="header-right">
            <div className="team-selector-mini">
              {['KC', 'PHI', 'BUF', 'SF'].map(team => (
                <button
                  key={team}
                  className={selectedTeam === team ? 'active' : ''}
                  onClick={() => setSelectedTeam(team)}
                >
                  {team}
                </button>
              ))}
            </div>
          </div>
        </header>

        <StatsPanel
          play={currentPlay}
          plays={allPlays}
          filteredPlays={filteredPlays}
          tendencies={tendencies}
          filteredTendencies={filteredTendencies}
          selectedTeam={selectedTeam}
          onTeamChange={setSelectedTeam}
          onQuery={handleQuery}
          activeFilters={activeFilters}
          queryLabel={queryLabel}
        />
      </div>

      {/* SCREEN 2: Portal Overlay (3D visualization) */}
      {portalOpen && (
        <div className="portal-overlay">
          <div className="portal-header">
            <div className="portal-title">
              <span className="portal-label">{queryLabel || 'Play Viewer'}</span>
              <span className="portal-count">{filteredPlays.length} plays</span>
            </div>
            <button className="portal-close" onClick={closePortal}>
              ✕ Back to Chat
            </button>
          </div>

          <div className="portal-content">
            <Field3D
              play={currentPlay}
              currentFrame={currentFrame}
              onFrameCount={handleFrameCount}
              cameraPreset={cameraPreset}
              resetCamera={resetCameraFlag}
              cameraSpeed={cameraSpeed}
              viewMode={viewMode}
              filteredPlays={filteredPlays}
            />

            {/* View Mode Toggle */}
            <div className="view-mode-toggle">
              <button
                onClick={() => setViewMode('replay')}
                className={viewMode === 'replay' ? 'active' : ''}
              >
                Replay
              </button>
              <button
                onClick={() => {
                  setViewMode('routes');
                  setCameraPreset('all22');
                  setIsPlaying(false);
                }}
                className={viewMode === 'routes' ? 'active' : ''}
              >
                Routes
              </button>
              <button
                onClick={() => {
                  setViewMode('chart');
                  setCameraPreset('all22');
                  setIsPlaying(false);
                }}
                className={viewMode === 'chart' ? 'active' : ''}
              >
                Pass Chart
              </button>
            </div>

            {/* Camera Controls */}
            <div className="camera-controls">
              {[
                { id: 'behind', label: 'Behind QB' },
                { id: 'follow', label: 'Follow Ball' },
                { id: 'all22', label: 'All-22' },
                { id: 'endzone', label: 'End Zone' },
                { id: 'sideline', label: 'Sideline' },
              ].map(cam => (
                <button
                  key={cam.id}
                  onClick={() => setCameraPreset(cam.id)}
                  className={cameraPreset === cam.id ? 'active' : ''}
                >
                  {cam.label}
                </button>
              ))}
            </div>
          </div>

          {/* Portal Footer with Controls */}
          <div className="portal-footer">
            {/* Play navigation - always show */}
            <div className="play-nav-inline">
              <button onClick={prevPlay} disabled={currentPlayIndex === 0}>◀</button>
              <span className="play-counter">
                <strong>{currentPlayIndex + 1}</strong> / <strong>{filteredPlays.length}</strong>
                {viewMode !== 'replay' && <span className="view-label"> {viewMode === 'routes' ? 'routes' : 'passes'}</span>}
              </span>
              <button onClick={nextPlay} disabled={currentPlayIndex >= filteredPlays.length - 1}>▶</button>
            </div>

            {/* Timeline controls - only in replay mode */}
            {viewMode === 'replay' && (
              <>
                <div className="timeline-controls">
                  <button onClick={() => setCurrentFrame(1)}>⏮</button>
                  <button onClick={() => stepFrame(-1)}>⏪</button>
                  <button onClick={togglePlay} className="play-btn">
                    {isPlaying ? '⏸' : '▶'}
                  </button>
                  <button onClick={() => stepFrame(1)}>⏩</button>
                  <button onClick={() => setCurrentFrame(totalFrames)}>⏭</button>
                </div>

                <div className="timeline-scrubber">
                  <input
                    type="range"
                    min={1}
                    max={totalFrames}
                    step={0.1}
                    value={currentFrame}
                    onChange={(e) => setCurrentFrame(parseFloat(e.target.value))}
                  />
                  <span className="time-display">
                    {((currentFrame - 1) / 10).toFixed(1)}s / {((totalFrames - 1) / 10).toFixed(1)}s
                  </span>
                </div>

                <div className="speed-controls">
                  {[0.25, 0.5, 1, 2].map(speed => (
                    <button
                      key={speed}
                      onClick={() => setPlaybackSpeed(speed)}
                      className={playbackSpeed === speed ? 'active' : ''}
                    >
                      {speed}x
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
