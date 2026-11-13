import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { useGameMenuControls } from '../../app/GameMenu';
import { FocusZone } from '../../lib/input';
import { mergeShowcase } from '../games/showcase';
import './showcase-play.css';

// The staged demo is also used standalone; constrain only its embedded presentation.
const embeddedDemoStyles = `
  #editor { gap: 6px !important; padding: 6px !important; grid-template-columns: minmax(0,1fr) !important;
    grid-template-rows: minmax(0,68fr) auto minmax(0,25fr) !important;
    grid-template-areas: 'stage' 'rail' 'tray' !important; }
  #editor .topbar, #editor #inspector, #editor #stop, #editor #tray h2 { display: none !important; }
  #editor #rail { flex-direction: row !important; padding: 4px !important; gap: 4px !important; }
  #editor #rail button { min-height: 0 !important; flex-direction: row !important; font-size: 14px !important; }
  #editor #rail .thumb { width: 36px !important; height: 36px !important; }
  #editor #tray { padding: 4px !important; }
  #editor.playing { display: block !important; padding: 0 !important; }
  #editor.playing #stage { width: 100%; height: 100%; border: 0; border-radius: 0; }
  #editor.playing #rail, #editor.playing #tray { display: none !important; }
  @media (orientation: landscape) { #editor:not(.playing) { grid-template-columns: minmax(0,1fr) minmax(220px,27%) !important;
    grid-template-rows: auto minmax(0,1fr) !important; grid-template-areas: 'stage rail' 'stage tray' !important; } }
`;

export function ShowcasePlay() {
  const { id = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const mode = search.get('mode') === 'edit' ? 'edit' : 'play';
  const entry = mergeShowcase([]).find((game) => game.showcase?.id === id && id !== 'goblin-cellar');
  const frame = useRef<HTMLIFrameElement>(null);
  const initial = useRef<{ id: string; src: string } | undefined>(undefined);
  if (entry && initial.current?.id !== id) {
    const params = new URLSearchParams({ shell: '', models: 'json', editor: '', title: entry.title });
    if (mode === 'play') params.set('play', '');
    initial.current = { id, src: `/proto/demo/index.html?${params}` };
  }
  const setMode = useCallback((next: 'play' | 'edit') => {
    const params = new URLSearchParams(search); params.set('mode', next); setSearch(params, { replace: true });
  }, [search, setSearch]);
  const sendMode = useCallback(() => frame.current?.contentWindow?.postMessage({ ogm: mode }, window.location.origin), [mode]);
  const onLoad = useCallback(() => {
    const document = frame.current?.contentDocument;
    if (document?.head) {
      const style = document.createElement('style');
      style.textContent = embeddedDemoStyles;
      document.head.append(style);
    }
    sendMode();
  }, [sendMode]);
  useEffect(() => sendMode(), [sendMode]);
  const controls = useMemo(() => ({ actions: [
    { id: 'games', label: 'Games', icon: 'games', onSelect: () => navigate('/all') },
    ...(mode === 'play' ? [{ id: 'edit', label: 'Edit', icon: 'edit', onSelect: () => setMode('edit') }] : []),
  ], extras: [] }), [mode, navigate, setMode]);
  useGameMenuControls(controls);
  if (!entry || !initial.current) return <Navigate to="/all" replace />;
  return <section className="showcase-play" aria-label="Play and edit">
    {mode === 'edit' && <FocusZone id="editor-bar" className="showcase-play-control"><button type="button" aria-label="Play" onClick={() => setMode('play')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v18l14-9z" /></svg></button></FocusZone>}
    <iframe ref={frame} src={initial.current.src} title={entry.title} allow="autoplay; fullscreen" onLoad={onLoad} />
  </section>;
}
