import { useEffect, useRef, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { ScreenStage } from '../components/ScreenStage';
import { useUserActions } from '../lib/userActions';
import { LiveTranscriber, type TranscriberState } from '../lib/transcribe';

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
  channelId,
  channelLabel,
  meId,
  meName,
  meEmoji,
  participants,
  streams,
  screens,
  localStream,
  localScreen,
  muted,
  videoOn,
  sharing,
  recorderIds,
  recording,
  onToggleMute,
  onToggleVideo,
  onToggleShare,
  onToggleRecord,
  onPostTranscript,
  onLeave,
}: {
  channelId: string;
  channelLabel: string;
  meId: string;
  meName: string;
  meEmoji: string | null;
  participants: string[];
  streams: Map<string, MediaStream>;
  screens: Map<string, MediaStream>;
  localStream: MediaStream | null;
  localScreen: MediaStream | null;
  muted: boolean;
  videoOn: boolean;
  sharing: boolean;
  /** Everyone currently recording this campfire — shown to the whole room. */
  recorderIds: string[];
  /** Whether I am recording. */
  recording: boolean;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onToggleShare: () => void;
  onToggleRecord: () => void;
  onPostTranscript: (text: string) => void;
  onLeave: () => void;
}) {
  const { getUser } = useUserActions();
  const others = participants.filter((id) => id !== meId);

  // Live transcription (experimental add-on): Whisper in the browser, fed by
  // the same streams the call plays. Local to this device — nothing uploads.
  const transcriber = useRef<LiveTranscriber | null>(null);
  const [transcript, setTranscript] = useState<string[]>([]);
  const [transcriberState, setTranscriberState] = useState<TranscriberState | 'off'>('off');
  useEffect(() => () => void transcriber.current?.stop(), []);
  useEffect(() => {
    // Feed people who join mid-session into the running transcriber.
    if (!transcriber.current?.running) return;
    if (localStream) transcriber.current.addAudio(localStream);
    for (const stream of streams.values()) transcriber.current.addAudio(stream);
  }, [streams, localStream]);

  const toggleTranscribe = async () => {
    if (transcriber.current?.running || transcriberState === 'loading') {
      await transcriber.current?.stop();
      transcriber.current = null;
      setTranscriberState('off');
      return;
    }
    const t = new LiveTranscriber(
      (text) => setTranscript((cur) => [...cur.slice(-40), text]),
      (state) => setTranscriberState(state),
    );
    transcriber.current = t;
    if (!(await t.start([localStream, ...streams.values()]))) transcriber.current = null;
  };

  const recorderNames = recorderIds
    .map((id) => (id === meId ? 'you' : (getUser(id)?.name.split(' ')[0] ?? 'someone')))
    .join(', ');

  // One screen on stage at a time: yours while you share, else the presenter's.
  const remoteShare = [...screens.entries()][0];
  const stage = localScreen
    ? { stream: localScreen, presenterName: 'You' }
    : remoteShare
      ? { stream: remoteShare[1], presenterName: getUser(remoteShare[0])?.name.split(' ')[0] ?? 'Peer' }
      : null;

  return (
    <div className={`call-panel ${stage ? 'has-stage' : ''}`}>
      <div className="call-head">
        <span><Icon name="flame" /> {channelLabel}</span>
        <span className="call-count">{participants.length} around the fire</span>
      </div>
      {recorderIds.length > 0 && (
        <div className="rec-banner" title="This call is being recorded — the file is posted to the channel afterwards.">
          <span className="rec-dot" /> Recording · {recorderNames}
        </div>
      )}
      {stage && (
        <ScreenStage
          stream={stage.stream}
          channelId={channelId}
          meId={meId}
          meName={meName}
          presenterName={stage.presenterName}
        />
      )}
      <div className="call-tiles">
        <Tile name={meName} emoji={meEmoji} stream={videoOn ? (localStream ?? undefined) : undefined} muted />
        {others.map((id) => {
          const user = getUser(id);
          return <Tile key={id} name={user?.name ?? 'Peer'} emoji={user?.avatarEmoji} stream={streams.get(id)} />;
        })}
      </div>
      {(transcriberState !== 'off' || transcript.length > 0) && (
        <div className="call-transcript">
          {transcriberState === 'loading' && <span className="transcript-note">Loading the transcriber (first use downloads the model)…</span>}
          {transcriberState === 'error' && <span className="transcript-note">Transcription is unavailable on this device.</span>}
          {transcript.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
          {transcript.length > 0 && (
            <button className="btn transcript-post" onClick={() => onPostTranscript(transcript.join('\n'))}>
              Post transcript to channel
            </button>
          )}
        </div>
      )}
      <div className="call-controls">
        <button className={`btn ${muted ? 'block-btn' : ''}`} onClick={onToggleMute}>
          {muted ? <><Icon name="micOff" /> Unmute</> : <><Icon name="mic" /> Mute</>}
        </button>
        <button className="btn" onClick={onToggleVideo}>
          {videoOn ? <><Icon name="videoOff" /> Cam off</> : <><Icon name="video" /> Cam on</>}
        </button>
        <button className="btn" onClick={onToggleShare} title={sharing ? 'Stop sharing your screen' : 'Share your screen'}>
          <Icon name="screen" /> {sharing ? 'Stop' : 'Share'}
        </button>
        <button
          className={`btn ${recording ? 'rec-live' : ''}`}
          onClick={onToggleRecord}
          title={recording ? 'Stop recording — the file posts to the channel' : 'Record this call (everyone will see it)'}
        >
          <Icon name="record" /> {recording ? 'Stop rec' : 'Rec'}
        </button>
        <button
          className="btn"
          onClick={() => void toggleTranscribe()}
          title="Live transcription, local to this device (experimental)"
        >
          <Icon name="captions" /> {transcriber.current?.running || transcriberState === 'loading' ? 'CC off' : 'CC'}
        </button>
        <button className="btn primary" onClick={onLeave}>
          Leave
        </button>
      </div>
    </div>
  );
}
