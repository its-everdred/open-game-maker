import { resolve } from 'node:path';

import { readRoles, skillsConfig } from '@ogm/game-repo-template';
import { Scalar, stringify } from 'yaml';

import { PolicyViolation, RenderInputSchema, type RenderInput, type ValidatedRenderInput } from './types.js';

export { PolicyViolation } from './types.js';

const ACTIVE_STATES = ['todo', 'in-progress', 'human-review', 'rework', 'merging'];
const TERMINAL_STATES = ['done', 'closed', 'cancelled', 'canceled'];

export function renderAiurConfig(rawInput: RenderInput): string {
  const input = RenderInputSchema.parse(rawInput);
  const policy = resolvePolicy(input);
  const featureLabelPrefix = new Scalar('feature:');
  featureLabelPrefix.type = Scalar.QUOTE_SINGLE;

  const config = {
    tracker: {
      kind: 'github',
      base_branch: input.baseBranch,
      active_states: ACTIVE_STATES,
      terminal_states: TERMINAL_STATES,
      github: {
        repo: input.repo,
        bot_account: input.botAccount,
        identity_mode: 'separate_account',
        label_prefix: input.labelPrefix,
        allowed_users: [input.intakeLogin],
        trusted_accounts: [input.intakeLogin],
        human_mergers: [],
      },
    },
    instance: {
      mode: policy.instanceMode,
      deployment_kind: 'operator',
      role: 'primary',
      id: input.instanceId ?? input.repo.replace('/', '-'),
    },
    merge_policy: {
      ci: 'wait',
      local_tests: 'partial',
    },
    polling: {
      interval_seconds: 60,
      intervals: {
        dispatch: 60,
        review: 300,
        planning: 0,
      },
    },
    server: {
      host: '127.0.0.1',
      port: input.port,
      tailscale_funnel: false,
    },
    workspace: {
      root: input.workspaceRoot,
    },
    hooks_file: 'hooks',
    prompt_file: 'prompt.md',
    agent: {
      priority: ['codex'],
      // No named account: Aiur then preserves the daemon process's per-repo CODEX_HOME.
      accounts: { codex: [] },
      max_concurrent_agents: input.maxConcurrentAgents,
      max_agent_duration_minutes: input.kind === 'new_game' ? 90 : 45,
      max_dispatches_per_ticket: 3,
      max_turns_by_complexity: new Map([
        [1, 4],
        [2, 8],
        [3, 12],
        [4, 16],
        [5, 20],
      ]),
      build_nice: 10,
      // Role labels inline their mandatory skills at ticket start (skills/gm-core/references/roles.md).
      skills: skillsConfig(readRoles()),
      codex: {
        approval_policy: policy.approvalPolicy,
        thread_sandbox: 'workspace-write',
        turn_sandbox_policy: {
          type: 'workspaceWrite',
          writableRoots: policy.writableRoots,
          networkAccess: policy.networkAccess,
          excludeSlashTmp: policy.excludeSlashTmp,
        },
      },
    },
    events: {
      export: { enabled: true },
    },
    decisions: {
      supervisor_allowed_kinds: ['direction_checkpoint'],
    },
    observability: {
      capture_label_prefixes: [featureLabelPrefix],
    },
  };

  return stringify(config, { lineWidth: 0 });
}

function resolvePolicy(input: ValidatedRenderInput) {
  const overrides = input.overrides ?? {};
  const networkAccess = overrides.networkAccess ?? false;
  const excludeSlashTmp = overrides.excludeSlashTmp ?? true;
  const writableRoots = overrides.writableRoots ?? [input.workspaceRoot];
  const approvalPolicy = overrides.approvalPolicy ?? 'on-request';
  const instanceMode = overrides.instanceMode ?? 'local';

  if (networkAccess) {
    throw new PolicyViolation('agent.codex.turn_sandbox_policy.networkAccess must be false');
  }
  if (!excludeSlashTmp) {
    throw new PolicyViolation('agent.codex.turn_sandbox_policy.excludeSlashTmp must be true');
  }
  if (
    writableRoots.length !== 1 ||
    resolve(writableRoots[0] ?? '') !== resolve(input.workspaceRoot) ||
    writableRoots.some((root) => root === '/tmp' || root.startsWith('/tmp/'))
  ) {
    throw new PolicyViolation('agent.codex.turn_sandbox_policy.writableRoots must contain only workspaceRoot');
  }
  if (approvalPolicy !== 'on-request') {
    throw new PolicyViolation('agent.codex.approval_policy must be on-request');
  }
  if (overrides.permissionMode === 'bypassPermissions') {
    throw new PolicyViolation('permission_mode bypassPermissions is forbidden');
  }
  if (overrides.claude !== undefined) {
    throw new PolicyViolation('a Claude backend is outside the game-builder policy');
  }
  if (instanceMode !== 'local') {
    throw new PolicyViolation('instance.mode must be local');
  }

  return { approvalPolicy, excludeSlashTmp, instanceMode, networkAccess, writableRoots };
}
