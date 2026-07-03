const feed = document.getElementById('feed');
const form = document.getElementById('form');
const input = document.getElementById('input');
const status = document.getElementById('status');

const name = `peer-${Math.random().toString(36).slice(2, 6)}`;
let me = null;

function addMessage(msg) {
  const el = document.createElement('div');
  el.className = msg.author === me ? 'm mine' : 'm';
  const b = document.createElement('b');
  b.textContent = msg.name;
  // Every rendered message passed signature verification in the worker;
  // the tooltip shows whose key vouches for it.
  b.title = `signed by ${msg.author.slice(0, 12)}…`;
  el.append(b, document.createTextNode(msg.text));
  feed.append(el);
  feed.scrollTop = feed.scrollHeight;
}

window.chat.onEvent((event) => {
  if (event.type === 'ready') {
    me = event.me;
    status.textContent = `room: ${event.room} · ${event.history} messages on disk · waiting for peers…`;
  }
  if (event.type === 'history') {
    for (const msg of event.messages) addMessage(msg);
  }
  if (event.type === 'peers') {
    status.textContent = `${event.count} peer${event.count === 1 ? '' : 's'} connected`;
    status.className = event.count > 0 ? 'connected' : '';
  }
  if (event.type === 'message') addMessage(event.message);
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  // No local echo: the worker signs, persists, and reflects it back.
  void window.chat.send({ name, text });
  input.value = '';
});
