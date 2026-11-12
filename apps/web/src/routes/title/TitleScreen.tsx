import { useEffect } from 'react';
import { useNavigate } from 'react-router';

import { InstanceLogo } from '../../app/InstanceLogo';
import { StudioMenu } from '../../app/StudioMenu';
import { useSession } from '../../lib/api/session';
import { FocusZone, useFocusable, useInitialFocus } from '../../lib/input';
import { set } from '../../lib/sound';
import { TitleTown } from './TitleTown';
import './title.css';

export function TitleScreen({ townSrc }: { townSrc?: string }) {
  const { data: session } = useSession();
  const navigate = useNavigate();
  useInitialFocus('title-menu');

  useEffect(() => {
    set('title');
    return () => set('off');
  }, []);

  return (
    <div className="title-screen">
      <TitleTown active src={townSrc} />
      <StudioMenu />
      <h1 className="title-logo">
        <InstanceLogo defaultSource="/art/logo.webp" alt="Open Game Maker 2000" width="1400" height="788" />
      </h1>
      <FocusZone id="title-menu" className="title-menu">
        <MenuButton
          className="title-start"
          onClick={() => navigate(session ? '/all' : `/signin?next=${encodeURIComponent('/all')}`)}
        >
          Start
        </MenuButton>
      </FocusZone>
    </div>
  );
}

// a real or gamepad Enter on the focused button clicks it, so Norigin only moves focus here
function MenuButton({ className, onClick, children }: { className: string; onClick: () => void; children: string }) {
  const { ref } = useFocusable();
  return (
    <button ref={ref} type="button" className={className} onClick={onClick}>
      {children}
    </button>
  );
}
