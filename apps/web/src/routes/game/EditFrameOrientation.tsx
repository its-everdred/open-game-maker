import { useEffect, useState } from 'react';

export type FrameOrientation = 'wide' | 'vertical';

/** Follow the device until the creator explicitly chooses a game orientation. */
export function useEditFrameOrientation() {
  const [override, setOverride] = useState<FrameOrientation>();
  const [portraitDevice, setPortraitDevice] = useState(() => window.matchMedia('(orientation: portrait)').matches);

  useEffect(() => {
    const query = window.matchMedia('(orientation: portrait)');
    const update = () => setPortraitDevice(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return { orientation: override ?? (portraitDevice ? 'wide' : 'vertical'), setOrientation: setOverride } as const;
}

export function EditFrameOrientation({
  orientation,
  onChange,
}: {
  orientation: FrameOrientation;
  onChange(orientation: FrameOrientation): void;
}) {
  return (
    <div role="group" aria-label="Game orientation">
      <button
        type="button"
        aria-label="Wide game"
        aria-pressed={orientation === 'wide'}
        onClick={() => onChange('wide')}
      >
        ▭
      </button>
      <button
        type="button"
        aria-label="Vertical game"
        aria-pressed={orientation === 'vertical'}
        onClick={() => onChange('vertical')}
      >
        ▯
      </button>
    </div>
  );
}
