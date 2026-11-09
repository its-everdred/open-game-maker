import { renamed } from '../../alias.js';
import { command as wait } from '../command/wait.js';

// `gm checkpoint` became aiur's word, `gm command` (#571). Kept for one release; delete this directory after it.
export const command = renamed('checkpoint wait', wait);
