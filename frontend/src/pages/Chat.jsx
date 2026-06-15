import { useState, useRef, useEffect } from 'react';
import { apiFetchJson } from '../lib/api';
import './Chat.css';

export default function Chat() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Hi! I can help you search through your recordings. Try asking things like "show me videos with dogs" or "what happened yesterday?"' }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async () => {
    if (!inputValue.trim()) return;

    const userMessage = inputValue.trim();
    setInputValue('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      const result = await apiFetchJson('/chat', {
        method: 'POST',
        body: JSON.stringify({ query: userMessage }),
      });

      const assistantMsg = {
        role: 'assistant',
        content: result.response || 'No response from server',
        matches: result.matches || [],
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      console.error('[Chat UI] Error:', err);
      
      let errorContent = err.message;
      if (err.message.includes('400')) {
        errorContent = `Bad request. Make sure your query is not empty. Error: ${err.message}`;
      } else if (err.message.includes('500')) {
        errorContent = `Server error. Check the backend is running and recordings exist. Error: ${err.message}`;
      } else if (err.message.includes('Failed to parse response')) {
        errorContent = `Server didn't return valid JSON. Is the backend running? ${err.message}`;
      }
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: errorContent,
        error: true,
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="chat-root">
      <div className="chat-header">
        <h1>📹 Recording Search</h1>
        <p>Ask me anything about your recordings</p>
      </div>

      <div className="chat-container">
        <div className="chat-messages">
          {messages.map((msg, idx) => (
            <div key={idx} className={`chat-message ${msg.role}`}>
              <div className="chat-bubble">
                <p>{msg.content}</p>

                {msg.matches && msg.matches.length > 0 && (
                  <div className="chat-results">
                    <div className="results-title">
                      📹 {msg.matches.length} matching recording{msg.matches.length !== 1 ? 's' : ''}
                    </div>
                    {msg.matches.map((match, mIdx) => (
                      <div key={mIdx} className="result-item">
                        <div className="result-header">
                          <span className="result-camera">{match.cameraName}</span>
                          <span className="result-time">
                            {new Date(match.generatedAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="result-description">{match.description}</p>
                        <div className="result-actions">
                          <a
                            href={`/playback?camera=${encodeURIComponent(match.cameraId)}&file=${encodeURIComponent(match.filename)}`}
                            className="result-play-btn"
                          >
                            ▶ Watch Recording
                          </a>
                          <code className="result-filename">{match.filename}</code>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {msg.error && (
                <div className="chat-error-indicator">⚠️</div>
              )}
            </div>
          ))}

          {loading && (
            <div className="chat-message assistant">
              <div className="chat-bubble loading">
                <div className="spinner"></div>
                <p>Searching your recordings...</p>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input-area">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask about your recordings... (e.g., 'show me videos with dogs', 'what happened last hour?')"
            className="chat-textarea"
            disabled={loading}
            rows="2"
          />
          <button
            onClick={sendMessage}
            disabled={!inputValue.trim() || loading}
            className="chat-send-btn"
          >
            {loading ? '⏳' : '📤'} Send
          </button>
        </div>
      </div>

      <div className="chat-tips">
        <p><strong>Example queries:</strong></p>
        <ul>
          <li>"Show me videos with dogs"</li>
          <li>"What happened in the last 24 hours?"</li>
          <li>"Find recordings from front camera with people"</li>
          <li>"Show me the video when someone entered"</li>
          <li>"Videos from yesterday with motion"</li>
        </ul>
      </div>
    </div>
  );
}
