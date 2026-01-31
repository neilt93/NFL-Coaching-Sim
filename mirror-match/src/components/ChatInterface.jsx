import { useState, useRef, useEffect } from 'react';
import { queryGemini } from '../engine/geminiClient';
import './ChatInterface.css';

// Get API key from environment variable
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// Fallback responses when API is not available
const DEMO_RESPONSES = {
  'default': "I can help you analyze NFL tendencies. Try asking about specific situations like '3rd and 7' or 'red zone' plays.",
  'third': "KC passes 72% on 3rd down, with 94% of those plays from shotgun. They favor the right side of the field (40%) and average 4.6 yards per play.",
  '3rd': "KC passes 72% on 3rd down, with 94% of those plays from shotgun. They favor the right side of the field (40%) and average 4.6 yards per play.",
  'red zone': "In the red zone, KC's passing game shifts to quick throws. They target the middle of the field more often due to compressed spacing.",
  'shotgun': "KC uses shotgun on 81% of plays overall. On 3rd down, that jumps to 94%. They're one of the most shotgun-heavy teams in the league.",
  'pass': "KC's overall pass rate is 60%. On 1st down it's 50/50, but by 3rd down they pass 72% of the time.",
  'run': "KC runs 40% of the time overall. Their most frequent run situations are 1st down (50%) and short-yardage (3 yards or less).",
  'kelce': "Travis Kelce is the primary target on crossing routes and in the red zone. He sees increased targets on 3rd down and medium distance.",
  'mahomes': "Patrick Mahomes excels when given time in shotgun formations. His scrambling ability adds an extra dimension when plays break down.",
  'tendencies': "KC's key tendencies: 60% pass overall, 72% pass on 3rd down, 81% shotgun rate, favors right side of field on passes.",
  'blitz': "When facing a blitz, KC typically adjusts to hot routes and quick throws. Completion percentage drops but they get the ball out faster.",
  'what if': "Against a blitz, KC's completion rate drops about 15% but they compensate with hot routes. Average time to throw drops from 2.8s to 2.1s.",
  'eagles': "PHI runs 42% of the time with a strong outside zone scheme. On 3rd down they pass 70%, favoring the left side of the field.",
  'phi': "PHI runs 42% of the time with a strong outside zone scheme. On 3rd down they pass 70%, favoring the left side of the field.",
};

function getFallbackResponse(message, tendencies, selectedTeam) {
  const lower = message.toLowerCase();

  // Check for team-specific queries
  if (lower.includes('phi') || lower.includes('eagle')) {
    const phiData = tendencies?.PHI?.overall;
    if (phiData) {
      return `PHI 2025: ${(phiData.passRate * 100).toFixed(0)}% pass, ${(phiData.runRate * 100).toFixed(0)}% run. Shotgun rate: ${(phiData.shotgunRate * 100).toFixed(0)}%. Average ${phiData.avgYards} yards per play.`;
    }
  }

  // Check for KC queries
  if (lower.includes('kc') || lower.includes('chief')) {
    const kcData = tendencies?.KC?.overall;
    if (kcData) {
      return `KC 2025: ${(kcData.passRate * 100).toFixed(0)}% pass, ${(kcData.runRate * 100).toFixed(0)}% run. Shotgun rate: ${(kcData.shotgunRate * 100).toFixed(0)}%. Average ${kcData.avgYards} yards per play.`;
    }
  }

  // Check keyword matches
  for (const [key, response] of Object.entries(DEMO_RESPONSES)) {
    if (lower.includes(key)) {
      return response;
    }
  }

  // Generate response from actual data if available
  const teamData = tendencies?.[selectedTeam]?.overall;
  if (teamData) {
    return `${selectedTeam} passes ${(teamData.passRate * 100).toFixed(0)}% of the time overall, averaging ${teamData.avgYards} yards per play. They use shotgun on ${(teamData.shotgunRate * 100).toFixed(0)}% of snaps.`;
  }

  return DEMO_RESPONSES.default;
}

export default function ChatInterface({ tendencies, selectedTeam }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `Welcome to Mirror Match! I've loaded KC and PHI tendency data from the 2025 season. ${GEMINI_API_KEY ? '🟢 Gemini API connected.' : '⚪ Demo mode (add VITE_GEMINI_API_KEY to .env for AI).'} Ask me about down-and-distance tendencies, formations, or specific situations!`
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = input.trim();
    setInput('');

    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    setIsTyping(true);

    let response;

    try {
      if (GEMINI_API_KEY) {
        // Use Gemini API
        response = await queryGemini(userMessage, tendencies, selectedTeam, GEMINI_API_KEY);
      } else {
        // Fallback to demo mode
        await new Promise(resolve => setTimeout(resolve, 600 + Math.random() * 400));
        response = getFallbackResponse(userMessage, tendencies, selectedTeam);
      }
    } catch (error) {
      console.error('Chat error:', error);
      response = `Sorry, I encountered an error. ${error.message}. Using cached data instead: ` +
        getFallbackResponse(userMessage, tendencies, selectedTeam);
    }

    setIsTyping(false);
    setMessages(prev => [...prev, { role: 'assistant', content: response }]);
  };

  const handleQuickAction = (action) => {
    setInput(action);
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
            <div className="message-avatar">
              {msg.role === 'assistant' ? '🤖' : '👤'}
            </div>
            <div className="message-content">
              {msg.content}
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="message assistant">
            <div className="message-avatar">🤖</div>
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
        <button onClick={() => handleQuickAction("What does KC do on 3rd and 7?")}>
          3rd & 7
        </button>
        <button onClick={() => handleQuickAction("Show me KC shotgun tendencies")}>
          Shotgun
        </button>
        <button onClick={() => handleQuickAction("What if I blitz?")}>
          What-if
        </button>
        <button onClick={() => handleQuickAction("Compare KC vs PHI")}>
          Compare
        </button>
      </div>

      <form className="chat-input" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about tendencies..."
          disabled={isTyping}
        />
        <button type="submit" disabled={isTyping || !input.trim()}>
          →
        </button>
      </form>
    </div>
  );
}
