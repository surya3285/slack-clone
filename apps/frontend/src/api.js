async function request(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `request failed with status ${res.status}`);
  }
  return data;
}

export const signup = (username, password) => request('/auth/signup', { method: 'POST', body: { username, password } });
export const login = (username, password) => request('/auth/login', { method: 'POST', body: { username, password } });
export const fetchMe = (token) => request('/auth/me', { token });

export const searchUsers = (token, q) => request(`/users/search?q=${encodeURIComponent(q)}`, { token });

export const fetchConversations = (token) => request('/conversations', { token });
export const openConversation = (token, userId) => request('/conversations', { method: 'POST', token, body: { userId } });
export const fetchMessages = (token, conversationId) => request(`/conversations/${conversationId}/messages`, { token });
