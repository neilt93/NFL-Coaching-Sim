import { useState, useRef, useEffect } from 'react';
import { queryGemini } from '../engine/geminiClient';
import './ChatInterface.css';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

const suggestedQueries = [
  "Show me Kelce routes",
  "KC red zone plays",
  "Pass Chart",
  "Show longest throws",
];

export default function ChatInterface({ plays, tendencies, selectedTeam, onQuery }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handlePortalClick = (portal) => {
    if (onQuery) {
      const label = buildFilterLabel(portal.filters);
      onQuery(portal.filters, label, portal.viewMode || 'replay');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsTyping(true);

    try {
      const result = await queryGemini(userMessage, tendencies, selectedTeam, GEMINI_API_KEY);
      setIsTyping(false);

      // Calculate stats from filtered plays if we have filters
      let stats = null;
      if (result.filters && plays.length > 0) {
        const matchingPlays = plays.filter(p => {
          if (result.filters.offense && p.offense !== result.filters.offense) return false;
          if (result.filters.down && p.down !== result.filters.down) return false;
          if (result.filters.distanceMin && p.yardsToGo < result.filters.distanceMin) return false;

          // Red zone filter - use ball position if no yardline
          if (result.filters.fieldZone === 'redzone') {
            let inRedZone = false;
            if (p.yardline !== undefined) {
              inRedZone = p.yardline <= 20;
            } else if (p.ball && p.ball.length > 0) {
              const ballFrame = p.ball.find(b => b.f === 1) || p.ball[0];
              if (ballFrame?.x !== undefined) {
                inRedZone = ballFrame.x >= 90 || ballFrame.x <= 20;
              }
            }
            if (!inRedZone) return false;
          }

          // Play type filter
          if (result.filters.playType) {
            const isPassPlay = p.passResult && p.passResult !== '';
            if (result.filters.playType === 'pass' && !isPassPlay) return false;
            if (result.filters.playType === 'run' && isPassPlay) return false;
          }

          // Yards gained filters (for "longest throws", "big plays", etc.)
          if (result.filters.yardsGainedMin !== undefined && (p.yardsGained || 0) < result.filters.yardsGainedMin) {
            return false;
          }
          if (result.filters.yardsGainedMax !== undefined && (p.yardsGained || 0) > result.filters.yardsGainedMax) {
            return false;
          }

          // Touchdown filter
          if (result.filters.isTouchdown) {
            const isTD = p.isTouchdown || (p.description && p.description.toLowerCase().includes('touchdown'));
            if (!isTD) return false;
          }

          // Check targetPlayer filter
          if (result.filters.targetPlayer) {
            const playerName = result.filters.targetPlayer.toLowerCase();
            const hasPlayer = p.players?.some(player =>
              (player.name || '').toLowerCase().includes(playerName)
            );
            if (!hasPlayer) return false;
          }
          return true;
        });
        console.log('ChatInterface stats - matching plays:', matchingPlays.length, 'filters:', result.filters);

        if (matchingPlays.length > 0) {
          const passPlays = matchingPlays.filter(p => p.passResult);
          const completions = passPlays.filter(p => p.passResult === 'C' || p.yardsGained > 0);
          stats = {
            plays: matchingPlays.length,
            completion: passPlays.length > 0 ? Math.round((completions.length / passPlays.length) * 100) : 0,
            avgYards: matchingPlays.reduce((sum, p) => sum + (p.yardsGained || 0), 0) / matchingPlays.length,
          };
        }
      }

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: result.response,
        stats: stats,
        portal: result.filters ? {
          filters: result.filters,
          viewMode: result.viewMode || 'replay',
          label: buildFilterLabel(result.filters)
        } : null
      }]);

    } catch (error) {
      console.error('Chat error:', error);
      setIsTyping(false);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `I couldn't process that request. Try asking about a specific team and situation, like "Show me KC red zone plays" or "Buffalo 3rd down tendencies".`
      }]);
    }
  };

  const handleSuggestion = (query) => {
    setInput(query);
    setTimeout(() => {
      const form = document.querySelector('.chat-input-form');
      if (form) form.dispatchEvent(new Event('submit', { bubbles: true }));
    }, 100);
  };

  return (
    <div className="chat-interface">
      {/* Chat Messages */}
      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="welcome-screen">
            <div className="welcome-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <h2>Welcome, Coach</h2>
            <p className="welcome-subtitle">
              I analyze NFL play data to help you understand tendencies and patterns.
              Ask me about any team, situation, or player.
            </p>
            <div className="suggestions">
              <p className="suggestions-label">Try asking:</p>
              {suggestedQueries.map((query, i) => (
                <button
                  key={i}
                  className="suggestion-btn"
                  onClick={() => handleSuggestion(query)}
                >
                  {query}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className="message-container">
              <div className={`message-row ${msg.role}`}>
                {msg.role === 'assistant' && (
                  <div className="ai-avatar">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                      <path d="M2 17l10 5 10-5"/>
                      <path d="M2 12l10 5 10-5"/>
                    </svg>
                  </div>
                )}
                <div className={`message-bubble ${msg.role}`}>
                  {msg.content}
                </div>
              </div>

              {/* Stats Card */}
              {msg.stats && (
                <div className="stats-card">
                  <div className="stats-grid">
                    <div className="stat-item">
                      <div className="stat-value">{msg.stats.plays}</div>
                      <div className="stat-label">Plays</div>
                    </div>
                    <div className="stat-item">
                      <div className="stat-value">{msg.stats.completion}%</div>
                      <div className="stat-label">Completion</div>
                    </div>
                    <div className="stat-item">
                      <div className="stat-value">{msg.stats.avgYards.toFixed(1)}</div>
                      <div className="stat-label">Avg Yards</div>
                    </div>
                  </div>

                  {msg.portal && (
                    <button
                      className="simulation-btn"
                      onClick={() => handlePortalClick(msg.portal)}
                    >
                      <span>Watch Plays</span>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                      </svg>
                    </button>
                  )}
                </div>
              )}

              {/* Portal card (when no stats but has filters) */}
              {!msg.stats && msg.portal && (
                <button className="portal-btn" onClick={() => handlePortalClick(msg.portal)}>
                  <span>View: {msg.portal.label}</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                </button>
              )}
            </div>
          ))
        )}

        {isTyping && (
          <div className="message-row assistant">
            <div className="ai-avatar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div className="message-bubble assistant typing">
              <span className="dot"></span>
              <span className="dot"></span>
              <span className="dot"></span>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form className="chat-input-form" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about any team, situation, or player..."
          disabled={isTyping}
        />
        <button type="submit" disabled={isTyping || !input.trim()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </form>
    </div>
  );
}

function buildFilterLabel(filters) {
  if (!filters) return 'All Plays';
  const parts = [];

  if (filters.offense) parts.push(filters.offense);
  if (filters.targetPlayer) parts.push(filters.targetPlayer + ' Routes');
  if (filters.down) {
    let downStr = `${filters.down}${getOrdinal(filters.down)} down`;
    if (filters.distanceMin) downStr += ` (${filters.distanceMin}+ yds)`;
    else if (filters.distanceMax) downStr += ` (1-${filters.distanceMax} yds)`;
    parts.push(downStr);
  }
  if (filters.fieldZone === 'redzone') parts.push('Red Zone');
  if (filters.coverageTight === true) parts.push('Tight Coverage');
  if (filters.playType === 'pass') parts.push('Pass Plays');
  else if (filters.playType === 'run') parts.push('Run Plays');

  return parts.join(' · ') || 'All Plays';
}

function getOrdinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
