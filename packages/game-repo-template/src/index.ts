import { renderRepoTemplate, type RepoTemplate, type TemplateCtx } from './repo.js';

export { renderDaemonFiles, sparsePaths, type DaemonFiles, type DaemonFilesContext } from './daemon-files.js';
export { renderInstanceTemplate, type InstanceTemplate } from './instance.js';
export { DAEMON_LABEL_SUFFIXES, LABELS, isDaemonLabel, STATE_SUFFIXES, type TemplateLabel } from './labels.js';
export {
  parseTemplateRef,
  renderRepoTemplate,
  REQUIRED_CHECKS,
  type Engine,
  type FileMode,
  type RepoTemplate,
  type TemplateCtx,
  type TemplateFile,
} from './repo.js';
export {
  gameLabelSkills,
  parseRoles,
  PRELOAD_MAX_BYTES,
  readRoles,
  ROLES_PATH,
  skillsConfig,
  type GameSkills,
  type Role,
  type SkillsConfig,
} from './roles.js';
export { skillPack, type SkillPack } from './skills.js';

// OGM-035's `TemplateSource` for `game-<engine>@1` refs.
export class GameRepoTemplateSource {
  constructor(private readonly root?: string) {}

  async render(templateRef: string, context: TemplateCtx): Promise<RepoTemplate> {
    return renderRepoTemplate(templateRef, context, this.root);
  }
}
