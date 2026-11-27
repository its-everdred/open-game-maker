#!/usr/bin/env node
/** Refresh per-instance overlap reports for the hourly meta collector. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

import { featureKeys, readJsonl, report, type Disposition, type Wake } from './overlap-report.ts';

type Instance = {
  name: string;
  launch_dir: string;
  wakes: string;
  dispositions: string;
  coverage_complete?: boolean;
  coverage_verified_at?: string;
};

export function collect(config: string, output: string): void {
  const settings: unknown = JSON.parse(readFileSync(config, 'utf8'));
  const instances = (settings as { instances?: unknown } | null)?.instances;
  if (!Array.isArray(instances) || !instances.length) throw new Error('config needs a nonempty instances list');
  mkdirSync(output, { recursive: true });
  const names = new Set<string>();
  const reports = new Map<string, ReturnType<typeof report>>();
  for (const raw of instances as unknown[]) {
    if (!raw || typeof raw !== 'object') throw new Error('invalid instance');
    const instance = raw as Instance;
    if (typeof instance.name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(instance.name) || names.has(instance.name))
      throw new Error('instance names must be unique lowercase slugs');
    names.add(instance.name);
    for (const key of ['launch_dir', 'wakes', 'dispositions'] as const)
      if (typeof instance[key] !== 'string' || !isAbsolute(instance[key]))
        throw new Error(`${instance.name}: ${key} must be an absolute path`);
    if (instance.coverage_complete !== undefined && typeof instance.coverage_complete !== 'boolean')
      throw new Error(`${instance.name}: coverage_complete must be boolean`);
    const now = new Date();
    let coverageComplete = false;
    if (instance.coverage_complete) {
      const at = instance.coverage_verified_at;
      if (typeof at !== 'string' || !/(?:Z|[+-]\d\d:\d\d)$/.test(at) || !Number.isFinite(Date.parse(at)))
        throw new Error(`${instance.name}: coverage_verified_at needs an offset`);
      const age = now.getTime() - Date.parse(at);
      coverageComplete = age >= 0 && age <= 2 * 60 * 60 * 1000;
    }
    let snapshot: string;
    try {
      snapshot = execFileSync('aiur-main', ['feature', 'show', '--json'], {
        cwd: instance.launch_dir,
        encoding: 'utf8',
        timeout: 120_000,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const failure = error as { stderr?: Buffer | string; message?: string };
      throw new Error(
        `${instance.name}: aiur feature show failed: ${String(failure.stderr || failure.message || 'unknown error').trim()}`,
      );
    }
    reports.set(
      instance.name,
      report(
        readJsonl<Wake>(instance.wakes),
        readJsonl<Disposition>(instance.dispositions),
        now,
        featureKeys(JSON.parse(snapshot)),
        coverageComplete,
      ),
    );
  }
  for (const [name, result] of reports) {
    const temporary = join(output, `.${name}-${randomUUID()}`);
    try {
      writeFileSync(temporary, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      renameSync(temporary, join(output, `${name}.json`));
    } finally {
      try {
        unlinkSync(temporary);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const config = args[0] === '--config' ? args[1] : undefined;
    const output = args[2] === '--output' ? args[3] : undefined;
    if (!config || !output || args.length !== 4)
      throw new Error('usage: overlap-collect.ts --config <file> --output <dir>');
    collect(config, output);
  } catch (error) {
    process.stderr.write(`overlap collector: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
