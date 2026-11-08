import type { SupportedOffer } from './admit';

const LABELS: Record<SupportedOffer, string> = {
  queue: 'Queue for the reset',
  ask_admin: 'Ask an admin',
};

export function Offers({
  offers,
  message,
  disabled = false,
  onChoose,
}: {
  offers: SupportedOffer[];
  message?: string;
  disabled?: boolean;
  onChoose(offer: SupportedOffer): void;
}) {
  return (
    <section className="scope-offers" aria-label="Build options">
      {message ? <p role="alert">{message}</p> : null}
      {offers.map((offer) => (
        <button className="tap-secondary" disabled={disabled} key={offer} type="button" onClick={() => onChoose(offer)}>
          {LABELS[offer]}
        </button>
      ))}
    </section>
  );
}
