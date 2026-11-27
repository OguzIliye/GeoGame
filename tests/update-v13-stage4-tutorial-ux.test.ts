import type { Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import rawTopoJson from '../public/assets/world-50m.json';
import { RetroMusicController } from '../src/audio/music';
import { KeyBindingsManager } from '../src/config/keybindings';
import { parseWorldTopology } from '../src/map/worldLoader';
import { MapCamera } from '../src/render/camera';
import { isAutoPaused } from '../src/sim/calendar';
import {
  getCountryRegions,
  queueFactoryParallelBatch,
  startBuildingConstruction,
  tickEconomyAndQueues,
} from '../src/sim/economy';
import { createInitialGameState, startGameWithCountry } from '../src/state/gameStore';
import { SpotlightTutorialController } from '../src/ui/spotlightTutorial';
import { GameUIController } from '../src/ui/windows';

const worldCountries = parseWorldTopology(rawTopoJson as unknown as Topology);
const turkey = worldCountries.find((c) => c.name === 'Turkey')!;
const baseState = createInitialGameState();
startGameWithCountry(baseState, turkey.id, worldCountries);

describe('v1.3 Aşama 4 — Tutorial Gizle/Aç (Sağ Üst Buton) & Fabrika/Kışla Alt-Hedefli Spotlight', () => {
  it('— Gizle ile spotlight maskesini kapatıp sağ üstte 📖 Tutorial Görevi (Adım X/11) gösterir ve geri açılınca kaldığı adımdan devam eder', () => {
    const state = structuredClone(baseState);
    const pid = turkey.id;
    const p = state.countries[pid];
    p.money = 1000;

    const spotHost = {
      id: 'spotlight-host',
      innerHTML: '',
      querySelector: () => null,
    };
    const root = {
      id: 'ui-layer',
      innerHTML: '',
      querySelector: () => null,
      querySelectorAll: () => [],
      contains: () => false,
    };

    const inputs: Record<string, { value: string }> = {
      weapon_sword: { value: '0' },
      shield_wood: { value: '0' },
      barracks_qty: { value: '5' },
      bar_w: { value: '0' },
      bar_s: { value: '0' },
    };

    const prevWin = (globalThis as Record<string, unknown>).window;
    const prevDoc = (globalThis as Record<string, unknown>).document;
    (globalThis as Record<string, unknown>).window = {
      innerWidth: 1440,
      innerHeight: 900,
      addEventListener: () => {},
    };
    (globalThis as Record<string, unknown>).document = {
      body: { appendChild: () => {}, contains: () => false },
      createElement: () => ({ id: '', className: '', style: {} }),
      getElementById: (id: string) => (id === 'spotlight-host' ? spotHost : null),
      querySelector: (sel: string) => {
        if (sel === '#barracks-soldier-qty') return inputs.barracks_qty;
        return null;
      },
      querySelectorAll: (sel: string) => {
        if (sel === '.factory-eq-input[data-fac-cat="weapon"]') return [inputs.weapon_sword];
        if (sel === '.factory-eq-input[data-fac-cat="shield"]') return [inputs.shield_wood];
        if (sel === '.barracks-eq-input[data-eq-cat="weapon"]') return [inputs.bar_w];
        if (sel === '.barracks-eq-input[data-eq-cat="shield"]') return [inputs.bar_s];
        return [];
      },
    };

    try {
      const cam = new MapCamera();
      if (state.arena) cam.setBounds(state.arena, 1440, 900, true);
      const ui = new GameUIController(
        root as unknown as HTMLDivElement,
        state,
        new RetroMusicController(),
        new KeyBindingsManager(),
        {
          onStartWorldSelect: () => {},
          onReturnToWorld: () => {},
          onReturnToMainMenu: () => {},
          onSaveAndExitToMain: () => {},
          onSaveAndExitToWorld: () => {},
          onLoadSlotFromMenu: () => {},
          onCycleArmyFocus: () => {},
          onEnterBuildingPlacement: () => {},
          onCancelPlacementOrOrder: () => {},
        },
      );

      const tutorial = new SpotlightTutorialController(state, cam, ui, {
        onFinishFreshRestart: () => {},
        onFinishKeepPlaying: () => {},
      });

      tutorial.start();
      expect(tutorial.stage).toBe('1_goal');
      expect(spotHost.innerHTML).toContain('btn-hide-spotlight-tutorial');
      expect(isAutoPaused(state)).toBe(true);

      // 1) Gizle -> maske ve auto-pause kalkar, sağ üstte 📖 Tutorial Görevi (Adım 1/11) butonu oluşur!
      tutorial.hide();
      expect(tutorial.hidden).toBe(true);
      expect(tutorial.isActive).toBe(true);
      expect(isAutoPaused(state)).toBe(false);
      expect(spotHost.innerHTML).toContain('btn-restore-tutorial-task');
      expect(spotHost.innerHTML).toContain('📖 Tutorial Görevi (Adım 1/11)');
      expect(spotHost.innerHTML).not.toContain('tut-spot-mask');

      // 2) Geri Aç -> kaldığı adımdan tekrar açılır!
      tutorial.show();
      expect(tutorial.hidden).toBe(false);
      expect(isAutoPaused(state)).toBe(true);
      expect(spotHost.innerHTML).toContain('tut-spot-mask');

      // 3) Fabrika alt-hedef sırası: Kılıç +5 -> Tahta Kalkan +5 -> Üretimi Başlat -> Kapat & İzle
      const emptyRegs = getCountryRegions(state, pid).filter((r) => !r.building);
      const facReg = emptyRegs[0];
      const barReg = emptyRegs[1];
      startBuildingConstruction(state, pid, facReg.id, 'factory');
      startBuildingConstruction(state, pid, barReg.id, 'barracks');
      tickEconomyAndQueues(state, 8);

      ui.activeWindow = 'factory';
      (tutorial as unknown as { setStage: (s: string) => void }).setStage('3_order_equip');
      expect(spotHost.innerHTML).toContain('1/3 — Kılıç Sayısını Arttır (+5)');

      inputs.weapon_sword.value = '5';
      tutorial.syncFrame();
      expect(spotHost.innerHTML).toContain('2/3 — Tahta Kalkan Seç (+5)');

      inputs.shield_wood.value = '5';
      tutorial.syncFrame();
      expect(spotHost.innerHTML).toContain('3/3 — Üretimi Başlat!');

      queueFactoryParallelBatch(state, pid, facReg.id, [
        { category: 'weapon', itemId: 'sword', count: 5 },
        { category: 'shield', itemId: 'wood', count: 5 },
      ]);
      inputs.weapon_sword.value = '0';
      inputs.shield_wood.value = '0';
      tutorial.syncFrame();
      expect(spotHost.innerHTML).toContain('Paralel Hatlar Hazır — Kapat & İzle');

      // Üretimi tamamla ve Kışla alt-hedef sırasını doğrula: Asker MAX -> Kılıç MAX -> Kalkan MAX -> Asker Yetiştir
      ui.activeWindow = null;
      tickEconomyAndQueues(state, 12);
      ui.activeWindow = 'barracks';
      (tutorial as unknown as { setStage: (s: string) => void }).setStage('4_train_soldiers');
      expect(spotHost.innerHTML).toContain('1/4 — Asker Sayısı: MAX');

      tutorial.barracksSoldierCountChosen = true;
      tutorial.syncFrame();
      expect(spotHost.innerHTML).toContain('2/4 — Silah Seçimi: Kılıç MAX');

      inputs.bar_w.value = '5';
      tutorial.syncFrame();
      expect(spotHost.innerHTML).toContain('3/4 — Kalkan Seçimi: Tahta Kalkan MAX');

      inputs.bar_s.value = '5';
      tutorial.syncFrame();
      expect(spotHost.innerHTML).toContain('4/4 — Asker Yetiştir!');
    } finally {
      (globalThis as Record<string, unknown>).window = prevWin;
      (globalThis as Record<string, unknown>).document = prevDoc;
    }
  });
});
