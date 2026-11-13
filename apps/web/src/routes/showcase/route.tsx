import type { ScreenRoute } from '../../app/screen';
import { ShowcasePlay } from './ShowcasePlay';

export const route: ScreenRoute = {
  path: '/g/showcase/:id',
  element: <ShowcasePlay />,
  chrome: 'app',
  auth: 'required',
};
