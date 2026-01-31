import ChatInterface from './ChatInterface';
import './StatsPanel.css';

export default function StatsPanel({
  play,
  plays,
  filteredPlays,
  tendencies,
  filteredTendencies,
  selectedTeam,
  onTeamChange,
  onQuery,
  activeFilters,
  queryLabel
}) {
  // Current situation from play
  const down = play?.down || 0;
  const distance = play?.yardsToGo || 0;

  // Use filtered tendencies for display
  const displayTendencies = filteredTendencies;

  return (
    <div className="stats-panel">
      {/* Compact Stats Section */}
      <div className="stats-section">
        {/* Team Selector */}
        <div className="team-selector">
          {['KC', 'PHI', 'BUF', 'SF', 'MIA', 'DET'].map(team => (
            <button
              key={team}
              className={`${selectedTeam === team ? 'active' : ''} ${team.toLowerCase()}`}
              onClick={() => onTeamChange(team)}
            >
              {team}
            </button>
          ))}
        </div>

        {/* Hero Stats - THE BIG NUMBERS */}
        {displayTendencies && (
          <div className="hero-stats">
            <div className="hero-stat">
              <span className="hero-value">{(displayTendencies.completionPct * 100).toFixed(0)}%</span>
              <span className="hero-label">Completion</span>
            </div>
            <div className="hero-stat">
              <span className="hero-value">{displayTendencies.avgYards?.toFixed(1)}</span>
              <span className="hero-label">Avg Yards</span>
            </div>
            <div className="hero-stat">
              <span className="hero-value">{displayTendencies.avgCoverage?.toFixed(1) || '—'}</span>
              <span className="hero-label">Separation</span>
            </div>
          </div>
        )}

        {/* Down & Distance Badge + Sample Size */}
        <div className="context-row">
          {down > 0 && (
            <div className="situation-badge">
              {down}{getOrdinal(down)} & {distance}
            </div>
          )}
          {displayTendencies && (
            <span className="sample-size">{displayTendencies.sampleSize} plays</span>
          )}
        </div>

        {/* Active Query Badge */}
        {queryLabel && (
          <div className="active-query">
            <span className="query-label">{queryLabel}</span>
            <span className="query-count">{filteredPlays?.length || 0} matching</span>
          </div>
        )}

        {/* Pass Direction - Only section that matters */}
        {displayTendencies && displayTendencies.passLeft !== undefined && (
          <div className="direction-bars">
            <div className="direction-header">Pass Direction</div>
            <TendencyBar label="Left" value={displayTendencies.passLeft} />
            <TendencyBar label="Middle" value={displayTendencies.passMiddle} />
            <TendencyBar label="Right" value={displayTendencies.passRight} />
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="section-divider"></div>

      {/* AI Coach Chat - Takes remaining space */}
      <div className="chat-section">
        <ChatInterface
          plays={plays}
          tendencies={tendencies}
          selectedTeam={selectedTeam}
          onQuery={onQuery}
        />
      </div>
    </div>
  );
}

function TendencyBar({ label, value }) {
  const percentage = ((value || 0) * 100).toFixed(0);

  return (
    <div className="tendency-bar">
      <div className="bar-label">
        <span>{label}</span>
        <span className="bar-value">{percentage}%</span>
      </div>
      <div className="bar-track">
        <div
          className="bar-fill"
          style={{ width: `${percentage}%` }}
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
