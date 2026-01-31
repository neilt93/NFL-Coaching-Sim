import { useState, useRef, useEffect } from 'react';
import { queryGemini } from '../engine/geminiClient';
import './ChatInterface.css';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

export default function ChatInterface({ plays, tendencies, selectedTeam, onQuery }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `Ready to analyze ${selectedTeam}. Ask me about situations like "3rd and long", "red zone", or "tight coverage" and I'll show you matching plays.`
    }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Update welcome message when team changes
  useEffect(() => {
    setMessages([{
      role: 'assistant',
      content: `Ready to analyze ${selectedTeam}. Ask me about situations like "3rd and long", "red zone", or "tight coverage" and I'll show you matching plays.`
    }]);
  }, [selectedTeam]);

  // Handle clicking on a portal card
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

    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsTyping(true);

    try {
      // Query Gemini to get filters + response
      const result = await queryGemini(userMessage, tendencies, selectedTeam, GEMINI_API_KEY);

      setIsTyping(false);

      // Add assistant response WITH portal card if filters were returned
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: result.response,
        // Include portal data so we can render a clickable card
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
        content: `Error: ${error.message}. Try asking about "3rd down" or "red zone" plays.`
      }]);
    }
  };

  const handleQuickAction = (query) => {
    setInput(query);
    // Auto-submit
    setTimeout(() => {
      const form = document.querySelector('.chat-input');
      if (form) form.dispatchEvent(new Event('submit', { bubbles: true }));
    }, 100);
  };

  return (
    <div className="chat-interface">
      <div className="chat-header">
        <h3>AI Coach</h3>
        <span className={`model-badge ${GEMINI_API_KEY ? 'active' : ''}`}>
          {GEMINI_API_KEY ? 'Gemini 2.0' : 'Demo'}
        </span>
      </div>

      <div className="chat-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <div className="message-content">
              {msg.content}
              {/* Portal window - clickable mini preview */}
              {msg.portal && (
                <div
                  className="portal-window"
                  onClick={() => handlePortalClick(msg.portal)}
                >
                  <div className="portal-window-field">
                    <div className="field-lines"></div>
                    <div className="field-overlay">
                      {msg.portal.viewMode === 'routes' && <div className="preview-routes"></div>}
                      {msg.portal.viewMode === 'chart' && <div className="preview-dots"></div>}
                      {msg.portal.viewMode === 'replay' && <div className="preview-players"></div>}
                    </div>
                  </div>
                  <div className="portal-window-label">{msg.portal.label}</div>
                </div>
              )}
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="message assistant">
            <div className="message-content typing">
              <span className="dot"></span>
              <span className="dot"></span>
              <span className="dot"></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="quick-actions">
        <button onClick={() => handleQuickAction("Show me 3rd and long plays")}>
          3rd & Long
        </button>
        <button onClick={() => handleQuickAction("Show me Kelce routes")}>
          Kelce Routes
        </button>
        <button onClick={() => handleQuickAction("Red zone plays")}>
          Red Zone
        </button>
        <button onClick={() => handleQuickAction("Where do they throw?")}>
          Pass Chart
        </button>
      </div>

      <form className="chat-input" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about situations..."
          disabled={isTyping}
        />
        <button type="submit" disabled={isTyping || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

// Build a human-readable label from filters
function buildFilterLabel(filters) {
  const parts = [];

  if (filters.offense) {
    parts.push(filters.offense);
  }

  if (filters.targetPlayer) {
    parts.push(filters.targetPlayer + ' Routes');
  }

  if (filters.down) {
    let downStr = `${filters.down}${getOrdinal(filters.down)} down`;
    if (filters.distanceMin) {
      downStr += ` (${filters.distanceMin}+ yds)`;
    } else if (filters.distanceMax) {
      downStr += ` (1-${filters.distanceMax} yds)`;
    }
    parts.push(downStr);
  }

  if (filters.fieldZone === 'redzone') {
    parts.push('Red Zone');
  }

  if (filters.coverageTight === true) {
    parts.push('Tight Coverage');
  } else if (filters.coverageTight === false) {
    parts.push('Off Coverage');
  }

  if (filters.shotgun === true) {
    parts.push('Shotgun');
  } else if (filters.shotgun === false) {
    parts.push('Under Center');
  }

  if (filters.playType === 'pass') {
    parts.push('Pass Plays');
  } else if (filters.playType === 'run') {
    parts.push('Run Plays');
  }

  return parts.join(' - ') || 'All Plays';
}

function getOrdinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
