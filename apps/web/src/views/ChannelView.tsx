import { Fragment, useRef, useState } from 'react';
import type { ChannelDto, MessageDto, ScheduledMessageDto } from '@app/shared';
import { api } from '../lib/api';
import { Avatar } from '../components/Avatar';
import { Composer, type ComposerHandle, type SlashCommand } from '../components/Composer';
import { Icon } from '../components/Icon';
import { Message } from '../components/Message';
import { MembersModal } from '../modals/MembersModal';
import { useUserActions } from '../lib/userActions';
import { useWindowedFeed } from '../lib/useWindowedFeed';

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

/** Group consecutive messages: same author within 5 minutes lose their header. */
function isCompact(prev: MessageDto | undefined, m: MessageDto): boolean {
  if (!prev) return false;
  if (prev.authorId !== m.authorId) return false;
  return new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
}

function isNewDay(prev: MessageDto | undefined, m: MessageDto): boolean {
  if (!prev) return true;
  return new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
}

export function ChannelView({
  channel,
  messages,
  callParticipants,
  callRecording,
  inCall,
  onStartCall,
  commands,
  scheduled,
  onCancelScheduled,
  onOpenThread,
  onOpenAsk,
  meId,
  onLeft,
  onArchive,
  canArchive,
}: {
  channel: ChannelDto;
  messages: MessageDto[];
  callParticipants: string[];
  /** Someone in the live campfire is recording — say so before people join. */
  callRecording: boolean;
  inCall: boolean;
  onStartCall: (withVideo: boolean) => void;
  commands: SlashCommand[];
  scheduled: ScheduledMessageDto[];
  onCancelScheduled: (id: string) => void;
  onOpenThread: (root: MessageDto) => void;
  onOpenAsk: () => void;
  meId: string;
  /** After leaving a private channel/group — it's gone for this user. */
  onLeft: () => void;
  onArchive: () => void;
  canArchive: boolean;
}) {
  const { getUser } = useUserActions();
  const feedRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const dragDepth = useRef(0);
  const [membersOpen, setMembersOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Dropping a file anywhere in the channel stages it on the composer. We only
  // engage for actual files so text/link drags fall through untouched.
  const canDrop = !channel.archivedAt;
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');

  const { visible, hiddenCount, onScroll } = useWindowedFeed(feedRef, messages, channel.id);

  const label = channel.type === 'dm' ? channel.dmPartnerNames?.join(', ') : `# ${channel.name}`;
  const soloPartner =
    channel.type === 'dm' && (channel.dmPartnerIds ?? []).length === 1
      ? getUser(channel.dmPartnerIds![0]!)
      : undefined;

  return (
    <main
      className="main"
      onDragEnter={(e) => {
        if (!canDrop || !hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (canDrop && hasFiles(e)) e.preventDefault();
      }}
      onDragLeave={() => {
        if (!dragging) return;
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragging(false);
        }
      }}
      onDrop={(e) => {
        if (!canDrop || !hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        composerRef.current?.addFiles(e.dataTransfer.files);
      }}
    >
      {dragging && (
        <div className="drop-overlay">
          <Icon name="paperclip" size={26} /> Drop to attach
        </div>
      )}
      <header className="topbar">
        {soloPartner && <Avatar name={soloPartner.name} emoji={soloPartner.avatarEmoji} />}
        <span className="topbar-id">
          <span className="chan" title={label}>
            {label}
          </span>
          {channel.topic && (
            <span className="topic" title={channel.topic}>
              {channel.topic}
            </span>
          )}
        </span>
        {channel.archivedAt && <span className="archived-chip">archived</span>}
        {channel.type !== 'public' && (
          <button className="members-btn" title="Who's here — add or remove people" onClick={() => setMembersOpen(true)}>
            <Icon name="people" />
          </button>
        )}
        {!channel.archivedAt && !inCall && (
          callParticipants.length > 0 ? (
            <button
              className="campfire-btn live"
              onClick={() => onStartCall(false)}
              title={callRecording ? 'This call is being recorded' : undefined}
            >
              <Icon name="flame" /> Join · {callParticipants.length}
              {callRecording && <span className="rec-dot" title="This call is being recorded" />}
            </button>
          ) : (
            <span className="campfire-start">
              <button className="campfire-btn" title="Start a voice campfire" onClick={() => onStartCall(false)}>
                <Icon name="phone" />
              </button>
              <button className="campfire-btn" title="Start a video campfire" onClick={() => onStartCall(true)}>
                <Icon name="video" />
              </button>
            </span>
          )
        )}
        <button className="askbtn" onClick={onOpenAsk}>
          <span className="askbtn-hint">Ask Frith — people, threads, decisions…</span>
          <kbd>⌘J</kbd>
        </button>
        {channel.type !== 'dm' && !channel.archivedAt && (
          <button
            className="archive-btn"
            disabled={!canArchive}
            title={
              canArchive
                ? 'Archive this channel — it becomes read-only but stays searchable'
                : 'Only the space owner or admins can archive a public channel'
            }
            onClick={onArchive}
          >
            <Icon name="archive" />
          </button>
        )}
      </header>
      <div className="feed" ref={feedRef} onScroll={onScroll}>
        {hiddenCount > 0 && <div className="feed-more">↑ {hiddenCount} earlier messages</div>}
        {visible.map((m, i) => {
          const prev = i === 0 ? messages[messages.length - visible.length - 1] : visible[i - 1];
          const newDay = isNewDay(prev, m);
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="day-sep">
                  <span>{dayFormat.format(new Date(m.createdAt))}</span>
                </div>
              )}
              <Message
                message={m}
                compact={!newDay && isCompact(prev, m)}
                own={m.authorId === meId}
                onOpenThread={onOpenThread}
              />
            </Fragment>
          );
        })}
        {messages.length === 0 && (
          <div className="feed-empty">Nothing here yet — say something.</div>
        )}
      </div>
      {channel.archivedAt ? (
        <div className="archived-banner">
          <span>This channel is archived — read-only, but its history still feeds Ask.</span>
          <button className="btn" onClick={() => void api.setArchived(channel.id, false)}>
            Unarchive
          </button>
        </div>
      ) : (
        <>
          {scheduled.length > 0 && (
            <div className="scheduled-strip">
              {scheduled.map((s) => (
                <span key={s.id} className="scheduled-chip">
                  <Icon name="clock" /> “{s.body.length > 40 ? `${s.body.slice(0, 40)}…` : s.body}” sends{' '}
                  {new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(s.sendAt))}
                  <button title="Cancel" onClick={() => onCancelScheduled(s.id)}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          <Composer ref={composerRef} channelId={channel.id} placeholder={`Message ${label}`} commands={commands} />
        </>
      )}
      {membersOpen && (
        <MembersModal
          channel={channel}
          meId={meId}
          onLeft={() => {
            setMembersOpen(false);
            onLeft();
          }}
          onClose={() => setMembersOpen(false)}
        />
      )}
    </main>
  );
}
