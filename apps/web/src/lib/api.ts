import type {
  AskResponse,
  DocDto,
  DocFullDto,
  ChannelDto,
  FileDto,
  ConnectDto,
  HomeDto,
  MeDto,
  MessageDto,
  PoliciesDto,
  ProfilePageDto,
  SpaceListDto,
  ProfilePatch,
  ScheduledMessageDto,
  SpaceDto,
  StorageDto,
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
  patchSpace: (patch: { name?: string; description?: string }) =>
    request<SpaceDto>('/api/space', { method: 'PATCH', body: JSON.stringify(patch) }),
  setSpaceLogo: async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/space/logo', { method: 'POST', body: form });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json() as Promise<SpaceDto>;
  },
  removeSpaceLogo: () => request<SpaceDto>('/api/space/logo', { method: 'DELETE' }),
  // Remove a member from the whole space (owner/admin): rotates the content key
  // and invite so they can't read new messages or re-join with the old link.
  evictMember: (userId: string) =>
    request<{ ok: boolean }>('/api/space/evict', { method: 'POST', body: JSON.stringify({ userId }) }),
  setAdmin: (userId: string, admin: boolean) =>
    request<{ ok: boolean }>('/api/space/admins', { method: 'POST', body: JSON.stringify({ userId, admin }) }),
  setHistoryVisibility: (value: 'full' | 'join-forward') =>
    request<SpaceDto>('/api/space/history', { method: 'POST', body: JSON.stringify({ value }) }),
  spaces: () => request<SpaceListDto>('/api/spaces'),
  switchSpace: (dir: string) =>
    request<SpaceDto>('/api/spaces/switch', { method: 'POST', body: JSON.stringify({ dir }) }),
  files: () => request<FileDto[]>('/api/files'),
  docs: () => request<DocDto[]>('/api/docs'),
  doc: (id: string) => request<DocFullDto>(`/api/docs/${id}`),
  createDoc: (title: string) => request<DocFullDto>('/api/docs', { method: 'POST', body: JSON.stringify({ title }) }),
  updateDoc: (id: string, patch: { title?: string; body?: string }) =>
    request<DocFullDto>(`/api/docs/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  removeDoc: (id: string) => request<{ ok: boolean }>(`/api/docs/${id}`, { method: 'DELETE' }),
  setBlocked: (userId: string, blocked: boolean) =>
    request<{ blockedUserIds: string[] }>(`/api/users/${userId}/block`, {
      method: blocked ? 'POST' : 'DELETE',
    }),
  profile: (userId: string) => request<ProfilePageDto>(`/api/users/${userId}/profile`),
  login: (handle: string) =>
    request<UserDto>('/api/dev/login', { method: 'POST', body: JSON.stringify({ handle }) }),
  createProfile: (input: { name: string; handle: string; avatarEmoji?: string | null }) =>
    request<UserDto>('/api/profiles', { method: 'POST', body: JSON.stringify(input) }),
  logout: () => request<{ ok: boolean }>('/api/logout', { method: 'POST' }),
  exportIdentity: () => request<{ code: string }>('/api/identity/export'),
  importIdentity: (code: string) =>
    request<{ userId: string }>('/api/identity/import', { method: 'POST', body: JSON.stringify({ code }) }),
  channelMembers: (channelId: string) => request<UserDto[]>(`/api/channels/${channelId}/members`),
  addChannelMember: (channelId: string, userId: string) =>
    request<UserDto[]>(`/api/channels/${channelId}/members`, { method: 'POST', body: JSON.stringify({ userId }) }),
  removeChannelMember: (channelId: string, userId: string) =>
    request<UserDto[]>(`/api/channels/${channelId}/members/${userId}`, { method: 'DELETE' }),
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
  attach: async (channelId: string, file: File, caption: string, parentMessageId?: string) => {
    const form = new FormData();
    if (caption) form.append('caption', caption);
    if (parentMessageId) form.append('parentMessageId', parentMessageId);
    form.append('file', file);
    const res = await fetch(`/api/channels/${channelId}/attachments`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json() as Promise<MessageDto>;
  },
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
  calls: () => request<{ calls: Record<string, string[]>; recorders: Record<string, string[]> }>('/api/calls'),
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
  setCallRecording: (channelId: string, on: boolean) =>
    request<{ ok: boolean }>(`/api/channels/${channelId}/call/record`, {
      method: 'POST',
      body: JSON.stringify({ on }),
    }),
  /** Pull a file's bytes from whichever peer holds them (explicit click). */
  fetchFile: async (id: string) => {
    const res = await fetch(`/api/files/${id}?wait=1`);
    if (!res.ok) throw new Error('no connected peer has this file right now');
  },
  storage: () => request<StorageDto>('/api/storage'),
  setPolicies: (patch: Partial<PoliciesDto>) =>
    request<StorageDto>('/api/storage/policies', { method: 'PUT', body: JSON.stringify(patch) }),
  clearFileCache: () => request<StorageDto>('/api/storage/cache', { method: 'DELETE' }),
};
