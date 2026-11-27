import type { Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import rawTopoJson from '../public/assets/world-50m.json';
import { SIM_TIME_SCALE, simSecToRealSec } from '../src/config/balance';
import { parseWorldTopology } from '../src/map/worldLoader';
import { MapCamera } from '../src/render/camera';
import { renderRegionalTheater } from '../src/render/mapRenderer';
import {
  coalesceWoundedByCountry,
  getTotalSoldiers,
  orderArmyAttackEnemyArmy,
  tickArmiesCombatAndShips,
} from '../src/sim/army';
import { advanceClock } from '../src/sim/calendar';
import { declareWar } from '../src/sim/diplomacy';
import {
  getCountryRegions,
  spawnUnitsIntoCountryBarracks,
  tickEconomyAndQueues,
} from '../src/sim/economy';
import { createInitialGameState, startGameWithCountry } from '../src/state/gameStore';

const worldCountries = parseWorldTopology(rawTopoJson as unknown as Topology);
const turkey = worldCountries.find((c) => c.name === 'Turkey')!;
const baseState = createInitialGameState();
startGameWithCountry(baseState, turkey.id, worldCountries);

describe('v1.3 Aşama 1 — 3x Yavaş Simülasyon Temposu (SIM_TIME_SCALE = 1/3) & Tek Yaralı Birliği', () => {
  it('SIM_TIME_SCALE = 1/3 ile tüm oyunu 3x yavaşlatır (15 gerçek sn gelir ticki) ve tutorial 3x hızda v1.2 temposunu korur', () => {
    const state = structuredClone(baseState);
    const pid = turkey.id;
    const p = state.countries[pid];

    expect(SIM_TIME_SCALE).toBeCloseTo(1 / 3, 6);
    expect(simSecToRealSec(5)).toBe(15);
    expect(simSecToRealSec(2)).toBe(6);
    expect(simSecToRealSec(15)).toBe(45);

    const startMoney = p.money;
    // 14 gerçek sn -> 4.66 sim sn (< 5 sim sn) -> gelir henüz yatmaz
    const dt1 = advanceClock(state, 14);
    tickEconomyAndQueues(state, dt1);
    expect(p.money).toBe(startMoney);

    // +1 gerçek sn (toplam 15 gerçek sn = 5 sim sn) -> +25 gelir yatar!
    const dt2 = advanceClock(state, 1);
    tickEconomyAndQueues(state, dt2);
    expect(p.money).toBe(startMoney + 25);

    // Tutorial sırasında speedMult = 3 ile 5 gerçek sn'de gelir yatar (v1.2 normal temposu)
    const dtTut = advanceClock(state, 5);
    tickEconomyAndQueues(state, dtTut, 3);
    expect(p.money).toBe(startMoney + 50);
  });

  it('çatışmadan çıkan tüm yaralıları ülke başına tek bir WoundedBatch olarak birleştirir ve haritada toplam sayı rozeti çizer', () => {
    const state = structuredClone(baseState);
    const pid = turkey.id;
    const enemyId = Object.keys(state.countries).find((id) => id !== pid)!;

    const myRegs = getCountryRegions(state, pid);
    const hospReg = myRegs.find((r) => !r.building)!;
    hospReg.building = {
      type: 'hospital',
      level: 1,
      constructing: false,
      progressSec: 0,
      totalSec: 0,
    };

    declareWar(state, pid, enemyId);
    const a1 = spawnUnitsIntoCountryBarracks(state, pid, 'sword:wood', 20, myRegs[0].id)!;
    const a2 = spawnUnitsIntoCountryBarracks(state, pid, 'spear:wood', 20, myRegs[1].id)!;
    const e1 = spawnUnitsIntoCountryBarracks(state, enemyId, 'ak:steel', 18)!;
    const e2 = spawnUnitsIntoCountryBarracks(state, enemyId, 'ak:steel', 18)!;

    e1.x = a1.x + 0.08;
    e1.y = a1.y;
    e2.x = a2.x + 0.08;
    e2.y = a2.y;
    orderArmyAttackEnemyArmy(state, a1.id, e1.id);
    orderArmyAttackEnemyArmy(state, a2.id, e2.id);

    // İki ayrı cephede çoklu çatışma tick'i -> tüm yaralılar tek 1 grupta toplanmalı!
    for (let i = 0; i < 6; i++) {
      tickArmiesCombatAndShips(state, 0.5);
    }

    const myWounded = state.wounded.filter((w) => w.countryId === pid);
    expect(myWounded.length).toBe(1);
    const totalW = getTotalSoldiers(myWounded[0].units);
    expect(totalW).toBeGreaterThan(1);

    // Manuel eklenen ekstra grup bile coalesceWoundedByCountry ile birleşir
    state.wounded.push({
      id: 'extra_w',
      countryId: pid,
      units: { 'sword:wood': 3 },
      from: [a1.x, a1.y],
      toRegionId: hospReg.id,
      to: [...hospReg.centroid],
      travelProgress: 0.3,
      healElapsedSec: 0,
      healRequiredSec: 8,
    });
    coalesceWoundedByCountry(state);
    expect(state.wounded.filter((w) => w.countryId === pid).length).toBe(1);
    expect(getTotalSoldiers(state.wounded.find((w) => w.countryId === pid)!.units)).toBe(totalW + 3);

    // Harita çiziminde yürüyen yaralı birliğinin toplam sayı rozeti ("🩹 X") çizilmeli
    const texts: string[] = [];
    const ctx = {
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      globalAlpha: 1,
      lineDashOffset: 0,
      font: '',
      textAlign: 'center',
      textBaseline: 'middle',
      imageSmoothingEnabled: false,
      save: () => {},
      restore: () => {},
      translate: () => {},
      scale: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      arc: () => {},
      setLineDash: () => {},
      fillText: (t: string) => texts.push(t),
      measureText: (t: string) => ({ width: t.length * 7 }),
    } as unknown as CanvasRenderingContext2D;
    const cam = new MapCamera();
    if (state.arena) cam.setBounds(state.arena, 1280, 720, true);
    renderRegionalTheater(ctx, state, cam, 1280, 720, 100);
    expect(texts.some((t) => t.startsWith('🩹 '))).toBe(true);
  });
});
