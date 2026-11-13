import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { GameMenuProvider } from '../../app/GameMenu';
import { ShowcasePlay } from './ShowcasePlay';

afterEach(cleanup);

describe('showcase play', () => {
  it('opens the staged prototype demo with the selected title and mode', () => {
    render(<MemoryRouter initialEntries={['/g/showcase/restorebound?mode=play']}><GameMenuProvider><Routes><Route path="/g/showcase/:id" element={<ShowcasePlay />} /></Routes></GameMenuProvider></MemoryRouter>);
    const frame = screen.getByTitle('RestoreBound') as HTMLIFrameElement;
    expect(frame).toHaveAttribute('src', '/proto/demo/index.html?shell=&models=json&editor=&title=RestoreBound&play=');
    const demoDocument = document.implementation.createHTMLDocument('demo');
    Object.defineProperty(frame, 'contentDocument', { value: demoDocument });
    fireEvent.load(frame);
    expect(demoDocument.head.textContent).toContain("grid-template-areas: 'stage' 'rail' 'tray'");
  });
});
