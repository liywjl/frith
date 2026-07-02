import type { AskResponse, ChannelDto, MessageDto, UserDto } from '@app/shared';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  me: () => request<UserDto>('/api/me'),
  users: () => request<UserDto[]>('/api/users'),
  login: (handle: string) =>
    request<UserDto>('/api/dev/login', { method: 'POST', body: JSON.stringify({ handle }) }),
  channels: () => request<ChannelDto[]>('/api/channels'),
  messages: (channelId: string) => request<MessageDto[]>(`/api/channels/${channelId}/messages`),
  markRead: (channelId: string) =>
    request<{ ok: boolean }>(`/api/channels/${channelId}/read`, { method: 'POST' }),
  openDm: (userId: string) => request<{ channelId: string }>(`/api/dms/${userId}`, { method: 'POST' }),
  thread: (rootId: string) => request<MessageDto[]>(`/api/messages/${rootId}/thread`),
  send: (channelId: string, body: string, parentMessageId?: string) =>
    request<MessageDto>(`/api/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body, parentMessageId }),
    }),
  react: (messageId: string, emoji: string) =>
    request<{ added: boolean }>(`/api/messages/${messageId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    }),
  ask: (q: string) => request<AskResponse>(`/api/ask?q=${encodeURIComponent(q)}`),
};
