import { useState } from 'react';
import ChatInterface from './ChatInterface';
import './StatsPanel.css';

export default function StatsPanel({ play, tendencies, selectedTeam, onTeamChange }) {
  const [activeTab, setActiveTab] = useState('situation');

  const teamData = tendencies?.[selectedTeam];
  const thirdDownData = teamData?.thirdDown;

  // Determine current situation from play
  const down = play?.down || 0;
  const distance = play?.yardsToGo || 0;
  const distanceCategory = distance <= 3 ? 'short' : distance <= 7 ? 'medium' : 'long';

  // Get relevant tendencies based on situation
  const getSituationTendencies = () => {
    if (!teamData) return null;

    if (down === 3 && thirdDownData) {
      return thirdDownData[distanceCategory] || thirdDownData.overall;
    }

    return teamData.byDown?.[String(down)] || teamData.overall;
  };

  const situationStats = getSituationTendencies();

  return (
    <div className="stats-panel">
      {/* Team Selector */}
      <div className="team-selector">
        <button
          className={selectedTeam === 'KC' ? 'active kc' : ''}
          onClick={() => onTeamChange('KC')}
        >
          KC Chiefs
        </button>
        <button
          className={selectedTeam === 'PHI' ? 'active phi' : ''}
          onClick={() => onTeamChange('PHI')}
        >
          PHI Eagles
        </button>
      </div>

      {/* Play Info */}
      {play && (
        <div className="play-info card">
          <h3>Current Play</h3>
          <div className="situation-badge">
            {down > 0 ? `${down}${getOrdinal(down)} & ${distance}` : 'Special Teams'}
          </div>
          <div className="info-grid">
            <div className="info-item">
              <span className="label">Quarter</span>
              <span className="value">Q{play.quarter}</span>
            </div>
            <div className="info-item">
              <span className="label">Formation</span>
              <span className="value">{play.formation || 'N/A'}</span>
            </div>
            <div className="info-item">
              <span className="label">Result</span>
              <span className="value result">
                {play.passResult || 'Run'} {play.yardsGained > 0 ? '+' : ''}{play.yardsGained}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Tendency Analysis */}
      {situationStats && (
        <div className="tendency-analysis card">
          <h3>
            {selectedTeam} Tendencies
            <span className="sample-size">n={situationStats.sampleSize}</span>
          </h3>

          {/* Pass/Run Split */}
          <div className="tendency-section">
            <h4>Play Type</h4>
            <TendencyBar
              label="Pass"
              value={situationStats.passRate}
              color="var(--accent-blue)"
            />
            <TendencyBar
              label="Run"
              value={situationStats.runRate}
              color="var(--accent-green)"
            />
          </div>

          {/* Pass Direction */}
          <div className="tendency-section">
            <h4>Pass Direction</h4>
            <TendencyBar
              label="Left"
              value={situationStats.passLeft}
              color="var(--accent-yellow)"
            />
            <TendencyBar
              label="Middle"
              value={situationStats.passMiddle}
              color="var(--accent-yellow)"
            />
            <TendencyBar
              label="Right"
              value={situationStats.passRight}
              color="var(--accent-yellow)"
              highlight
            />
          </div>

          {/* Key Stats */}
          <div className="key-stats">
            <div className="stat">
              <span className="stat-value">{(situationStats.shotgunRate * 100).toFixed(0)}%</span>
              <span className="stat-label">Shotgun</span>
            </div>
            <div className="stat">
              <span className="stat-value">{situationStats.avgYards}</span>
              <span className="stat-label">Avg Yards</span>
            </div>
            <div className="stat">
              <span className="stat-value">{situationStats.passAvgYards}</span>
              <span className="stat-label">Pass Avg</span>
            </div>
          </div>
        </div>
      )}

      {/* Third Down Focus */}
      {thirdDownData?.overall && (
        <div className="third-down-focus card">
          <h3>3rd Down Focus</h3>
          <div className="third-down-grid">
            {['short', 'medium', 'long'].map(dist => {
              const data = thirdDownData[dist];
              if (!data) return null;
              return (
                <div key={dist} className={`third-down-item ${dist === distanceCategory && down === 3 ? 'active' : ''}`}>
                  <span className="dist-label">{dist}</span>
                  <span className="pass-rate">{(data.passRate * 100).toFixed(0)}%</span>
                  <span className="pass-label">pass</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Play Description */}
      {play?.description && (
        <div className="play-description card">
          <h4>Play Description</h4>
          <p>{play.description}</p>
        </div>
      )}

      {/* Chat Interface */}
      <div className="chat-container">
        <ChatInterface
          tendencies={tendencies}
          selectedTeam={selectedTeam}
        />
      </div>
    </div>
  );
}

function TendencyBar({ label, value, color, highlight }) {
  const percentage = (value * 100).toFixed(0);

  return (
    <div className={`tendency-bar ${highlight ? 'highlight' : ''}`}>
      <div className="bar-label">
        <span>{label}</span>
        <span className="bar-value">{percentage}%</span>
      </div>
      <div className="bar-track">
        <div
          className="bar-fill"
          style={{
            width: `${percentage}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
}

function getOrdinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
