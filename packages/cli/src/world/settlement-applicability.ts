import type { DomainPatchV1, ScalarV1 } from './domain-patch.js';

export interface SettlementApplicableEventV1 {
  id: string;
  patches: readonly DomainPatchV1[];
}

export interface SettlementWorldStateV1 {
  variables: Readonly<Record<string, ScalarV1>>;
  characters: ReadonlyMap<string, Readonly<{ status: string; locationId: string | null }>>;
  locations: ReadonlyMap<string, Readonly<{ status: string }>>;
  arcs: ReadonlyMap<string, Readonly<{ stage: string }>>;
}

export function validateSettlementApplicabilityV1(
  events: readonly SettlementApplicableEventV1[],
  currentWorld: Readonly<SettlementWorldStateV1>,
): void {
  const variables = new Map(Object.entries(currentWorld.variables));
  const characterStatus = new Map([...currentWorld.characters].map(([id, state]) => [id, state.status]));
  const characterLocation = new Map([...currentWorld.characters].map(([id, state]) => [id, state.locationId]));
  const locationStatus = new Map([...currentWorld.locations].map(([id, state]) => [id, state.status]));
  const arcStage = new Map([...currentWorld.arcs].map(([id, state]) => [id, state.stage]));
  const writes = new Set<string>();

  for (const event of events) for (const patch of event.patches) {
    const target = settlementPatchTargetV1(patch);
    if (writes.has(target)) throw new Error(`Settlement contains conflicting writes to ${target} (at ${event.id}).`);
    writes.add(target);

    if (patch.op === 'set-world-variable') {
      expectV1(variables.has(patch.key) ? variables.get(patch.key) : null, patch.expected, event.id, patch.op);
      variables.set(patch.key, patch.value);
    } else if (patch.op === 'set-character-status') {
      expectV1(characterStatus.get(patch.characterId), patch.expected, event.id, patch.op);
      characterStatus.set(patch.characterId, patch.value);
    } else if (patch.op === 'move-character') {
      expectV1(characterLocation.get(patch.characterId), patch.expectedLocationId, event.id, patch.op);
      characterLocation.set(patch.characterId, patch.locationId);
    } else if (patch.op === 'set-location-status') {
      expectV1(locationStatus.get(patch.locationId), patch.expected, event.id, patch.op);
      locationStatus.set(patch.locationId, patch.value);
    } else {
      expectV1(arcStage.get(patch.arcId), patch.expected, event.id, patch.op);
      arcStage.set(patch.arcId, patch.value);
    }
  }
}

export function settlementPatchTargetV1(patch: DomainPatchV1): string {
  if (patch.op === 'set-world-variable') return `world-variable:${patch.key}`;
  if (patch.op === 'set-character-status') return `character:${patch.characterId}:status`;
  if (patch.op === 'move-character') return `character:${patch.characterId}:location`;
  if (patch.op === 'set-location-status') return `location:${patch.locationId}:status`;
  return `arc:${patch.arcId}:stage`;
}

function expectV1(actual: unknown, expected: unknown, eventId: string, operation: string): void {
  if (!Object.is(actual, expected)) throw new Error(`${eventId} ${operation} precondition failed.`);
}
