import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { SpaceDto, UserDto } from '@app/shared';
import { api } from '../lib/api';
import { Avatar } from '../components/Avatar';
import { SpaceLogo } from '../components/SpaceLogo';
import { Modal } from './Modal';

export function SpaceModal({
  space,
  onSpaceChange,
  onClose,
}: {
  space: SpaceDto;
  onSpaceChange: (space: SpaceDto) => void;
  onClose: () => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Manage-panel state (share mode, managers only): editable name/description.
  const [mName, setMName] = useState('');
  const [mDesc, setMDesc] = useState('');
  const [mErr, setMErr] = useState<string | null>(null);
  const [mBusy, setMBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  // Member management (share mode, managers only).
  const [people, setPeople] = useState<UserDto[]>([]);

  useEffect(() => {
    if (space.invite) QRCode.toDataURL(space.invite, { margin: 1, width: 220 }).then(setQr);
    else setQr(null);
  }, [space]);

  useEffect(() => {
    if (space.canManage) api.users().then(setPeople).catch(console.error);
  }, [space]);

  useEffect(() => {
    setMName(space.name);
    setMDesc(space.description ?? '');
  }, [space]);

  async function manage(action: () => Promise<SpaceDto>) {
    setMBusy(true);
    setMErr(null);
    try {
      onSpaceChange(await action());
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setMErr(e instanceof Error ? e.message.replace(/^\d+\s*/, '') : 'That did not work.');
    } finally {
      setMBusy(false);
    }
  }

  // Evict / admin actions return {ok}, so refetch the space (invite + key
  // rotated) and the member list afterwards.
  async function memberAction(action: () => Promise<unknown>) {
    setMBusy(true);
    setMErr(null);
    try {
      await action();
      const s = await api.space();
      if (s) onSpaceChange(s);
      setPeople(await api.users());
    } catch (e) {
      setMErr(e instanceof Error ? e.message.replace(/^\d+\s*/, '') : 'That did not work.');
    } finally {
      setMBusy(false);
    }
  }

  const mailto = `mailto:?subject=${encodeURIComponent(`Join "${space.name}" on Frith`)}&body=${encodeURIComponent(
      `Join my Frith space "${space.name}" — paste this invite into Frith:\n\n${space.invite ?? ''}\n\nFrith is peer-to-peer: your copy of the workspace lives on your machine.`,
    )}`;
    const dirty = mName.trim() !== space.name || mDesc.trim() !== (space.description ?? '');
    return (
      <Modal
        title={space.name}
        subtitle={
          space.description ||
          `P2P space · ${space.connectedPeers} peer${space.connectedPeers === 1 ? '' : 's'} connected`
        }
        headExtra={<SpaceLogo space={space} />}
        onClose={onClose}
      >
        {space.invite ? (
          <>
            <div className="space-manage-h">Invite people</div>
            <div className="space-share">
              {qr && <img className="space-qr" src={qr} alt="Invite QR code — scan to join this space" />}
              <div className="space-share-right">
                <p className="space-hint">
                  Anyone with this invite (or the QR code) can join — it's the key to the space, so share it like a
                  password.
                </p>
                <input className="space-invite" readOnly value={space.invite} onFocus={(e) => e.target.select()} />
                <div className="space-actions">
                  <button
                    className="btn primary"
                    onClick={() => {
                      void navigator.clipboard.writeText(space.invite!);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                  >
                    {copied ? 'Copied ✓' : 'Copy invite'}
                  </button>
                  <a className="btn" href={mailto}>
                    Email it
                  </a>
                </div>
              </div>
            </div>
          </>
        ) : (
          <p className="space-hint">
            Adding people is up to the space's owner and admins — ask one of them for an invite.
          </p>
        )}

        {space.canManage && (
          <div className="space-manage">
            <div className="space-manage-h">Manage space</div>
            <div className="space-logo-row">
              <SpaceLogo space={space} large />
              <div className="space-logo-actions">
                <label className={`btn ${mBusy ? 'disabled' : ''}`}>
                  {space.logoUrl ? 'Replace logo' : 'Upload logo'}
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    disabled={mBusy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) void manage(() => api.setSpaceLogo(file));
                    }}
                  />
                </label>
                {space.logoUrl && (
                  <button className="btn" disabled={mBusy} onClick={() => void manage(() => api.removeSpaceLogo())}>
                    Remove
                  </button>
                )}
              </div>
            </div>
            <label className="field">
              <span>Name</span>
              <input value={mName} maxLength={60} onChange={(e) => setMName(e.target.value)} />
            </label>
            <label className="field">
              <span>Description</span>
              <textarea
                className="space-desc"
                value={mDesc}
                maxLength={280}
                placeholder="What's this space for?"
                onChange={(e) => setMDesc(e.target.value)}
              />
            </label>
            <div className="space-actions">
              <button
                className="btn primary"
                disabled={mBusy || !dirty || !mName.trim()}
                onClick={() =>
                  void manage(() =>
                    api.patchSpace({ name: mName.trim(), description: mDesc.trim() }),
                  )
                }
              >
                {saved ? 'Saved ✓' : 'Save changes'}
              </button>
            </div>

            {space.isOwner && (
              <label className="field">
                <span>New members can read</span>
                <select
                  className="space-desc"
                  value={space.historyVisibility}
                  disabled={mBusy}
                  onChange={(e) => void manage(() => api.setHistoryVisibility(e.target.value as 'full' | 'join-forward'))}
                >
                  <option value="full">All past messages</option>
                  <option value="join-forward">Only messages sent after they join</option>
                </select>
              </label>
            )}

            <div className="space-manage-h">Members</div>
            <p className="space-hint">
              Removing someone rotates the space key and invite — they keep messages already on their device but can't
              read anything new, and the old invite stops working.
            </p>
            {people
              .filter((u) => u.id !== space.ownerUserId)
              .map((u) => (
                <div key={u.id} className="member-row">
                  <Avatar name={u.name} emoji={u.avatarEmoji} />
                  <span className="member-name">
                    {u.name} {space.adminUserIds.includes(u.id) && <small>(admin)</small>}
                  </span>
                  {space.isOwner && (
                    <button
                      className="btn"
                      disabled={mBusy}
                      onClick={() => void memberAction(() => api.setAdmin(u.id, !space.adminUserIds.includes(u.id)))}
                    >
                      {space.adminUserIds.includes(u.id) ? 'Revoke admin' : 'Make admin'}
                    </button>
                  )}
                  <button
                    className="btn danger"
                    disabled={mBusy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Remove ${u.name} from ${space.name}? They keep what they've already synced but lose access to everything new. This can't be undone.`,
                        )
                      )
                        void memberAction(() => api.evictMember(u.id));
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            {people.filter((u) => u.id !== space.ownerUserId).length === 0 && (
              <p className="modal-empty">No other members yet.</p>
            )}
            {mErr && <div className="form-error">{mErr}</div>}
          </div>
        )}

        <div className="space-manage">
          <div className="space-manage-h">This device</div>
          <p className="space-hint">
            Removing the space deletes its copy from this device only — other members keep theirs, and an invite
            brings you back.
          </p>
          <div className="space-actions">
            <button
              className="btn danger"
              disabled={mBusy}
              onClick={() => {
                if (!window.confirm(`Remove "${space.name}" from this device? Its messages and files here will be deleted.`)) return;
                setMBusy(true);
                void api.removeSpace().then(() => window.location.reload());
              }}
            >
              Remove from this device
            </button>
          </div>
        </div>
      </Modal>
    );
}
