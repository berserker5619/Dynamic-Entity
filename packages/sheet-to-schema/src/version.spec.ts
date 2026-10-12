import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readPlan } from './read-plan';
import { IMPORTER_VERSION, PLAN_VERSIONS } from './version';

describe('IMPORTER_VERSION', () => {
  it('is the version in package.json, which is the one that is published', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version: string };
    expect(IMPORTER_VERSION).toBe(manifest.version);
  });
});

describe('PLAN_VERSIONS', () => {
  it('lists exactly the plan versions readPlan reads', () => {
    const entries = [{ ref: 'a', column: 0 }];
    expect(PLAN_VERSIONS).toEqual([1, 2]);
    expect(readPlan({ entity: 'x', entries }).plan).toBeDefined();
    expect(readPlan({ planVersion: 2, target: 'x', entries }).plan).toBeDefined();
    expect(readPlan({ planVersion: 3, target: 'x', entries }).plan).toBeUndefined();
  });
});
