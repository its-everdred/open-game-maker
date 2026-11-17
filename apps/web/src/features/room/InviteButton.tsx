import { useEffect, useRef, useState } from 'react';

import { PROTOCOL_VERSION, type AuthorityMode, type RoomPin } from '@ogm/contracts/browser';

import { api } from '../../lib/api/client';
import { pushToast } from '../../lib/notify/slice';
import { shareInvite } from './share';

export type CreatedRoom = {
  roomId: string;
  grant: string;
  pin: RoomPin;
  roomsUrl: string;
};

type InviteButtonProps = {
  branchId: string;
  buildId: string;
  gameId: string;
  maxPlayers?: number;
  authorityMode?: AuthorityMode;
  onRoomCreated?: (room: CreatedRoom) => void;
  roomId?: string;
};

export function InviteButton({
  branchId,
  buildId,
  gameId,
  maxPlayers = 4,
  authorityMode,
  onRoomCreated,
  roomId,
}: InviteButtonProps) {
  const roomRef = useRef<string | undefined>(roomId);
  const timerRef = useRef<number | undefined>(undefined);
  const activeRef = useRef(true);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<string>();

  useEffect(() => {
    roomRef.current = roomId ?? roomRef.current;
  }, [roomId]);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      window.clearTimeout(timerRef.current);
    };
  }, []);

  const invite = async () => {
    if (busy) return;
    setBusy(true);
    setConfirmation(undefined);
    try {
      if (roomRef.current === undefined) {
        const room = await api<CreatedRoom>(`/games/${encodeURIComponent(gameId)}/rooms`, {
          method: 'POST',
          /* The room speaks the protocol this tab's client joins with (ticket 497 D-N3-17). */
          json: {
            branchId,
            buildId,
            maxPlayers,
            protocol: PROTOCOL_VERSION,
            ...(authorityMode ? { mode: authorityMode } : {}),
          },
        });
        roomRef.current = room.roomId;
        onRoomCreated?.(room);
      }
      const result = await api<{ url: string }>(`/rooms/${encodeURIComponent(roomRef.current)}/invites`, {
        method: 'POST',
        json: {},
      });
      const shared = await shareInvite(result.url);
      if (!activeRef.current) return;
      setConfirmation(shared.method === 'copy' ? 'Copied' : 'Shared');
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setConfirmation(undefined), 2_000);
    } catch {
      if (activeRef.current) pushToast('Could not share invite');
    } finally {
      if (activeRef.current) setBusy(false);
    }
  };

  return (
    <span className="room-invite-control">
      <button className="room-invite tap-primary" type="button" aria-label="Invite" disabled={busy} onClick={invite}>
        <span aria-hidden="true">↗</span>
      </button>
      {confirmation ? <output aria-live="polite">{confirmation}</output> : null}
    </span>
  );
}
