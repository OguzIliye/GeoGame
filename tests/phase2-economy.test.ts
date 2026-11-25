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
  startCombinedBuildingUpgrade,
  startTechResearch,
  tickEconomyAndQueues,
} from '../src/sim/economy';
import { createInitialGameState, startGameWithCountry } from '../src/state/gameStore';

const worldCountries = parseWorldTopology(rawTopoJson as unknown as Topology);

describe('Faz 2 — Zaman, Ekonomi, Binalar & Teknoloji', () => {
  it('takvimi 2000-2020 arası ilerletir, hız çarpanlarını ve Space durdur/başlat kuralını uygular', () => {
    const state = createInitialGameState();
    const turkey = worldCountries.find((c) => c.name === 'Turkey')!;
    startGameWithCountry(state, turkey.id, worldCountries);

    expect(formatSimDate(state.simDaysElapsed)).toBe('1 Oca 2000');

    // 2x hızda 1.5 gerçek saniye = 3 sim sn = 30 gün
    setGameSpeed(state, 2);
    const simDt = advanceClock(state, 1.5);
    expect(simDt).toBe(3);
    expect(state.simDaysElapsed).toBe(30);

    // Space ile durdur -> önceki hızı hatırla
    togglePauseSpace(state);
    expect(state.speed).toBe(0);
    expect(advanceClock(state, 5)).toBe(0);

    togglePauseSpace(state);
    expect(state.speed).toBe(2);

    // 2020 tavanı
    advanceClock(state, 5000);
    expect(formatSimDate(state.simDaysElapsed)).toBe('1 Oca 2020');
  });

  it('bina kurallarını, kıyı Liman şartını ve tüm binalar yıkılsa bile soft-lock taban gelirini korur', () => {
    const state = createInitialGameState();
    const turkey = worldCountries.find((c) => c.name === 'Turkey')!;
    startGameWithCountry(state, turkey.id, worldCountries);
    const pid = turkey.id;
    const player = state.countries[pid];

    // Başlangıçta 1 Banka + 1 Kışla -> 5 taban + 12 banka = 17 para/sn
    expect(getCountryMoneyPerSec(state, pid)).toBe(17);
    expect(getCountryHealthPct(state, pid)).toBe(50);
    expect(getCountryManpowerPerSec(state, pid)).toBe(1);

    const owned = getCountryRegions(state, pid);
    const occupied = owned.find((r) => r.building !== null)!;
    // Aynı bölgeye 2. bina kurulamaz
    expect(startBuildingConstruction(state, pid, occupied.id, 'bank').ok).toBe(false);

    // Kara bölgesine Liman kurulamaz, kıyı bölgesine kurulabilir
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

    // Hastane kurulduğunda sağlık oranı ve manpower/s artar
    const emptyForHosp = owned.find((r) => !r.building)!;
    expect(startBuildingConstruction(state, pid, emptyForHosp.id, 'hospital').ok).toBe(true);
    tickEconomyAndQueues(state, 6.5);
    expect(getCountryHealthPct(state, pid)).toBe(65);
    expect(getCountryManpowerPerSec(state, pid)).toBe(3);

    // Tüm binalar yıkılsa bile soft-lock olmaz (+5 para/s, +1 manpower/s)
    for (const r of owned) r.building = null;
    expect(getCountryMoneyPerSec(state, pid)).toBe(5);
    expect(getCountryManpowerPerSec(state, pid)).toBe(1);
  });

  it('Üniversite araştırması, Fabrika üretimi ve Kışla asker eğitimini süre bazlı çalıştırır; sadece önemli olayda bildirim çıkarır', () => {
    const state = createInitialGameState();
    const turkey = worldCountries.find((c) => c.name === 'Turkey')!;
    startGameWithCountry(state, turkey.id, worldCountries);
    const pid = turkey.id;
    const player = state.countries[pid];
    player.money = 5000;
    player.manpower = 100;

    const emptyRegs = getCountryRegions(state, pid).filter((r) => !r.building);
    expect(startBuildingConstruction(state, pid, emptyRegs[0].id, 'university').ok).toBe(true);
    expect(startBuildingConstruction(state, pid, emptyRegs[1].id, 'factory').ok).toBe(true);
    tickEconomyAndQueues(state, 9); // Binalar tamamlanır

    // Üniversitede Mızrak araştırması -> bitince kritik bildirim (toast) çıkar
    expect(startTechResearch(state, pid, 'weapon').ok).toBe(true);
    tickEconomyAndQueues(state, 13);
    expect(player.unlockedWeapons).toContain('spear');
    expect(state.toasts.some((t) => t.kind === 'research')).toBe(true);

    const toastCountBeforeRoutine = state.toasts.length;

    // Fabrikada 5 Mızrak + 5 Tahta Kalkan üretimi (rutin -> toast üretmez)
    expect(queueFactoryProduction(state, pid, 'weapon', 'spear', 5).ok).toBe(true);
    expect(queueFactoryProduction(state, pid, 'shield', 'wood', 5).ok).toBe(true);
    tickEconomyAndQueues(state, 10);
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

  it('küçük ülkelerde Birleşik Bina yükseltmesini ve Tier 2 bilim başlangıcını destekler', () => {
    const state = createInitialGameState();
    const vatican = worldCountries.find((c) => c.name === 'Vatican')!;
    startGameWithCountry(state, vatican.id, worldCountries);
    const p = state.countries[vatican.id];
    p.money = 1000;

    expect(p.isSmallCountry).toBe(true);
    expect(p.unlockedWeapons).toEqual(['sword', 'spear']);
    expect(p.unlockedShields).toEqual(['wood', 'bronze']);

    const reg = getCountryRegions(state, vatican.id)[0];
    expect(reg.building?.type).toBe('combined');
    expect(reg.building?.level).toBe(1);

    // Tek birleşik binayla hem Fabrika hem Üniversite hem Kışla çalışır; ayrıca Lv.2 yükseltilebilir
    expect(startCombinedBuildingUpgrade(state, vatican.id, reg.id).ok).toBe(true);
    tickEconomyAndQueues(state, 7);
    expect(reg.building?.level).toBe(2);
    expect(reg.building?.constructing).toBe(false);
    expect(getCountryMoneyPerSec(state, vatican.id)).toBe(5 + 24);
  });
});
