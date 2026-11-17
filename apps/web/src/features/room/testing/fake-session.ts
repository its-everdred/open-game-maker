import type { RoomClientMessage, ServerMessage } from '@ogm/contracts';

import { createRoomStore } from '../../../net/room-store';
import { fromRoomClient, type RoomSession, type RoomSessionSnapshot } from '../session';

export type FakeRoomSession = RoomSession & {
  emit(message: ServerMessage): void;
  setState(state: Partial<RoomSessionSnapshot>): void;
  sent(): RoomClientMessage[];
};

export function fakeSession(roomId = 'fake-room'): FakeRoomSession {
  const store = createRoomStore();
  const messages: RoomClientMessage[] = [];
  const session = fromRoomClient(roomId, {
    store,
    send: (message) => messages.push(message),
    leave: async () => {
      if (store.getState().status !== 'ended') store.getState().connection('idle');
    },
  });

  return {
    ...session,
    emit(message) {
      switch (message.t) {
        case 'welcome':
          store.getState().welcome(message.you, message.state);
          break;
        case 'ended':
          store.getState().end(message.reason);
          break;
        case 'resync':
          store.getState().connection('desynced');
          break;
        case 'design.tx':
          store.setState({ lastRev: message.tx.rev });
          break;
        default:
          break;
      }
    },
    setState(state) {
      store.setState(state);
    },
    sent: () => [...messages],
  };
}
