import { useEffect, useRef } from 'react';
import { Avatar } from './Avatar';
import { useUserActions } from './userActions';

function Tile({ name, emoji, stream, muted }: { name: string; emoji?: string | null; stream?: MediaStream; muted?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const hasVideo = (stream?.getVideoTracks().length ?? 0) > 0;

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
    if (audioRef.current && stream) audioRef.current.srcObject = stream;
  }, [stream, hasVideo]);

  return (
    <div className="call-tile">
      {hasVideo ? (
        <video ref={videoRef} autoPlay playsInline muted={muted} />
      ) : (
        <>
          <Avatar name={name} emoji={emoji} />
          {stream && !muted && <audio ref={audioRef} autoPlay />}
        </>
      )}
      <span className="call-tile-name">{name.split(' ')[0]}</span>
    </div>
  );
}

export function CallPanel({
  channelLabel,
  meId,
  meName,
  meEmoji,
  participants,
  streams,
  localStream,
  muted,
  videoOn,
  withVideo,
  onToggleMute,
  onToggleVideo,
  onLeave,
}: {
  channelLabel: string;
  meId: string;
  meName: string;
  meEmoji: string | null;
  participants: string[];
  streams: Map<string, MediaStream>;
  localStream: MediaStream | null;
  muted: boolean;
  videoOn: boolean;
  withVideo: boolean;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onLeave: () => void;
}) {
  const { getUser } = useUserActions();
  const others = participants.filter((id) => id !== meId);

  return (
    <div className="call-panel">
      <div className="call-head">
        <span>🔥 {channelLabel}</span>
        <span className="call-count">{participants.length} around the fire</span>
      </div>
      <div className="call-tiles">
        <Tile name={meName} emoji={meEmoji} stream={videoOn ? (localStream ?? undefined) : undefined} muted />
        {others.map((id) => {
          const user = getUser(id);
          return <Tile key={id} name={user?.name ?? 'Peer'} emoji={user?.avatarEmoji} stream={streams.get(id)} />;
        })}
      </div>
      <div className="call-controls">
        <button className={`btn ${muted ? 'block-btn' : ''}`} onClick={onToggleMute}>
          {muted ? '🔇 Unmute' : '🎙 Mute'}
        </button>
        {withVideo && (
          <button className="btn" onClick={onToggleVideo}>
            {videoOn ? '📷 Cam off' : '🎥 Cam on'}
          </button>
        )}
        <button className="btn primary" onClick={onLeave}>
          Leave
        </button>
      </div>
    </div>
  );
}
