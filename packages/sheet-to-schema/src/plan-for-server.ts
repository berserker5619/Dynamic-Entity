/**
 * plan-for-server.ts — the plan a client may send to the server it is talking to (spec §4,
 * "Talking to an older server").
 *
 * A server from before plan v2 reads every plan as v1 and ignores the keys it does not know.
 * So a v2 plan with `group`, posted to it, is accepted and imports one record per row: a wrong
 * result reported as a success. A preview says which plan versions its server reads
 * (`planVersions`, and absent means `[1]`), and a client checks its plan against that before
 * it commits. That check is this file, so every client makes it the same way.
 */

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Where a plan uses something only plan v2 has: `lists`, `group`, and an entry's `split` or
 * `dateOrder`. Paths into the plan, in the order the reader reports them. Empty for anything
 * that is not a plan: saying what is wrong with it is the reader's job.
 */
export function v2OnlyFields(plan: unknown): string[] {
  if (!isObject(plan)) return [];
  const found: string[] = [];
  if (plan['lists'] !== undefined) found.push('lists');
  if (plan['group'] !== undefined) found.push('group');
  const entries = Array.isArray(plan['entries']) ? (plan['entries'] as unknown[]) : [];
  entries.forEach((entry, i) => {
    if (isObject(entry) && entry['split'] !== undefined) found.push(`entries[${i}].split`);
    if (isObject(entry) && entry['dateOrder'] !== undefined) found.push(`entries[${i}].dateOrder`);
  });
  return found;
}

/** What `planForServer` decides. */
export type PlanForServer =
  /** Send this. It is the plan as given, or the same plan in v1 form. */
  | { plan: unknown; refused?: undefined }
  /** Do not commit. The paths are what the server would ignore. */
  | { plan?: undefined; refused: string[] };

/**
 * The plan to send to a server that reads `planVersions`, or the reason not to send one.
 *
 * - The server reads v2, or the plan is not v2: the plan goes as it is. A v1 plan is read by
 *   every server.
 * - The server reads only v1 and the plan uses nothing v2 added: it goes in v1 form (`entity`,
 *   `configVersion`, no `planVersion`), which means the same thing there.
 * - The server reads only v1 and the plan uses a v2-only field: **refused**, with the paths.
 *   A client MUST NOT commit it, and should say the server needs upgrading.
 *
 * @param planVersions as the preview reported it. `undefined` is a server from before plan v2.
 */
export function planForServer(plan: unknown, planVersions: readonly number[] | undefined): PlanForServer {
  const reads = planVersions ?? [1];
  if (!isObject(plan) || plan['planVersion'] !== 2 || reads.includes(2)) return { plan };

  const refused = v2OnlyFields(plan);
  if (refused.length) return { refused };

  const { target, schemaVersion } = plan;
  const rest = Object.fromEntries(Object.entries(plan).filter(([key]) => key !== 'planVersion' && key !== 'target' && key !== 'schemaVersion'));
  return {
    plan: {
      ...rest,
      // A v2 plan may still carry the old names, with a warning from the reader. They win
      // nothing here: `target` is what the plan means.
      ...(target !== undefined ? { entity: target } : {}),
      ...(schemaVersion !== undefined ? { configVersion: schemaVersion } : {}),
    },
  };
}
