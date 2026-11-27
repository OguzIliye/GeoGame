import { DIPLOMACY_CONFIG } from '../config/balance';
import type { DiplomacyEdge, GameState, RelationStatus } from '../types';
import { setAutoPauseReason, setGameSpeed } from './calendar';
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
          nonAggressionUntilDay: 0,
          tradeAgreement: false,
          lastGiftDayByCountry: {},
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
      nonAggressionUntilDay: 0,
      tradeAgreement: false,
      lastGiftDayByCountry: {},
    };
  }
  return state.diplomacy[key];
}

export function getRelationStatus(state: GameState, a: string, b: string): RelationStatus {
  if (a === b) return 'allied';
  return getDiplomacyEdge(state, a, b)?.status ?? 'neutral';
}

export function isNonAggressionActive(state: GameState, a: string, b: string): boolean {
  const edge = getDiplomacyEdge(state, a, b);
  if (!edge) return false;
  return (edge.nonAggressionUntilDay ?? 0) > state.simDaysElapsed;
}

export function getNonAggressionRemainingDays(state: GameState, a: string, b: string): number {
  const edge = getDiplomacyEdge(state, a, b);
  if (!edge) return 0;
  return Math.max(0, Math.ceil((edge.nonAggressionUntilDay ?? 0) - state.simDaysElapsed));
}

