import type { ServerMessage } from '@ogm/contracts/browser';

import type { JoinRoom } from './room-client';
import type { RoomStoreApi } from './room-store';

export type RoomTestClient = {
  join(input: JoinRoom): Promise<void>;
  leave(consented?: boolean): Promise<void>;
  received(): ServerMessage[];
};

export type RoomTestHandle = {
  join(input: JoinRoom): Promise<void>;
  state(): object;
  received(): ServerMessage[];
  play(): void;
  edit(): void;
  leave(): Promise<void>;
};

type HostWithRoom = NonNullable<Window['__ogmHost']> & { room?: RoomTestHandle };

export function installRoomTestHandle(client: RoomTestClient, store: RoomStoreApi): RoomTestHandle | undefined {
  if (!new URLSearchParams(window.location.search).has('test') || window.__ogmHost === undefined) return undefined;

  const handle: RoomTestHandle = {
    join: (input) => client.join(input),
    state: () => roomState(store),
    received: () => client.received(),
    play: () => store.getState().play(),
    edit: () => store.getState().edit(),
    leave: () => client.leave(true),
  };
  (window.__ogmHost as HostWithRoom).room = handle;
  return handle;
}

function roomState(store: RoomStoreApi): object {
  const {
    status,
    rejection,
    you,
    role,
    phase,
    phaseAt,
    playRev,
    lastRev,
    members,
    presence,
    pin,
    draft,
    ended,
    rttMs,
    matchPause,
  } = store.getState();
  return {
    status,
    rejection,
    you,
    role,
    phase,
    phaseAt,
    playRev,
    lastRev,
    members,
    presence,
    pin,
    draft,
    ended,
    rttMs,
    matchPause,
  };
}
