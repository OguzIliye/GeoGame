import type { Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import rawTopoJson from '../public/assets/world-50m.json';
import { parseWorldTopology } from '../src/map/worldLoader';
import { MapCamera } from '../src/render/camera';
import {
  cyclePlayerArmyFocus,
  orderArmyMoveToRegion,
  resolveEncounterChoice,
  splitArmyStack,
  tickArmiesCombatAndShips,
} from '../src/sim/army';
import { advanceClock, isAutoPaused } from '../src/sim/calendar';
import { declareWar, getRelationStatus } from '../src/sim/diplomacy';
import { getCountryRegions, spawnUnitsIntoCountryBarracks } from '../src/sim/economy';
import { createInitialGameState, startGameWithCountry } from '../src/state/gameStore';

const worldCountries = parseWorldTopology(rawTopoJson as unknown as Topology);
const turkey = worldCountries.find((c) => c.name === 'Turkey')!;
const baseTurkeyState = createInitialGameState();
startGameWithCountry(baseTurkeyState, turkey.id, worldCountries);

describe('v1.1 Aşama 2 — Uzun Mesafe Doğal Yürüyüş, Hedef Fethi, Karşılaşma (Encounter) & Ordu Zoom (Q)', () => {
  it('uzun mesafede hafif sağ/sol salınımlı rota üretir ve ara düşman bölgelerini es geçip yalnızca hedef bölgeyi fetheder', () => {
    const state = structuredClone(baseTurkeyState);
    const pid = turkey.id;
    const enemyId = Object.keys(state.countries).find(
      (id) => id !== pid && getCountryRegions(state, id).length >= 2,
    )!;
    declareWar(state, pid, enemyId);

    const enemyRegs = getCountryRegions(state, enemyId);
    const midReg = enemyRegs[0];
    const destReg = enemyRegs[enemyRegs.length - 1];

    const army = spawnUnitsIntoCountryBarracks(state, pid, 'ak:steel', 30)!;
    // Orduyu ara düşman bölgesinin yakınına koyup uzak hedef bölgeye gönder
    army.x = midReg.centroid[0] - 0.1;
    army.y = midReg.centroid[1] - 0.1;
    army.currentRegionId = midReg.id;

    // Uzak hedefe yürüyüş -> uzun mesafeyse hafif sağ/sol salınım ara noktaları oluşur
    const farPoint: [number, number] = [army.x + 4.5, army.y + 1.2];
    expect(orderArmyMoveToRegion(state, army.id, destReg.id, farPoint).ok).toBe(true);
    expect((army.waypoints?.length ?? 0)).toBeGreaterThan(1);

    // Yürürken ara düşman bölgesini (midReg) ele geçirmez!
    tickArmiesCombatAndShips(state, 1);
    expect(midReg.ownerId).toBe(enemyId);
    expect(midReg.capture).toBeNull();

    // Hedef noktayı destReg merkezine çekip varışı tamamla -> yalnızca varılan destReg fethedilir
    expect(orderArmyMoveToRegion(state, army.id, destReg.id).ok).toBe(true);
    for (let i = 0; i < 40; i++) {
      tickArmiesCombatAndShips(state, 1);
    }
    expect(destReg.ownerId).toBe(pid);
    expect(midReg.ownerId).toBe(enemyId);
  });

  it('başka bir devletin ordusuyla karşılaşınca oyunu otomatik durdurur ve Savaş İlan Et / Dur kararlarını uygular', () => {
    const state = structuredClone(baseTurkeyState);
    const pid = turkey.id;
    const otherId = Object.keys(state.countries).find((id) => id !== pid)!;

    const myArmy = spawnUnitsIntoCountryBarracks(state, pid, 'spear:bronze', 20)!;
    const otherArmy = spawnUnitsIntoCountryBarracks(state, otherId, 'sword:wood', 15)!;

    // İki ordu karşılaşma mesafesine (<= 1.05) girer
    otherArmy.x = myArmy.x + 0.85;
    otherArmy.y = myArmy.y;

    tickArmiesCombatAndShips(state, 0.2);

    // Karşılaşma popup'ı açılır ve oyun otomatik durur!
    expect(state.activeEncounter).not.toBeNull();
    expect(state.activeEncounter?.otherCountryId).toBe(otherId);
    expect(state.activeEncounter?.relation).toBe('neutral');
    expect(isAutoPaused(state)).toBe(true);
    expect(advanceClock(state, 5)).toBe(0);

    // 1. Oyuncu "Dur / Geri Çekil" derse -> savaş çıkmaz, otomatik duraklatma kalkar ve spam yapmaz
    expect(resolveEncounterChoice(state, 'stand_down').ok).toBe(true);
    expect(state.activeEncounter).toBeNull();
    expect(isAutoPaused(state)).toBe(false);
    expect(getRelationStatus(state, pid, otherId)).toBe('neutral');
    expect(myArmy.inCombatWithArmyId).toBeNull();

    // Tekrar yaklaştırıp yeni karşılaşmada "Savaş İlan Et ve Saldır" seç
    state.encounterCooldownUntilSimSec = {};
    otherArmy.x = myArmy.x + 0.8;
    otherArmy.y = myArmy.y;
    tickArmiesCombatAndShips(state, 0.2);
    expect(state.activeEncounter).not.toBeNull();

    expect(resolveEncounterChoice(state, 'declare_war_attack').ok).toBe(true);
    expect(getRelationStatus(state, pid, otherId)).toBe('war');
    expect(myArmy.inCombatWithArmyId).toBe(otherArmy.id);
    expect(isAutoPaused(state)).toBe(false);
  });

  it('Q / odaklanma komutuyla elimizdeki ordular arasında sırayla gezinir ve kamerayı yumuşakça zoomlar', () => {
    const state = structuredClone(baseTurkeyState);
    const pid = turkey.id;

    // Hiç ordu yokken ok: false döner
    expect(cyclePlayerArmyFocus(state).ok).toBe(false);

    const a1 = spawnUnitsIntoCountryBarracks(state, pid, 'sword:wood', 12)!;
    const split = splitArmyStack(state, a1.id, { 'sword:wood': 5 });
    expect(split.ok).toBe(true);
    const a2 = split.newArmy!;
    a2.x += 2.5;
    a2.y -= 1.5;

    const cam = new MapCamera();
    if (state.arena) cam.setBounds(state.arena, 1280, 720, true);
    const initialScale = cam.scale;

    const f1 = cyclePlayerArmyFocus(state, 1000);
    expect(f1.ok).toBe(true);
    expect(state.moveOrderMode).toBe(false); // Odaklanma yanlışlıkla hareket emri moduna sokmaz!
    expect(state.focusPing).not.toBeNull();

    cam.focusOnPoint(f1.target!.x, f1.target!.y);
    cam.update(0.5);
    expect(cam.scale).toBeGreaterThan(initialScale);

    const f2 = cyclePlayerArmyFocus(state, 1500);
    expect(f2.ok).toBe(true);
    expect(f2.target!.id).not.toBe(f1.target!.id);

    const f3 = cyclePlayerArmyFocus(state, 2000);
    expect(f3.target!.id).toBe(f1.target!.id);
  });
});
