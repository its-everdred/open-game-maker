import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type CatalogFamily } from './catalog';
import { StyleStep } from './StyleStep';

const legacyShowcase = {
  tileVideoUrl: '/showcase/tiles.mp4',
  sheetVideoUrl: '/showcase/sheets.mp4',
  stops: [
    {
      id: 'fantasy',
      label: 'Fantasy',
      startSeconds: 0,
      tileFallbackUrl: '/showcase/fantasy-tile.gif',
      sheetFallbackUrl: '/showcase/fantasy-sheet.gif',
    },
    {
      id: 'modern-zombie',
      label: 'Modern zombie',
      startSeconds: 7.5,
      tileFallbackUrl: '/showcase/zombie-tile.gif',
      sheetFallbackUrl: '/showcase/zombie-sheet.gif',
    },
  ],
};

const v5Showcase = {
  stops: [
    {
      id: '1-fantasy',
      label: 'Portal glade ambush',
      startSeconds: 0,
      region: {
        videoUrl: '/showcase/1-fantasy.region.mp4',
        gifUrl: '/showcase/1-fantasy.region.gif',
        posterUrl: '/showcase/1-fantasy.region.png',
      },
      sheet: {
        videoUrl: '/showcase/1-fantasy.sheet.mp4',
        gifUrl: '/showcase/1-fantasy.sheet.gif',
        posterUrl: '/showcase/1-fantasy.sheet.png',
      },
    },
    {
      id: '2-desert',
      label: 'Caravan camp raid',
      startSeconds: 3.75,
      region: {
        videoUrl: '/showcase/2-desert.region.mp4',
        gifUrl: '/showcase/2-desert.region.gif',
        posterUrl: '/showcase/2-desert.region.png',
      },
      sheet: {
        videoUrl: '/showcase/2-desert.sheet.mp4',
        gifUrl: '/showcase/2-desert.sheet.gif',
        posterUrl: '/showcase/2-desert.sheet.png',
      },
    },
  ],
  outlineOptions: {
    id: 'outline-options',
    label: 'Outline options',
    sheet: {
      videoUrl: '/showcase/outline.sheet.mp4',
      gifUrl: '/showcase/outline.sheet.gif',
      posterUrl: '/showcase/outline.sheet.png',
    },
  },
};

const v6Showcase = {
  regionVideoUrl: '/showcase/showcase.region.mp4',
  sheetVideoUrl: '/showcase/showcase.sheet.mp4',
  stops: [
    {
      id: '1-fantasy',
      label: 'Portal glade ambush',
      startSeconds: 0,
      region: { posterUrl: '/showcase/1-fantasy.region.png' },
      sheet: { posterUrl: '/showcase/1-fantasy.sheet.png' },
    },
    {
      id: '2-desert',
      label: 'Caravan camp raid',
      startSeconds: 3,
      region: { posterUrl: '/showcase/2-desert.region.png' },
      sheet: { posterUrl: '/showcase/2-desert.sheet.png' },
    },
  ],
};

const families: CatalogFamily[] = [
  family('chunky-low-poly', 'Chunky low poly', [set('chunky', 'Chunky set')]),
  family('pixel-art', 'Pixel art', [
    {
      ...set('pixel-town', 'Pixel Town'),
      showcase: {
        ...legacyShowcase,
        tileVideoUrl: '/showcase/town-tiles.mp4',
        sheetVideoUrl: '/showcase/town-sheets.mp4',
      },
    },
  ]),
  family('flat-cartoon', 'Flat cartoon', []),
  family('isometric-2d', 'Isometric 2D', [
    { ...set('smallscaleint', 'SmallScaleInt'), pickerFamilies: ['pixel-art'], showcase: v5Showcase },
  ]),
  family('sketch', 'Sketch', []),
];

afterEach(cleanup);

function family(id: string, label: string, sets: CatalogFamily['sets']): CatalogFamily {
  return { id, label, views: ['iso'], creationChoice: true, packs: [], sets };
}

