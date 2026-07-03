import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const CHANNEL = 'general';

export default function App() {
  const [username, setUsername] = useState(() => localStorage.getItem('username') || '');
  const [usernameInput, setUsernameInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (!username) return;

    fetch(`/api/messages?channel=${CHANNEL}`)
      .then((res) => res.json())
      .then(setMessages)
      .catch((err) => console.error('failed to load message history', err));

    const socket = io({ path: '/socket.io/' });
    socketRef.current = socket;

    socket.emit('chat:join', CHANNEL);
    socket.on('chat:message', (message) => {
      setMessages((prev) => [...prev, message]);
    });

    return () => socket.disconnect();
  }, [username]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleJoin(e) {
    e.preventDefault();
    if (!usernameInput.trim()) return;
    localStorage.setItem('username', usernameInput.trim());
    setUsername(usernameInput.trim());
  }

  function handleSend(e) {
    e.preventDefault();
    if (!text.trim() || !socketRef.current) return;
    socketRef.current.emit('chat:message', { channel: CHANNEL, username, text: text.trim() });
    setText('');
  }

  if (!username) {
    return (
      <div className="login-screen">
        <form onSubmit={handleJoin} className="login-form">
          <h1>Slack Clone</h1>
          <input
            autoFocus
            placeholder="Choose a username"
            value={usernameInput}
            onChange={(e) => setUsernameInput(e.target.value)}
          />
          <button type="submit">Join #{CHANNEL}</button>
        </form>
      </div>
    );
  }

  return (
    <div className="chat-screen">
      <header>
        <span>#{CHANNEL}</span>
        <span className="whoami">signed in as {username}</span>
      </header>
      <main className="message-list">
        {messages.map((m) => (
          <div key={m._id || `${m.username}-${m.createdAt}`} className="message">
            <span className="message-user">{m.username}</span>
            <span className="message-text">{m.text}</span>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </main>
      <form onSubmit={handleSend} className="message-form">
        <input
          autoFocus
          placeholder={`Message #${CHANNEL}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
