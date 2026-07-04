import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import AuthForm from './components/AuthForm';
import Sidebar from './components/Sidebar';
import ChatWindow from './components/ChatWindow';
import { fetchConversations, fetchMe, fetchMessages, openConversation } from './api';

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('token') || '');
  const [currentUser, setCurrentUser] = useState(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });
  const [authChecked, setAuthChecked] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const socketRef = useRef(null);
  // Socket event handlers close over stale state, so track the active
  // conversation id in a ref they can read fresh.
  const activeConversationRef = useRef(null);

  useEffect(() => {
    activeConversationRef.current = activeConversation?.id || null;
  }, [activeConversation]);

  // Verify the stored token is still valid before trusting it.
  useEffect(() => {
    if (!token) {
      setAuthChecked(true);
      return;
    }
    fetchMe(token)
      .then(({ user }) => setCurrentUser(user))
      .catch(() => handleLogout())
      .finally(() => setAuthChecked(true));
  }, [token]);

  useEffect(() => {
    if (!token || !currentUser) return;

    const socket = io({ path: '/socket.io/', auth: { token } });
    socketRef.current = socket;

    socket.on('message:new', ({ conversationId, message }) => {
      setMessages((prev) => (activeConversationRef.current === conversationId ? [...prev, message] : prev));
    });

    socket.on('conversation:updated', ({ id, otherUser, lastMessage }) => {
      setConversations((prev) => {
        const exists = prev.some((c) => c.id === id);
        const next = exists
          ? prev.map((c) => (c.id === id ? { ...c, otherUser, lastMessage } : c))
          : [{ id, otherUser, lastMessage }, ...prev];
        return next.sort((a, b) => new Date(b.lastMessage?.createdAt || 0) - new Date(a.lastMessage?.createdAt || 0));
      });
    });

    fetchConversations(token).then(setConversations).catch(console.error);

    return () => socket.disconnect();
  }, [token, currentUser]);

  function handleAuthed(newToken, user) {
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(user));
    setToken(newToken);
    setCurrentUser(user);
  }

  function handleLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    socketRef.current?.disconnect();
    setToken('');
    setCurrentUser(null);
    setConversations([]);
    setActiveConversation(null);
    setMessages([]);
  }

  async function selectConversation(conversation) {
    setActiveConversation(conversation);
    setMessages([]);
    const history = await fetchMessages(token, conversation.id);
    setMessages(history);
  }

  async function startConversation(user) {
    const existing = conversations.find((c) => c.otherUser?.id === user.id);
    if (existing) {
      selectConversation(existing);
      return;
    }
    const conversation = await openConversation(token, user.id);
    setConversations((prev) => [conversation, ...prev]);
    selectConversation(conversation);
  }

  function sendMessage(text) {
    socketRef.current?.emit('message:send', { conversationId: activeConversation.id, text });
  }

  if (!authChecked) return null;

  if (!token || !currentUser) {
    return <AuthForm onAuthed={handleAuthed} />;
  }

  return (
    <div className="app-layout">
      <Sidebar
        token={token}
        currentUser={currentUser}
        conversations={conversations}
        activeConversationId={activeConversation?.id}
        onSelectConversation={selectConversation}
        onStartConversation={startConversation}
        onLogout={handleLogout}
      />
      <ChatWindow
        conversation={activeConversation}
        messages={messages}
        currentUser={currentUser}
        onSend={sendMessage}
      />
    </div>
  );
}
