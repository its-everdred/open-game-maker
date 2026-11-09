import { renamed } from '../../alias.js';
import { command as request } from '../command/request.js';

// `gm checkpoint` became aiur's word, `gm command` (#571). Kept for one release; delete this directory after it.
export const command = renamed('checkpoint open', request);
