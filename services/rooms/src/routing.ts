import type { NetClientMessage } from '@ogm/contracts';

/*
 * Who receives a protocol-2 message (#497 §4.6, D-N3-15/D-N3-16).
 *
 * The room never renumbers, reorders, dedupes or parses a payload; it only decides recipients and re-stamps
 * the sender's seat from the grant. Delivery always excludes the sender, which has already applied its own
 * message locally — including when it targets its own seat or team.
 */

/** Why a message produced no recipients. Each code is a counter the room exposes for tests and metrics. */
export type DropCode =
  | 'NO_EPOCH'
  | 'SPECTATOR_NOT_SEATED'
  | 'SEAT_UNKNOWN'
  | 'SEAT_OUT_OF_RANGE'
  | 'TEAM_UNKNOWN'
  | 'NOT_PRIMARY'
  | 'NOT_READY'
  | 'EPOCH_ACTIVE'
  | 'INVALID_SEAT_REQUEST';

export type SeatRecord = {
  seat: number;
  userId: string;
  team: number;
  connected: boolean;
  forfeited: boolean;
  sessions: string[];
};

export type RoutingInput = {
  message: NetClientMessage;
  senderSessionId: string;
  senderSeat: number | undefined;
  seats: readonly SeatRecord[];
  spectators: readonly { userId: string; sessions: string[] }[];
  primarySeat: number;
};

export type RoutingResult = { sessions: string[]; drop?: DropCode };

export function recipientsFor(input: RoutingInput): RoutingResult {
  const { message, senderSessionId, senderSeat, seats, spectators, primarySeat } = input;
  /* A spectator has no seat and no authority; only the ready check and a seat request are honoured (handled
   * by the room before routing), so every routed message from one is dropped and counted. */
  if (senderSeat === undefined) return { sessions: [], drop: 'SPECTATOR_NOT_SEATED' };
  const seated = seats.filter((seat) => seat.userId !== '');

  switch (message.t) {
    case 'net.inputs':
    case 'net.checksum':
      return { sessions: others(seated, senderSeat, senderSessionId) };
    case 'net.state':
    case 'net.recovery':
      if (message.to !== undefined) {
        const target = seatAt(seats, message.to);
        return target === undefined
          ? { sessions: [], drop: 'SEAT_OUT_OF_RANGE' }
          : { sessions: target.sessions.filter((id) => id !== senderSessionId) };
      }
      return { sessions: others(seated, senderSeat, senderSessionId) };
    case 'net.signal': {
      const target = seatAt(seats, message.to);
      return target === undefined
        ? { sessions: [], drop: 'SEAT_OUT_OF_RANGE' }
        : { sessions: target.sessions.filter((id) => id !== senderSessionId) };
    }
    case 'net.recovery.request': {
      if (message.scope === 'shared') {
        const primary = seatAt(seats, primarySeat);
        return { sessions: (primary?.sessions ?? []).filter((id) => id !== senderSessionId) };
      }
      const target = seatAt(seats, message.seat ?? senderSeat);
      return target === undefined
        ? { sessions: [], drop: 'SEAT_OUT_OF_RANGE' }
        : { sessions: target.sessions.filter((id) => id !== senderSessionId) };
    }
    case 'net.event': {
      if (message.target === 'all') {
        return { sessions: [...others(seated, senderSeat, senderSessionId), ...spectators.flatMap((s) => s.sessions)] };
      }
      if (message.target === 'seat') {
        const target = message.to === undefined ? undefined : seatAt(seats, message.to);
        if (target === undefined) return { sessions: [], drop: 'SEAT_OUT_OF_RANGE' };
        return { sessions: target.sessions.filter((id) => id !== senderSessionId) };
      }
      const team = message.team;
      if (team === undefined) return { sessions: [], drop: 'TEAM_UNKNOWN' };
      if (!seated.some((seat) => seat.team === team)) return { sessions: [], drop: 'TEAM_UNKNOWN' };
      const members = seated.filter((seat) => seat.team === team && seat.seat !== senderSeat);
      return { sessions: members.flatMap((seat) => seat.sessions) };
    }
    default:
      return { sessions: [] };
  }
}

function seatAt(seats: readonly SeatRecord[], seat: number): SeatRecord | undefined {
  return seats.find((candidate) => candidate.seat === seat && candidate.userId !== '');
}

function others(seats: readonly SeatRecord[], senderSeat: number, senderSessionId: string): string[] {
  return seats
    .filter((seat) => seat.seat !== senderSeat)
    .flatMap((seat) => seat.sessions.filter((id) => id !== senderSessionId));
}
