import { homedir } from 'node:os';

import { skillPack } from '@ogm/game-repo-template';

import { agentDesignRoutes } from './agent-design.js';
import { bundleRoutes, hookIdentityFiles, hookSecretFiles, type SkillTarball } from './bundle.js';
import { tarGz } from './tarball.js';

// Game-repo hooks call these on the API's loopback port with their daemon's hook secret.
export const prefix = '/internal';

let tarball: SkillTarball | undefined;

export default bundleRoutes({
  daemonForSecret: hookSecretFiles(homedir()),
  skills: () => {
    if (!tarball) {
      const pack = skillPack();
      tarball = { version: pack.version, tgz: tarGz(pack.files) };
    }
    return tarball;
  },
}).route('/', agentDesignRoutes({ identityForSecret: hookIdentityFiles(homedir()) }));
