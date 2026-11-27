import type { SetupContent, SetupStep, SetupSubstep } from '../schema.js';
import type { SplashContent } from '../splash.js';
import { renderAgentPrompt } from './markdown.js';

export const PLACEHOLDER_TOKENS = ['<user>', '<tailnet-host>', '<app-origin>', '<github-owner>'] as const;

const fontsHref =
  'https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&amp;family=Nunito:wght@600;700;800&amp;display=swap';

const copyIcon =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

const handIcon =
  '<svg class="hand" viewBox="0 0 24 24" width="22" height="22" role="img" aria-label="Hand step"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5a1.5 1.5 0 0 1 3 0V11m0-5a1.5 1.5 0 0 1 3 0V12m0-3.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L3.6 16a1.6 1.6 0 0 1 2.4-2.1L8 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function substepId(step: SetupStep, index: number): string {
  return `${step.id}.${index + 1}`;
}

function handSteps(step: SetupStep): SetupSubstep[] {
  return step.substeps.filter((substep) => substep.kind === 'hand');
}

export function renderPage(options: { title: string; script?: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
    <meta name="theme-color" content="#a69b8d" />
    <title>${escapeHtml(options.title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="${fontsHref}" />
    <link rel="stylesheet" href="/tokens.css" />
    <link rel="stylesheet" href="/site.css" />
    <noscript><style>[hidden] { display: block; }</style></noscript>
${options.script ? `    <script type="module" src="${escapeHtml(options.script)}"></script>\n` : ''}  </head>
  <body>
${options.body}
  </body>
</html>
`;
}

function copyBlock(text: string, className: string): string {
  return `<div class="${className}"><pre data-template="${escapeHtml(text)}">${escapeHtml(text)}</pre><button type="button" class="copy" aria-label="Copy">${copyIcon}</button></div>`;
}

function renderSubstep(step: SetupStep, substep: SetupSubstep, index: number): string {
  const id = substepId(step, index);
  const textId = `substep-${id.replace('.', '-')}`;
  const icon = substep.kind === 'hand' ? handIcon : '';
  const optional = substep.kind === 'optional' ? ' <span class="mark">optional</span>' : '';
  return `<li class="substep" data-kind="${substep.kind}" data-substep="${id}">
<p class="say" id="${textId}">${icon}<span data-template="${escapeHtml(substep.text)}">${escapeHtml(substep.text)}</span>${optional}</p>
${copyBlock(substep.command, 'command')}
<input type="checkbox" class="done" data-substep="${id}" aria-labelledby="${textId}" />
<p class="check">Check: <code data-template="${escapeHtml(substep.check)}">${escapeHtml(substep.check)}</code></p>
</li>`;
}

function renderStep(step: SetupStep): string {
  const panelId = `step-${step.id}-panel`;
  const buttonId = `step-${step.id}-button`;
  const hands = handSteps(step);
  const handList =
    hands.length === 0
      ? ''
      : `<ul class="hand-list">${hands
          .map(
            (hand) =>
              `<li>${handIcon}<span data-template="${escapeHtml(hand.text)}">${escapeHtml(hand.text)}</span></li>`,
          )
          .join('')}</ul>`;

  return `<section class="step" data-step="${step.id}">
<h2 id="step-${step.id}"><button type="button" id="${buttonId}" aria-expanded="false" aria-controls="${panelId}">
<span class="num">${step.id}</span>
<span class="head"><span class="title">${escapeHtml(step.title)}</span><span class="outcome">${escapeHtml(step.outcome)}</span></span>
<span class="meta"><span class="time">${escapeHtml(step.time)}</span><span class="progress" data-progress="${step.id}">0/${step.substeps.length}</span></span>
</button></h2>
<div class="panel" id="${panelId}" role="region" aria-labelledby="${buttonId}" hidden>
<ol class="substeps">
${step.substeps.map((substep, index) => renderSubstep(step, substep, index)).join('\n')}
</ol>
<div class="agent">
<h3>Ask an agent</h3>
${copyBlock(renderAgentPrompt(step), 'prompt')}
${handList}
</div>
</div>
</section>`;
}

function renderPlaceholderForm(): string {
  const fields = PLACEHOLDER_TOKENS.map((token) => {
    const name = token.slice(1, -1);
    return `<label><span>${escapeHtml(token)}</span><input type="text" name="${name}" data-token="${escapeHtml(token)}" autocomplete="off" spellcheck="false" /></label>`;
  }).join('\n');
  return `<form class="placeholders" aria-label="Placeholders">\n${fields}\n</form>`;
}

export function renderSetupHtml(content: SetupContent): string {
  const body = `<main class="setup">
<h1 class="sr">Set up Open Game Maker 2000</h1>
${renderPlaceholderForm()}
${content.steps.map(renderStep).join('\n')}
</main>`;
  return renderPage({ title: 'Set up Open Game Maker 2000', script: '/page/setup.js', body });
}

const githubIcon =
  '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"/></svg>';

/* `asset` maps a public path to its URL; the build appends a content hash so the immutable cache in _headers still
   picks up a re-recorded clip */
export function renderSplashHtml(content: SplashContent, asset: (path: string) => string = (path) => path): string {
  const e = escapeHtml;
  const features = content.captures
    .map(
      (capture) => `      <section class="s-feature">
        <h2>${e(capture.heading)}</h2>
        <video src="${e(asset(capture.path))}" poster="${e(asset(capture.poster))}" muted loop playsinline autoplay preload="none"></video>
      </section>`,
    )
    .join('\n');

  const body = `    <main class="splash">
      <section class="s-hero">
        <picture class="s-poster">
          <source media="(orientation: portrait)" srcset="${e(asset('/hero/poster-portrait.webp'))}" />
          <img alt="" src="${e(asset('/hero/poster-landscape.webp'))}" fetchpriority="high" />
        </picture>
        <h1 class="s-logo"><img src="${e(asset('/hero/logo.webp'))}" alt="Open Game Maker 2000" width="1400" height="788" /></h1>
        <div class="s-menu">
          <p class="s-line">${e(content.line)}</p>
          <a class="s-cta" href="/setup">${e(content.cta.setup)}</a>
          <a class="s-cta" href="/signin">${e(content.cta.sign_in)}</a>
          <p class="s-line">Invite only. Request access from an administrator.</p>
        </div>
      </section>
${features}
    </main>
    <footer class="s-footer">
      <a href="${e(content.footer.repo)}" aria-label="Source on GitHub">${githubIcon}</a>
      <small>${e(content.footer.licence)}</small>
    </footer>`;

  return renderPage({ title: 'Open Game Maker 2000', body });
}