function set(id: string, label: string): CatalogFamily['sets'][number] {
  return {
    id,
    label,
    pickerFamilies: [],
    vendors: ['fixture'],
    traits: {},
    packs: [{ id: `${id}-pack`, name: `${label} pack`, thumbnailUrl: `/${id}.png`, aiGenerated: false }],
  };
}

function renderStep(onSelect = vi.fn()) {
  render(
    <StyleStep
      families={families}
      selected={[]}
      other={undefined}
      full={false}
      allowAiGenerated
      onAllowAiGeneratedChange={vi.fn()}
      onFull={vi.fn()}
      onOtherChange={vi.fn()}
      onSelect={onSelect}
    />,
  );
  return onSelect;
}

describe('StyleStep', () => {
  it('starts with representative family icons and no set tiles', () => {
    renderStep();

    for (const label of ['Chunky low poly', 'Pixel art', 'Flat cartoon', 'Isometric', 'Sketch', 'Other']) {
      expect(screen.getByRole('button', { name: label })).toBeVisible();
    }
    expect(screen.queryByText('SmallScaleInt')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /pack preview/i })).not.toBeInTheDocument();
  });

  it('opens an aliased set from Pixel art and selects from detail without an extra back control', () => {
    const onSelect = renderStep();
    fireEvent.click(screen.getByRole('button', { name: 'Pixel art' }));

    expect(screen.getByRole('button', { name: 'Pixel Town' })).toBeVisible();
    const smallscaleint = screen.getByRole('button', { name: 'SmallScaleInt' });
    expect(screen.queryByText('SmallScaleInt')).not.toBeInTheDocument();
    fireEvent.click(smallscaleint);
    expect(screen.queryByText('SmallScaleInt')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select SmallScaleInt' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Back to Pixel art sets' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select SmallScaleInt' }));
    expect(onSelect).toHaveBeenCalledWith('smallscaleint');
    expect(screen.getByRole('button', { name: 'Pixel art' })).toBeVisible();
  });

  it('badges generated pack thumbnails and hides them when the game setting is off', () => {
    const generated = family('pixel-art', 'Pixel art', [
      {
        ...set('generated', 'Generated'),
        packs: [
          {
            id: 'generated-pack',
            name: 'Generated pack',
            thumbnailUrl: '/generated.png',
            aiGenerated: true,
          },
        ],
      },
      set('authored', 'Authored'),
      {
        ...set('mixed', 'Mixed'),
        packs: [
          { id: 'mixed-generated', name: 'Generated pack', thumbnailUrl: '/mixed-generated.png', aiGenerated: true },
          { id: 'mixed-authored', name: 'Authored pack', thumbnailUrl: '/mixed-authored.png', aiGenerated: false },
        ],
      },
    ]);
    const onAllowAiGeneratedChange = vi.fn();
    const view = render(
      <StyleStep
        families={[generated]}
        selected={[]}
        other={undefined}
        full={false}
        allowAiGenerated
        onAllowAiGeneratedChange={onAllowAiGeneratedChange}
        onFull={vi.fn()}
        onOtherChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Pixel art' }));
    expect(screen.getByRole('button', { name: 'Generated, AI-generated' })).toContainElement(
      screen.getAllByLabelText('AI-generated')[0],
    );
    expect(screen.getByRole('button', { name: 'Mixed, AI-generated' })).toContainElement(
      screen.getAllByLabelText('AI-generated')[1],
    );
    fireEvent.click(screen.getByRole('switch', { name: 'AI-generated assets' }));
    expect(onAllowAiGeneratedChange).toHaveBeenCalledWith(false);

    view.rerender(
      <StyleStep
        families={[generated]}
        selected={[]}
        other={undefined}
        full={false}
        allowAiGenerated={false}
        onAllowAiGeneratedChange={onAllowAiGeneratedChange}
        onFull={vi.fn()}
        onOtherChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Generated, AI-generated' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Authored' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Mixed' })).not.toContainElement(screen.queryByLabelText('AI-generated'));
  });

  it('badges showcase media for a set containing multiple generated packs', () => {
    const generated = family('pixel-art', 'Pixel art', [
      {
        ...set('generated', 'Generated'),
        showcase: legacyShowcase,
        packs: [
          { id: 'a', name: 'A', thumbnailUrl: '/a.png', aiGenerated: true },
          { id: 'b', name: 'B', thumbnailUrl: '/b.png', aiGenerated: true },
        ],
      },
      set('authored', 'Authored'),
    ]);
    render(
      <StyleStep
        families={[generated]}
        selected={[]}
        other={undefined}
        full={false}
        allowAiGenerated
        onAllowAiGeneratedChange={vi.fn()}
        onFull={vi.fn()}
        onOtherChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pixel art' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generated, AI-generated' }));
    expect(screen.getAllByLabelText('AI-generated').length).toBeGreaterThan(0);
  });

  it('opens a single-set family directly and wraps controls and arrow keys', () => {
    renderStep();
    fireEvent.click(screen.getByRole('button', { name: 'Isometric' }));
    expect(screen.getByRole('button', { name: 'Select SmallScaleInt' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Next style' }));
    expect(screen.getByRole('button', { name: 'Select SmallScaleInt' })).toBeVisible();
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(screen.getByRole('button', { name: 'Select SmallScaleInt' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Back to styles' })).not.toBeInTheDocument();
  });

  it('swaps v5 scene media, keeps tracks synced, and renders outline options last without visible labels', () => {
    renderStep();
    fireEvent.click(screen.getByRole('button', { name: 'Isometric' }));
    let tile = screen.getByLabelText('Diorama preview') as HTMLVideoElement;

    expect(tile).toHaveAttribute('playsinline');
    expect(tile.loop).toBe(true);
    expect(tile.muted).toBe(true);
    expect(tile).toHaveAttribute('src', '/showcase/1-fantasy.region.mp4');
    expect(tile).toHaveAttribute('poster', '/showcase/1-fantasy.region.png');
    const fallback = screen.getByRole('img', { name: 'Portal glade ambush diorama fallback' });
    expect(fallback).toHaveAttribute('src', '/showcase/1-fantasy.region.gif');
    fireEvent.error(fallback);
    expect(fallback).toHaveAttribute('src', '/showcase/1-fantasy.region.png');
    expect(screen.queryByText('Portal glade ambush')).not.toBeInTheDocument();
    expect(screen.queryByText('SmallScaleInt')).not.toBeInTheDocument();
    const track = tile.closest('.new-style-track');
    expect(track).toHaveAttribute('data-ready', 'false');
    fireEvent.canPlay(tile);
    expect(track).toHaveAttribute('data-ready', 'true');
    fireEvent.error(tile);
    expect(track).toHaveAttribute('data-ready', 'false');
    expect(screen.getByRole('button', { name: 'Previous scene' })).toHaveClass('new-style-scene-button');
    expect(screen.getByRole('button', { name: 'Next scene' })).toHaveClass('new-style-scene-button');
    fireEvent.click(screen.getByRole('button', { name: 'Next scene' }));
    tile = screen.getByLabelText('Diorama preview');
    const sheet = screen.getByLabelText('Sprite sheets preview') as HTMLVideoElement;
    expect(tile).toHaveAttribute('src', '/showcase/2-desert.region.mp4');
    expect(sheet).toHaveAttribute('src', '/showcase/2-desert.sheet.mp4');
    expect(tile.closest('.new-style-track')).toHaveAttribute('data-ready', 'false');
    fireEvent.loadedMetadata(tile);
    fireEvent.loadedMetadata(sheet);
    expect(tile.currentTime).toBe(3.75);
    expect(sheet.currentTime).toBe(3.75);

    tile.currentTime = 2;
    sheet.currentTime = 0;
    fireEvent.timeUpdate(tile);
    expect(sheet.currentTime).toBe(2);

    const controls = screen.getAllByRole('button', { name: /Portal glade ambush|Caravan camp raid|Outline options/ });
    expect(controls.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Portal glade ambush',
      'Caravan camp raid',
      'Outline options',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Next scene' }));
    expect(screen.getByRole('button', { name: 'Outline options' })).toHaveAttribute('aria-pressed', 'true');
    const outlineRegion = screen.getByLabelText('Diorama preview') as HTMLVideoElement;
    const outlineSheet = screen.getByLabelText('Sprite sheets preview') as HTMLVideoElement;
    expect(outlineRegion).toHaveAttribute('src', '/showcase/2-desert.region.mp4');
    expect(outlineSheet).toHaveAttribute('src', '/showcase/outline.sheet.mp4');
    fireEvent.loadedMetadata(outlineSheet);
    outlineRegion.currentTime = 3.75;
    fireEvent.timeUpdate(outlineRegion);
    expect(outlineSheet.currentTime).toBe(0);
  });

  it('keeps legacy aggregate tracks and seeks both to cumulative scene offsets', () => {
    renderStep();
    fireEvent.click(screen.getByRole('button', { name: 'Pixel art' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pixel Town' }));
    const tile = screen.getByLabelText('Diorama preview') as HTMLVideoElement;
    const sheet = screen.getByLabelText('Sprite sheets preview') as HTMLVideoElement;

    fireEvent.click(screen.getByRole('button', { name: 'Modern zombie' }));
    expect(tile.currentTime).toBe(7.5);
    expect(sheet.currentTime).toBe(7.5);
  });

  it('keeps v6 shared tracks loaded and seeks both to each stop start time', () => {
    const v6Families: CatalogFamily[] = [
      family('isometric-2d', 'Isometric 2D', [{ ...set('smallscaleint', 'SmallScaleInt'), showcase: v6Showcase }]),
    ];
    render(
      <StyleStep
        families={v6Families}
        selected={[]}
        other={undefined}
        full={false}
        allowAiGenerated
        onAllowAiGeneratedChange={vi.fn()}
        onFull={vi.fn()}
        onOtherChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Isometric' }));
    const region = screen.getByLabelText('Diorama preview') as HTMLVideoElement;
    const sheet = screen.getByLabelText('Sprite sheets preview') as HTMLVideoElement;

    expect(region).toHaveAttribute('src', '/showcase/showcase.region.mp4');
    expect(sheet).toHaveAttribute('src', '/showcase/showcase.sheet.mp4');
    expect(screen.getByRole('button', { name: 'Portal glade ambush' }).querySelector('img')).toHaveAttribute(
      'src',
      '/showcase/1-fantasy.region.png',
    );
    expect(screen.getByRole('button', { name: 'Caravan camp raid' }).querySelector('img')).toHaveAttribute(
      'src',
      '/showcase/2-desert.region.png',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Caravan camp raid' }));
    expect(screen.getByLabelText('Diorama preview')).toBe(region);
    expect(screen.getByLabelText('Sprite sheets preview')).toBe(sheet);
    expect(region.currentTime).toBe(3);
    expect(sheet.currentTime).toBe(3);
    expect(region).toHaveAttribute('poster', '/showcase/2-desert.region.png');
    expect(sheet).toHaveAttribute('poster', '/showcase/2-desert.sheet.png');
  });

  it('cycles through a multi-set family with style navigation and keyboard wrap', () => {
    renderStep();
    fireEvent.click(screen.getByRole('button', { name: 'Pixel art' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pixel Town' }));
    expect(screen.getByRole('button', { name: 'Previous style' })).toHaveClass('new-style-style-button');
    expect(screen.getByRole('button', { name: 'Next style' })).toHaveClass('new-style-style-button');
    fireEvent.click(screen.getByRole('button', { name: 'Previous style' }));
    expect(screen.getByRole('button', { name: 'Select SmallScaleInt' })).toBeVisible();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: 'Select Pixel Town' })).toBeVisible();
  });

  it('shows the next set fallback until its own video is ready', () => {
    renderStep();
    fireEvent.click(screen.getByRole('button', { name: 'Pixel art' }));
    fireEvent.click(screen.getByRole('button', { name: 'SmallScaleInt' }));
    const first = screen.getByLabelText('Diorama preview');
    fireEvent.canPlay(first);
    expect(first.closest('.new-style-track')).toHaveAttribute('data-ready', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Next style' }));
    const next = screen.getByLabelText('Diorama preview');
    expect(screen.getByRole('button', { name: 'Select Pixel Town' })).toBeVisible();
    expect(next.closest('.new-style-track')).toHaveAttribute('data-ready', 'false');
  });
});
