import React, { useEffect, useRef, useState } from 'react';

export default function ChatWindow({ conversation, messages, currentUser, onSend }) {
  const [text, setText] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text.trim());
    setText('');
  }

  if (!conversation) {
    return (
      <main className="chat-panel empty-state">
        <p>Select a conversation or search for someone to start chatting.</p>
      </main>
    );
  }

  return (
    <main className="chat-panel">
      <header>
        <span>{conversation.otherUser?.username}</span>
      </header>
      <div className="message-list">
        {messages.map((m) => (
          <div key={m.id} className={`message ${m.sender?.id === currentUser.id ? 'mine' : ''}`}>
            <span className="message-user">{m.sender?.username}</span>
            <span className="message-text">{m.text}</span>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <form onSubmit={handleSubmit} className="message-form">
        <input
          autoFocus
          placeholder={`Message ${conversation.otherUser?.username}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit">Send</button>
      </form>
    </main>
  );
}
