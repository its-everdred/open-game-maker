import { api } from '../../lib/api/client';
import type { AuthorityMode } from '@ogm/contracts/browser';
import { pushToast } from '../../lib/notify/slice';
import { InviteButton, type CreatedRoom } from './InviteButton';
import { RoomBadge } from './RoomBadge';
import type { RoomSession, RoomSessionSnapshot } from './session';

type RoomControlProps = {
  branchId: string;
  buildId?: string;
  gameId: string;
  authorityMode?: AuthorityMode;
  onRoomCreated?: (room: CreatedRoom) => void;
  onRoomLeave?: () => void | Promise<void>;
  roomSession?: RoomSession;
  roomSnapshot?: RoomSessionSnapshot;
};

export function InviteRoomControl({
  branchId,
  buildId,
  gameId,
  authorityMode,
  onRoomCreated,
  roomSession,
  roomSnapshot,
}: RoomControlProps) {
  if (buildId === undefined) return null;
  const activeRoomId = roomSnapshot?.status === 'connected' ? roomSession?.roomId : undefined;
  return (
    <InviteButton
      branchId={branchId}
      buildId={buildId}
      gameId={gameId}
      authorityMode={authorityMode}
      maxPlayers={roomSnapshot?.maxPlayers}
      onRoomCreated={onRoomCreated}
      roomId={activeRoomId}
    />
  );
}

export function RoomMembersControl({ onRoomLeave, roomSession, roomSnapshot }: RoomControlProps) {
  if (roomSession === undefined || roomSnapshot?.status !== 'connected') return null;
  const owner = roomSnapshot.you !== undefined && roomSnapshot.you.userId === roomSnapshot.ownerId;
  return (
    <RoomBadge
      members={roomSnapshot.members}
      owner={owner}
      onEnd={() => void onRoomLeave?.()}
      onKick={(userId) => {
        roomSession.send({ t: 'kick', userId });
        void api(`/rooms/${encodeURIComponent(roomSession.roomId)}/revoke`, {
          method: 'POST',
          json: { userId },
        }).catch(() => pushToast('Could not remove player'));
      }}
    />
  );
}
