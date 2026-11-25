import type { DiplomacyEdge, GameState, RelationStatus } from '../types';
import { getCountryRegions, pushImportantToast } from './economy';

export function makePairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

export function ensureAllDiplomacyPairs(state: GameState): void {
  const ids = Object.keys(state.countries);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const key = makePairKey(ids[i], ids[j]);
      if (!state.diplomacy[key]) {
        state.diplomacy[key] = {
          a: ids[i] < ids[j] ? ids[i] : ids[j],
          b: ids[i] < ids[j] ? ids[j] : ids[i],
          status: 'neutral',
          score: 0,
        };
      }
    }
  }
}

export function getDiplomacyEdge(state: GameState, a: string, b: string): DiplomacyEdge | null {
  if (a === b) return null;
  const key = makePairKey(a, b);
  if (!state.diplomacy[key]) {
    state.diplomacy[key] = {
      a: a < b ? a : b,
      b: a < b ? b : a,
      status: 'neutral',
      score: 0,
    };
  }
  return state.diplomacy[key];
}

export function getRelationStatus(state: GameState, a: string, b: string): RelationStatus {
  if (a === b) return 'allied';
  return getDiplomacyEdge(state, a, b)?.status ?? 'neutral';
}

export function canArmyEnterCountryTerritory(
  state: GameState,
  armyCountryId: string,
  territoryOwnerId: string,
): boolean {
  if (armyCountryId === territoryOwnerId) return true;
  const rel = getRelationStatus(state, armyCountryId, territoryOwnerId);
  return rel === 'war' || rel === 'allied';
}

export function estimateCountryMilitaryPower(state: GameState, countryId: string): number {
  let power = getCountryRegions(state, countryId).length * 15;
  for (const army of Object.values(state.armies)) {
    if (army.countryId !== countryId) continue;
    for (const cnt of Object.values(army.units)) {
      power += cnt * 8;
    }
  }
  return power;
}

export function declareWar(
  state: GameState,
  attackerId: string,
  defenderId: string,
): { ok: boolean; error?: string } {
  if (attackerId === defenderId) return { ok: false, error: 'Geçersiz hedef.' };
  const edge = getDiplomacyEdge(state, attackerId, defenderId);
  if (!edge) return { ok: false, error: 'İlişki bulunamadı.' };
  if (edge.status === 'war') return { ok: false, error: 'Zaten savaş halindesiniz.' };

  edge.status = 'war';
  edge.score = -85;

  const atkName = state.countries[attackerId]?.name ?? attackerId;
  const defName = state.countries[defenderId]?.name ?? defenderId;
  const pid = state.playerCountryId;
  if (attackerId === pid || defenderId === pid) {
    pushImportantToast(state, `⚔️ Savaş İlanı: ${atkName} → ${defName}!`, 'war');
  }

  // Defender's allies join defensive war
  for (const otherId of Object.keys(state.countries)) {
    if (otherId === attackerId || otherId === defenderId || state.countries[otherId].eliminated) {
      continue;
    }
    if (getRelationStatus(state, defenderId, otherId) === 'allied') {
      const allyEdge = getDiplomacyEdge(state, attackerId, otherId);
      if (allyEdge && allyEdge.status !== 'war') {
        allyEdge.status = 'war';
        allyEdge.score = -70;
        if (attackerId === pid || otherId === pid) {
          pushImportantToast(
            state,
            `⚔️ Müttefik Savaşa Katıldı: ${state.countries[otherId].name}!`,
            'war',
          );
        }
      }
    }
  }

  return { ok: true };
}

export function proposeAlliance(
  state: GameState,
  fromId: string,
  toId: string,
  forceAccept = false,
): { ok: boolean; accepted: boolean; error?: string } {
  if (fromId === toId) return { ok: false, accepted: false, error: 'Geçersiz hedef.' };
  const edge = getDiplomacyEdge(state, fromId, toId);
  if (!edge) return { ok: false, accepted: false, error: 'İlişki bulunamadı.' };
  if (edge.status === 'war') {
    return { ok: false, accepted: false, error: 'Savaştaki ülkeye önce barış teklif edilmeli.' };
  }
  if (edge.status === 'allied') {
    return { ok: false, accepted: true, error: 'Zaten müttefiksiniz.' };
  }

  const target = state.countries[toId];
  if (!target || target.eliminated) return { ok: false, accepted: false, error: 'Ülke elendi.' };

  let accepted = forceAccept;
  if (!forceAccept) {
    const fromPower = estimateCountryMilitaryPower(state, fromId);
    const toPower = estimateCountryMilitaryPower(state, toId);
    const ratio = fromPower / Math.max(10, toPower);
    const personalityBonus =
      target.personality === 'diplomat' ? 0.35 : target.personality === 'aggressive' ? -0.25 : 0.1;
    accepted = ratio + personalityBonus + edge.score / 200 >= 0.72;
  }

  if (accepted) {
    edge.status = 'allied';
    edge.score = Math.max(65, edge.score + 50);
    const pid = state.playerCountryId;
    if (fromId === pid || toId === pid) {
      pushImportantToast(
        state,
        `🤝 İttifak Kuruldu: ${state.countries[fromId].name} & ${target.name}`,
        'alliance',
      );
    }
  } else {
    edge.score = Math.max(-100, edge.score - 5);
  }

  return { ok: true, accepted };
}

export function proposePeace(
  state: GameState,
  fromId: string,
  toId: string,
  forceAccept = false,
): { ok: boolean; accepted: boolean; error?: string } {
  const edge = getDiplomacyEdge(state, fromId, toId);
  if (!edge || edge.status !== 'war') {
    return { ok: false, accepted: false, error: 'Bu ülkeyle savaşta değilsiniz.' };
  }

  const target = state.countries[toId];
  let accepted = forceAccept;
  if (!forceAccept && target) {
    const fromPower = estimateCountryMilitaryPower(state, fromId);
    const toPower = estimateCountryMilitaryPower(state, toId);
    // AI accepts peace if losing, evenly matched, or diplomat/economist
    const thresh = target.personality === 'aggressive' ? 1.15 : 0.75;
    accepted = fromPower / Math.max(10, toPower) >= thresh;
  }

  if (accepted) {
    edge.status = 'neutral';
    edge.score = -15;

    // Clear active captures & combats between these two countries
    for (const reg of Object.values(state.regions)) {
      if (
        reg.capture &&
        ((reg.ownerId === fromId && reg.capture.attackerCountryId === toId) ||
          (reg.ownerId === toId && reg.capture.attackerCountryId === fromId))
      ) {
        reg.capture = null;
      }
    }
    for (const army of Object.values(state.armies)) {
      if (army.inCombatWithArmyId) {
        const other = state.armies[army.inCombatWithArmyId];
        if (
          !other ||
          (army.countryId === fromId && other.countryId === toId) ||
          (army.countryId === toId && other.countryId === fromId)
        ) {
          army.inCombatWithArmyId = null;
        }
      }
    }

    const pid = state.playerCountryId;
    if (fromId === pid || toId === pid) {
      pushImportantToast(
        state,
        `🕊️ Barış Antlaşması: ${state.countries[fromId]?.name} & ${state.countries[toId]?.name}`,
        'peace',
      );
    }
  }

  return { ok: true, accepted };
}
