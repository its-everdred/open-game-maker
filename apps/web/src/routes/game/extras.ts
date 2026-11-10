import type { ComponentType } from 'react';

import { InviteRoomControl, RoomMembersControl } from '../../features/room/RoomControls';
import type { CreatedRoom } from '../../features/room/InviteButton';
import type { RoomSession, RoomSessionSnapshot } from '../../features/room/session';
import { VersionControls } from './versions/VersionControls';

export type GameExtraProps = {
  gameId: string;
  branchId: string;
  buildId?: string;
  mode: 'play' | 'edit';
  onNavigate?: () => void;
  onRoomCreated?: (room: CreatedRoom) => void;
  onRoomLeave?: () => void | Promise<void>;
  roomSession?: RoomSession;
  roomSnapshot?: RoomSessionSnapshot;
};

export type GameExtra = {
  id: string;
  placement: 'topbar' | 'hud' | 'overlay';
  Component: ComponentType<GameExtraProps>;
};

/** Additive seam owned by OGM-077 and OGM-078. */
export const gameExtras: GameExtra[] = [
  { id: 'room-invite', placement: 'topbar', Component: InviteRoomControl },
  { id: 'room-members', placement: 'topbar', Component: RoomMembersControl },
  { id: 'versions-nav', placement: 'topbar', Component: VersionControls },
];
