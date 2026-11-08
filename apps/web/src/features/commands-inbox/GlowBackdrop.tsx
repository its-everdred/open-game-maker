// The games screen's living background from the studio prototype (prototypes/studio-v0/app.js, "living background"):
// five soft glows drift on slow, unrelated cycles behind the review's glass panes. The glows are tokens (tokens.css)
// and the drift is CSS (review-glass.css), so reduced motion holds them still like every other animation.
export function GlowBackdrop() {
  return (
    <div className="glow-backdrop" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}
