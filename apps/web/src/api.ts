import type {
  AskResponse,
  ChannelDto,
  ConnectDto,
  HomeDto,
  MeDto,
  MessageDto,
  ProfilePageDto,
  ProfilePatch,
  ScheduledMessageDto,
  SpaceDto,
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
  connect: () => request<ConnectDto>('/api/connect'),
  space: () => request<SpaceDto | null>('/api/space'),
  createSpace: (name: string) =>
    request<SpaceDto>('/api/space', { method: 'POST', body: JSON.stringify({ name }) }),
  joinSpace: (invite: string) =>
    request<SpaceDto>('/api/space/join', { method: 'POST', body: JSON.stringify({ invite }) }),
  setBlocked: (userId: string, blocked: boolean) =>
    request<{ blockedUserIds: string[] }>(`/api/users/${userId}/block`, {
      method: blocked ? 'POST' : 'DELETE',
    }),
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
  calls: () => request<Record<string, string[]>>('/api/calls'),
  schedule: (channelId: string, body: string, inMinutes: number) =>
    request<ScheduledMessageDto>(`/api/channels/${channelId}/schedule`, {
      method: 'POST',
      body: JSON.stringify({ body, inMinutes }),
    }),
  scheduled: () => request<ScheduledMessageDto[]>('/api/scheduled'),
  cancelScheduled: (id: string) => request<{ ok: boolean }>(`/api/scheduled/${id}`, { method: 'DELETE' }),
  setPinned: (channelId: string, pinned: boolean) =>
    request<{ ok: boolean }>(`/api/channels/${channelId}/pin`, {
      method: 'POST',
      body: JSON.stringify({ pinned }),
    }),
  reorderPins: (channelIds: string[]) =>
    request<{ ok: boolean }>('/api/pins', { method: 'PUT', body: JSON.stringify({ channelIds }) }),
  joinCall: (channelId: string) =>
    request<{ participants: string[] }>(`/api/channels/${channelId}/call/join`, { method: 'POST' }),
  leaveCall: (channelId: string) =>
    request<{ ok: boolean }>(`/api/channels/${channelId}/call/leave`, { method: 'POST' }),
  taskScope: (requirements: string) =>
    request<TaskScopeDto>('/api/task-scope', { method: 'POST', body: JSON.stringify({ requirements }) }),
};
