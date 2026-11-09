import { describe, expect, it } from 'vitest';

import {
  decisionKeyFromMarker,
  decisionKeyMarker,
  waitKeyOfLabel,
  waitLabel,
  waitMarker,
  waitsFromText,
} from '../src/index.js';

describe('decision waits', () => {
  it('fits the longest key in a GitHub label (50 characters) and reads it back', () => {
    const key = `blobs/${'x'.repeat(34)}`;
    expect(waitLabel(key)).toHaveLength(46);
    expect(waitKeyOfLabel(waitLabel(key))).toBe(key);
    expect(waitKeyOfLabel(waitLabel('dec_0123456789abcdef'))).toBe('dec_0123456789abcdef');
  });

  it('ignores labels that are not waits, so release never touches other labels', () => {
    expect(waitKeyOfLabel('agent:paused')).toBeNull();
    expect(waitKeyOfLabel('waits:')).toBeNull();
    expect(waitKeyOfLabel('waits:Has Space')).toBeNull();
  });

  it('carries a key through a Command context alongside other markers', () => {
    const context = `<!-- gm-checkpoint:cp_1 -->\n<!-- gm-audience:creator -->\n${decisionKeyMarker('blobs/diorama')}`;
    expect(decisionKeyFromMarker(context)).toBe('blobs/diorama');
    expect(decisionKeyFromMarker('<!-- gm-audience:creator -->')).toBeNull();
    expect(decisionKeyFromMarker(undefined)).toBeNull();
  });

  it('reads every wait a comment declares, with its option condition', () => {
    const text = `Waits on a decision.\n${waitMarker({ key: 'blobs/diorama' })}\n${waitMarker({
      key: 'blobs/staging',
      when: 'b',
    })}\n<!-- gm-waits-on:{"key":"Bad Key"} -->`;
    expect(waitsFromText(text)).toEqual([{ key: 'blobs/diorama' }, { key: 'blobs/staging', when: 'b' }]);
  });

  it('refuses to write a marker for a key that cannot be a label', () => {
    expect(() => waitMarker({ key: 'x'.repeat(41) })).toThrow();
  });
});
