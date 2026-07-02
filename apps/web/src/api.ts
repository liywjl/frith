import type {
  AskResponse,
  ChannelDto,
  HomeDto,
  MeDto,
  MessageDto,
  ProfilePageDto,
  ProfilePatch,
  TaskScopeDto,
  UserDto,
} from '@app/shared';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    // Fastify 400s on an empty body with a JSON content-type, so only claim
    // JSON when we actually send one.
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  me: () => request<MeDto>('/api/me'),
  patchMe: (patch: ProfilePatch) =>
    request<UserDto>('/api/me', { method: 'PATCH', body: JSON.stringify(patch) }),
  users: () => request<UserDto[]>('/api/users'),
  home: () => request<HomeDto>('/api/home'),
  profile: (userId: string) => request<ProfilePageDto>(`/api/users/${userId}/profile`),
  login: (handle: string) =>
    request<UserDto>('/api/dev/login', { method: 'POST', body: JSON.stringify({ handle }) }),
  channels: () => request<ChannelDto[]>('/api/channels'),
  createChannel: (input: { name: string; type: 'public' | 'private'; topic?: string | null }) =>
    request<{ channelId: string }>('/api/channels', { method: 'POST', body: JSON.stringify(input) }),
  setArchived: (channelId: string, archived: boolean) =>
    request<{ ok: boolean }>(`/api/channels/${channelId}/${archived ? 'archive' : 'unarchive'}`, {
      method: 'POST',
    }),
  createGroup: (userIds: string[]) =>
    request<{ channelId: string }>('/api/groups', { method: 'POST', body: JSON.stringify({ userIds }) }),
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
  taskScope: (requirements: string) =>
    request<TaskScopeDto>('/api/task-scope', { method: 'POST', body: JSON.stringify({ requirements }) }),
};
