import type { Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import rawTopoJson from '../public/assets/world-50m.json';
import { parseWorldTopology } from '../src/map/worldLoader';
import { advanceClock, formatSimDate, setGameSpeed, togglePauseSpace } from '../src/sim/calendar';
import {
  getCountryHealthPct,
  getCountryManpowerPerSec,
  getCountryMoneyPerSec,
  getCountryRegions,
  queueBarracksTraining,
  queueFactoryProduction,
  startBuildingConstruction,
  startTechResearch,
  tickEconomyAndQueues,
} from '../src/sim/economy';
import { createInitialGameState, startGameWithCountry } from '../src/state/gameStore';

const worldCountries = parseWorldTopology(rawTopoJson as unknown as Topology);
const turkey = worldCountries.find((c) => c.name === 'Turkey')!;
const baseTurkeyState = createInitialGameState();
startGameWithCountry(baseTurkeyState, turkey.id, worldCountries);

describe('Faz 2 — Zaman, Ekonomi, Binalar & Teknoloji', () => {
  it('takvimi 2000-2010 (~4 saat) arası ilerletir, hız çarpanlarını ve Space durdur/başlat kuralını uygular', () => {
    const state = structuredClone(baseTurkeyState);

    expect(formatSimDate(state.simDaysElapsed)).toBe('1 Oca 2000');

    setGameSpeed(state, 2);
    const simDt = advanceClock(state, 6);
    expect(simDt).toBeCloseTo(4, 5);
    expect(state.simDaysElapsed).toBeCloseTo(1, 5); // 4 sim sec * 0.25 day/sec = 1 in-game day

    togglePauseSpace(state);
    expect(state.speed).toBe(0);
    expect(advanceClock(state, 5)).toBe(0);

    togglePauseSpace(state);
    expect(state.speed).toBe(2);

    advanceClock(state, 30000);
    expect(formatSimDate(state.simDaysElapsed)).toBe('1 Oca 2010');
  });

  it('bina kurallarını, kıyı Liman şartını ve tüm binalar yıkılsa bile soft-lock taban gelirini korur', () => {
    const state = structuredClone(baseTurkeyState);
    const pid = turkey.id;
    const player = state.countries[pid];

    expect(getCountryMoneyPerSec(state, pid)).toBe(5);
    expect(getCountryHealthPct(state, pid)).toBe(50);
    expect(getCountryManpowerPerSec(state, pid)).toBe(1);

    const owned = getCountryRegions(state, pid);
    const occupied = owned.find((r) => r.building !== null)!;
    expect(occupied.building?.type).toBe('university');
    expect(startBuildingConstruction(state, pid, occupied.id, 'bank').ok).toBe(false);

    const inland = owned.find((r) => !r.isCoastal && !r.building);
    if (inland) {
      expect(startBuildingConstruction(state, pid, inland.id, 'port').ok).toBe(false);
    }

    const coastalEmpty = owned.find((r) => r.isCoastal && !r.building)!;
    expect(coastalEmpty).toBeDefined();
    player.money = 1000;
    expect(startBuildingConstruction(state, pid, coastalEmpty.id, 'port').ok).toBe(true);
    expect(coastalEmpty.building?.constructing).toBe(true);
    tickEconomyAndQueues(state, 7.5);
    expect(coastalEmpty.building?.constructing).toBe(false);
    expect(Object.values(state.ships).some((s) => s.homeRegionId === coastalEmpty.id)).toBe(true);

    const emptyForHosp = owned.find((r) => !r.building)!;
    expect(startBuildingConstruction(state, pid, emptyForHosp.id, 'hospital').ok).toBe(true);
    tickEconomyAndQueues(state, 6.5);
    expect(getCountryHealthPct(state, pid)).toBe(65);
    expect(getCountryManpowerPerSec(state, pid)).toBe(3);

    for (const r of owned) r.building = null;
    expect(getCountryMoneyPerSec(state, pid)).toBe(5);
    expect(getCountryManpowerPerSec(state, pid)).toBe(1);
  });

  it('Üniversite araştırması, Fabrika üretimi ve Kışla asker eğitimini süre bazlı çalıştırır; sadece önemli olayda bildirim çıkarır', () => {
    const state = structuredClone(baseTurkeyState);
    const pid = turkey.id;
    const player = state.countries[pid];
    player.money = 5000;
    player.manpower = 100;

    // Başlangıçta zaten 1 Üniversite var (MAX_UNIVERSITIES = 1); Fabrika ve Kışla kuralım
    const emptyRegs = getCountryRegions(state, pid).filter((r) => !r.building);
    expect(startBuildingConstruction(state, pid, emptyRegs[0].id, 'university').ok).toBe(false);
    expect(startBuildingConstruction(state, pid, emptyRegs[0].id, 'factory').ok).toBe(true);
    expect(startBuildingConstruction(state, pid, emptyRegs[1].id, 'barracks').ok).toBe(true);
    tickEconomyAndQueues(state, 9); // Binalar tamamlanır

    // Üniversitede Mızrak araştırması -> bitince kritik bildirim (toast) çıkar
    expect(startTechResearch(state, pid, 'weapon').ok).toBe(true);
    tickEconomyAndQueues(state, 13);
    expect(player.unlockedWeapons).toContain('spear');
    expect(state.toasts.some((t) => t.kind === 'research')).toBe(true);

    const toastCountBeforeRoutine = state.toasts.length;

    // Fabrikada paralel 5 Mızrak (4sn/ad = 20sn) + 5 Tahta Kalkan (2sn/ad = 10sn) üretimi (rutin -> toast üretmez)
    expect(queueFactoryProduction(state, pid, 'weapon', 'spear', 5).ok).toBe(true);
    expect(queueFactoryProduction(state, pid, 'shield', 'wood', 5).ok).toBe(true);
    tickEconomyAndQueues(state, 20.5);
    expect(player.weaponsStock.spear).toBe(5);
    expect(player.shieldsStock.wood).toBe(5);
    expect(state.toasts.length).toBe(toastCountBeforeRoutine);

    // Kışlada 5 Mızrak + Tahta Kalkanlı asker eğitimi (rutin -> toast üretmez)
    expect(queueBarracksTraining(state, pid, 'spear', 'wood', 5).ok).toBe(true);
    tickEconomyAndQueues(state, 3);
    const playerArmies = Object.values(state.armies).filter((a) => a.countryId === pid);
    expect(playerArmies.length).toBe(1);
    expect(playerArmies[0].units['spear:wood']).toBe(5);
    expect(state.toasts.length).toBe(toastCountBeforeRoutine);
  });

  it('kompakt bölge boyutuyla orta ölçekli ülkelerde (Yunanistan) çoklu bağımsız bina alanı sağlar', () => {
    const greece = worldCountries.find((c) => c.name === 'Greece')!;
    const state = createInitialGameState();
    startGameWithCountry(state, greece.id, worldCountries);
    const owned = getCountryRegions(state, greece.id);
    expect(owned.length).toBeGreaterThanOrEqual(6);
  });
});
