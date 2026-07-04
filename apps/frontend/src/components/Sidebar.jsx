import React, { useEffect, useState } from 'react';
import { searchUsers } from '../api';

export default function Sidebar({ token, currentUser, conversations, activeConversationId, onSelectConversation, onStartConversation, onLogout }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    const timeout = setTimeout(() => {
      searchUsers(token, q).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timeout);
  }, [query, token]);

  function handleSelectResult(user) {
    onStartConversation(user);
    setQuery('');
    setResults([]);
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span>{currentUser.username}</span>
        <button className="link-button" onClick={onLogout}>
          Log out
        </button>
      </div>

      <div className="search-box">
        <input
          placeholder="Search people..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {results.length > 0 && (
          <ul className="search-results">
            {results.map((user) => (
              <li key={user.id} onClick={() => handleSelectResult(user)}>
                {user.username}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ul className="conversation-list">
        {conversations.map((c) => (
          <li
            key={c.id}
            className={c.id === activeConversationId ? 'active' : ''}
            onClick={() => onSelectConversation(c)}
          >
            <span className="conversation-name">{c.otherUser?.username}</span>
            {c.lastMessage?.text && <span className="conversation-preview">{c.lastMessage.text}</span>}
          </li>
        ))}
        {conversations.length === 0 && <li className="empty-hint">Search for someone to start chatting</li>}
      </ul>
    </aside>
  );
}
