// Load the Acme corpus into the running server's space.
export {};

const port = process.env.PORT ?? 3001;
try {
  const res = await fetch(`http://127.0.0.1:${port}/api/dev/seed`, { method: 'POST' });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const counts = (await res.json()) as { users: number; channels: number; messages: number };
  console.log(`seeded ${counts.users} users, ${counts.channels} channels, ${counts.messages} messages`);
} catch (err) {
  console.error('Could not seed — is the server running? (pnpm dev)');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
