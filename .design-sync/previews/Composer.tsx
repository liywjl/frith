import { Composer } from 'web';

const commands = [
  { name: 'task', hint: 'Start a task from this channel', run: () => {} },
  { name: 'call', hint: 'Light a campfire (voice / video)', run: () => {} },
  { name: 'remind', hint: 'Schedule a reminder', run: () => {} },
];

export const Default = () => (
  <div style={{ maxWidth: 660 }}>
    <Composer channelId="c1" placeholder="Message #infra" commands={commands} />
  </div>
);

export const ThreadReply = () => (
  <div style={{ maxWidth: 660 }}>
    <Composer channelId="c1" parentMessageId="m1" placeholder="Reply in thread…" />
  </div>
);
