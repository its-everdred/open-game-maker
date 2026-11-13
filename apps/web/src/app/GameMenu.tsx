import {
  createContext,
  useContext,
  useEffect,
  useMemo,
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
  setControls: Dispatch<SetStateAction<GameMenuControls | undefined>>;
  setOpen: Dispatch<SetStateAction<boolean>>;
};

const GameMenuContext = createContext<GameMenuState | undefined>(undefined);

export function GameMenuProvider({ children }: { children: ReactNode }) {
  const [controls, setControls] = useState<GameMenuControls>();
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ controls, open, setControls, setOpen }), [controls, open]);
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
