import { existsSync, readdirSync, readFileSync } from 'node:fs';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { toJSONSchema, type z } from 'zod';

import { analyticsSchemas, ActivityMeta } from '../src/analytics.js';
import { apiSchemas } from '../src/api.js';
import { budgetSchemas, SizeClassRow } from '../src/budget.js';
import { designDecisionsSchemas } from '../src/design-decisions.js';
import { energySchemas } from '../src/energy.js';
import { CreateJobAccepted, CreateJobRequest, Job, jobsSchemas } from '../src/jobs.js';
import { notificationsSchemas } from '../src/notifications.js';
import { reportsSchemas } from '../src/reports.js';
import { scopeSchemas } from '../src/scope.js';
import { voiceSchemas } from '../src/voice.js';
import { loadJson } from './helpers.js';

const families: Record<string, Record<string, z.ZodType>> = {
  api: apiSchemas,
  jobs: jobsSchemas,
  budget: budgetSchemas,
  analytics: analyticsSchemas,
  reports: reportsSchemas,
  scope: scopeSchemas,
  notifications: notificationsSchemas,
  voice: voiceSchemas,
  designDecisions: designDecisionsSchemas,
  energy: energySchemas,
};

const packageRoot = new URL('../', import.meta.url);

// Same pairing rule as scripts/check-fixtures.mjs.
function fixturesFor(stem: string): string[] {
  const [, family, name] = /^([a-z-]+)\.(.+)\.v\d+$/.exec(stem)!;
  const directory = new URL(`fixtures/${family}/${name}/`, packageRoot);
  if (existsSync(directory)) {
    return readdirSync(directory)
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => `fixtures/${family}/${name}/${entry}`);
  }
  return [`fixtures/${family}/${name}.json`];
}

const shapes = Object.entries(families).flatMap(([family, record]) =>
  Object.entries(record).map(([stem, schema]) => ({ family, stem, schema })),
);

describe('backend contract families', () => {
  it.each(shapes)('$stem has a fixture that parses', ({ stem, schema }) => {
    const files = fixturesFor(stem);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const result = schema.safeParse(loadJson(file));
      expect(result.success, `${file}: ${result.error?.message}`).toBe(true);
    }
  });

  it.each(shapes)('$stem emitted JSON Schema is current and accepts its fixtures', ({ stem, schema }) => {
    const emitted = JSON.parse(readFileSync(new URL(`schemas/${stem}.json`, packageRoot), 'utf8')) as object;
    expect(emitted).toEqual({
      ...toJSONSchema(schema, { target: 'draft-2020-12' }),
      $id: `https://open-game-maker-2000.local/schemas/${stem}.json`,
    });
    const ajv = new Ajv2020.default({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
    addFormats.default(ajv);
    const validate = ajv.compile(emitted);
    for (const file of fixturesFor(stem)) {
      expect(validate(loadJson(file)), `${file}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  it('keeps the worked 202 fixture from the ticket', () => {
    expect(CreateJobAccepted.parse(loadJson('fixtures/jobs/create-job.accepted.json'))).toEqual({
      jobId: 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f',
      state: 'queued',
      reservation: { amountMicroUsd: 3_000_000, sizeClass: 'medium', confidence: 'low' },
      slot: 'edit',
      position: 2,
    });
  });
});

describe('backend contract invariants', () => {
  // Each negative fixture is a valid fixture with one invariant broken.
  const negatives: Array<{ file: string; schema: z.ZodType }> = [
    // analytics meta is allow-listed: free text such as a prompt never reaches storage
    {
      file: 'fixtures/analytics-negative/ingest.request.meta-prompt.json',
      schema: analyticsSchemas['analytics.ingest.request.v1'],
    },
    // every amount is integer micro-dollars
    { file: 'fixtures/jobs-negative/create-job.accepted.fractional-amount.json', schema: CreateJobAccepted },
    // ids are <prefix>_<uuid>
    { file: 'fixtures/jobs-negative/create-job.accepted.short-id.json', schema: CreateJobAccepted },
    { file: 'fixtures/jobs-negative/create-job.request.unknown-kind.json', schema: CreateJobRequest },
  ];

  it.each(negatives)('rejects $file', ({ file, schema }) => {
    expect(schema.safeParse(loadJson(file)).success).toBe(false);
  });

  it('defaults a job request to start now on main', () => {
    const request = loadJson<Record<string, unknown>>('fixtures/jobs/create-job.request.json');
    delete request.start;
    delete request.branchId;
    expect(CreateJobRequest.parse(request)).toMatchObject({ start: 'now', branchId: 'main' });
  });

  it('accepts scope jobs without widening persisted size-class kinds', () => {
    const request = loadJson<Record<string, unknown>>('fixtures/jobs/create-job.request.json');
    request.kind = 'scope';
    expect(CreateJobRequest.parse(request)).toMatchObject({ kind: 'scope' });
    expect(
      SizeClassRow.safeParse({
        kind: 'scope',
        sizeClass: 'small',
        p50MicroUsd: 500_000,
        p80MicroUsd: 1_500_000,
        samples: 0,
      }).success,
    ).toBe(false);

    const job = loadJson<Record<string, unknown>>('fixtures/jobs/job.json');
    Object.assign(job, { stage: 'building', stageText: 'Building', phase: 'work', progressPercent: 40 });
    expect(Job.parse(job)).toMatchObject({
      stage: 'building',
      stageText: 'Building',
      phase: 'work',
      progressPercent: 40,
    });
  });

  it('rejects unknown meta keys', () => {
    expect(ActivityMeta.safeParse({ command: 'gm verify' }).success).toBe(true);
    expect(ActivityMeta.safeParse({ command: 'gm verify', note: 'x' }).success).toBe(false);
  });
});
