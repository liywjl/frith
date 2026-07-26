// Seed the full demo: three spaces on one instance — Acme (work), Blade Crew
// (rollerblading friends), Static Bloom (a band). Server must be running.
//
// Cross-platform replacement for the previous demo-spaces.sh, which shelled
// out to curl and python3 to read one field out of a JSON response.

const port = process.env.PORT ?? '3001'
const api = `http://localhost:${port}/api`

/** fetch + throw on non-2xx, mirroring `curl -sf`. */
async function call(path, init) {
  const res = await fetch(`${api}${path}`, init)
  if (!res.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}`)
  }
  return res
}

const json = (body) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

/** { active, spaces: [{ dir, name }] } */
const listSpaces = async () => (await call('/spaces')).json()

const { active: homeDir } = await listSpaces()
await call('/dev/seed', json({ corpus: 'acme' }))
console.log(`seeded acme into current space (${homeDir})`)

const demoSpaces = [
  { name: 'Blade Crew 🛼', corpus: 'skate' },
  { name: 'Static Bloom 🎸', corpus: 'band' },
]

for (const { name, corpus } of demoSpaces) {
  // The shell version grepped the raw JSON for the name, which would also
  // match a substring inside some other field. Check the parsed list instead.
  const { spaces } = await listSpaces()
  if (spaces.some((s) => s.name === name)) {
    console.log(`${name} already exists — skipping`)
    continue
  }
  await call('/space', json({ name }))
  await call('/dev/seed', json({ corpus }))
  console.log(`created + seeded ${name}`)
}

await call('/spaces/switch', json({ dir: homeDir }))
console.log('back on the first space — open the app and use the rail to hop around')
