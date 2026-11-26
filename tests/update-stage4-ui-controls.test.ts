import type { Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import rawTopoJson from '../public/assets/world-50m.json';
import { KEY_ACTION_SPECS, KeyBindingsManager } from '../src/config/keybindings';
import { parseWorldTopology } from '../src/map/worldLoader';
import {
  cancelSelectionAndOrderMode,
  resolveEncounterChoice,
  tickArmiesCombatAndShips,
} from '../src/sim/army';
import { isAutoPaused, setAutoPauseReason } from '../src/sim/calendar';
import { declareWar, getRelationStatus } from '../src/sim/diplomacy';
import { spawnUnitsIntoCountryBarracks } from '../src/sim/economy';
import { createInitialGameState, startGameWithCountry } from '../src/state/gameStore';

const worldCountries = parseWorldTopology(rawTopoJson as unknown as Topology);
const turkey = worldCountries.find((c) => c.name === 'Turkey')!;
const baseTurkeyState = createInitialGameState();
startGameWithCountry(baseTurkeyState, turkey.id, worldCountries);

describe('v1.1 Aşama 4 — Ana Ekran Akışı, Karşılaşma Diplomasi Sekmesi, Kısayol Bildirimi & Auto-Pause UX', () => {
  it('tüm 12 klavye eylemi için onChange dinleyicilerini tetikler ve dinamik hover notlarını anlık günceller', () => {
    const kb = new KeyBindingsManager();
    kb.resetDefaults();
    expect(KEY_ACTION_SPECS.length).toBe(12);

    let changeCount = 0;
    kb.onChange(() => {
      changeCount++;
    });

    expect(kb.getTooltipText('openScience')).toBe('Bilim Ağacı Penceresi — Kısayol: [T]');
    expect(kb.bindKey('openScience', 'KeyY').ok).toBe(true);
    expect(changeCount).toBe(1);
    expect(kb.getTooltipText('openScience')).toBe('Bilim Ağacı Penceresi — Kısayol: [Y]');

    kb.resetDefaults();
    expect(changeCount).toBe(2);
    expect(kb.getTooltipText('openScience')).toBe('Bilim Ağacı Penceresi — Kısayol: [T]');
  });

  it('ordu hedef seçme (moveOrderMode) ve oyun içi tutorial açılışında otomatik duraklatmayı yönetir', () => {
    const state = structuredClone(baseTurkeyState);
    expect(isAutoPaused(state)).toBe(false);

    state.moveOrderMode = true;
    setAutoPauseReason(state, 'move_order', true);
    expect(isAutoPaused(state)).toBe(true);

    cancelSelectionAndOrderMode(state);
    expect(state.moveOrderMode).toBe(false);
    expect(isAutoPaused(state)).toBe(false);

    setAutoPauseReason(state, 'tutorial', true);
    expect(isAutoPaused(state)).toBe(true);
    setAutoPauseReason(state, 'tutorial', false);
    expect(isAutoPaused(state)).toBe(false);
  });

  it('Karşılaşma popup ı içindeki Diplomasi sekmesinden savaş ilan edilince karşılaşma ilişkisini günceller ve saldırıya izin verir', () => {
    const state = structuredClone(baseTurkeyState);
    const pid = turkey.id;
    const otherId = Object.keys(state.countries).find((id) => id !== pid)!;

    const myArmy = spawnUnitsIntoCountryBarracks(state, pid, 'bazooka:forcefield', 12)!;
    const otherArmy = spawnUnitsIntoCountryBarracks(state, otherId, 'ak:steel', 10)!;
    otherArmy.x = myArmy.x + 0.75;
    otherArmy.y = myArmy.y;

    tickArmiesCombatAndShips(state, 0.2);
    expect(state.activeEncounter).not.toBeNull();
    expect(state.activeEncounter?.relation).toBe('neutral');

    // Popup içindeki Diplomasi sekmesine geçip savaş ilan et
    state.activeEncounter!.activeTab = 'diplomacy';
    declareWar(state, pid, otherId);
    state.activeEncounter!.relation = getRelationStatus(state, pid, otherId);
    expect(state.activeEncounter?.relation).toBe('war');

    // Tekrar Karşılaşma sekmesinden doğrudan Saldır seç -> çatışma başlar
    state.activeEncounter!.activeTab = 'encounter';
    expect(resolveEncounterChoice(state, 'attack').ok).toBe(true);
    expect(myArmy.inCombatWithArmyId).toBe(otherArmy.id);
    expect(isAutoPaused(state)).toBe(false);
  });
});