export function hasTransitPact(state: GameState, a: string, b: string): boolean {
  if (a === b) return false;
  return getRelationStatus(state, a, b) === 'allied';
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

function findNearestLandHomePath(
  state: GameState,
  startRegionId: string,
  countryId: string,
): string[] | null {
  if (!state.regions[startRegionId]) return null;
  const queue: string[] = [startRegionId];
  const prev = new Map<string, string | null>([[startRegionId, null]]);
  while (queue.length > 0) {
    const curId = queue.shift()!;
    const cur = state.regions[curId];
    if (!cur) continue;
    if (cur.ownerId === countryId) {
      const path: string[] = [];
      let trace: string | null = curId;
      while (trace !== null) {
        path.push(trace);
        trace = prev.get(trace) ?? null;
      }
      path.reverse();
      return path;
    }
    for (const nbId of cur.neighbors) {
      if (prev.has(nbId) || !state.regions[nbId]) continue;
      prev.set(nbId, curId);
      queue.push(nbId);
    }
  }
  return null;
}

/** Send any armies standing in (or marching toward) non-war, non-allied foreign territory back to their nearest land-reachable own region. */
export function evacuateStrandedArmies(state: GameState): void {
  for (const army of Object.values(state.armies)) {
    const curReg = state.regions[army.currentRegionId];
    const targetReg = army.targetRegionId ? state.regions[army.targetRegionId] : null;
    const onForbidden =
      curReg !== undefined && !canArmyEnterCountryTerritory(state, army.countryId, curReg.ownerId);
    const headingForbidden =
      targetReg !== undefined &&
      targetReg !== null &&
      !canArmyEnterCountryTerritory(state, army.countryId, targetReg.ownerId);

    if (!onForbidden && !headingForbidden) continue;

    for (const reg of Object.values(state.regions)) {
      if (reg.capture?.armyId === army.id) reg.capture = null;
    }
    army.inCombatWithArmyId = null;
    army.targetArmyId = null;
    army.mergeTargetArmyId = null;
    army.embarkingShipId = null;

    if (!onForbidden) {
      army.targetRegionId = null;
      army.targetX = null;
      army.targetY = null;
      army.waypoints = [];
      continue;
    }

    const landPath = curReg ? findNearestLandHomePath(state, curReg.id, army.countryId) : null;
    if (!landPath || landPath.length === 0) {
      // Stranded on an island with no land bridge home — stay put instead of walking on water
      army.evacuatingHome = false;
      army.targetRegionId = null;
      army.targetX = null;
      army.targetY = null;
      army.waypoints = [];
      continue;
    }

    const wps = landPath
      .slice(1)
      .map((id): [number, number] => [
        state.regions[id].centroid[0],
        state.regions[id].centroid[1],
      ]);
    const homeId = landPath[landPath.length - 1];
    const home = state.regions[homeId];
    if (wps.length === 0) {
      wps.push([home.centroid[0], home.centroid[1]]);
    }
    army.evacuatingHome = true;
    army.targetRegionId = home.id;
    army.waypoints = wps;
    army.targetX = wps[0][0];
    army.targetY = wps[0][1];
  }
}

function triggerPlayerWarAlertIfAI(state: GameState, attackerId: string, targetId: string): void {
  const pid = state.playerCountryId;
  if (!pid || attackerId === pid || targetId !== pid) return;
  if (state.countries[attackerId]?.isPlayer) return;
  state.warAlertQueue ??= [];
  if (!state.warAlertQueue.includes(attackerId)) {
    state.warAlertQueue.push(attackerId);
  }
  setGameSpeed(state, 0);
  setAutoPauseReason(state, 'war_alert', true);
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

/** 1. Declare War (blocked during active Non-Aggression Pact; cancels Trade Agreement). */
export function declareWar(
  state: GameState,
  attackerId: string,
  defenderId: string,
): { ok: boolean; error?: string } {
  if (attackerId === defenderId) return { ok: false, error: 'Geçersiz hedef.' };
  const edge = getDiplomacyEdge(state, attackerId, defenderId);
  if (!edge) return { ok: false, error: 'İlişki bulunamadı.' };
  if (edge.status === 'war') return { ok: false, error: 'Zaten savaş halindesiniz.' };
  if (isNonAggressionActive(state, attackerId, defenderId)) {
    const rem = getNonAggressionRemainingDays(state, attackerId, defenderId);
    return {
      ok: false,
      error: `Aktif Saldırmazlık Paktı var (${rem} gün kaldı) — savaş ilan edilemez!`,
    };
  }

  edge.status = 'war';
  edge.score = -85;
  edge.tradeAgreement = false;
  edge.peaceTreaty = false;
  edge.nonAggressionUntilDay = 0;

  const atkName = state.countries[attackerId]?.name ?? attackerId;
  const defName = state.countries[defenderId]?.name ?? defenderId;
  const pid = state.playerCountryId;
  if (attackerId === pid || defenderId === pid) {
    pushImportantToast(state, `⚔️ Savaş İlanı: ${atkName} → ${defName}!`, 'war');
  }
  triggerPlayerWarAlertIfAI(state, attackerId, defenderId);

  // Stop home-evacuation for armies now inside a newly declared war enemy's territory so they fight/capture immediately
  for (const army of Object.values(state.armies)) {
    if (!army.evacuatingHome) continue;
    const cur = state.regions[army.currentRegionId];
    if (cur && canArmyEnterCountryTerritory(state, army.countryId, cur.ownerId)) {
      army.evacuatingHome = false;
      army.targetX = null;
      army.targetY = null;
      army.targetRegionId = null;
      army.waypoints = [];
    }
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
        allyEdge.tradeAgreement = false;
        allyEdge.peaceTreaty = false;
        allyEdge.nonAggressionUntilDay = 0;
        if (attackerId === pid || otherId === pid) {
          pushImportantToast(
            state,
            `⚔️ Müttefik Savaşa Katıldı: ${state.countries[otherId].name}!`,
            'war',
          );
        }
        triggerPlayerWarAlertIfAI(state, attackerId, otherId);
      }
    }
  }

  return { ok: true };
}

/** 2. Propose Alliance (with neutral countries). */
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
    edge.score = Math.min(100, Math.max(65, edge.score + 50));
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

