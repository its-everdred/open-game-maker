import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactElement,
  type ReactNode,
  type SetStateAction,
} from 'react';

export type GameMenuAction = {
  id: string;
  label: string;
  icon: string;
  disabled?: boolean;
  /** The pause panel shows this action itself, so its More page leaves it out. */
  onPausePanel?: boolean;
  onSelect(): void;
};

export type GameMenuControls = {
  actions: GameMenuAction[];
  extras: ReactElement[];
  button?: { colour: string; icon: 'pause' | 'menu' };
};

type GameMenuState = {
  controls?: GameMenuControls;
  open: boolean;
  /** The pause panel's More page; while set, the studio tray renders inside it instead of over the game. */
  moreHost: HTMLElement | null;
  setControls: Dispatch<SetStateAction<GameMenuControls | undefined>>;
  setOpen: Dispatch<SetStateAction<boolean>>;
  setMoreHost: Dispatch<SetStateAction<HTMLElement | null>>;
  setCloseLocked(locked: boolean): void;
};

const GameMenuContext = createContext<GameMenuState | undefined>(undefined);

export function GameMenuProvider({ children }: { children: ReactNode }) {
  const [controls, setControls] = useState<GameMenuControls>();
  const [open, setOpenState] = useState(false);
  const closeLocked = useRef(false);
  const setCloseLocked = useCallback((locked: boolean) => {
    closeLocked.current = locked;
  }, []);
  const setOpen: Dispatch<SetStateAction<boolean>> = useCallback((next) => {
    if (closeLocked.current) return;
    setOpenState(next);
  }, []);
  const [moreHost, setMoreHost] = useState<HTMLElement | null>(null);
  const value = useMemo(
    () => ({ controls, open, moreHost, setControls, setOpen, setMoreHost, setCloseLocked }),
    [controls, open, moreHost, setOpen, setCloseLocked],
  );
  return <GameMenuContext.Provider value={value}>{children}</GameMenuContext.Provider>;
}

export function useGameMenu(): GameMenuState {
  const menu = useContext(GameMenuContext);
  if (menu === undefined) throw new Error('useGameMenu must be used inside GameMenuProvider');
  return menu;
}

export function useGameMenuControls(controls: GameMenuControls | undefined): void {
  const menu = useGameMenu();
  useEffect(() => {
    menu.setControls(controls);
    return () => menu.setControls((current) => (current === controls ? undefined : current));
  }, [controls, menu.setControls]);
}
