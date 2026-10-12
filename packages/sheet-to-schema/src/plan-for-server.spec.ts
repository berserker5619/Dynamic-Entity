import { planForServer, v2OnlyFields } from './plan-for-server';
import { readPlan } from './read-plan';

const entries = [
  { ref: 'name', column: 0, header: 'Name', confidence: 'exact' },
  { ref: 'source', constant: 'import' },
];
const V2 = { planVersion: 2, target: 'people', schemaVersion: 4, sourceHeaders: ['Name'], entries };
const V1 = { entity: 'people', configVersion: 4, sourceHeaders: ['Name'], entries };

describe('v2OnlyFields', () => {
  it('finds nothing in a plan that uses only what v1 had', () => {
    expect(v2OnlyFields(V2)).toEqual([]);
    expect(v2OnlyFields(V1)).toEqual([]);
  });

  it('names each v2-only field by its path, in the order the reader reports them', () => {
    const plan = {
      ...V2,
      entries: [{ ref: 'born', column: 0, dateOrder: 'DMY' }, null, { ref: 'tags', column: 1, split: ';' }, { ref: 'both', column: 2, split: ',', dateOrder: 'MDY' }],
      group: { key: [0], collect: ['phones'] },
      lists: { phones: { compact: true } },
    };
    expect(v2OnlyFields(plan)).toEqual(['lists', 'group', 'entries[0].dateOrder', 'entries[2].split', 'entries[3].split', 'entries[3].dateOrder']);
  });

  it('agrees with the reader about which fields those are', () => {
    // The reader refuses a v2 field on a plan that does not say it is v2 (rule 4), at these paths.
    const unstamped = { entity: 'people', entries: [{ ref: 'tags', column: 0, split: ';' }], group: { key: [0], collect: [] }, lists: {} };
    const refusedAt = readPlan(unstamped).problems.filter(problem => problem.code === 'PLAN_VERSION').map(problem => problem.path);
    expect(v2OnlyFields(unstamped)).toEqual(refusedAt);
  });

  it('says nothing about what is not a plan, or has no entries', () => {
    for (const notAPlan of [null, undefined, 'plan', 7, [], [V2]]) expect(v2OnlyFields(notAPlan)).toEqual([]);
    expect(v2OnlyFields({ planVersion: 2, target: 'people' })).toEqual([]);
    expect(v2OnlyFields({ planVersion: 2, entries: 'none', group: {} })).toEqual(['group']);
  });
});

describe('planForServer', () => {
  it('sends a v2 plan as it is to a server that reads v2', () => {
    expect(planForServer(V2, [1, 2]).plan).toBe(V2);
    const grouped = { ...V2, group: { key: [0], collect: ['phones'] } };
    expect(planForServer(grouped, [1, 2]).plan).toBe(grouped);
    expect(planForServer(grouped, [2])).toEqual({ plan: grouped });
  });

  it('sends a v1 plan as it is to any server', () => {
    expect(planForServer(V1, undefined).plan).toBe(V1);
    expect(planForServer(V1, [1]).plan).toBe(V1);
    expect(planForServer(V1, [1, 2]).plan).toBe(V1);
  });

  it('takes a server that reports no plan versions to be one from before plan v2', () => {
    expect(planForServer(V2, undefined)).toEqual(planForServer(V2, [1]));
    expect(planForServer(V2, undefined).plan).not.toBe(V2);
  });

  it('sends a v2 plan that uses nothing new in v1 form, which the reader takes to mean the same', () => {
    const sent = planForServer(V2, [1]);
    expect(sent).toEqual({ plan: V1 });
    expect(sent.plan).not.toHaveProperty('planVersion');
    expect(sent.plan).not.toHaveProperty('target');
    expect(sent.plan).not.toHaveProperty('schemaVersion');

    const before = readPlan(V2);
    const after = readPlan(sent.plan);
    expect(after.problems).toEqual([]);
    expect(after.plan).toEqual(before.plan);
  });

  it('leaves out what the plan never said, and keeps everything else it carried', () => {
    expect(planForServer({ planVersion: 2, target: 'people', entries }, [1]).plan).toEqual({ entity: 'people', entries });
    expect(planForServer({ planVersion: 2, entries }, [1]).plan).toEqual({ entries });
  });

  it('refuses a plan using a v2-only field when the server reads only v1, and says which', () => {
    const grouped = { ...V2, group: { key: [0], collect: ['phones'] } };
    expect(planForServer(grouped, undefined)).toEqual({ refused: ['group'] });
    expect(planForServer(grouped, [1])).toEqual({ refused: ['group'] });
    expect(planForServer({ ...V2, entries: [{ ref: 'born', column: 0, dateOrder: 'DMY' }] }, [1])).toEqual({ refused: ['entries[0].dateOrder'] });
    expect(planForServer({ ...V2, lists: {} }, [])).toEqual({ refused: ['lists'] });
  });

  it('sends what is not a plan as it is, for the server to refuse', () => {
    for (const notAPlan of [null, 'plan', [], 7]) expect(planForServer(notAPlan, [1])).toEqual({ plan: notAPlan });
    const future = { planVersion: 3, target: 'people', entries };
    expect(planForServer(future, [1]).plan).toBe(future);
  });
});
