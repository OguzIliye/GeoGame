import type { Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import rawTopoJson from '../public/assets/world-50m.json';
import { CALENDAR } from '../src/config/balance';
import { formatKeyCodeLabel, KeyBindingsManager } from '../src/config/keybindings';
import { parseWorldTopology } from '../src/map/worldLoader';
import {
  advanceClock,
  formatSimDate,
  isAutoPaused,
  isEffectivelyPaused,
  setAutoPauseReason,
  setGameSpeed,
  togglePauseSpace,
} from '../src/sim/calendar';
import {
  getCountryRegions,
  startBuildingConstruction,
  validateBuildingPlacementAtPoint,
} from '../src/sim/economy';
import { createInitialGameState, startGameWithCountry } from '../src/state/gameStore';

const worldCountries = parseWorldTopology(rawTopoJson as unknown as Topology);
const turkey = worldCountries.find((c) => c.name === 'Turkey')!;
const baseTurkeyState = createInitialGameState();
startGameWithCountry(baseTurkeyState, turkey.id, worldCountries);

describe('v1.1 Aşama 1 — Takvim (0.25 gün/sn, 4 Saat), Auto-Pause, Manuel Bina (x,y) & KeyBindings', () => {
  it('oyunu main_menu fazında başlatır ve 1x hızda 1 sn = 0.25 gün (~4 saat = 2000->2010) olarak yürütür', () => {
    const fresh = createInitialGameState();
    expect(fresh.phase).toBe('main_menu');

    const state = structuredClone(baseTurkeyState);
    expect(CALENDAR.DAYS_PER_SIM_SECOND).toBe(0.25);
    expect(CALENDAR.TOTAL_DAYS).toBe(3650);

    // 4 gerçek saniye = tam 1 oyun günü
    advanceClock(state, 4);
    expect(state.simDaysElapsed).toBe(1);
    expect(formatSimDate(state.simDaysElapsed)).toBe('2 Oca 2000');

    // ~4 saat (14600 sn) sonunda 1 Ocak 2010'a ulaşır
    advanceClock(state, 14596);
    expect(formatSimDate(state.simDaysElapsed)).toBe('1 Oca 2010');
  });

  it('bina yerleştirme / eylem anında oyunu otomatik duraklatır ve manuel duraklatmayı ezmeden eski hıza döner', () => {
    const state = structuredClone(baseTurkeyState);
    setGameSpeed(state, 2);

    // Eylem başlar -> Auto-Pause aktif -> zaman akmaz ama state.speed (2x) korunur
    setAutoPauseReason(state, 'building_placement', true);
    expect(isAutoPaused(state)).toBe(true);
    expect(isEffectivelyPaused(state)).toBe(true);
    expect(advanceClock(state, 5)).toBe(0);

    // Eylem biter -> otomatik olarak 2x hızdan devam eder
    setAutoPauseReason(state, 'building_placement', false);
    expect(isAutoPaused(state)).toBe(false);
    expect(advanceClock(state, 2)).toBe(4);

    // Oyuncu önceden Space ile manuel durdurmuşsa, eylem bitince oyun duraklatılmış kalır
    togglePauseSpace(state);
    expect(state.speed).toBe(0);
    setAutoPauseReason(state, 'encounter', true);
    setAutoPauseReason(state, 'encounter', false);
    expect(state.speed).toBe(0);
    expect(advanceClock(state, 4)).toBe(0);
  });

  it('fareyle seçilen özel (x,y) noktasına bina kurar, geçersiz noktaları reddeder ve bina altındaki çevre öğelerini temizler', () => {
    const state = structuredClone(baseTurkeyState);
    const pid = turkey.id;
    state.countries[pid].money = 1000;

    const emptyReg = getCountryRegions(state, pid).find((r) => !r.building)!;
    const customPt: [number, number] = [emptyReg.centroid[0] + 0.04, emptyReg.centroid[1] - 0.03];

    // Binanın tam altına bir ağaç prop'u ekle -> inşa edilince temizlenmeli
    emptyReg.props.push({ kind: 'tree', x: customPt[0] + 0.05, y: customPt[1], variant: 0 });

    const validCheck = validateBuildingPlacementAtPoint(state, pid, 'factory', customPt);
    expect(validCheck.ok).toBe(true);
    expect(validCheck.region?.id).toBe(emptyReg.id);

    const buildRes = startBuildingConstruction(state, pid, emptyReg.id, 'factory', customPt);
    expect(buildRes.ok).toBe(true);
    expect(emptyReg.building?.x).toBeCloseTo(customPt[0]);
    expect(emptyReg.building?.y).toBeCloseTo(customPt[1]);
    expect(
      emptyReg.props.some((p) => Math.hypot(p.x - customPt[0], p.y - customPt[1]) < 0.2),
    ).toBe(false);

    // Aynı bölgeye 2. bina kurulamaz
    expect(validateBuildingPlacementAtPoint(state, pid, 'bank', customPt).ok).toBe(false);

    // Bölge sınırı dışındaki nokta reddedilir
    const otherEmpty = getCountryRegions(state, pid).find((r) => !r.building)!;
    expect(
      startBuildingConstruction(state, pid, otherEmpty.id, 'bank', [999, 999]).ok,
    ).toBe(false);
  });

  it('KeyBindings yöneticisinde Esc tuşunu engeller, çakışan tuşları takas eder ve tooltip metnini dinamik üretir', () => {
    const kb = new KeyBindingsManager();
    kb.resetDefaults();

    expect(kb.getCode('cycleArmy')).toBe('KeyQ');
    expect(kb.getDisplayLabel('togglePause')).toBe('Boşluk');
    expect(kb.getTooltipText('cycleArmy')).toContain('[Q]');

    // Esc yasak!
    const escRes = kb.bindKey('cycleArmy', 'Escape');
    expect(escRes.ok).toBe(false);
    expect(kb.getCode('cycleArmy')).toBe('KeyQ');

    // Çakışan tuş (KeyB -> openBuildings) seçildiğinde otomatik takas yapar
    const swapRes = kb.bindKey('cycleArmy', 'KeyB');
    expect(swapRes.ok).toBe(true);
    expect(swapRes.swappedWith).toBe('openBuildings');
    expect(kb.getCode('cycleArmy')).toBe('KeyB');
    expect(kb.getCode('openBuildings')).toBe('KeyQ');
    expect(kb.getTooltipText('cycleArmy')).toContain('[B]');

    // Varsayılanlara sıfırlama
    kb.resetDefaults();
    expect(kb.getCode('cycleArmy')).toBe('KeyQ');
    expect(formatKeyCodeLabel('Digit2')).toBe('2');
  });
});
