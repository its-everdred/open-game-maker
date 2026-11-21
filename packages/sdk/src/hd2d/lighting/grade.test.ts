import { describe, expect, it } from 'vitest';
import { gradeColor, timeOfDayGrade } from './grade.js';

describe('color grading', () => {
  it('preserves neutral colors under a neutral grade', () => {
    expect(gradeColor([40, 120, 220], { temperature: 0, saturation: 1, contrast: 1 })).toEqual([40, 120, 220]);
  });

  it('returns bounded grades across the day', () => {
    for (const hour of [0, 6, 12, 18, 24]) {
      const grade = timeOfDayGrade(hour);
      expect(gradeColor([30, 140, 240], grade).every((channel) => channel >= 0 && channel <= 255)).toBe(true);
    }
  });
});
