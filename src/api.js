import { API_BASE } from './config';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  spots: () => request('/api/spots'),
  posts: () => request('/api/posts'),
  weather: () => request('/api/weather'),
  feed: () => request('/api/community/feed'),
  createPost: (body) => request('/api/posts', { method: 'POST', body: JSON.stringify(body) }),
  likePost: (id, author, action = 'like') =>
    request(`/api/posts/${id}/like`, { method: 'POST', body: JSON.stringify({ author, action }) }),
  commentPost: (id, author, text) =>
    request(`/api/posts/${id}/comment`, { method: 'POST', body: JSON.stringify({ author, text }) }),
  chat: (message, context = {}) =>
    request('/api/agent/chat', { method: 'POST', body: JSON.stringify({ message, context }) }),
};
