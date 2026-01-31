import { useState, useEffect, useCallback, useRef } from 'react';
import Field3D from './components/Field3D';
import StatsPanel from './components/StatsPanel';
import './App.css';

function App() {
  const [plays, setPlays] = useState([]);
  const [tendencies, setTendencies] = useState(null);
  const [currentPlayIndex, setCurrentPlayIndex] = useState(0);
  const [currentFrame, setCurrentFrame] = useState(1);
  const [totalFrames, setTotalFrames] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [loading, setLoading] = useState(true);
  const [gameInfo, setGameInfo] = useState(null);
  const [selectedTeam, setSelectedTeam] = useState('KC');
  const [cameraPreset, setCameraPreset] = useState('behind');

  // Refs for animation
  const isPlayingRef = useRef(isPlaying);
  const totalFramesRef = useRef(totalFrames);
  const playbackSpeedRef = useRef(playbackSpeed);

  // Keep refs in sync
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { totalFramesRef.current = totalFrames; }, [totalFrames]);
  useEffect(() => { playbackSpeedRef.current = playbackSpeed; }, [playbackSpeed]);

  // Load play data and tendencies
  useEffect(() => {
    console.log('Loading data...');

    fetch('/plays.json')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(playData => {
        console.log('Plays loaded:', playData.plays?.length);
        setGameInfo(playData.game);

        // Use all plays that have player data
        const validPlays = playData.plays.filter(p =>
          p.players && p.players.length > 0 && p.numFrames > 0
        );
        console.log('Valid plays:', validPlays.length);

        if (validPlays.length > 0) {
          setPlays(validPlays);
          // Set initial frame count from first play
          setTotalFrames(validPlays[0].numFrames);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load plays:', err);
        setLoading(false);
      });

    fetch('/tendencies.json')
      .then(res => res.json())
      .then(data => setTendencies(data))
      .catch(err => console.error('Failed to load tendencies:', err));
  }, []);

  // Animation loop using refs to avoid stale closures
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setCurrentFrame(prev => {
        const nextFrame = prev + 1;
        if (nextFrame > totalFramesRef.current) {
          // Stop at end - will trigger the stop effect below
          return prev;
        }
        return nextFrame;
      });
    }, 100 / playbackSpeedRef.current);

    return () => clearInterval(interval);
  }, [isPlaying]);

  // Stop playing when we reach the end
  useEffect(() => {
    if (isPlaying && currentFrame >= totalFrames) {
      setIsPlaying(false);
    }
  }, [currentFrame, totalFrames, isPlaying]);

  // Handle frame count from Field3D
  const handleFrameCount = useCallback((count) => {
    console.log('Frame count updated:', count);
    setTotalFrames(count);
  }, []);

  // Control functions
  const togglePlay = useCallback(() => {
    setCurrentFrame(prev => {
      if (prev >= totalFramesRef.current) return 1;
      return prev;
    });
    setIsPlaying(prev => !prev);
  }, []);

  const nextPlay = useCallback(() => {
    setPlays(currentPlays => {
      setCurrentPlayIndex(prev => {
        if (prev < currentPlays.length - 1) {
          setCurrentFrame(1);
          setIsPlaying(false);
          return prev + 1;
        }
        return prev;
      });
      return currentPlays;
    });
  }, []);

  const prevPlay = useCallback(() => {
    setCurrentPlayIndex(prev => {
      if (prev > 0) {
        setCurrentFrame(1);
        setIsPlaying(false);
        return prev - 1;
      }
      return prev;
    });
  }, []);

  const stepFrame = useCallback((delta) => {
    setCurrentFrame(prev => Math.max(1, Math.min(totalFramesRef.current, prev + delta)));
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          stepFrame(-1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          stepFrame(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          prevPlay();
          break;
        case 'ArrowDown':
          e.preventDefault();
          nextPlay();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, stepFrame, prevPlay, nextPlay]);

  const currentPlay = plays[currentPlayIndex];

  if (loading) {
    return (
      <div className="app loading">
        <div className="loader">Loading NFL tracking data...</div>
      </div>
    );
  }

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <h1>MIRROR MATCH</h1>
        <div className="header-center">
          {gameInfo && (
            <div className="game-info">
              <span className="team away">{gameInfo.away}</span>
              <span className="score">{gameInfo.awayScore} - {gameInfo.homeScore}</span>
              <span className="team home">{gameInfo.home}</span>
            </div>
          )}
        </div>
        <div className="header-right">
          <span className="data-badge">2025 Season Data</span>
        </div>
      </header>

      <div className="main-content">
        {/* 3D Field */}
        <div className="field-container">
          <Field3D
            play={currentPlay}
            currentFrame={currentFrame}
            onFrameCount={handleFrameCount}
            cameraPreset={cameraPreset}
          />

          {/* Camera Controls */}
          <div className="camera-controls">
            {[
              { id: 'behind', label: 'Behind QB' },
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

          {/* Timeline Scrubber */}
          <div className="timeline">
            <div className="play-nav-inline">
              <button onClick={prevPlay} disabled={currentPlayIndex === 0}>
                ◀
              </button>
              <span className="play-counter">{currentPlayIndex + 1} / {plays.length}</span>
              <button onClick={nextPlay} disabled={currentPlayIndex === plays.length - 1}>
                ▶
              </button>
            </div>

            <div className="timeline-controls">
              <button onClick={() => setCurrentFrame(1)} title="Start">
                ⏮
              </button>
              <button onClick={() => stepFrame(-1)} title="Step Back (←)">
                ⏪
              </button>
              <button onClick={togglePlay} className="play-btn" title="Play/Pause (Space)">
                {isPlaying ? '⏸' : '▶'}
              </button>
              <button onClick={() => stepFrame(1)} title="Step Forward (→)">
                ⏩
              </button>
              <button onClick={() => setCurrentFrame(totalFrames)} title="End">
                ⏭
              </button>
            </div>

            <div className="timeline-scrubber">
              <input
                type="range"
                min={1}
                max={totalFrames}
                value={currentFrame}
                onChange={(e) => setCurrentFrame(parseInt(e.target.value))}
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
          </div>
        </div>

        {/* Stats Panel */}
        <StatsPanel
          play={currentPlay}
          tendencies={tendencies}
          selectedTeam={selectedTeam}
          onTeamChange={setSelectedTeam}
        />
      </div>
    </div>
  );
}

export default App;