/** 3. Break Alliance (leave alliance with heavy relation penalty). */
export function breakAlliance(
  state: GameState,
  fromId: string,
  toId: string,
): { ok: boolean; error?: string } {
  if (fromId === toId) return { ok: false, error: 'Geçersiz hedef.' };
  const edge = getDiplomacyEdge(state, fromId, toId);
  if (!edge || edge.status !== 'allied') {
    return { ok: false, error: 'Bu ülkeyle aktif bir ittifakınız yok.' };
  }

  edge.status = 'neutral';
  edge.score = Math.max(-100, edge.score - DIPLOMACY_CONFIG.BREAK_ALLIANCE_PENALTY);
  edge.tradeAgreement = false;
  evacuateStrandedArmies(state);

  const pid = state.playerCountryId;
  if (fromId === pid || toId === pid) {
    pushImportantToast(
      state,
      `💥 İttifak Bozuldu: ${state.countries[fromId]?.name} & ${state.countries[toId]?.name}`,
      'info',
    );
  }
  return { ok: true };
}

/** 4. Propose Peace (with countries at war). */
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
    const thresh = target.personality === 'aggressive' ? 1.15 : 0.75;
    accepted = fromPower / Math.max(10, toPower) >= thresh;
  }

  if (accepted) {
    edge.status = 'neutral';
    edge.peaceTreaty = true;
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
    evacuateStrandedArmies(state);
  }

  return { ok: true, accepted };
}

/** 5. Send Diplomatic Gift (-150 money -> +25 relation score, short cooldown). */
export function sendDiplomaticGift(
  state: GameState,
  fromId: string,
  toId: string,
): { ok: boolean; newScore?: number; error?: string } {
  if (fromId === toId) return { ok: false, error: 'Geçersiz hedef.' };
  const sender = state.countries[fromId];
  const receiver = state.countries[toId];
  const edge = getDiplomacyEdge(state, fromId, toId);
  if (!sender || !receiver || receiver.eliminated || !edge) {
    return { ok: false, error: 'Geçersiz ülke.' };
  }
  if (edge.status === 'war') {
    return { ok: false, error: 'Savaştaki ülkeye hediye gönderilemez.' };
  }
  if (sender.money < DIPLOMACY_CONFIG.GIFT_COST) {
    return { ok: false, error: `Yetersiz para (${DIPLOMACY_CONFIG.GIFT_COST} 💰 gerekli).` };
  }

  edge.lastGiftDayByCountry ??= {};
  const lastDay = edge.lastGiftDayByCountry[fromId];
  if (lastDay !== undefined && state.simDaysElapsed - lastDay < DIPLOMACY_CONFIG.GIFT_COOLDOWN_DAYS) {
    const waitDays = Math.ceil(
      DIPLOMACY_CONFIG.GIFT_COOLDOWN_DAYS - (state.simDaysElapsed - lastDay),
    );
    return { ok: false, error: `Yeni hediye için ${waitDays} oyun günü bekleyin.` };
  }

  sender.money -= DIPLOMACY_CONFIG.GIFT_COST;
  receiver.money += DIPLOMACY_CONFIG.GIFT_COST;
  edge.score = Math.min(100, edge.score + DIPLOMACY_CONFIG.GIFT_SCORE_BONUS);
  edge.lastGiftDayByCountry[fromId] = state.simDaysElapsed;

  return { ok: true, newScore: edge.score };
}

