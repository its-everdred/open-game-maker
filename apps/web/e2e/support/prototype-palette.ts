// Palette acceptance is covered by the theme tests and screenshot evidence. Reset
// theme colors here so prototype fidelity keeps measuring the frozen shell geometry.
export const prototypePaletteNormalizationCss = `
  :root {
    --surface-page: #282828 !important;
    --surface-deep: #1d1b16 !important;
    --surface-card: rgba(30, 27, 40, 0.62) !important;
    --surface-raised: rgba(255, 255, 255, 0.06) !important;
    --text: #f2ead6 !important;
    --text-muted: rgba(242, 234, 214, 0.6) !important;
    --border: rgba(242, 234, 214, 0.18) !important;
    --action-primary: #b8bb26 !important;
    --action-primary-text: #1d1b16 !important;
    --action-secondary: rgba(255, 255, 255, 0.06) !important;
    --action-secondary-text: #f2ead6 !important;
    --paper: rgba(30, 27, 40, 0.62) !important;
    --paper-2: rgba(255, 255, 255, 0.06) !important;
    --paper-3: rgba(255, 255, 255, 0.1) !important;
    --ink: #f2ead6 !important;
    --ink-2: rgba(242, 234, 214, 0.82) !important;
    --muted: rgba(242, 234, 214, 0.6) !important;
    --rule: rgba(242, 234, 214, 0.18) !important;
    --dark: #1d1b16 !important;
    --glass: blur(22px) saturate(1.4) !important;
    --night: #282828 !important;
    --night-2: #32302f !important;
    --night-3: #3c3836 !important;
    --cream: #ebdbb2 !important;
    --red: #cc241d !important;
    --red-b: #fb4934 !important;
    --green: #98971a !important;
    --green-b: #b8bb26 !important;
    --yellow: #d79921 !important;
    --yellow-b: #fabd2f !important;
    --blue: #458588 !important;
    --blue-b: #83a598 !important;
    --purple: #b16286 !important;
    --purple-b: #d3869b !important;
    --aqua: #689d6a !important;
    --aqua-b: #8ec07c !important;
    --orange: #d65d0e !important;
    --orange-b: #fe8019 !important;
    --pop: 0 12px 32px rgba(0, 0, 0, 0.35) !important;
    --pop-sm: 0 6px 18px rgba(0, 0, 0, 0.3) !important;
  }
  .new-option {
    background: rgba(255, 255, 255, 0.022) !important;
  }
  .new-option[aria-pressed='true'] {
    background: color-mix(in srgb, var(--new-color) 10%, rgba(255, 255, 255, 0.02)) !important;
  }
  .new-next {
    background: var(--action-primary) !important;
    color: var(--dark) !important;
    box-shadow: var(--pop-sm) !important;
  }
  .new-summary {
    background: rgba(255, 255, 255, 0.05) !important;
  }
  .talk-host .vs {
    background: rgba(14, 13, 20, 0.7) !important;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4) !important;
  }
  .talk-host .caption {
    background: var(--night-2) !important;
  }
  .scope-offers button {
    background: rgba(255, 255, 255, 0.06) !important;
  }
  .scope-finish {
    background: var(--green-b) !important;
    color: var(--dark) !important;
  }
  .game-screen {
    --ink: #3a2a20 !important;
    --ink-2: rgba(58, 42, 32, 0.78) !important;
    --muted: rgba(58, 42, 32, 0.62) !important;
    --paper: #fdf1d8 !important;
    --paper-2: #fffaf0 !important;
    --paper-3: #f3e6cc !important;
    --rule: rgba(58, 42, 32, 0.24) !important;
    --editor-card: #fffaf0 !important;
    --editor-shadow: 0 5px 0 rgba(58, 42, 32, 0.22), 0 12px 26px rgba(58, 42, 32, 0.14) !important;
    background:
      radial-gradient(circle at 20% 10%, rgba(255, 255, 255, 0.4), transparent 28%),
      repeating-linear-gradient(2deg, rgba(58, 42, 32, 0.025) 0 1px, transparent 1px 5px),
      var(--paper) !important;
  }
  .game-screen .back, .game-screen .ask-change, .game-screen .mode-segment, .game-screen .mode-segment button {
    box-shadow: 0 3px 0 rgba(58, 42, 32, 0.25) !important;
  }
  .game-screen .mode-segment button[data-mode='play'][aria-pressed='true'] {
    background: linear-gradient(#a9d66c, #8cc152) !important;
  }
  .game-screen .mode-segment button[data-mode='edit'][aria-pressed='true'], .game-screen .ask-change {
    border-color: var(--ink) !important;
    background: linear-gradient(#f9cf6e, #f8b93a) !important;
    color: var(--ink) !important;
  }
  .game-screen .editor-rail button[aria-pressed='true'] {
    background: #ffd9b8 !important;
    color: var(--ink) !important;
    box-shadow: 0 4px 0 rgba(58, 42, 32, 0.25) !important;
  }
  .editor-tools button[aria-pressed='true'], .choice-segment button[aria-pressed='true'] {
    background: #9fd3f2 !important;
    color: var(--ink) !important;
  }
`;
