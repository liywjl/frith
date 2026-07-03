const feed = document.getElementById('feed');
const form = document.getElementById('form');
const input = document.getElementById('input');
const status = document.getElementById('status');

const name = `peer-${Math.random().toString(36).slice(2, 6)}`;

function addMessage(from, text, mine) {
  const el = document.createElement('div');
  el.className = mine ? 'm mine' : 'm';
  const b = document.createElement('b');
  b.textContent = from;
  el.append(b, document.createTextNode(text));
  feed.append(el);
  feed.scrollTop = feed.scrollHeight;
}

window.chat.onEvent((event) => {
  if (event.type === 'ready') status.textContent = `room: ${event.room} · waiting for peers…`;
  if (event.type === 'peers') {
    status.textContent = `${event.count} peer${event.count === 1 ? '' : 's'} connected`;
    status.className = event.count > 0 ? 'connected' : '';
  }
  if (event.type === 'message') addMessage(event.from, event.text, false);
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  void window.chat.send({ from: name, text });
  addMessage(name, text, true);
  input.value = '';
});