/** 6. Propose Non-Aggression Pact (365 days mutual war-declaration block). */
export function proposeNonAggressionPact(
  state: GameState,
  fromId: string,
  toId: string,
  forceAccept = false,
): { ok: boolean; accepted: boolean; error?: string } {
  if (fromId === toId) return { ok: false, accepted: false, error: 'Geçersiz hedef.' };
  const edge = getDiplomacyEdge(state, fromId, toId);
  const target = state.countries[toId];
  if (!edge || !target || target.eliminated) {
    return { ok: false, accepted: false, error: 'Geçersiz ülke.' };
  }
  if (edge.status === 'war') {
    return { ok: false, accepted: false, error: 'Savaştaki ülkeyle Saldırmazlık Paktı yapılamaz.' };
  }
  if (isNonAggressionActive(state, fromId, toId)) {
    return { ok: false, accepted: true, error: 'Zaten aktif bir Saldırmazlık Paktı var.' };
  }

  let accepted = forceAccept;
  if (!forceAccept) {
    const fromPower = estimateCountryMilitaryPower(state, fromId);
    const toPower = estimateCountryMilitaryPower(state, toId);
    const ratio = fromPower / Math.max(10, toPower);
    const pBonus =
      target.personality === 'diplomat' || target.personality === 'economist'
        ? 0.35
        : target.personality === 'aggressive'
          ? -0.2
          : 0.15;
    accepted = ratio + pBonus + edge.score / 150 >= 0.55;
  }

  if (accepted) {
    edge.nonAggressionUntilDay = state.simDaysElapsed + DIPLOMACY_CONFIG.NON_AGGRESSION_DAYS;
    edge.score = Math.min(100, edge.score + 15);
    const pid = state.playerCountryId;
    if (fromId === pid || toId === pid) {
      pushImportantToast(
        state,
        `🛡️ Saldırmazlık Paktı (1 Yıl): ${state.countries[fromId]?.name} & ${target.name}`,
        'info',
      );
    }
  } else {
    edge.score = Math.max(-100, edge.score - 3);
  }

  return { ok: true, accepted };
}

/** 7. Propose Trade Agreement (+10% income per 5s tick to both sides; auto-cancelled on war). */
export function proposeTradeAgreement(
  state: GameState,
  fromId: string,
  toId: string,
  forceAccept = false,
): { ok: boolean; accepted: boolean; error?: string } {
  if (fromId === toId) return { ok: false, accepted: false, error: 'Geçersiz hedef.' };
  const edge = getDiplomacyEdge(state, fromId, toId);
  const target = state.countries[toId];
  if (!edge || !target || target.eliminated) {
    return { ok: false, accepted: false, error: 'Geçersiz ülke.' };
  }
  if (edge.status === 'war') {
    return { ok: false, accepted: false, error: 'Savaştaki ülkeyle Ticaret Anlaşması yapılamaz.' };
  }
  if (edge.tradeAgreement) {
    return { ok: false, accepted: true, error: 'Zaten aktif bir Ticaret Anlaşması var.' };
  }

  let accepted = forceAccept;
  if (!forceAccept) {
    if (edge.status === 'allied') {
      accepted = true;
    } else {
      const pBonus =
        target.personality === 'economist' || target.personality === 'diplomat'
          ? 25
          : target.personality === 'aggressive'
            ? -15
            : 5;
      accepted = edge.score + pBonus >= -5;
    }
  }

  if (accepted) {
    edge.tradeAgreement = true;
    edge.score = Math.min(100, edge.score + 15);
    const pid = state.playerCountryId;
    if (fromId === pid || toId === pid) {
      pushImportantToast(
        state,
        `💰 Ticaret Anlaşması (+%10 Gelir): ${state.countries[fromId]?.name} & ${target.name}`,
        'info',
      );
    }
  } else {
    edge.score = Math.max(-100, edge.score - 3);
  }

  return { ok: true, accepted };
}

export function getCountryAlliesAndWars(
  state: GameState,
  countryId: string,
): { allies: string[]; wars: string[]; tradePartners: string[] } {
  const allies: string[] = [];
  const wars: string[] = [];
  const tradePartners: string[] = [];
  for (const otherId of Object.keys(state.countries)) {
    if (otherId === countryId || state.countries[otherId]?.eliminated) continue;
    const edge = getDiplomacyEdge(state, countryId, otherId);
    if (!edge) continue;
    if (edge.status === 'allied') allies.push(otherId);
    else if (edge.status === 'war') wars.push(otherId);
    if (edge.tradeAgreement && edge.status !== 'war') tradePartners.push(otherId);
  }
  return { allies, wars, tradePartners };
}
