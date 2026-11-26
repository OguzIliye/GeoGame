import {
  getBuildingSpriteDataUri,
  getCountryFlagDataUri,
  getTechItemSpriteDataUri,
  getUnitSpriteDataUri,
} from '../art/pixelSprites';
import { RetroMusicController } from '../audio/music';
import {
  BUILDINGS,
  CALENDAR,
  DIPLOMACY_CONFIG,
  ECONOMY,
  LOAN_CONFIG,
  SHIELD_ORDER,
  SHIELDS,
  WEAPON_ORDER,
  WEAPONS,
} from '../config/balance';
import { type KeyActionId, KeyBindingsManager } from '../config/keybindings';
import {
  cancelSelectionAndOrderMode,
  computeArmyAverageStats,
  type EncounterChoice,
  formatUnitKeyLabel,
  getMergeableFriendlyArmies,
  getMaxTierVisualsForUnits,
  getNonZeroUnits,
  getTotalSoldiers,
  mergeArmies,
  orderArmiesMerge,
  parseUnitKey,
  resolveEncounterChoice,
  retreatFromCombat,
  splitArmyHalf,
  splitArmyStack,
} from '../sim/army';
import {
  formatSimDate,
  isAutoPaused,
  setAutoPauseReason,
  setGameSpeed,
} from '../sim/calendar';
import {
  breakAlliance,
  declareWar,
  getCountryAlliesAndWars,
  getDiplomacyEdge,
  getNonAggressionRemainingDays,
  getRelationStatus,
  isNonAggressionActive,
  proposeAlliance,
  proposeNonAggressionPact,
  proposePeace,
  proposeTradeAgreement,
  sendDiplomaticGift,
} from '../sim/diplomacy';
import {
  demolishBuilding,
  type FactoryBatchItemInput,
  getBarracksTrainingProgress,
  getCountryActiveProductionOrders,
  getCountryGrossIncomePerTick,
  getCountryHealthPct,
  getCountryManpowerPerSec,
  getCountryRegions,
  getEffectiveBuildingCount,
  getTotalBuildingCountIncludingConstructing,
  pushImportantToast,
  queueBarracksTrainingBatch,
  queueFactoryParallelBatch,
  repayBankLoan,
  startBuildingConstruction,
  startTechResearch,
  takeBankLoan,
} from '../sim/economy';
import { computeStandings } from '../sim/scoring';
import {
  deleteSlot,
  hasAnySavedSlot,
  listSaveSlots,
  type SaveSlotId,
} from '../state/saveManager';
import type {
  BuildingType,
  GameState,
  Point,
  Region,
  ShieldId,
  SpeedMultiplier,
  WeaponId,
} from '../types';

export type ActiveWindowId =
  | null
  | 'shop'
  | 'buildings'
  | 'bank'
  | 'university'
  | 'science'
  | 'hospital'
  | 'barracks'
  | 'factory'
  | 'port'
  | 'diplomacy'
  | 'army'
  | 'save_exit'
  | 'settings';

const BUILDING_POPUP_IDS = new Set<ActiveWindowId>([
  'bank',
  'university',
  'hospital',
  'barracks',
  'factory',
  'port',
]);

export interface QuickBuildTarget {
  regionId: string;
  point: Point;
  screenX: number;
  screenY: number;
}

export interface GameUICallbacks {
  onStartWorldSelect: (startTutorial?: boolean) => void;
  onReturnToWorld: () => void;
  onReturnToMainMenu: () => void;
  onSaveAndExitToMain: (slotId: SaveSlotId) => void;
  onSaveAndExitToWorld: (slotId: SaveSlotId) => void;
  onLoadSlotFromMenu: (slotId: SaveSlotId) => void;
  onCycleArmyFocus: () => void;
  onEnterBuildingPlacement: (type: BuildingType) => void;
  onCancelPlacementOrOrder: () => void;
  onSelectShipForOrder?: (shipId: string) => void;
  onRestartInteractiveTutorial?: () => void;
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildUnitHoverTooltip(unitKey: string, count: number): string {
  const { weapon, shield } = parseUnitKey(unitKey);
  const wSpec = WEAPONS[weapon];
  const sSpec = shield === 'none' ? null : SHIELDS[shield];
  const sText = sSpec ? `${sSpec.name} (Koruma: ${sSpec.defense})` : 'Kalkansız (Koruma: 0)';
  return `Birlik Sayısı: ${count} Asker\nSilah: ${wSpec.name} (Hasar: ${wSpec.damage})\nKalkan: ${sText}`;
}

function renderUnitIconCardHtml(
  unitKey: string,
  count: number,
  ownerColor: string,
  extraBottomHtml = '',
): string {
  const { weapon, shield } = parseUnitKey(unitKey);
  const uri = getUnitSpriteDataUri(weapon, shield, ownerColor);
  const tip = escapeAttr(buildUnitHoverTooltip(unitKey, count));
  const shortS = shield === 'none' ? 'Yok' : SHIELDS[shield].name.split(' ')[0];
  return `
    <div class="unit-icon-card" data-hover-tip="${tip}">
      <span class="unit-count-pill">×${count}</span>
      <img src="${uri}" alt="${escapeAttr(formatUnitKeyLabel(unitKey))}" />
      <div class="unit-mini-label">${WEAPONS[weapon].name} + ${shortS}</div>
      ${extraBottomHtml}
    </div>
  `;
}

export class GameUIController {
  activeWindow: ActiveWindowId = null;
  /** On Diplomacy popup: null = Page 1 (Countries Grid), string = Page 2 (Country Detail & 7 Actions) */
  diplomacyPageCountryId: string | null = null;
  selectedDiplomacyCountryId: string | null = null;
  listeningKeyAction: KeyActionId | null = null;
  tutorialOpen = false;
  tutorialStep = 0;
  continueModalOpen = false;
  quickBuildTarget: QuickBuildTarget | null = null;
  confirmDemolishRegionId: string | null = null;
  lastErrorMsg = '';
  closeButtonLockedByTutorial = false;

  private root: HTMLDivElement;
  private state: GameState;
  private music: RetroMusicController;
  private keyBindings: KeyBindingsManager;
  private callbacks: GameUICallbacks;
  private mountedPhase: string | null = null;
  private mountedEncounterKey: string | null = null;
  private mountedPromptOpen = false;
  private mountedContinueOpen = false;
  private lastHudMoneyFxId = '';
  private tooltipEl: HTMLDivElement;
  private currentHoverTarget: HTMLElement | null = null;

  constructor(
    root: HTMLDivElement,
    state: GameState,
    music: RetroMusicController,
    keyBindings: KeyBindingsManager,
    callbacks: GameUICallbacks,
  ) {
    this.root = root;
    this.state = state;
    this.music = music;
    this.keyBindings = keyBindings;
    this.callbacks = callbacks;

    this.tooltipEl = document.createElement('div');
    this.tooltipEl.id = 'pixel-tooltip';
    this.tooltipEl.className = 'pixel-tooltip';
    this.tooltipEl.style.display = 'none';
    document.body.appendChild(this.tooltipEl);

    this.setupTooltipDelegation();
    this.setupKeybindCaptureListener();

    this.keyBindings.onChange(() => {
      this.refreshKeyBadgesInDOM();
      if (this.currentHoverTarget) {
        this.updateTooltipContentForElement(this.currentHoverTarget);
      }
    });
  }

  private setupTooltipDelegation(): void {
    window.addEventListener('mouseover', (ev) => {
      const target = (ev.target as HTMLElement | null)?.closest<HTMLElement>(
        '[data-hover-tip], [data-key-action]',
      );
      if (!target || !this.root.contains(target)) {
        this.hideTooltip();
        return;
      }
      this.currentHoverTarget = target;
      this.updateTooltipContentForElement(target);
      this.positionTooltip(ev.clientX, ev.clientY);
    });

    window.addEventListener('mousemove', (ev) => {
      if (this.currentHoverTarget && this.tooltipEl.style.display !== 'none') {
        if (!document.body.contains(this.currentHoverTarget)) {
          this.hideTooltip();
          return;
        }
        this.positionTooltip(ev.clientX, ev.clientY);
      }
    });

    window.addEventListener('mousedown', () => {
      this.hideTooltip();
    });
  }

  private updateTooltipContentForElement(el: HTMLElement): void {
    const customTip = el.dataset.hoverTip;
    if (customTip) {
      this.tooltipEl.textContent = customTip;
      this.tooltipEl.style.display = 'block';
      return;
    }
    const action = el.dataset.keyAction as KeyActionId | undefined;
    if (action) {
      this.tooltipEl.textContent = this.keyBindings.getTooltipText(action);
      this.tooltipEl.style.display = 'block';
      return;
    }
    this.hideTooltip();
  }

  private positionTooltip(clientX: number, clientY: number): void {
    const pad = 14;
    const rect = this.tooltipEl.getBoundingClientRect();
    let left = clientX + pad;
    let top = clientY + pad;
    if (left + rect.width > window.innerWidth - 8) {
      left = Math.max(8, clientX - rect.width - pad);
    }
    if (top + rect.height > window.innerHeight - 8) {
      top = Math.max(8, clientY - rect.height - pad);
    }
    this.tooltipEl.style.left = `${Math.round(left)}px`;
    this.tooltipEl.style.top = `${Math.round(top)}px`;
  }

  hideTooltip(): void {
    this.currentHoverTarget = null;
    this.tooltipEl.style.display = 'none';
  }

  private setupKeybindCaptureListener(): void {
    window.addEventListener(
      'keydown',
      (ev) => {
        if (!this.listeningKeyAction) return;
        ev.preventDefault();
        ev.stopPropagation();
        const action = this.listeningKeyAction;
        this.listeningKeyAction = null;
        const res = this.keyBindings.bindKey(action, ev.code);
        this.lastErrorMsg = res.ok ? '' : res.error || 'Tuş atanamadı.';
        this.renderModal();
      },
      true,
    );
  }

  private refreshKeyBadgesInDOM(): void {
    const focusBtn = document.getElementById('btn-cycle-army');
    if (focusBtn) {
      focusBtn.textContent = `🎯 Ordum [${this.keyBindings.getDisplayLabel('cycleArmy')}]`;
    }
  }

  setQuickBuildTarget(target: QuickBuildTarget | null): void {
    this.quickBuildTarget = target;
    this.renderQuickBuildMenu();
  }

  openBuildingPopupForRegion(regionId: string): void {
    const reg = this.state.regions[regionId];
    if (!reg || !reg.building || reg.ownerId !== this.state.playerCountryId) return;
    this.quickBuildTarget = null;
    this.renderQuickBuildMenu();
    this.confirmDemolishRegionId = null;
    this.state.selectedRegionId = regionId;
    this.state.activeBuildingRegionId = regionId;
    this.openWindow(reg.building.type, false);
  }

  openTutorial(step = 0): void {
    this.tutorialOpen = true;
    this.tutorialStep = step;
    this.state.tutorialSeen = true;
    this.state.tutorialPromptOpen = false;
    if (this.state.phase === 'playing') {
      setAutoPauseReason(this.state, 'tutorial', true);
    }
    this.renderTutorialOverlay();
  }

  closeTutorial(): void {
    this.tutorialOpen = false;
    setAutoPauseReason(this.state, 'tutorial', false);
    const host = document.getElementById('tutorial-host');
    if (host) host.innerHTML = '';
    this.syncFrame();
  }

  toggleTutorial(): void {
    if (this.tutorialOpen) this.closeTutorial();
    else this.openTutorial(0);
  }

  openWindow(win: ActiveWindowId, toggle = true): void {
    if (win === null && this.closeButtonLockedByTutorial) {
      return;
    }
    this.listeningKeyAction = null;
    this.confirmDemolishRegionId = null;

    let normalized: ActiveWindowId = win;
    if (normalized === 'buildings') normalized = 'shop';
    if (normalized === 'science') normalized = 'university';

    const next = toggle && this.activeWindow === normalized ? null : normalized;

    // If opening a building popup via keyboard shortcut without activeBuildingRegionId, find first owned building of that type
    if (
      next &&
      BUILDING_POPUP_IDS.has(next) &&
      this.state.playerCountryId &&
      (!this.state.activeBuildingRegionId ||
        this.state.regions[this.state.activeBuildingRegionId]?.building?.type !== next)
    ) {
      const ownedMatch = getCountryRegions(this.state, this.state.playerCountryId).find(
        (r) => r.building?.type === next && !r.building.constructing,
      ) ??
        getCountryRegions(this.state, this.state.playerCountryId).find(
          (r) => r.building?.type === next,
        );
      if (!ownedMatch) {
        const bName = BUILDINGS[next as BuildingType]?.name ?? next;
        pushImportantToast(
          this.state,
          `Haritanızda henüz kurulu bir ${bName} bulunmuyor (Mağaza'dan kurabilirsiniz).`,
          'info',
        );
        return;
      }
      this.state.activeBuildingRegionId = ownedMatch.id;
      this.state.selectedRegionId = ownedMatch.id;
    }

    if (next !== null && this.state.placingBuildingType) {
      this.state.placingBuildingType = null;
      this.state.placementHoverPoint = null;
      setAutoPauseReason(this.state, 'building_placement', false);
    }

    if (next === 'diplomacy' && this.activeWindow !== 'diplomacy') {
      // Always start Diplomacy on Page 1 (Active Countries List)
      this.diplomacyPageCountryId = null;
    }

    this.quickBuildTarget = null;
    this.renderQuickBuildMenu();

    this.activeWindow = next;
    this.lastErrorMsg = '';
    this.hideTooltip();

    // Auto-pause rules for building popups & save_exit popup
    const isBldPopup = Boolean(next && BUILDING_POPUP_IDS.has(next));
    setAutoPauseReason(this.state, 'building_popup', isBldPopup);
    if (!isBldPopup) {
      this.state.activeBuildingRegionId = null;
    }
    setAutoPauseReason(this.state, 'save_exit', next === 'save_exit');

    this.renderModal();
    this.syncDockButtons();
  }

  forceRefresh(): void {
    this.mountedPhase = null;
    this.mountedEncounterKey = null;
    this.quickBuildTarget = null;
    this.confirmDemolishRegionId = null;
    this.hideTooltip();
    this.syncFrame();
    this.renderModal();
    if (this.tutorialOpen) this.renderTutorialOverlay();
  }

  syncFrame(): void {
    if (this.state.phase === 'main_menu') {
      if (
        this.mountedPhase !== 'main_menu' ||
        this.mountedPromptOpen !== this.state.tutorialPromptOpen ||
        this.mountedContinueOpen !== this.continueModalOpen
      ) {
        this.mountedPhase = 'main_menu';
        this.mountedPromptOpen = this.state.tutorialPromptOpen;
        this.mountedContinueOpen = this.continueModalOpen;
        this.activeWindow = null;
        this.mountMainMenu();
      }
      return;
    }

    if (this.state.phase === 'world_select') {
      if (this.mountedPhase !== 'world_select') {
        this.mountedPhase = 'world_select';
        this.activeWindow = null;
        this.mountWorldSelectBanner();
      }
      return;
    }

    if (this.state.phase === 'ended') {
      if (this.mountedPhase !== 'ended') {
        this.mountedPhase = 'ended';
        this.activeWindow = null;
        this.mountEndedScreen();
      }
      return;
    }

    if (this.mountedPhase !== 'playing') {
      this.mountedPhase = 'playing';
      this.mountPlayingShell();
    }

    this.updateLiveHUD();
    this.updateLiveOpsStrip();
    this.updateMultiArmyPanel();
    this.updateToasts();
    this.updateLiveProgressInsideModal();
    this.syncEncounterOverlay();
  }

  mountWorldSelectBanner(customHint?: string): void {
    const hintText = customHint ?? 'Başlamak için dünya haritasından bir ülkeye tıklayın';
    this.root.innerHTML = `
      <div class="pixel-panel top-banner" id="world-select-banner">
        <strong>PIXEL WORLD</strong>
        <span id="world-select-hint">${hintText}</span>
        <span id="world-hover-badge" class="badge" style="display:none"></span>
        <button class="pixel-btn" id="btn-back-main">← Ana Ekran</button>
      </div>
      <div id="tutorial-host"></div>
      <div id="spotlight-host"></div>
    `;
    document
      .getElementById('btn-back-main')
      ?.addEventListener('click', () => this.callbacks.onReturnToMainMenu());
    if (this.tutorialOpen) this.renderTutorialOverlay();
  }

  private mountMainMenu(): void {
    const anySaved = hasAnySavedSlot();
    const bankIcon = getBuildingSpriteDataUri('bank', '#3b82f6');

    const promptHtml = this.state.tutorialPromptOpen
      ? `
        <div class="tutorial-prompt-modal">
          <div class="pixel-panel modal-window" style="max-width:640px;text-align:center">
            <div class="modal-header" style="justify-content:center">
              <div class="popup-title-wrap">
                <img class="popup-header-icon" src="${bankIcon}" alt="" />
                <strong>📖 İnteraktif Tutorial Seçeneği</strong>
              </div>
            </div>
            <p style="margin:14px 0;line-height:1.65;font-size:16px">
              Oyuna başlamadan önce <b>Pixel World v1.2</b>'yi uygulamalı olarak öğreten kısa <b>Spotlight Tutorial</b> ile başlamak ister misiniz?
            </p>
            <hr class="popup-divider" />
            <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:14px">
              <button class="pixel-btn active-btn" id="btn-prompt-yes">📖 Evet, Tutorial'ı Aç</button>
              <button class="pixel-btn" id="btn-prompt-no">▶ Hayır, Direkt Haritaya Geç</button>
            </div>
          </div>
        </div>
      `
      : '';

    const continueHtml = this.continueModalOpen ? this.buildContinueModalHtml() : '';

    this.root.innerHTML = `
      <div class="main-menu-shell">
        <div class="pixel-panel main-menu-actions">
          <div class="muted" style="font-size:15px;color:#e2e8f0;text-align:center">
            Bölgesel Strateji • Ekonomi • Teknoloji • Savaş
          </div>
          <div class="main-menu-btn-row">
            <button class="pixel-btn hero-btn hero-btn-primary" id="btn-main-play">▶ Oyna</button>
            <button class="pixel-btn hero-btn hero-btn-continue" id="btn-main-continue" ${anySaved ? '' : 'disabled'}>▶ Continue</button>
            <button class="pixel-btn hero-btn" id="btn-main-tutorial">📖 Tutorial</button>
          </div>
        </div>
      </div>
      ${promptHtml}
      ${continueHtml}
      <div id="tutorial-host"></div>
      <div id="spotlight-host"></div>
    `;

    document.getElementById('btn-main-play')?.addEventListener('click', () => {
      if (!this.state.tutorialSeen) {
        this.state.tutorialPromptOpen = true;
        this.syncFrame();
      } else {
        this.callbacks.onStartWorldSelect(false);
      }
    });

    document.getElementById('btn-main-continue')?.addEventListener('click', () => {
      if (!hasAnySavedSlot()) return;
      this.continueModalOpen = true;
      this.syncFrame();
    });

    document.getElementById('btn-main-tutorial')?.addEventListener('click', () => {
      this.state.tutorialSeen = true;
      this.state.tutorialPromptOpen = false;
      this.callbacks.onStartWorldSelect(true);
    });

    document.getElementById('btn-prompt-yes')?.addEventListener('click', () => {
      this.state.tutorialSeen = true;
      this.state.tutorialPromptOpen = false;
      this.callbacks.onStartWorldSelect(true);
    });

    document.getElementById('btn-prompt-no')?.addEventListener('click', () => {
      this.state.tutorialSeen = true;
      this.state.tutorialPromptOpen = false;
      this.callbacks.onStartWorldSelect(false);
    });

    this.bindContinueModalEvents();
    if (this.tutorialOpen) this.renderTutorialOverlay();
  }

  private buildContinueModalHtml(): string {
    const slots = listSaveSlots();
    const headerFlag = getCountryFlagDataUri('#22c55e');
    return `
      <div class="tutorial-prompt-modal" id="continue-modal-overlay">
        <div class="pixel-panel modal-window" style="max-width:740px">
          <div class="modal-header">
            <div class="popup-title-wrap">
              <img class="popup-header-icon" src="${headerFlag}" alt="" />
              <strong>▶ Kayıtlı Oyuna Devam Et (3 Kayıt Slotu)</strong>
            </div>
            <button class="pixel-btn" id="btn-close-continue">✕</button>
          </div>
          <div class="divided-list">
            ${slots
              .map((s) => {
                if (s.empty) {
                  const emptyFlag = getCountryFlagDataUri('#475569');
                  return `
                    <div class="divided-item">
                      <div class="card-row" style="opacity:0.75">
                        <div style="display:flex;align-items:center;gap:12px">
                          <img class="popup-row-icon" src="${emptyFlag}" alt="" />
                          <div>
                            <strong>Slot ${s.slotId} — Boş Kayıt</strong>
                            <div class="muted">Bu yuvada kayıtlı oyun bulunmuyor.</div>
                          </div>
                        </div>
                        <span class="badge">Boş</span>
                      </div>
                    </div>
                  `;
                }
                const flagUri = getCountryFlagDataUri(s.countryColor || '#3b82f6');
                return `
                  <div class="divided-item">
                    <div class="card-row">
                      <div style="display:flex;align-items:center;gap:12px">
                        <img class="popup-row-icon" src="${flagUri}" alt="" />
                        <div>
                          <strong>Slot ${s.slotId} — ★ ${escapeAttr(s.countryName || '')}</strong>
                          <div class="muted">Oyun Tarihi: <b>${escapeAttr(s.simDateLabel || '')}</b></div>
                        </div>
                      </div>
                      <div style="display:flex;gap:8px;flex-wrap:wrap">
                        <button class="pixel-btn active-btn" data-load-slot="${s.slotId}">▶ Devam Et</button>
                        <button class="pixel-btn danger-btn" data-del-slot="${s.slotId}">🗑️ Sil</button>
                      </div>
                    </div>
                  </div>
                `;
              })
              .join('')}
          </div>
        </div>
      </div>
    `;
  }

  private bindContinueModalEvents(): void {
    document.getElementById('btn-close-continue')?.addEventListener('click', () => {
      this.continueModalOpen = false;
      this.syncFrame();
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-load-slot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slotId = Number(btn.dataset.loadSlot) as SaveSlotId;
        this.continueModalOpen = false;
        this.callbacks.onLoadSlotFromMenu(slotId);
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-del-slot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slotId = Number(btn.dataset.delSlot) as SaveSlotId;
        deleteSlot(slotId);
        if (!hasAnySavedSlot()) {
          this.continueModalOpen = false;
        }
        this.mountedContinueOpen = !this.continueModalOpen;
        this.mountedPhase = null;
        this.syncFrame();
      });
    });
  }

  private renderTutorialOverlay(): void {
    const host = document.getElementById('tutorial-host');
    if (!host) return;
    if (!this.tutorialOpen) {
      host.innerHTML = '';
      return;
    }

    const uniUri = getBuildingSpriteDataUri('university', '#3b82f6');
    const bankUri = getBuildingSpriteDataUri('bank', '#eab308');
    const facUri = getBuildingSpriteDataUri('factory', '#22c55e');
    const barUri = getBuildingSpriteDataUri('barracks', '#ef4444');
    const hospUri = getBuildingSpriteDataUri('hospital', '#38bdf8');
    const unitUri = getUnitSpriteDataUri('bazooka', 'forcefield', '#3b82f6');

    host.innerHTML = `
      <div class="tutorial-prompt-modal">
        <div class="pixel-panel modal-window" style="max-width:780px">
          <div class="modal-header">
            <div class="popup-title-wrap">
              <img class="popup-header-icon" src="${uniUri}" alt="" />
              <strong>📖 Hızlı Rehber & Kısayol Özeti (v1.2)</strong>
            </div>
            <button class="pixel-btn" id="btn-tut-close">✕</button>
          </div>
          <div class="divided-list">
            <div class="divided-item" style="display:flex;align-items:center;gap:12px">
              <img class="popup-row-icon" src="${bankUri}" alt="" />
              <div>
                <strong>5 Saniyelik Ekonomi & Banka Kredisi:</strong>
                Başlangıçta <code>100 💰</code> ve <code>1 Üniversite</code> bulunur. Alt menüdeki <b>🏪 Mağaza</b>'dan Banka (<code>100 💰</code>) kurun; her <code>5 sn</code>'de toplu gelir yatar. Bankaya tıklayarak <code>+500 / +1.000 / +10.000 💰</code> kredi alabilirsiniz.
              </div>
            </div>
            <div class="divided-item" style="display:flex;align-items:center;gap:12px">
              <img class="popup-row-icon" src="${facUri}" alt="" />
              <div>
                <strong>Bina-Bazlı Bağımsız Fabrika & Kışla:</strong>
                Haritadaki kendi binanıza tıklayınca oyun durur ve o binanın popup'ı açılır. Her Fabrika paralel hatlarda silah/kalkan üretir (<code>2–15 sn</code>); her Kışla kendi konumunda asker çıkarır.
              </div>
            </div>
            <div class="divided-item" style="display:flex;align-items:center;gap:12px">
              <img class="popup-row-icon" src="${unitUri}" alt="" />
              <div>
                <strong>RTS Kontrolleri & Kutu Seçimi:</strong>
                <b>Sol tık sürükle</b> = Çoklu ordu kutu seçimi & sağ alttan birleştirme | <b>Sağ/Orta tık sürükle</b> veya <b>WASD / Ok tuşları</b> = Harita kaydırma | <b>Sağ tık</b> = İptal. Bölge fethinde düşman binası yıkılır ve <code>+1.000 💰</code> kazanılır!
              </div>
            </div>
            <div class="divided-item" style="display:flex;align-items:center;gap:12px">
              <img class="popup-row-icon" src="${hospUri}" alt="" />
              <div>
                <strong>Hastane & 2 Sayfalı Diplomasi:</strong>
                Çatışmadan kaçan yaralılar en yakın Hastaneye koşup eski ekipmanlarıyla iyileşir. <b>📜 Diplomasi</b> (<code>[${this.keyBindings.getDisplayLabel('openDiplomacy')}]</code>) penceresinden 7 diplomatik aksiyonu yönetin.
              </div>
            </div>
            <div class="divided-item" style="display:flex;align-items:center;gap:12px">
              <img class="popup-row-icon" src="${barUri}" alt="" />
              <div>
                <strong>Kısayollar:</strong>
                Duraklat <code>[${this.keyBindings.getDisplayLabel('togglePause')}]</code> • Mağaza <code>[${this.keyBindings.getDisplayLabel('openBuildings')}]</code> • Diplomasi <code>[${this.keyBindings.getDisplayLabel('openDiplomacy')}]</code> • Ordum <code>[${this.keyBindings.getDisplayLabel('cycleArmy')}]</code> • Ayarlar <code>[${this.keyBindings.getDisplayLabel('openSettings')}]</code>
              </div>
            </div>
          </div>
          <hr class="popup-divider" />
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
            ${
              this.callbacks.onRestartInteractiveTutorial
                ? `<button class="pixel-btn" id="btn-restart-spotlight-tutorial" style="border-color:#facc15;color:#fef08a">↺ İnteraktif Tutorial'ı Yeniden Başlat</button>`
                : '<span></span>'
            }
            <button class="pixel-btn active-btn" id="btn-tut-done">✓ Anladım, Devam Et</button>
          </div>
        </div>
      </div>
    `;

    host.querySelector('#btn-tut-close')?.addEventListener('click', () => this.closeTutorial());
    host.querySelector('#btn-tut-done')?.addEventListener('click', () => this.closeTutorial());
    host.querySelector('#btn-restart-spotlight-tutorial')?.addEventListener('click', () => {
      this.closeTutorial();
      this.callbacks.onRestartInteractiveTutorial?.();
    });
  }

  private mountEndedScreen(): void {
    const standings = computeStandings(this.state);
    const playerRow = standings.find((s) => s.isPlayer);
    const flagUri = getCountryFlagDataUri(playerRow?.color ?? '#3b82f6');
    let title = `🏁 1 Ocak ${CALENDAR.END_YEAR} — Oyun Sonu Stat Karşılaştırması`;
    let subtitle = playerRow
      ? playerRow.rank === 1
        ? '🏆 Tebrikler! En yüksek skorla oyunu 1. sırada kazandınız!'
        : `Oyun tamamlandı — Sıralamanız: #${playerRow.rank}`
      : '';

    if (this.state.endReason === 'defeat_eliminated') {
      title = '💀 YENİLGİ — Tüm Topraklarınızı Kaybettiniz!';
      subtitle = 'Ülkenizin tüm bölgeleri ele geçirildi.';
    } else if (this.state.endReason === 'victory_domination') {
      title = '🏆 ZAFER — Tüm Bölgeye Hakim Oldunuz!';
      subtitle = 'Bitiş tarihinden önce aktif bölgedeki tüm toprakları birleştirdiniz!';
    }

    this.root.innerHTML = `
      <div class="endgame-overlay">
        <div class="pixel-panel modal-window">
          <div class="modal-header">
            <div class="popup-title-wrap">
              <img class="popup-header-icon" src="${flagUri}" alt="" />
              <strong>${title}</strong>
            </div>
            <div style="display:flex;gap:8px">
              <button class="pixel-btn active-btn" id="btn-play-again">🌍 Ülke Seç</button>
              <button class="pixel-btn" id="btn-end-main">🏠 Ana Ekran</button>
            </div>
          </div>
          <div class="status-line">${subtitle}</div>
          <table class="stats-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Ülke</th>
                <th>Toprak (Bölge)</th>
                <th>Bina</th>
                <th>Ordu (Asker / Güç)</th>
                <th>Teknoloji</th>
                <th>Ekonomi</th>
                <th>Toplam Skor</th>
              </tr>
            </thead>
            <tbody>
              ${standings
                .map(
                  (s) => `
                  <tr class="${s.isPlayer ? 'player-row' : ''} ${s.eliminated ? 'elim-row' : ''}">
                    <td>${s.rank}</td>
                    <td><img src="${getCountryFlagDataUri(s.color)}" style="width:18px;height:18px;vertical-align:middle;margin-right:6px" alt="" />${s.isPlayer ? '★ ' : ''}${s.name}${s.eliminated ? ' (Elendi)' : ''}</td>
                    <td>${s.regionCount}</td>
                    <td>${s.buildingCount}</td>
                    <td>${s.soldierCount} (${s.armyPower})</td>
                    <td>${s.techTierSum} / 10</td>
                    <td>${s.money} (+${s.moneyPerSec}/s)</td>
                    <td>${s.totalScore}</td>
                  </tr>
                `,
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('btn-play-again')?.addEventListener('click', () => {
      this.callbacks.onReturnToWorld();
    });
    document.getElementById('btn-end-main')?.addEventListener('click', () => {
      this.callbacks.onReturnToMainMenu();
    });
  }

  setHoveredWorldCountryName(name: string | null): void {
    const badge = document.getElementById('world-hover-badge');
    if (!badge) return;
    if (name) {
      badge.style.display = 'inline-block';
      badge.textContent = name;
    } else {
      badge.style.display = 'none';
    }
  }

  private mountPlayingShell(): void {
    const qLabel = this.keyBindings.getDisplayLabel('cycleArmy');
    this.root.innerHTML = `
      <div class="hud-topbar pixel-panel">
        <div class="hud-group">
          <strong id="hud-country">★ Ülke</strong>
          <span id="hud-date" class="badge">1 Oca 2000</span>
          <span id="hud-autopause-badge" class="badge" style="display:none;background:#7c2d12;border-color:#fb923c">
            ⏸ Eylem Bekleniyor
          </span>
          <button class="pixel-btn" id="btn-cancel-action" style="display:none;border-color:#facc15;color:#fef08a">
            ✕ İptal (Sağ Tık)
          </button>
        </div>

        <div class="hud-group">
          <div class="hud-money-box">
            <span>💰 <b id="hud-money">100</b> (<span id="hud-money-5s">+25</span>/5sn)</span>
            <div class="hud-income-bar-track" data-hover-tip="Her 5 simülasyon saniyesinde toplu gelir kasaya eklenir.">
              <div id="hud-income-bar-fill" class="hud-income-bar-fill"></div>
            </div>
            <div id="hud-money-float-host"></div>
          </div>
          <span id="hud-debt-badge" class="hud-debt-badge" style="display:none" data-hover-tip="Banka borcu: her 5 sn gelirinin %25'i otomatik düşülür. Bankayı açmak için tıklayın.">🏦 Borç: 0💰</span>
          <span>👥 <b id="hud-mp">50</b> (<span id="hud-mp-rate">+1</span>/s)</span>
          <span>❤️ <b id="hud-health">%50</b></span>
          <span>⚔️ <b id="hud-soldiers">0</b></span>
          <button class="pixel-btn" id="btn-cycle-army" data-key-action="cycleArmy">🎯 Ordum [${qLabel}]</button>
        </div>

        <div class="hud-group speed-controls">
          <button class="pixel-btn speed-btn" data-speed="0" data-key-action="togglePause">⏸</button>
          <button class="pixel-btn speed-btn" data-speed="0.5" data-key-action="speedSlow">0.5x</button>
          <button class="pixel-btn speed-btn" data-speed="1" data-key-action="speedNormal">1x</button>
          <button class="pixel-btn speed-btn" data-speed="2" data-key-action="speedFast">2x</button>
          <button class="pixel-btn" id="btn-hud-tutorial" data-key-action="openTutorial">📖</button>
          <button class="pixel-btn dock-btn" id="btn-hud-settings" data-win="settings" data-key-action="openSettings">⚙️ Ayarlar</button>
        </div>
      </div>

      <div id="live-ops-strip" class="live-ops-strip" style="display:none"></div>
      <div id="toast-strip" class="toast-strip"></div>

      <div class="hud-dock pixel-panel">
        <button class="pixel-btn dock-btn" id="btn-dock-shop" data-win="shop" data-key-action="openBuildings">🏪 Mağaza</button>
        <button class="pixel-btn dock-btn" id="btn-dock-diplomacy" data-win="diplomacy" data-key-action="openDiplomacy">📜 Diplomasi</button>
        <button class="pixel-btn dock-btn" id="btn-dock-map" data-win="save_exit">🌍 Harita</button>
      </div>

      <div id="region-bar" class="side-inspector pixel-panel" style="display:none"></div>
      <div id="multi-army-panel" class="multi-army-panel pixel-panel" style="display:none"></div>
      <div id="quick-build-host"></div>
      <div id="modal-host" class="modal-host"></div>
      <div id="encounter-host"></div>
      <div id="tutorial-host"></div>
      <div id="spotlight-host"></div>
    `;

    this.root.querySelectorAll<HTMLButtonElement>('.speed-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sp = Number(btn.dataset.speed) as SpeedMultiplier;
        setGameSpeed(this.state, sp);
        this.updateLiveHUD();
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('.dock-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const win = btn.dataset.win as ActiveWindowId;
        this.openWindow(win);
      });
    });

    document.getElementById('hud-debt-badge')?.addEventListener('click', () => {
      this.openWindow('bank', false);
    });

    document.getElementById('btn-cycle-army')?.addEventListener('click', () => {
      this.callbacks.onCycleArmyFocus();
    });

    document.getElementById('btn-hud-tutorial')?.addEventListener('click', () => {
      this.toggleTutorial();
    });

    document.getElementById('btn-cancel-action')?.addEventListener('click', () => {
      this.callbacks.onCancelPlacementOrOrder();
    });
  }

  private syncDockButtons(): void {
    this.root.querySelectorAll<HTMLButtonElement>('.dock-btn').forEach((btn) => {
      btn.classList.toggle('active-btn', btn.dataset.win === this.activeWindow);
    });
  }

  private updateLiveHUD(): void {
    const pid = this.state.playerCountryId;
    if (!pid || !this.state.countries[pid]) return;
    const p = this.state.countries[pid];

    const setTxt = (id: string, v: string) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== v) el.textContent = v;
    };

    const gross5s = getCountryGrossIncomePerTick(this.state, pid);
    const net5s =
      p.debt > 0
        ? gross5s - Math.min(p.debt, Math.round(gross5s * LOAN_CONFIG.AUTO_DEDUCT_RATE))
        : gross5s;

    setTxt('hud-country', `★ ${p.name}`);
    setTxt('hud-date', formatSimDate(this.state.simDaysElapsed));
    setTxt('hud-money', `${Math.floor(p.money)}`);
    setTxt('hud-money-5s', `+${Math.round(net5s)}`);
    setTxt('hud-mp', `${Math.floor(p.manpower)}`);
    setTxt('hud-mp-rate', `+${getCountryManpowerPerSec(this.state, pid)}`);
    setTxt('hud-health', `%${getCountryHealthPct(this.state, pid)}`);

    const barFill = document.getElementById('hud-income-bar-fill');
    if (barFill) {
      const pct = Math.max(
        0,
        Math.min(100, ((p.incomeTickAccSec ?? 0) / ECONOMY.INCOME_TICK_SEC) * 100),
      );
      barFill.style.width = `${pct.toFixed(1)}%`;
    }

    // Trigger HUD +X 💰 floating animation when a new 5s payout occurs
    const latestMoneyFx = [...(this.state.floatingEffects ?? [])]
      .reverse()
      .find((f) => f.scope === 'hud_money');
    if (latestMoneyFx && latestMoneyFx.id !== this.lastHudMoneyFxId) {
      this.lastHudMoneyFxId = latestMoneyFx.id;
      const floatHost = document.getElementById('hud-money-float-host');
      if (floatHost && Date.now() - latestMoneyFx.createdAtRealMs < 1400) {
        floatHost.innerHTML = `<span class="hud-money-float">${escapeAttr(latestMoneyFx.text)}</span>`;
      }
    }

    const debtBadge = document.getElementById('hud-debt-badge');
    if (debtBadge) {
      if (p.debt > 0) {
        debtBadge.style.display = 'inline-block';
        const txt = `🏦 Borç: ${Math.ceil(p.debt)}💰`;
        if (debtBadge.textContent !== txt) debtBadge.textContent = txt;
      } else {
        debtBadge.style.display = 'none';
      }
    }

    const autoBadge = document.getElementById('hud-autopause-badge');
    const cancelBtn = document.getElementById('btn-cancel-action');
    if (autoBadge) {
      if (this.state.placingBuildingType) {
        const bName = BUILDINGS[this.state.placingBuildingType].name;
        autoBadge.style.display = 'inline-block';
        autoBadge.textContent = `⏸ ${bName} Yerleştiriliyor — Haritaya Sol Tıkla`;
      } else if (this.state.moveOrderMode) {
        autoBadge.style.display = 'inline-block';
        autoBadge.textContent = '⏸ Hedef Seçiliyor — Haritaya Sol Tıkla';
      } else if (isAutoPaused(this.state)) {
        autoBadge.style.display = 'inline-block';
        autoBadge.textContent = '⏸ Oyun Otomatik Duraklatıldı';
      } else {
        autoBadge.style.display = 'none';
      }
    }
    if (cancelBtn) {
      cancelBtn.style.display =
        this.state.placingBuildingType || this.state.moveOrderMode ? 'inline-block' : 'none';
    }

    let totalSoldiers = 0;
    for (const a of Object.values(this.state.armies)) {
      if (a.countryId !== pid) continue;
      totalSoldiers += getTotalSoldiers(a.units);
    }
    for (const s of Object.values(this.state.ships)) {
      if (s.countryId !== pid) continue;
      totalSoldiers += getTotalSoldiers(s.units);
    }
    setTxt('hud-soldiers', `${totalSoldiers}`);

    this.root.querySelectorAll<HTMLButtonElement>('.speed-btn').forEach((btn) => {
      btn.classList.toggle('active-btn', Number(btn.dataset.speed) === this.state.speed);
    });

    const regEl = document.getElementById('region-bar');
    if (regEl) {
      if (this.state.selectedShipId && this.state.ships[this.state.selectedShipId]) {
        const sh = this.state.ships[this.state.selectedShipId];
        const owner = this.state.countries[sh.countryId];
        const carried = getTotalSoldiers(sh.units);
        const entries = getNonZeroUnits(sh.units);
        const iconsHtml =
          entries.length > 0
            ? `<div class="unit-icon-grid" style="margin-top:6px">${entries
                .map(([k, c]) => renderUnitIconCardHtml(k, c, owner?.color ?? '#3b82f6'))
                .join('')}</div>`
            : '';
        regEl.style.display = 'block';
        const nextHtml = `
          <div><strong>⚓ Taşıma Gemisi</strong> (${owner?.name ?? '-'})</div>
          <div><strong>Taşınan Asker:</strong> ${carried} (Kapasite: Sınırsız)</div>
          ${iconsHtml}
          <div class="muted" style="margin-top:4px">Kıyı bölgesine sol tıklayarak gönderin. Asker bindirmek için önce askere sonra gemiye tıklayın.</div>
        `;
        if (regEl.dataset.sig !== `${sh.id}_${carried}`) {
          regEl.dataset.sig = `${sh.id}_${carried}`;
          regEl.innerHTML = nextHtml;
        }
      } else {
        const reg = this.state.selectedRegionId
          ? this.state.regions[this.state.selectedRegionId]
          : null;
        if (!reg) {
          regEl.style.display = 'none';
          regEl.dataset.sig = '';
        } else {
          regEl.style.display = 'block';
          const owner = this.state.countries[reg.ownerId];
          const bText = reg.building
            ? `${BUILDINGS[reg.building.type].name}${reg.building.constructing ? ` (%${Math.floor((reg.building.progressSec / Math.max(0.1, reg.building.totalSec)) * 100)})` : ''}`
            : 'Yok (Boş)';
          const sig = `${reg.id}_${reg.ownerId}_${bText}`;
          if (regEl.dataset.sig !== sig) {
            regEl.dataset.sig = sig;
            regEl.innerHTML = `
              <div><strong>Bölge:</strong> ${reg.id} (${owner?.name ?? '-'})</div>
              <div><strong>Bina:</strong> ${bText}</div>
              <div><strong>Durum:</strong> ${reg.biome} | ${reg.isCoastal ? '🌊 Kıyı' : '🏔️ Kara'}</div>
            `;
          }
        }
      }
    }
  }

  /** Top-Left Semi-Transparent Live Operations Strip (Factory orders, Active Research, Wounded in Hospitals) */
  private updateLiveOpsStrip(): void {
    const strip = document.getElementById('live-ops-strip');
    const pid = this.state.playerCountryId;
    if (!strip || !pid || !this.state.countries[pid]) return;
    const p = this.state.countries[pid];

    const rows: string[] = [];

    // 1. Active Factory parallel orders across all owned Factories
    const prodOrders = getCountryActiveProductionOrders(this.state, pid);
    for (const { order } of prodOrders.slice(0, 5)) {
      const pct =
        order.unitTimeSec > 0 ? Math.min(100, Math.round((order.progressSec / order.unitTimeSec) * 100)) : 0;
      const uri = getTechItemSpriteDataUri(order.category, order.itemId);
      rows.push(`
        <div class="live-op-row">
          <img src="${uri}" alt="" />
          <span>×${order.remainingCount}</span>
          <div class="live-op-mini-bar"><div class="live-op-mini-fill" style="width:${pct}%"></div></div>
        </div>
      `);
    }

    // 2. Active University research
    if (p.activeResearch) {
      const pct = Math.min(
        100,
        Math.round((p.activeResearch.progressSec / Math.max(0.1, p.activeResearch.totalSec)) * 100),
      );
      const uri = getTechItemSpriteDataUri(
        p.activeResearch.branch,
        p.activeResearch.targetId as WeaponId | Exclude<ShieldId, 'none'>,
      );
      rows.push(`
        <div class="live-op-row">
          <img src="${uri}" alt="" />
          <span>🔬 %${pct}</span>
          <div class="live-op-mini-bar"><div class="live-op-mini-fill" style="width:${pct}%;background:#facc15"></div></div>
        </div>
      `);
    }

    // 3. Wounded soldiers walking to / healing in Hospitals
    const myWounded = this.state.wounded
      .filter((w) => w.countryId === pid)
      .reduce((s, w) => s + getTotalSoldiers(w.units), 0);
    if (myWounded > 0) {
      const hospUri = getBuildingSpriteDataUri('hospital', p.color);
      rows.push(`
        <div class="live-op-row">
          <img src="${hospUri}" alt="" />
          <span style="color:#86efac">➕ Yaralı / İyileşen: <b>${myWounded}</b></span>
        </div>
      `);
    }

    if (rows.length === 0) {
      if (strip.style.display !== 'none') {
        strip.style.display = 'none';
        strip.innerHTML = '';
        strip.dataset.sig = '';
      }
      return;
    }

    strip.style.display = 'flex';
    const html = rows.join('');
    if (strip.dataset.sig !== html) {
      strip.dataset.sig = html;
      strip.innerHTML = html;
    }
  }

  /** Bottom-Right Multi-Army Selection & Merge Panel (`2+` armies box-selected) */
  private updateMultiArmyPanel(): void {
    const panel = document.getElementById('multi-army-panel');
    const pid = this.state.playerCountryId;
    if (!panel || !pid) return;

    const validIds = (this.state.selectedArmyIds ?? []).filter(
      (id) => this.state.armies[id]?.countryId === pid && getTotalSoldiers(this.state.armies[id].units) > 0,
    );
    if (validIds.length !== (this.state.selectedArmyIds?.length ?? 0)) {
      this.state.selectedArmyIds = validIds;
    }

    if (validIds.length < 2) {
      if (panel.style.display !== 'none') {
        panel.style.display = 'none';
        panel.innerHTML = '';
        panel.dataset.sig = '';
      }
      return;
    }

    const totalSoldiers = validIds.reduce(
      (s, id) => s + getTotalSoldiers(this.state.armies[id].units),
      0,
    );
    const sig = `${validIds.join(',')}:${totalSoldiers}`;
    panel.style.display = 'flex';
    if (panel.dataset.sig === sig) return;
    panel.dataset.sig = sig;

    const pColor = this.state.countries[pid]?.color ?? '#3b82f6';
    const sampleVis = getMaxTierVisualsForUnits(this.state.armies[validIds[0]].units);
    const unitUri = getUnitSpriteDataUri(sampleVis.weapon, sampleVis.shield, pColor);

    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px">
        <img src="${unitUri}" style="width:36px;height:32px;image-rendering:pixelated" alt="" />
        <div>
          <strong>${validIds.length} Birlik Seçili</strong>
          <div class="muted">Toplam: <b>${totalSoldiers} Asker</b></div>
        </div>
      </div>
      <hr class="popup-divider" style="margin:4px 0" />
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="pixel-btn active-btn" id="btn-multi-merge">🔗 Seçilenleri Birleştir</button>
        <button class="pixel-btn" id="btn-multi-cancel">✕ Seçimi İptal</button>
      </div>
      <div class="muted" style="font-size:12.5px">Toplu yürütmek için haritada hedef bölgeye sol tıklayın.</div>
    `;

    panel.querySelector('#btn-multi-merge')?.addEventListener('click', () => {
      const res = orderArmiesMerge(this.state, validIds);
      if (!res.ok && res.error) {
        pushImportantToast(this.state, res.error, 'info');
      }
      this.updateMultiArmyPanel();
      this.updateLiveHUD();
    });

    panel.querySelector('#btn-multi-cancel')?.addEventListener('click', () => {
      cancelSelectionAndOrderMode(this.state);
      this.updateMultiArmyPanel();
    });
  }

  /** Floating Quick-Build Menu when clicking own empty region */
  renderQuickBuildMenu(): void {
    const host = document.getElementById('quick-build-host');
    if (!host) return;
    const pid = this.state.playerCountryId;
    const target = this.quickBuildTarget;
    if (!target || !pid || !this.state.countries[pid]) {
      host.innerHTML = '';
      return;
    }

    const reg = this.state.regions[target.regionId];
    const p = this.state.countries[pid];
    if (!reg || reg.ownerId !== pid || reg.building !== null) {
      this.quickBuildTarget = null;
      host.innerHTML = '';
      return;
    }

    const uniCount = getTotalBuildingCountIncludingConstructing(this.state, pid, 'university');
    const types: BuildingType[] = ['bank', 'factory', 'barracks', 'hospital'];
    if (reg.isCoastal) types.push('port');
    if (uniCount < ECONOMY.MAX_UNIVERSITIES) types.push('university');

    const left = Math.max(14, Math.min(window.innerWidth - 290, Math.round(target.screenX + 16)));
    const top = Math.max(76, Math.min(window.innerHeight - 330, Math.round(target.screenY - 24)));

    host.innerHTML = `
      <div class="pixel-panel quick-build-menu" style="left:${left}px;top:${top}px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <strong style="font-size:14.5px;color:#fef08a">🏗️ Buraya Bina Kur (${reg.id})</strong>
          <button class="pixel-btn mini-qty-btn" id="btn-close-quick-build">✕</button>
        </div>
        <div class="divided-list">
          ${types
            .map((bt) => {
              const spec = BUILDINGS[bt];
              const canAfford = p.money >= spec.cost;
              const uri = getBuildingSpriteDataUri(bt, p.color);
              return `
                <div class="divided-item" style="margin-top:6px;padding-top:6px">
                  <button class="quick-build-row" data-quick-build="${bt}" ${canAfford ? '' : 'disabled'}>
                    <span style="display:flex;align-items:center;gap:8px">
                      <img src="${uri}" alt="" />
                      <span>${spec.name}</span>
                    </span>
                    <span style="color:#fde047">${spec.cost} 💰</span>
                  </button>
                </div>
              `;
            })
            .join('')}
        </div>
      </div>
    `;

    host.querySelector('#btn-close-quick-build')?.addEventListener('click', () => {
      this.setQuickBuildTarget(null);
    });

    host.querySelectorAll<HTMLButtonElement>('[data-quick-build]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const bt = btn.dataset.quickBuild as BuildingType;
        const res = startBuildingConstruction(this.state, pid, reg.id, bt, target.point);
        if (!res.ok) {
          pushImportantToast(this.state, res.error || 'Bina kurulamadı.', 'info');
        }
        this.setQuickBuildTarget(null);
        this.updateLiveHUD();
      });
    });
  }

  private updateToasts(): void {
    const strip = document.getElementById('toast-strip');
    if (!strip) return;
    const now = Date.now();
    this.state.toasts = this.state.toasts.filter((t) => now - t.createdAtRealMs < 5500);
    const html = this.state.toasts
      .map((t) => `<div class="toast-item toast-${t.kind}">${t.message}</div>`)
      .join('');
    if (strip.innerHTML !== html) strip.innerHTML = html;
  }

  private syncEncounterOverlay(): void {
    const host = document.getElementById('encounter-host');
    if (!host) return;
    const enc = this.state.activeEncounter;
    if (!enc) {
      if (this.mountedEncounterKey !== null || host.innerHTML !== '') {
        this.mountedEncounterKey = null;
        host.innerHTML = '';
      }
      return;
    }

    const pid = this.state.playerCountryId;
    if (pid) {
      enc.relation = getRelationStatus(this.state, pid, enc.otherCountryId);
    }
    const sig = `${enc.id}_${enc.activeTab}_${enc.relation}_${this.selectedDiplomacyCountryId ?? ''}`;
    if (this.mountedEncounterKey === sig) return;
    this.mountedEncounterKey = sig;
    this.hideTooltip();
    this.renderEncounterModal(host);
  }

  private renderEncounterModal(host: HTMLElement): void {
    const enc = this.state.activeEncounter;
    const pid = this.state.playerCountryId;
    if (!enc || !pid) {
      host.innerHTML = '';
      return;
    }

    const myArmy = this.state.armies[enc.playerArmyId];
    const otherArmy = this.state.armies[enc.otherArmyId];
    const me = this.state.countries[pid];
    const otherCountry = this.state.countries[enc.otherCountryId];
    if (!myArmy || !otherArmy || !me || !otherCountry) {
      resolveEncounterChoice(this.state, 'stand_down');
      host.innerHTML = '';
      return;
    }

    const relLabels = {
      neutral: '⚪ Nötr',
      allied: '🟢 Müttefik',
      war: '🔴 Savaşta',
    };

    const myStats = computeArmyAverageStats(myArmy.units);
    const otherStats = computeArmyAverageStats(otherArmy.units);
    const myUnits = getNonZeroUnits(myArmy.units);
    const otherUnits = getNonZeroUnits(otherArmy.units);
    const otherFlag = getCountryFlagDataUri(otherCountry.color);

    let bodyHtml = '';
    if (enc.activeTab === 'encounter') {
      const napLocked = isNonAggressionActive(this.state, pid, otherCountry.id);
      const actionButtons =
        enc.relation === 'war'
          ? `
            <button class="pixel-btn active-btn" data-enc-choice="attack">⚔️ Saldır / Çatışmaya Gir</button>
            <button class="pixel-btn" data-enc-choice="stand_down">🏃 Dur / Geri Çekil</button>
          `
          : enc.relation === 'neutral'
            ? `
            <button class="pixel-btn danger-btn" data-enc-choice="declare_war_attack" ${napLocked ? 'disabled' : ''}>⚔️ Savaş İlan Et ve Saldır</button>
            <button class="pixel-btn active-btn" data-enc-choice="stand_down">🛑 Saldırma / Dur</button>
            <button class="pixel-btn" data-enc-choice="continue_pass">🕊️ Yanından Geç</button>
          `
            : `
            <button class="pixel-btn active-btn" data-enc-choice="continue_pass">🤝 Müttefik — Yoluna Devam Et</button>
            <button class="pixel-btn" data-enc-choice="stand_down">🛑 Burada Dur</button>
          `;

      bodyHtml = `
        <div class="status-line">
          🚨 <b>${me.name}</b> birlikleriniz, <b>${otherCountry.name}</b> ordusuyla karşılaştı!
          Anlık İlişki: <b>${relLabels[enc.relation]}</b> — Oyun kararınız için duraklatıldı.
        </div>
        <div class="two-col">
          <div class="army-vs-box">
            <strong>★ Bizim Ordumuz (${me.name})</strong>
            <div class="muted">Toplam: <b>${myStats.count} Asker</b> | Ort. Hasar: <b>${myStats.avgDamage.toFixed(1)}</b> | Ort. Koruma: <b>${myStats.avgDefense.toFixed(1)}</b></div>
            <hr class="popup-divider" />
            <div class="unit-icon-grid">
              ${myUnits.map(([k, c]) => renderUnitIconCardHtml(k, c, me.color)).join('')}
            </div>
          </div>
          <div class="army-vs-box">
            <strong><img src="${otherFlag}" style="width:20px;height:20px;vertical-align:middle;margin-right:6px" alt="" />${otherCountry.name} Ordusu</strong>
            <div class="muted">Toplam: <b>${otherStats.count} Asker</b> | Ort. Hasar: <b>${otherStats.avgDamage.toFixed(1)}</b> | Ort. Koruma: <b>${otherStats.avgDefense.toFixed(1)}</b></div>
            <hr class="popup-divider" />
            <div class="unit-icon-grid">
              ${otherUnits.map(([k, c]) => renderUnitIconCardHtml(k, c, otherCountry.color)).join('')}
            </div>
          </div>
        </div>
        <hr class="popup-divider" />
        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
          ${actionButtons}
        </div>
      `;
    } else {
      const activeCountries = Object.values(this.state.countries).filter((c) => !c.eliminated);
      const others = activeCountries.filter((c) => c.id !== pid);
      const focusDipId =
        this.selectedDiplomacyCountryId && this.state.countries[this.selectedDiplomacyCountryId]
          ? this.selectedDiplomacyCountryId
          : otherCountry.id;
      const dipTarget = this.state.countries[focusDipId] ?? otherCountry;
      const dipEdge = getDiplomacyEdge(this.state, pid, dipTarget.id);
      const summary = getCountryAlliesAndWars(this.state, dipTarget.id);

      bodyHtml = `
        <div class="two-col">
          <div class="divided-list" style="max-height:320px;overflow-y:auto">
            ${others
              .map((c) => {
                const r = getRelationStatus(this.state, pid, c.id);
                return `
                  <div class="divided-item">
                    <button class="pixel-btn ${c.id === dipTarget.id ? 'active-btn' : ''}" data-enc-dip="${c.id}" style="width:100%;display:flex;justify-content:space-between;align-items:center">
                      <span style="display:flex;align-items:center;gap:8px">
                        <img src="${getCountryFlagDataUri(c.color)}" style="width:20px;height:20px" alt="" />
                        <span>${c.name}</span>
                      </span>
                      <span>${relLabels[r]}</span>
                    </button>
                  </div>
                `;
              })
              .join('')}
          </div>
          <div class="army-vs-box">
            <strong><img src="${getCountryFlagDataUri(dipTarget.color)}" style="width:22px;height:22px;vertical-align:middle;margin-right:6px" alt="" />${dipTarget.name} — Diplomatik Dosya</strong>
            <div>Bizimle İlişki: <b>${relLabels[dipEdge?.status ?? 'neutral']} (${dipEdge?.score ?? 0})</b></div>
            <div>Müttefikleri: <b>${summary.allies.map((id) => this.state.countries[id]?.name).join(', ') || 'Yok'}</b></div>
            <div>Savaşta Oldukları: <b>${summary.wars.map((id) => this.state.countries[id]?.name).join(', ') || 'Yok'}</b></div>
            <hr class="popup-divider" />
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${
                dipEdge?.status !== 'war'
                  ? `<button class="pixel-btn danger-btn" id="btn-enc-dip-war">⚔️ Savaş İlan Et</button>`
                  : `<button class="pixel-btn" id="btn-enc-dip-peace">🕊️ Barış Teklif Et</button>`
              }
              ${
                dipEdge?.status === 'neutral'
                  ? `<button class="pixel-btn" id="btn-enc-dip-ally">🤝 İttifak Teklif Et</button>`
                  : ''
              }
            </div>
          </div>
        </div>
      `;
    }

    host.innerHTML = `
      <div class="encounter-overlay">
        <div class="pixel-panel modal-window">
          <div class="modal-header">
            <div class="popup-title-wrap">
              <img class="popup-header-icon" src="${otherFlag}" alt="" />
              <strong>⚔️ Ordu Karşılaşması — ${otherCountry.name}</strong>
            </div>
            <span class="badge">⏸ Oyun Duraklatıldı</span>
          </div>
          <div class="tab-strip">
            <button class="pixel-btn ${enc.activeTab === 'encounter' ? 'active-btn' : ''}" data-enc-tab="encounter">
              ⚔️ Karşılaşma & Kuvvetler
            </button>
            <button class="pixel-btn ${enc.activeTab === 'diplomacy' ? 'active-btn' : ''}" data-enc-tab="diplomacy">
              📜 Diplomasi
            </button>
          </div>
          ${this.lastErrorMsg ? `<div class="err-line">${this.lastErrorMsg}</div>` : ''}
          ${bodyHtml}
        </div>
      </div>
    `;

    host.querySelectorAll<HTMLButtonElement>('[data-enc-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.state.activeEncounter) return;
        this.state.activeEncounter.activeTab = btn.dataset.encTab as 'encounter' | 'diplomacy';
        this.lastErrorMsg = '';
        this.mountedEncounterKey = null;
        this.syncEncounterOverlay();
      });
    });

    host.querySelectorAll<HTMLButtonElement>('[data-enc-choice]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ch = btn.dataset.encChoice as EncounterChoice;
        const res = resolveEncounterChoice(this.state, ch);
        if (!res.ok) {
          this.lastErrorMsg = res.error || 'İşlem başarısız.';
          this.mountedEncounterKey = null;
          this.syncEncounterOverlay();
          return;
        }
        this.lastErrorMsg = '';
        this.mountedEncounterKey = null;
        this.hideTooltip();
        this.syncEncounterOverlay();
        this.updateLiveHUD();
      });
    });

    host.querySelectorAll<HTMLButtonElement>('[data-enc-dip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedDiplomacyCountryId = btn.dataset.encDip || null;
        this.mountedEncounterKey = null;
        this.syncEncounterOverlay();
      });
    });

    const focusDipId =
      this.selectedDiplomacyCountryId && this.state.countries[this.selectedDiplomacyCountryId]
        ? this.selectedDiplomacyCountryId
        : otherCountry.id;

    host.querySelector('#btn-enc-dip-war')?.addEventListener('click', () => {
      const res = declareWar(this.state, pid, focusDipId);
      this.lastErrorMsg = res.ok ? '' : res.error || '';
      this.mountedEncounterKey = null;
      this.syncEncounterOverlay();
    });
    host.querySelector('#btn-enc-dip-ally')?.addEventListener('click', () => {
      const res = proposeAlliance(this.state, pid, focusDipId);
      this.lastErrorMsg = !res.accepted ? 'İttifak teklifi reddedildi.' : '';
      this.mountedEncounterKey = null;
      this.syncEncounterOverlay();
    });
    host.querySelector('#btn-enc-dip-peace')?.addEventListener('click', () => {
      const res = proposePeace(this.state, pid, focusDipId);
      this.lastErrorMsg = !res.accepted ? 'Barış teklifi reddedildi.' : '';
      this.mountedEncounterKey = null;
      this.syncEncounterOverlay();
    });
  }

  private updateLiveProgressInsideModal(): void {
    if (!this.activeWindow || !this.state.playerCountryId) return;
    const pid = this.state.playerCountryId;
    const p = this.state.countries[pid];
    if (!p) return;

    if (this.activeWindow === 'university') {
      const liveBox = document.getElementById('modal-live-status');
      if (!liveBox) return;
      if (p.activeResearch) {
        const pct = Math.min(
          100,
          Math.floor((p.activeResearch.progressSec / Math.max(0.1, p.activeResearch.totalSec)) * 100),
        );
        const name =
          p.activeResearch.branch === 'weapon'
            ? WEAPONS[p.activeResearch.targetId as WeaponId].name
            : SHIELDS[p.activeResearch.targetId as Exclude<ShieldId, 'none'>].name;
        liveBox.textContent = `🔬 Araştırılıyor: ${name} (%${pct})`;
      } else {
        liveBox.textContent =
          'Aktif araştırma yok — Ağaçtaki sarı çerçeveli sıradaki ikona tıklayarak araştırma başlatın.';
      }
      return;
    }

    if (this.activeWindow === 'factory' && this.state.activeBuildingRegionId) {
      const reg = this.state.regions[this.state.activeBuildingRegionId];
      const lines = reg?.building?.parallelProduction ?? [];
      for (const el of document.querySelectorAll<HTMLElement>('[data-fac-line]')) {
        const [cat, id] = (el.dataset.facLine || '').split(':');
        const line = lines.find((l) => l.category === cat && l.itemId === id);
        if (!line || line.remainingCount <= 0) {
          el.style.display = 'none';
        } else {
          el.style.display = 'flex';
          const pct =
            line.unitTimeSec > 0 ? Math.min(100, Math.round((line.progressSec / line.unitTimeSec) * 100)) : 0;
          const fill = el.querySelector<HTMLElement>('.item-progress-fill');
          const lbl = el.querySelector<HTMLElement>('.item-progress-label');
          if (fill) fill.style.width = `${pct}%`;
          if (lbl) lbl.textContent = `⏳ Kalan: ${line.remainingCount} (%${pct})`;
        }
      }
      return;
    }

    if (this.activeWindow === 'barracks' && this.state.activeBuildingRegionId) {
      const reg = this.state.regions[this.state.activeBuildingRegionId];
      const liveBox = document.getElementById('modal-live-status');
      if (!liveBox || !reg?.building) return;
      const prog = getBarracksTrainingProgress(reg.building);
      liveBox.textContent = prog.active
        ? `⏳ Bu Kışlada Eğitiliyor: Kalan ${prog.remainingSoldiers} Asker (%${Math.round(prog.pct * 100)})`
        : '🛡️ Bu Kışla şu an boşta — asker sayısı ve ekipman ikonlarından seçim yapın.';
    }
  }

  private renderDemolishFooterHtml(reg: Region): string {
    if (!reg.building) return '';
    const bSpec = BUILDINGS[reg.building.type];
    const refund = Math.floor(bSpec.cost * ECONOMY.DEMOLISH_REFUND_RATE);
    const confirming = this.confirmDemolishRegionId === reg.id;
    return `
      <hr class="popup-divider" />
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <span class="muted">Bina Konumu: <b>${reg.id}</b> — Yıkım iadesi: <b>+${refund} 💰 (%50)</b></span>
        <button class="pixel-btn danger-btn" id="btn-demolish-building" data-reg="${reg.id}">
          ${confirming ? `⚠️ Emin misiniz? (+${refund} 💰 İade — Tıkla Yık)` : `🗑️ Binayı Yık (+${refund} 💰)`}
        </button>
      </div>
    `;
  }

  private bindDemolishButton(host: HTMLElement, pid: string, reg: Region): void {
    host.querySelector('#btn-demolish-building')?.addEventListener('click', () => {
      if (this.confirmDemolishRegionId !== reg.id) {
        this.confirmDemolishRegionId = reg.id;
        this.renderModal();
        return;
      }
      const res = demolishBuilding(this.state, pid, reg.id);
      this.confirmDemolishRegionId = null;
      if (!res.ok) {
        this.lastErrorMsg = res.error || 'Bina yıkılamadı.';
        this.renderModal();
        return;
      }
      pushImportantToast(
        this.state,
        `🗑️ Bina yıkıldı (+${res.refund ?? 0} 💰 iade).`,
        'info',
      );
      this.openWindow(null, false);
      this.updateLiveHUD();
    });
  }

  renderModal(): void {
    const host = document.getElementById('modal-host');
    if (!host) return;
    const pid = this.state.playerCountryId;
    if (!this.activeWindow || !pid || !this.state.countries[pid]) {
      host.innerHTML = '';
      return;
    }
    const p = this.state.countries[pid];
    const errHtml = this.lastErrorMsg ? `<div class="err-line">${this.lastErrorMsg}</div>` : '';
    const closeBtnAttrs = this.closeButtonLockedByTutorial ? 'disabled title="Önce tutorial adımını tamamlayın"' : '';

    // 1. SHOP (`🏪 Mağaza`) — Icon + Name + Price + Divider between every building!
    if (this.activeWindow === 'shop') {
      const owned = getCountryRegions(this.state, pid);
      const hasCoastal = owned.some((r) => r.isCoastal);
      const totalUni = getTotalBuildingCountIncludingConstructing(this.state, pid, 'university');

      const buildTypes: BuildingType[] = ['bank', 'factory', 'barracks', 'hospital', 'port'];
      if (totalUni < ECONOMY.MAX_UNIVERSITIES) {
        buildTypes.push('university');
      }

      const shopHeaderIcon = getBuildingSpriteDataUri('bank', p.color);

      host.innerHTML = `
        <div class="pixel-panel modal-window">
          <div class="modal-header">
            <div class="popup-title-wrap">
              <img class="popup-header-icon" src="${shopHeaderIcon}" alt="" />
              <strong>🏪 Mağaza — Bina Satın Al & Haritaya Yerleştir</strong>
            </div>
            <button class="pixel-btn close-win" ${closeBtnAttrs}>✕</button>
          </div>
          ${errHtml}
          <div class="status-line">
            🖱️ Kurmak istediğiniz binayı seçin → <b>Oyun otomatik durur</b> ve binayı kendi boş bölgenize sol tıklayarak yerleştirirsiniz (Sağ tık = İptal).
          </div>
          <div class="divided-list">
            ${buildTypes
              .map((bt) => {
                const spec = BUILDINGS[bt];
                const count = getEffectiveBuildingCount(this.state, pid, bt);
                const disabledCoast = bt === 'port' && !hasCoastal;
                const iconUri = getBuildingSpriteDataUri(bt, p.color);
                return `
                  <div class="divided-item">
                    <div class="card-row">
                      <div style="display:flex;align-items:center;gap:14px">
                        <img class="popup-row-icon" src="${iconUri}" alt="${spec.name}" />
                        <div>
                          <strong>${spec.name}</strong> — <b style="color:#fde047">${spec.cost} 💰</b>
                          <span class="badge" style="margin-left:6px">Kurulu: ${count}</span>
                          <div class="muted">${spec.description} (İnşa: ${spec.buildSec} sn)</div>
                        </div>
                      </div>
                      <button class="pixel-btn btn-place-building" data-shop-type="${bt}" data-type="${bt}" ${disabledCoast ? 'disabled' : ''}>
                        🖱️ Haritaya Yerleştir (${spec.cost}💰)
                      </button>
                    </div>
                  </div>
                `;
              })
              .join('')}
          </div>
        </div>
      `;

      host.querySelector('.close-win')?.addEventListener('click', () => this.openWindow(null, false));
      host.querySelectorAll<HTMLButtonElement>('.btn-place-building').forEach((btn) => {
        btn.addEventListener('click', () => {
          const bt = btn.dataset.type as BuildingType;
          if (p.money < BUILDINGS[bt].cost) {
            this.lastErrorMsg = `Yetersiz para (${BUILDINGS[bt].cost} 💰 gerekli).`;
            this.renderModal();
            return;
          }
          this.callbacks.onEnterBuildingPlacement(bt);
        });
      });
      return;
    }

    // Check if activeWindow is one of the 6 building popups and validate activeBuildingRegionId
    if (BUILDING_POPUP_IDS.has(this.activeWindow)) {
      const reg = this.state.activeBuildingRegionId
        ? this.state.regions[this.state.activeBuildingRegionId]
        : null;
      if (!reg || reg.ownerId !== pid || !reg.building) {
        this.openWindow(null, false);
        return;
      }

      // Under-construction building popup
      if (reg.building.constructing) {
        const bSpec = BUILDINGS[reg.building.type];
        const bIcon = getBuildingSpriteDataUri(reg.building.type, p.color);
        const pct = Math.min(
          100,
          Math.floor((reg.building.progressSec / Math.max(0.1, reg.building.totalSec)) * 100),
        );
        host.innerHTML = `
          <div class="pixel-panel modal-window" style="max-width:680px">
            <div class="modal-header">
              <div class="popup-title-wrap">
                <img class="popup-header-icon" src="${bIcon}" alt="" />
                <strong>🏗️ ${bSpec.name} — İnşa Ediliyor (${reg.id})</strong>
              </div>
              <button class="pixel-btn close-win" ${closeBtnAttrs}>✕</button>
            </div>
            <div class="status-line">
              ⏳ İnşaat İlerlemesi: <b>%${pct}</b> (${reg.building.progressSec.toFixed(1)} / ${reg.building.totalSec} sn) — Pencereyi kapattığınızda inşaat kaldığı yerden devam eder.
            </div>
            ${this.renderDemolishFooterHtml(reg)}
          </div>
        `;
        host.querySelector('.close-win')?.addEventListener('click', () => this.openWindow(null, false));
        this.bindDemolishButton(host, pid, reg);
        return;
      }

      // 2A. BANK POPUP (`bank`) — 5s Income, 500/1000/10000 Loans, Repay, Demolish
      if (this.activeWindow === 'bank') {
        const bIcon = getBuildingSpriteDataUri('bank', p.color);
        const bankCount = getEffectiveBuildingCount(this.state, pid, 'bank');
        const gross5s = getCountryGrossIncomePerTick(this.state, pid);
        const deduct5s =
          p.debt > 0 ? Math.min(p.debt, Math.round(gross5s * LOAN_CONFIG.AUTO_DEDUCT_RATE)) : 0;
        const net5s = gross5s - deduct5s;

        host.innerHTML = `
          <div class="pixel-panel modal-window" style="max-width:780px">
            <div class="modal-header">
              <div class="popup-title-wrap">
                <img class="popup-header-icon" src="${bIcon}" alt="" />
                <strong>🏦 Banka — Hazine & Kredi Merkezi (${reg.id})</strong>
              </div>
              <button class="pixel-btn close-win" ${closeBtnAttrs}>✕</button>
            </div>
            ${errHtml}
            <div class="divided-list">
              <div class="divided-item">
                <div class="card-row">
                  <span>🏦 Toplam Aktif Banka Sayısı:</span>
                  <b>${bankCount} Adet (Her ek Banka +60 💰 / 5sn)</b>
                </div>
              </div>
              <div class="divided-item">
                <div class="card-row">
                  <span>💰 5 Saniyelik Toplam Gelir:</span>
                  <b>Brüt: +${gross5s} 💰 / 5sn | Net Kasaya Giren: <span style="color:#4ade80">+${net5s} 💰 / 5sn</span></b>
                </div>
              </div>
              <div class="divided-item">
                <div class="card-row">
                  <span>📊 Güncel Borç Durumu (Tavan: ${LOAN_CONFIG.MAX_DEBT} 💰):</span>
                  <b style="color:${p.debt > 0 ? '#fca5a5' : '#86efac'}">${Math.ceil(p.debt)} 💰 ${p.debt > 0 ? `(Her 5 sn'de -${deduct5s} 💰 otomatik kesinti)` : '(Borç Yok)'}</b>
                </div>
              </div>
              <div class="divided-item">
                <h4>💳 Banka Kredisi Al (%15 Faiz — Maks. Borç Tavanı: 20.000 💰)</h4>
                <div class="muted" style="margin-bottom:10px">Alınan krediye %15 faiz eklenir; her 5 sn'lik brüt gelirin %25'i borçtan otomatik düşülür.</div>
                <div style="display:flex;gap:10px;flex-wrap:wrap">
                  ${LOAN_CONFIG.OPTIONS.map((amt) => {
                    const withInterest = Math.round(amt * (1 + LOAN_CONFIG.INTEREST_RATE));
                    const overCap = p.debt + withInterest > LOAN_CONFIG.MAX_DEBT;
                    return `
                      <button class="pixel-btn active-btn btn-take-loan" id="btn-loan-${amt}" data-loan="${amt}" ${overCap ? 'disabled' : ''}>
                        +${amt.toLocaleString('tr-TR')} 💰 Borç Al (Geri Ödeme: ${withInterest.toLocaleString('tr-TR')}💰)
                      </button>
                    `;
                  }).join('')}
                  <button class="pixel-btn" id="btn-repay-loan" ${p.debt > 0 && p.money >= 1 ? '' : 'disabled'}>
                    ✓ Borcu Kapat (${Math.min(Math.ceil(p.debt), Math.floor(p.money))} 💰)
                  </button>
                </div>
              </div>
            </div>
            ${this.renderDemolishFooterHtml(reg)}
          </div>
        `;

        host.querySelector('.close-win')?.addEventListener('click', () => this.openWindow(null, false));
        host.querySelectorAll<HTMLButtonElement>('.btn-take-loan').forEach((btn) => {
          btn.addEventListener('click', () => {
            const amt = Number(btn.dataset.loan) as 500 | 1000 | 10000;
            const res = takeBankLoan(this.state, pid, amt);
            this.lastErrorMsg = res.ok ? '' : res.error || '';
            this.renderModal();
            this.updateLiveHUD();
          });
        });
        host.querySelector('#btn-repay-loan')?.addEventListener('click', () => {
          const res = repayBankLoan(this.state, pid);
          this.lastErrorMsg = res.ok ? '' : res.error || '';
          this.renderModal();
          this.updateLiveHUD();
        });
        this.bindDemolishButton(host, pid, reg);
        return;
      }

      // 2B. UNIVERSITY POPUP (`university`) — Visual 2-Branch Science Tree + Demolish
      if (this.activeWindow === 'university') {
        const uIcon = getBuildingSpriteDataUri('university', p.color);
        const nextW = WEAPON_ORDER.find((w) => !p.unlockedWeapons.includes(w));
        const nextS = SHIELD_ORDER.find((s) => !p.unlockedShields.includes(s));
        const rootUri = getTechItemSpriteDataUri('root', 'base');
        const rootTip = escapeAttr(
          'Temel Bilim Başlangıç Noktası\nÜst çizgi: Silah Dalı (Saldırı Hasarı)\nAlt çizgi: Kalkan Dalı (Savunma Koruması)',
        );

        const renderWeaponBranch = WEAPON_ORDER.map((w, idx) => {
          const sp = WEAPONS[w];
          const unlocked = p.unlockedWeapons.includes(w);
          const isResearching =
            p.activeResearch?.branch === 'weapon' && p.activeResearch.targetId === w;
          const isNext = w === nextW && !isResearching;
          const cls = unlocked
            ? 'node-unlocked'
            : isResearching
              ? 'node-researching'
              : isNext
                ? 'node-next'
                : 'node-locked';
          const costLabel = unlocked
            ? '✓ Açık'
            : isResearching
              ? `${sp.researchCost} 💰 (⏳)`
              : `${sp.researchCost} 💰`;
          const tip = escapeAttr(
            `T${sp.tier} ${sp.name}\nHasar: ${sp.damage}\nAraştırma: ${sp.researchCost} Para / ${sp.researchSec} sn\nFabrika Üretimi: ${sp.prodCost} Para / ${sp.prodSec} sn`,
          );
          const edgeCls = unlocked ? 'edge-unlocked' : isResearching ? 'edge-active' : '';
          const edgeHtml = idx > 0 ? `<div class="tech-edge ${edgeCls}"></div>` : '';
          return `
            ${edgeHtml}
            <button class="tech-tree-node ${cls}" data-tech-branch="weapon" data-tech-id="${w}" data-tech-next="${isNext ? '1' : '0'}" data-hover-tip="${tip}">
              <img src="${getTechItemSpriteDataUri('weapon', w)}" alt="${sp.name}" />
              <span class="node-title">${sp.name}</span>
              <span class="node-cost">${costLabel}</span>
            </button>
          `;
        }).join('');

        const renderShieldBranch = SHIELD_ORDER.map((s, idx) => {
          const sp = SHIELDS[s];
          const unlocked = p.unlockedShields.includes(s);
          const isResearching =
            p.activeResearch?.branch === 'shield' && p.activeResearch.targetId === s;
          const isNext = s === nextS && !isResearching;
          const cls = unlocked
            ? 'node-unlocked'
            : isResearching
              ? 'node-researching'
              : isNext
                ? 'node-next'
                : 'node-locked';
          const costLabel = unlocked
            ? '✓ Açık'
            : isResearching
              ? `${sp.researchCost} 💰 (⏳)`
              : `${sp.researchCost} 💰`;
          const tip = escapeAttr(
            `T${sp.tier} ${sp.name}\nKoruma: ${sp.defense}\nAraştırma: ${sp.researchCost} Para / ${sp.researchSec} sn\nFabrika Üretimi: ${sp.prodCost} Para / ${sp.prodSec} sn`,
          );
          const edgeCls = unlocked ? 'edge-unlocked' : isResearching ? 'edge-active' : '';
          const edgeHtml = idx > 0 ? `<div class="tech-edge ${edgeCls}"></div>` : '';
          return `
            ${edgeHtml}
            <button class="tech-tree-node ${cls}" data-tech-branch="shield" data-tech-id="${s}" data-tech-next="${isNext ? '1' : '0'}" data-hover-tip="${tip}">
              <img src="${getTechItemSpriteDataUri('shield', s)}" alt="${sp.name}" />
              <span class="node-title">${sp.name}</span>
              <span class="node-cost">${costLabel}</span>
            </button>
          `;
        }).join('');

        host.innerHTML = `
          <div class="pixel-panel modal-window">
            <div class="modal-header">
              <div class="popup-title-wrap">
                <img class="popup-header-icon" src="${uIcon}" alt="" />
                <strong>🔬 Üniversite — Görsel Bilim Ağacı (${reg.id})</strong>
              </div>
              <button class="pixel-btn close-win" ${closeBtnAttrs}>✕</button>
            </div>
            ${errHtml}
            <div id="modal-live-status" class="status-line"></div>
            <div class="science-tree-wrap">
              <div class="science-root-box" data-hover-tip="${rootTip}">
                <img src="${rootUri}" style="width:54px;height:54px;image-rendering:pixelated" alt="Başlangıç" />
                <strong style="font-size:14.5px">Temel Bilim</strong>
                <span class="badge">Başlangıç</span>
              </div>
              <svg class="science-fork-svg" width="56" height="216" viewBox="0 0 56 216">
                <path d="M 0 108 L 24 108 L 24 46 L 56 46" fill="none" stroke="#22c55e" stroke-width="5" />
                <path d="M 0 108 L 24 108 L 24 170 L 56 170" fill="none" stroke="#38bdf8" stroke-width="5" />
              </svg>
              <div class="science-branches">
                <div class="science-branch-row">
                  <span class="science-branch-tag">⚔️ Silahlar</span>
                  ${renderWeaponBranch}
                </div>
                <hr class="popup-divider" />
                <div class="science-branch-row">
                  <span class="science-branch-tag">🛡️ Kalkanlar</span>
                  ${renderShieldBranch}
                </div>
              </div>
            </div>
            ${this.renderDemolishFooterHtml(reg)}
          </div>
        `;

        host.querySelector('.close-win')?.addEventListener('click', () => this.openWindow(null, false));
        host.querySelectorAll<HTMLButtonElement>('[data-tech-next="1"]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const branch = btn.dataset.techBranch as 'weapon' | 'shield';
            const res = startTechResearch(this.state, pid, branch);
            this.lastErrorMsg = res.ok ? '' : res.error || '';
            this.renderModal();
            this.updateLiveHUD();
          });
        });
        this.bindDemolishButton(host, pid, reg);
        this.updateLiveProgressInsideModal();
        return;
      }

      // 2C. HOSPITAL POPUP (`hospital`) — Healing & En-Route Wounded in THIS Hospital + Demolish
      if (this.activeWindow === 'hospital') {
        const hIcon = getBuildingSpriteDataUri('hospital', p.color);
        const batchesHere = this.state.wounded.filter(
          (w) => w.countryId === pid && w.toRegionId === reg.id,
        );
        const healingBatches = batchesHere.filter((w) => w.travelProgress >= 1);
        const incomingBatches = batchesHere.filter((w) => w.travelProgress < 1);

        const healingCount = healingBatches.reduce((s, w) => s + getTotalSoldiers(w.units), 0);
        const incomingCount = incomingBatches.reduce((s, w) => s + getTotalSoldiers(w.units), 0);

        const combinedUnits: Record<string, number> = {};
        for (const b of batchesHere) {
          for (const [k, cnt] of Object.entries(b.units)) {
            if (cnt > 0) combinedUnits[k] = (combinedUnits[k] ?? 0) + cnt;
          }
        }
        const unitEntries = getNonZeroUnits(combinedUnits);
        const avgHealPct =
          healingBatches.length > 0
            ? Math.round(
                (healingBatches.reduce(
                  (s, w) => s + Math.min(1, w.healElapsedSec / Math.max(0.1, w.healRequiredSec)),
                  0,
                ) /
                  healingBatches.length) *
                  100,
              )
            : 0;

        host.innerHTML = `
          <div class="pixel-panel modal-window" style="max-width:780px">
            <div class="modal-header">
              <div class="popup-title-wrap">
                <img class="popup-header-icon" src="${hIcon}" alt="" />
                <strong>🏥 Hastane — Yaralı Tedavi & Sağlık Merkezi (${reg.id})</strong>
              </div>
              <button class="pixel-btn close-win" ${closeBtnAttrs}>✕</button>
            </div>
            ${errHtml}
            <div class="divided-list">
              <div class="divided-item">
                <div class="card-row">
                  <span>❤️ Bu Hastanenin Katkısı:</span>
                  <b>+%${ECONOMY.HOSPITAL_HEALTH_BONUS_PCT} Ülke Sağlığı | +${ECONOMY.HOSPITAL_MANPOWER_PER_SEC} Manpower/sn</b>
                </div>
              </div>
              <div class="divided-item">
                <div class="card-row">
                  <span>🛏️ Şu An Tedavi Gören Yaralı Asker:</span>
                  <b>${healingCount} Asker ${healingCount > 0 ? `(%${avgHealPct} Tamamlandı)` : ''}</b>
                </div>
                ${
                  healingCount > 0
                    ? `<div class="item-progress-track" style="margin-top:8px"><div class="item-progress-fill" style="width:${avgHealPct}%"></div></div>`
                    : ''
                }
              </div>
              <div class="divided-item">
                <div class="card-row">
                  <span>🏃 Bu Hastaneye Yolda Olan Yaralı Asker:</span>
                  <b>${incomingCount} Asker</b>
                </div>
              </div>
              ${
                unitEntries.length > 0
                  ? `
                <div class="divided-item">
                  <h4>İyileşince Orduya Dönecek Birlikler (Eski Ekipmanlarıyla)</h4>
                  <div class="unit-icon-grid">
                    ${unitEntries.map(([k, c]) => renderUnitIconCardHtml(k, c, p.color)).join('')}
                  </div>
                </div>
              `
                  : ''
              }
            </div>
            ${this.renderDemolishFooterHtml(reg)}
          </div>
        `;

        host.querySelector('.close-win')?.addEventListener('click', () => this.openWindow(null, false));
        this.bindDemolishButton(host, pid, reg);
        return;
      }

      // 2D. ICON-ONLY BARRACKS POPUP (`barracks`) — Building-Specific Independent Training + MAX + No Names (Hover Tooltip)
      if (this.activeWindow === 'barracks') {
        const bIcon = getBuildingSpriteDataUri('barracks', p.color);
        const maxMp = Math.floor(p.manpower);

        const weaponRows = WEAPON_ORDER.map((w) => {
          const sp = WEAPONS[w];
          const stock = p.weaponsStock[w];
          const tip = escapeAttr(`${sp.name} — Hasar: ${sp.damage} (Stok: ${stock})`);
          const uri = getTechItemSpriteDataUri('weapon', w);
          return `
            <div class="divided-item">
              <div class="equip-icon-row">
                <div class="equip-icon-main">
                  <div style="display:flex;align-items:center;gap:10px">
                    <div class="equip-sprite-box" data-hover-tip="${tip}">
                      <img src="${uri}" alt="" />
                    </div>
                    <span>Stok: <b>${stock}</b></span>
                  </div>
                  <div class="mini-btn-group">
                    <input class="pixel-input barracks-eq-input" data-eq-cat="weapon" data-eq-id="${w}" data-stock="${stock}" type="number" min="0" max="${stock}" value="0" style="width:72px;padding:4px 6px" />
                    <button class="pixel-btn mini-qty-btn" data-bar-bump="1" data-target-w="${w}">+1</button>
                    <button class="pixel-btn mini-qty-btn" data-bar-bump="5" data-target-w="${w}">+5</button>
                    <button class="pixel-btn mini-qty-btn" data-bar-bump="10" data-target-w="${w}">+10</button>
                    <button class="pixel-btn mini-qty-btn" data-bar-max="1" data-target-w="${w}">MAX</button>
                  </div>
                </div>
              </div>
            </div>
          `;
        }).join('');

        const shieldRows = SHIELD_ORDER.map((s) => {
          const sp = SHIELDS[s];
          const stock = p.shieldsStock[s];
          const tip = escapeAttr(`${sp.name} — Koruma: ${sp.defense} (Stok: ${stock})`);
          const uri = getTechItemSpriteDataUri('shield', s);
          return `
            <div class="divided-item">
              <div class="equip-icon-row">
                <div class="equip-icon-main">
                  <div style="display:flex;align-items:center;gap:10px">
                    <div class="equip-sprite-box" data-hover-tip="${tip}">
                      <img src="${uri}" alt="" />
                    </div>
                    <span>Stok: <b>${stock}</b></span>
                  </div>
                  <div class="mini-btn-group">
                    <input class="pixel-input barracks-eq-input" data-eq-cat="shield" data-eq-id="${s}" data-stock="${stock}" type="number" min="0" max="${stock}" value="0" style="width:72px;padding:4px 6px" />
                    <button class="pixel-btn mini-qty-btn" data-bar-bump="1" data-target-s="${s}">+1</button>
                    <button class="pixel-btn mini-qty-btn" data-bar-bump="5" data-target-s="${s}">+5</button>
                    <button class="pixel-btn mini-qty-btn" data-bar-bump="10" data-target-s="${s}">+10</button>
                    <button class="pixel-btn mini-qty-btn" data-bar-max="1" data-target-s="${s}">MAX</button>
                  </div>
                </div>
              </div>
            </div>
          `;
        }).join('');

        host.innerHTML = `
          <div class="pixel-panel modal-window">
            <div class="modal-header">
              <div class="popup-title-wrap">
                <img class="popup-header-icon" src="${bIcon}" alt="" />
                <strong>🛡️ Kışla — Asker Eğitimi (${reg.id})</strong>
              </div>
              <button class="pixel-btn close-win" ${closeBtnAttrs}>✕</button>
            </div>
            ${errHtml}
            <div id="modal-live-status" class="status-line"></div>

            <div class="card-row" style="margin-bottom:10px">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <strong>👥 Üretilecek Asker Sayısı (Eldeki Manpower: ${maxMp}):</strong>
                <input id="barracks-soldier-qty" class="pixel-input" type="number" min="1" max="${Math.max(1, maxMp)}" value="${Math.min(5, Math.max(1, maxMp))}" style="width:90px" />
                <button class="pixel-btn active-btn" id="btn-barracks-max-soldiers">MAX (${maxMp})</button>
              </div>
              <button class="pixel-btn active-btn" id="btn-barracks-train">⚔️ Asker Yetiştir</button>
            </div>

            <hr class="popup-divider" />

            <div class="two-col">
              <div class="branch-col">
                <h4>⚔️ Silahlar (İkon Üstünde Tut = Stat)</h4>
                <div class="divided-list">${weaponRows}</div>
              </div>
              <div class="branch-col">
                <h4>🛡️ Kalkanlar (Opsiyonel — İkon Üstünde Tut = Stat)</h4>
                <div class="divided-list">${shieldRows}</div>
              </div>
            </div>

            ${this.renderDemolishFooterHtml(reg)}
          </div>
        `;

        host.querySelector('.close-win')?.addEventListener('click', () => this.openWindow(null, false));
        const soldierInp = host.querySelector('#barracks-soldier-qty') as HTMLInputElement | null;
        host.querySelector('#btn-barracks-max-soldiers')?.addEventListener('click', () => {
          if (soldierInp) soldierInp.value = String(Math.floor(p.manpower));
        });

        host.querySelectorAll<HTMLButtonElement>('[data-bar-bump]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const add = Number(btn.dataset.barBump || 0);
            const wId = btn.dataset.targetW;
            const sId = btn.dataset.targetS;
            const sel = wId
              ? `.barracks-eq-input[data-eq-cat="weapon"][data-eq-id="${wId}"]`
              : `.barracks-eq-input[data-eq-cat="shield"][data-eq-id="${sId}"]`;
            const inp = host.querySelector<HTMLInputElement>(sel);
            if (!inp) return;
            const stock = Number(inp.dataset.stock || 0);
            inp.value = String(Math.min(stock, Math.max(0, Number(inp.value || 0)) + add));
          });
        });

        host.querySelectorAll<HTMLButtonElement>('[data-bar-max]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const wId = btn.dataset.targetW;
            const sId = btn.dataset.targetS;
            const sel = wId
              ? `.barracks-eq-input[data-eq-cat="weapon"][data-eq-id="${wId}"]`
              : `.barracks-eq-input[data-eq-cat="shield"][data-eq-id="${sId}"]`;
            const inp = host.querySelector<HTMLInputElement>(sel);
            if (!inp) return;
            inp.value = String(Number(inp.dataset.stock || 0));
          });
        });

        host.querySelector('#btn-barracks-train')?.addEventListener('click', () => {
          const reqSoldiers = Number(soldierInp?.value || 0);
          const wMap: Partial<Record<WeaponId, number>> = {};
          const sMap: Partial<Record<Exclude<ShieldId, 'none'>, number>> = {};
          host.querySelectorAll<HTMLInputElement>('.barracks-eq-input').forEach((inp) => {
            const v = Math.max(0, Math.floor(Number(inp.value || 0)));
            if (v <= 0) return;
            if (inp.dataset.eqCat === 'weapon') {
              wMap[inp.dataset.eqId as WeaponId] = v;
            } else {
              sMap[inp.dataset.eqId as Exclude<ShieldId, 'none'>] = v;
            }
          });
          const res = queueBarracksTrainingBatch(this.state, pid, reg.id, reqSoldiers, wMap, sMap);
          if (!res.ok) {
            this.lastErrorMsg = res.error || 'Eğitim başlatılamadı.';
            this.renderModal();
            return;
          }
          this.lastErrorMsg = '';
          this.renderModal();
          this.updateLiveHUD();
        });

        this.bindDemolishButton(host, pid, reg);
        this.updateLiveProgressInsideModal();
        return;
      }

      // 2E. ICON-ONLY PARALLEL FACTORY POPUP (`factory`) — Non-Closing, Per-Item Loading Bars, Live Total Cost!
      if (this.activeWindow === 'factory') {
        const fIcon = getBuildingSpriteDataUri('factory', p.color);
        const lines = reg.building.parallelProduction ?? [];

        const renderFactoryCol = (cat: 'weapon' | 'shield') => {
          const ids = cat === 'weapon' ? p.unlockedWeapons : p.unlockedShields;
          return ids
            .map((id) => {
              const isW = cat === 'weapon';
              const wSp = isW ? WEAPONS[id as WeaponId] : null;
              const sSp = !isW ? SHIELDS[id as Exclude<ShieldId, 'none'>] : null;
              const cost = wSp ? wSp.prodCost : sSp!.prodCost;
              const sec = wSp ? wSp.prodSec : sSp!.prodSec;
              const stock = isW
                ? p.weaponsStock[id as WeaponId]
                : p.shieldsStock[id as Exclude<ShieldId, 'none'>];
              const tip = escapeAttr(
                wSp
                  ? `${wSp.name} — Hasar: ${wSp.damage}\nBirim Maliyet: ${cost} 💰 | Süre: ${sec} sn/ad\nMevcut Stok: ${stock}`
                  : `${sSp!.name} — Koruma: ${sSp!.defense}\nBirim Maliyet: ${cost} 💰 | Süre: ${sec} sn/ad\nMevcut Stok: ${stock}`,
              );
              const uri = getTechItemSpriteDataUri(cat, id);
              const activeLine = lines.find((l) => l.category === cat && l.itemId === id);
              const pct =
                activeLine && activeLine.unitTimeSec > 0
                  ? Math.min(100, Math.round((activeLine.progressSec / activeLine.unitTimeSec) * 100))
                  : 0;

              return `
                <div class="divided-item">
                  <div class="equip-icon-row">
                    <div class="equip-icon-main">
                      <div style="display:flex;align-items:center;gap:10px">
                        <div class="equip-sprite-box" data-hover-tip="${tip}">
                          <img src="${uri}" alt="" />
                        </div>
                        <div>
                          <div style="color:#fde047;font-weight:bold">${cost} 💰 <span class="muted">(${sec}sn)</span></div>
                          <div class="muted">Stok: <b>${stock}</b></div>
                        </div>
                      </div>
                      <div class="mini-btn-group">
                        <input class="pixel-input factory-eq-input" data-fac-cat="${cat}" data-fac-id="${id}" data-unit-cost="${cost}" type="number" min="0" max="999" value="0" style="width:72px;padding:4px 6px" />
                        <button class="pixel-btn mini-qty-btn" data-fac-bump="1" data-fac-target="${cat}:${id}">+1</button>
                        <button class="pixel-btn mini-qty-btn" data-fac-bump="5" data-fac-target="${cat}:${id}">+5</button>
                        <button class="pixel-btn mini-qty-btn" data-fac-bump="10" data-fac-target="${cat}:${id}">+10</button>
                        <button class="pixel-btn mini-qty-btn" data-fac-max="${cat}:${id}">MAX</button>
                      </div>
                    </div>
                    <div class="item-progress-wrap" data-fac-line="${cat}:${id}" style="display:${activeLine && activeLine.remainingCount > 0 ? 'flex' : 'none'}">
                      <span class="item-progress-label">⏳ Kalan: ${activeLine?.remainingCount ?? 0} (%${pct})</span>
                      <div class="item-progress-track">
                        <div class="item-progress-fill" style="width:${pct}%"></div>
                      </div>
                    </div>
                  </div>
                </div>
              `;
            })
            .join('');
        };

        host.innerHTML = `
          <div class="pixel-panel modal-window">
            <div class="modal-header">
              <div class="popup-title-wrap">
                <img class="popup-header-icon" src="${fIcon}" alt="" />
                <strong>⚙️ Fabrika — Paralel Ekipman Hatları (${reg.id})</strong>
              </div>
              <button class="pixel-btn close-win" ${closeBtnAttrs}>✕</button>
            </div>
            ${errHtml}
            <div class="status-line">
              İkonların üstüne fare tutarak stat, maliyet ve süreyi görün. Seçilen her alet bu Fabrikada <b>ayrı paralel hatta</b> üretilir; <code>✕</code> ile kapattığınızda üretim akar!
            </div>

            <div class="two-col">
              <div class="branch-col">
                <h4>⚔️ Açık Silahlar</h4>
                <div class="divided-list">${renderFactoryCol('weapon')}</div>
              </div>
              <div class="branch-col">
                <h4>🛡️ Açık Kalkanlar</h4>
                <div class="divided-list">${renderFactoryCol('shield')}</div>
              </div>
            </div>

            <hr class="popup-divider" />
            <div class="card-row">
              <div>
                <strong>💰 Toplam Sipariş Maliyeti: <span id="factory-total-cost" style="color:#fde047">0 💰</span></strong>
                <span class="muted" style="margin-left:10px">(Kasadaki Bakiye: <b>${Math.floor(p.money)} 💰</b>)</span>
              </div>
              <button class="pixel-btn active-btn" id="btn-factory-start">⚙️ Üretimi Başlat</button>
            </div>

            ${this.renderDemolishFooterHtml(reg)}
          </div>
        `;

        const computeCurrentTotalCost = (): number => {
          let sum = 0;
          host.querySelectorAll<HTMLInputElement>('.factory-eq-input').forEach((inp) => {
            const cnt = Math.max(0, Math.floor(Number(inp.value || 0)));
            const uCost = Number(inp.dataset.unitCost || 0);
            sum += cnt * uCost;
          });
          return sum;
        };

        const refreshCostLabel = (): void => {
          const total = computeCurrentTotalCost();
          const el = host.querySelector('#factory-total-cost');
          if (el) {
            el.textContent = `${total} 💰`;
            (el as HTMLElement).style.color = total > p.money ? '#f87171' : '#fde047';
          }
        };

        host.querySelector('.close-win')?.addEventListener('click', () => this.openWindow(null, false));
        host.querySelectorAll<HTMLInputElement>('.factory-eq-input').forEach((inp) => {
          inp.addEventListener('input', refreshCostLabel);
        });

        host.querySelectorAll<HTMLButtonElement>('[data-fac-bump]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const add = Number(btn.dataset.facBump || 0);
            const [cat, id] = (btn.dataset.facTarget || '').split(':');
            const inp = host.querySelector<HTMLInputElement>(
              `.factory-eq-input[data-fac-cat="${cat}"][data-fac-id="${id}"]`,
            );
            if (!inp) return;
            inp.value = String(Math.max(0, Math.floor(Number(inp.value || 0))) + add);
            refreshCostLabel();
          });
        });

        host.querySelectorAll<HTMLButtonElement>('[data-fac-max]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const [cat, id] = (btn.dataset.facMax || '').split(':');
            const targetInp = host.querySelector<HTMLInputElement>(
              `.factory-eq-input[data-fac-cat="${cat}"][data-fac-id="${id}"]`,
            );
            if (!targetInp) return;
            const uCost = Math.max(1, Number(targetInp.dataset.unitCost || 1));
            let otherCost = 0;
            host.querySelectorAll<HTMLInputElement>('.factory-eq-input').forEach((inp) => {
              if (inp === targetInp) return;
              otherCost += Math.max(0, Math.floor(Number(inp.value || 0))) * Number(inp.dataset.unitCost || 0);
            });
            const remBudget = Math.max(0, Math.floor(p.money) - otherCost);
            targetInp.value = String(Math.floor(remBudget / uCost));
            refreshCostLabel();
          });
        });

        host.querySelector('#btn-factory-start')?.addEventListener('click', () => {
          const orders: FactoryBatchItemInput[] = [];
          host.querySelectorAll<HTMLInputElement>('.factory-eq-input').forEach((inp) => {
            const cnt = Math.max(0, Math.floor(Number(inp.value || 0)));
            if (cnt <= 0) return;
            orders.push({
              category: inp.dataset.facCat as 'weapon' | 'shield',
              itemId: inp.dataset.facId as WeaponId | Exclude<ShieldId, 'none'>,
              count: cnt,
            });
          });
          const res = queueFactoryParallelBatch(this.state, pid, reg.id, orders);
          if (!res.ok) {
            this.lastErrorMsg = res.error || 'Üretim başlatılamadı.';
            this.renderModal();
            return;
          }
          // Non-closing popup rule: reset inputs, keep popup open, show separate per-item loading bars!
          this.lastErrorMsg = '';
          this.renderModal();
          this.updateLiveHUD();
        });

        this.bindDemolishButton(host, pid, reg);
        return;
      }

      // 2F. PORT POPUP (`port`) — Ship Status & Demolish
      if (this.activeWindow === 'port') {
        const pIcon = getBuildingSpriteDataUri('port', p.color);
        const ship = Object.values(this.state.ships).find(
          (s) => s.homeRegionId === reg.id && s.countryId === pid,
        );
        const carried = ship ? getTotalSoldiers(ship.units) : 0;

        host.innerHTML = `
          <div class="pixel-panel modal-window" style="max-width:720px">
            <div class="modal-header">
              <div class="popup-title-wrap">
                <img class="popup-header-icon" src="${pIcon}" alt="" />
                <strong>⚓ Liman — Deniz Taşımacılığı (${reg.id})</strong>
              </div>
              <button class="pixel-btn close-win" ${closeBtnAttrs}>✕</button>
            </div>
            ${errHtml}
            <div class="divided-list">
              <div class="divided-item">
                <div class="card-row">
                  <div>
                    <strong>🚢 Bağlı Taşıma Gemisi:</strong> ${ship ? 'Hazır (Sınırsız Kapasite)' : 'Yok'}
                    <div class="muted">Gemideki Asker: <b>${carried}</b> | Durum: <b>${ship?.targetX !== null ? 'Denizde Seyirde' : 'Kıyıda Demirli'}</b></div>
                  </div>
                  ${
                    ship
                      ? `<button class="pixel-btn active-btn" id="btn-port-select-ship">⚓ Gemiyi Seç & Hedef Göster</button>`
                      : ''
                  }
                </div>
              </div>
              <div class="divided-item">
                <div class="muted">Asker bindirmek için önce haritadaki ordunuza, ardından kıyıdaki geminize sol tıklayın. Deniz savaşı yoktur; gemiler güvenli çıkartma yapar.</div>
              </div>
            </div>
            ${this.renderDemolishFooterHtml(reg)}
          </div>
        `;

        host.querySelector('.close-win')?.addEventListener('click', () => this.openWindow(null, false));
        host.querySelector('#btn-port-select-ship')?.addEventListener('click', () => {
          if (!ship) return;
          this.openWindow(null, false);
          this.callbacks.onSelectShipForOrder?.(ship.id);
        });
        this.bindDemolishButton(host, pid, reg);
        return;
      }
    }

    // 3. ARMY POPUP (`army`) — 50/50 Split, Custom Split, Merge & Combat Retreat (`🏃 Geri Çekil`)!
    if (this.activeWindow === 'army') {
      const army = this.state.selectedArmyId ? this.state.armies[this.state.selectedArmyId] : null;
      if (!army) {
        this.activeWindow = null;
        host.innerHTML = '';
        return;
      }
      const owner = this.state.countries[army.countryId];
      const entries = getNonZeroUnits(army.units);
      const total = getTotalSoldiers(army.units);
      const isMine = army.countryId === pid;
      const inCombat = Boolean(army.inCombatWithArmyId);
      const mergeable = isMine && !inCombat ? getMergeableFriendlyArmies(this.state, army.id) : [];
      const maxVis = getMaxTierVisualsForUnits(army.units);
      const headerUnitIcon = getUnitSpriteDataUri(maxVis.weapon, maxVis.shield, owner?.color ?? '#3b82f6');

      host.innerHTML = `
        <div class="pixel-panel modal-window">
          <div class="modal-header">
            <div class="popup-title-wrap">
              <img class="popup-header-icon" src="${headerUnitIcon}" alt="" />
              <strong>⚔️ Ordu Kümesi — ${owner?.name ?? ''} (Toplam: ${total} Asker)</strong>
            </div>
            <button class="pixel-btn close-win" ${closeBtnAttrs}>✕</button>
          </div>
          ${errHtml}
          <div class="status-line">
            ${
              inCombat
                ? '🔥 Bu ordu şu an aktif çatışmada! İsterseniz <b>%10 kayıp cezasıyla</b> en yakın dost bölgeye geri çekebilirsiniz.'
                : isMine
                  ? '🖱️ Haritada hedef bölgeye/düşmana sol tıklayarak yürütün, başka bir dost orduya sol tıklayarak birleştirin (Sağ tık = İptal).'
                  : 'Yabancı devlet ordusu — birlik ikonlarının üstüne gelerek statları inceleyin.'
            }
          </div>
          <div class="unit-icon-grid">
            ${entries
              .map(([key, cnt]) => {
                const splitHtml =
                  isMine && !inCombat && total > 1
                    ? `<label style="font-size:13.5px;margin-top:4px">Ayır: <input class="pixel-input split-input" data-unit="${key}" type="number" min="0" max="${cnt}" value="0" style="width:68px;padding:4px 6px" /></label>`
                    : '';
                return renderUnitIconCardHtml(key, cnt, owner?.color ?? '#3b82f6', splitHtml);
              })
              .join('')}
          </div>
          ${
            isMine
              ? `
            <hr class="popup-divider" />
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              ${
                inCombat
                  ? `<button class="pixel-btn danger-btn" id="btn-retreat-combat">🏃 Geri Çekil (%10 Kayıp Cezası)</button>`
                  : total > 1
                    ? `
                      <button class="pixel-btn active-btn" id="btn-split-half">✂️ Yarıya Böl (50/50)</button>
                      <button class="pixel-btn" id="btn-split-army">✂️ Belirtilen Sayılarla Ayır</button>
                    `
                    : ''
              }
              ${mergeable
                .map(
                  (m) =>
                    `<button class="pixel-btn btn-merge-army" data-other="${m.id}">🔗 Yakın Kümeyle Birleştir (${getTotalSoldiers(m.units)} asker)</button>`,
                )
                .join('')}
            </div>
          `
              : ''
          }
        </div>
      `;

      host.querySelector('.close-win')?.addEventListener('click', () => this.openWindow(null, false));
      host.querySelector('#btn-retreat-combat')?.addEventListener('click', () => {
        const res = retreatFromCombat(this.state, army.id);
        if (!res.ok) {
          this.lastErrorMsg = res.error || 'Geri çekilemedi.';
          this.renderModal();
          return;
        }
        pushImportantToast(
          this.state,
          `🏃 Ordu geri çekiliyor (-${res.lostSoldiers ?? 0} kayıp).`,
          'info',
        );
        this.openWindow(null, false);
        this.updateLiveHUD();
      });
      host.querySelector('#btn-split-half')?.addEventListener('click', () => {
        const res = splitArmyHalf(this.state, army.id);
        if (!res.ok) {
          this.lastErrorMsg = res.error || '';
          this.renderModal();
          return;
        }
        this.lastErrorMsg = '';
        this.state.moveOrderMode = false;
        setAutoPauseReason(this.state, 'move_order', false);
        this.renderModal();
        this.updateLiveHUD();
      });
      host.querySelector('#btn-split-army')?.addEventListener('click', () => {
        const splitMap: Record<string, number> = {};
        host.querySelectorAll<HTMLInputElement>('.split-input').forEach((inp) => {
          const uKey = inp.dataset.unit!;
          splitMap[uKey] = Number(inp.value);
        });
        const res = splitArmyStack(this.state, army.id, splitMap);
        this.lastErrorMsg = res.ok ? '' : res.error || '';
        this.renderModal();
      });
      host.querySelectorAll<HTMLButtonElement>('.btn-merge-army').forEach((btn) => {
        btn.addEventListener('click', () => {
          const otherId = btn.dataset.other!;
          const res = mergeArmies(this.state, army.id, otherId);
          this.lastErrorMsg = res.ok ? '' : res.error || '';
          this.renderModal();
        });
      });
      return;
    }

    // 4. 2-PAGE 7-ACTION DIPLOMACY POPUP (`diplomacy`)
    if (this.activeWindow === 'diplomacy') {
      const others = Object.values(this.state.countries).filter((c) => c.id !== pid && !c.eliminated);
      const statusLabels = {
        neutral: '⚪ Nötr',
        allied: '🟢 İttifak',
        war: '🔴 Savaşta',
      };

      if (
        this.diplomacyPageCountryId &&
        (!this.state.countries[this.diplomacyPageCountryId] ||
          this.state.countries[this.diplomacyPageCountryId].eliminated)
      ) {
        this.diplomacyPageCountryId = null;
      }

      // PAGE 1 — Active Countries Grid
      if (!this.diplomacyPageCountryId) {
        const myFlag = getCountryFlagDataUri(p.color);
        host.innerHTML = `
          <div class="pixel-panel modal-window">
            <div class="modal-header">
              <div class="popup-title-wrap">
                <img class="popup-header-icon" src="${myFlag}" alt="" />
                <strong>📜 İlişkideki Ülkeler — Sayfa 1/2 (${others.length} Aktif Devlet)</strong>
              </div>
              <button class="pixel-btn close-win" ${closeBtnAttrs}>✕</button>
            </div>
            ${errHtml}
            <div class="status-line">
              İlişki detaylarını ve 7 diplomatik aksiyonu açmak için listeden bir ülkeye tıklayın.
            </div>
            <div class="dip-country-grid">
              ${others
                .map((c) => {
                  const edge = getDiplomacyEdge(this.state, pid, c.id);
                  const rel = edge?.status ?? 'neutral';
                  const regCnt = getCountryRegions(this.state, c.id).length;
                  const flagUri = getCountryFlagDataUri(c.color);
                  return `
                    <button class="dip-country-card" data-dip-card="${c.id}">
                      <span style="display:flex;align-items:center;gap:10px">
                        <img class="popup-row-icon" src="${flagUri}" alt="" />
                        <span>
                          <strong>${c.name}</strong>
                          <div class="muted">${regCnt} Bölge | Puan: ${edge?.score ?? 0}</div>
                        </span>
                      </span>
                      <span class="badge">${statusLabels[rel]}</span>
                    </button>
                  `;
                })
                .join('')}
            </div>
          </div>
        `;

        host.querySelector('.close-win')?.addEventListener('click', () => this.openWindow(null, false));
        host.querySelectorAll<HTMLButtonElement>('[data-dip-card]').forEach((btn) => {
          btn.addEventListener('click', () => {
            this.diplomacyPageCountryId = btn.dataset.dipCard || null;
            this.lastErrorMsg = '';
            this.renderModal();
          });
        });
        return;
      }

      // PAGE 2 — Specific Country Relation Detail & 7 Diplomatic Actions
      const target = this.state.countries[this.diplomacyPageCountryId];
      const edge = getDiplomacyEdge(this.state, pid, target.id)!;
      const targetFlag = getCountryFlagDataUri(target.color);
      const summary = getCountryAlliesAndWars(this.state, target.id);
      const napActive = isNonAggressionActive(this.state, pid, target.id);
      const napDays = getNonAggressionRemainingDays(this.state, pid, target.id);
      const scorePct = Math.max(0, Math.min(100, ((edge.score + 100) / 200) * 100));

      host.innerHTML = `
        <div class="pixel-panel modal-window" style="max-width:860px">
          <div class="modal-header">
            <div class="popup-title-wrap">
              <button class="pixel-btn" id="btn-dip-back">← Ülkelere Dön</button>
              <img class="popup-header-icon" src="${targetFlag}" alt="" />
              <strong>${target.name} — İlişki Sayfası (Sayfa 2/2)</strong>
            </div>
            <button class="pixel-btn close-win" ${closeBtnAttrs}>✕</button>
          </div>
          ${errHtml}

          <div class="divided-list">
            <div class="divided-item">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <span>Anlık Statü: <b>${statusLabels[edge.status]}</b> | Bölge: <b>${getCountryRegions(this.state, target.id).length}</b></span>
                <span>İlişki Puanı: <b>${edge.score} / 100</b></span>
              </div>
              <div class="relation-meter-track">
                <div class="relation-meter-zero"></div>
                <div class="relation-meter-marker" style="left:${scorePct.toFixed(1)}%"></div>
              </div>
            </div>

            <div class="divided-item">
              <div>🤝 Müttefikleri: <b>${summary.allies.map((id) => this.state.countries[id]?.name).join(', ') || 'Yok'}</b></div>
              <div>⚔️ Savaşta Oldukları: <b>${summary.wars.map((id) => this.state.countries[id]?.name).join(', ') || 'Yok'}</b></div>
              <div>📜 Aktif Anlaşmalarımız: <b>${[
                napActive ? `🛡️ Saldırmazlık Paktı (${napDays} gün kaldı)` : '',
                edge.tradeAgreement ? '💰 Ticaret Anlaşması (+%10 Gelir)' : '',
              ]
                .filter(Boolean)
                .join(' • ') || 'Yok'}</b></div>
            </div>

            <div class="divided-item">
              <h4>Diplomatik Aksiyonlar (7 Seçenek)</h4>
              <div class="divided-list">
                <div class="divided-item card-row">
                  <span><b>1. ⚔️ Savaş İlan Et</b> — ${napActive ? `Saldırmazlık Paktı aktif (${napDays} gün)` : 'Topraklarını fethetmek için savaşa girer.'}</span>
                  <button class="pixel-btn danger-btn" id="btn-dip-war" ${edge.status === 'war' || napActive ? 'disabled' : ''}>⚔️ Savaş İlan Et</button>
                </div>
                <div class="divided-item card-row">
                  <span><b>2. 🤝 İttifak Teklif Et</b> — Nötr ülkeyle ortak savunma ve geçiş paktı kurar.</span>
                  <button class="pixel-btn" id="btn-dip-ally" ${edge.status !== 'neutral' ? 'disabled' : ''}>🤝 İttifak Teklif Et</button>
                </div>
                <div class="divided-item card-row">
                  <span><b>3. 💥 İttifakı Boz</b> — Mevcut müttefikten ayrılır (-${DIPLOMACY_CONFIG.BREAK_ALLIANCE_PENALTY} ilişki cezası).</span>
                  <button class="pixel-btn danger-btn" id="btn-dip-break-ally" ${edge.status !== 'allied' ? 'disabled' : ''}>💥 İttifakı Boz</button>
                </div>
                <div class="divided-item card-row">
                  <span><b>4. 🕊️ Barış Teklif Et</b> — Devam eden savaşı ve çatışmaları sonlandırır.</span>
                  <button class="pixel-btn" id="btn-dip-peace" ${edge.status !== 'war' ? 'disabled' : ''}>🕊️ Barış Teklif Et</button>
                </div>
                <div class="divided-item card-row">
                  <span><b>5. 🎁 İlişki Geliştir</b> — <code>-${DIPLOMACY_CONFIG.GIFT_COST} 💰</code> hediye göndererek <code>+${DIPLOMACY_CONFIG.GIFT_SCORE_BONUS}</code> ilişki kazandırır.</span>
                  <button class="pixel-btn" id="btn-dip-gift" ${edge.status === 'war' || p.money < DIPLOMACY_CONFIG.GIFT_COST ? 'disabled' : ''}>🎁 Hediye Gönder (-${DIPLOMACY_CONFIG.GIFT_COST}💰)</button>
                </div>
                <div class="divided-item card-row">
                  <span><b>6. 🛡️ Saldırmazlık Paktı (1 Yıl / 365 Gün)</b> — İki taraf arasında 365 gün savaşı engeller.</span>
                  <button class="pixel-btn" id="btn-dip-nap" ${edge.status === 'war' || napActive ? 'disabled' : ''}>🛡️ Saldırmazlık Paktı</button>
                </div>
                <div class="divided-item card-row">
                  <span><b>7. 💰 Ticaret Anlaşması</b> — İki tarafa da her 5 sn'de <b>+%10 ek gelir</b> sağlar (savaşta iptal olur).</span>
                  <button class="pixel-btn" id="btn-dip-trade" ${edge.status === 'war' || edge.tradeAgreement ? 'disabled' : ''}>💰 Ticaret Anlaşması</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;

      host.querySelector('.close-win')?.addEventListener('click', () => this.openWindow(null, false));
      host.querySelector('#btn-dip-back')?.addEventListener('click', () => {
        this.diplomacyPageCountryId = null;
        this.lastErrorMsg = '';
        this.renderModal();
      });
      host.querySelector('#btn-dip-war')?.addEventListener('click', () => {
        const res = declareWar(this.state, pid, target.id);
        this.lastErrorMsg = res.ok ? '' : res.error || '';
        this.renderModal();
        this.updateLiveHUD();
      });
      host.querySelector('#btn-dip-ally')?.addEventListener('click', () => {
        const res = proposeAlliance(this.state, pid, target.id);
        this.lastErrorMsg = !res.ok
          ? res.error || ''
          : res.accepted
            ? ''
            : `${target.name} ittifak teklifini reddetti.`;
        this.renderModal();
      });
      host.querySelector('#btn-dip-break-ally')?.addEventListener('click', () => {
        const res = breakAlliance(this.state, pid, target.id);
        this.lastErrorMsg = res.ok ? '' : res.error || '';
        this.renderModal();
        this.updateLiveHUD();
      });
      host.querySelector('#btn-dip-peace')?.addEventListener('click', () => {
        const res = proposePeace(this.state, pid, target.id);
        this.lastErrorMsg = !res.ok
          ? res.error || ''
          : res.accepted
            ? ''
            : `${target.name} barış teklifini reddetti.`;
        this.renderModal();
      });
      host.querySelector('#btn-dip-gift')?.addEventListener('click', () => {
        const res = sendDiplomaticGift(this.state, pid, target.id);
        this.lastErrorMsg = res.ok ? '' : res.error || '';
        this.renderModal();
        this.updateLiveHUD();
      });
      host.querySelector('#btn-dip-nap')?.addEventListener('click', () => {
        const res = proposeNonAggressionPact(this.state, pid, target.id);
        this.lastErrorMsg = !res.ok
          ? res.error || ''
          : res.accepted
            ? ''
            : `${target.name} Saldırmazlık Paktı teklifini reddetti.`;
        this.renderModal();
      });
      host.querySelector('#btn-dip-trade')?.addEventListener('click', () => {
        const res = proposeTradeAgreement(this.state, pid, target.id);
        this.lastErrorMsg = !res.ok
          ? res.error || ''
          : res.accepted
            ? ''
            : `${target.name} Ticaret Anlaşması teklifini reddetti.`;
        this.renderModal();
        this.updateLiveHUD();
      });
      return;
    }

    // 5. 3-SLOT SAVE & EXIT POPUP (`save_exit` — opened by `🌍 Harita`)
    if (this.activeWindow === 'save_exit') {
      const slots = listSaveSlots();
      const myFlag = getCountryFlagDataUri(p.color);

      host.innerHTML = `
        <div class="pixel-panel modal-window" style="max-width:860px">
          <div class="modal-header">
            <div class="popup-title-wrap">
              <img class="popup-header-icon" src="${myFlag}" alt="" />
              <strong>🌍 Harita — 3 Slotlu Kaydet & Çık</strong>
            </div>
            <button class="pixel-btn close-win" ${closeBtnAttrs}>✕</button>
          </div>
          ${errHtml}
          <div class="status-line">
            ⏸ Oyun otomatik duraklatıldı. İlerleyişinizi 3 kayıt slotundan dilediğinize kaydedip çıkabilir veya kaydetmeden ayrılabilirsiniz.
          </div>
          <div class="divided-list">
            ${slots
              .map((s) => {
                const slotFlag = s.empty
                  ? getCountryFlagDataUri('#475569')
                  : getCountryFlagDataUri(s.countryColor || '#3b82f6');
                return `
                  <div class="divided-item">
                    <div class="card-row" style="flex-wrap:wrap">
                      <div style="display:flex;align-items:center;gap:12px">
                        <img class="popup-row-icon" src="${slotFlag}" alt="" />
                        <div>
                          <strong>Slot ${s.slotId} — ${s.empty ? 'Boş Slot' : `★ ${escapeAttr(s.countryName || '')}`}</strong>
                          <div class="muted">${s.empty ? 'Üzerine yeni kayıt yazılabilir.' : `Kayıt Tarihi: <b>${escapeAttr(s.simDateLabel || '')}</b>`}</div>
                        </div>
                      </div>
                      <div style="display:flex;gap:8px;flex-wrap:wrap">
                        <button class="pixel-btn active-btn" data-save-main="${s.slotId}">💾 Kaydet & Ana Ekrana Dön</button>
                        <button class="pixel-btn" data-save-world="${s.slotId}">💾 Kaydet & Dünya Haritasına Geç</button>
                      </div>
                    </div>
                  </div>
                `;
              })
              .join('')}
          </div>
          <hr class="popup-divider" />
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="pixel-btn danger-btn" id="btn-exit-main-nosave">🚪 Kaydetmeden Ana Ekrana Çık</button>
              <button class="pixel-btn danger-btn" id="btn-exit-world-nosave">🌍 Kaydetmeden Dünya Haritasına Geç</button>
            </div>
            <button class="pixel-btn" id="btn-cancel-save-exit">✕ İptal (Oyuna Dön)</button>
          </div>
        </div>
      `;

      host.querySelector('.close-win')?.addEventListener('click', () => this.openWindow(null, false));
      host.querySelector('#btn-cancel-save-exit')?.addEventListener('click', () => {
        this.openWindow(null, false);
      });
      host.querySelectorAll<HTMLButtonElement>('[data-save-main]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const slotId = Number(btn.dataset.saveMain) as SaveSlotId;
          this.openWindow(null, false);
          this.callbacks.onSaveAndExitToMain(slotId);
        });
      });
      host.querySelectorAll<HTMLButtonElement>('[data-save-world]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const slotId = Number(btn.dataset.saveWorld) as SaveSlotId;
          this.openWindow(null, false);
          this.callbacks.onSaveAndExitToWorld(slotId);
        });
      });
      host.querySelector('#btn-exit-main-nosave')?.addEventListener('click', () => {
        this.openWindow(null, false);
        this.callbacks.onReturnToMainMenu();
      });
      host.querySelector('#btn-exit-world-nosave')?.addEventListener('click', () => {
        this.openWindow(null, false);
        this.callbacks.onReturnToWorld();
      });
      return;
    }

    // 6. SETTINGS POPUP (`settings`)
    if (this.activeWindow === 'settings') {
      const volPct = Math.round(this.music.getVolume() * 100);
      const muted = this.music.isMuted();
      const specs = this.keyBindings.getAllSpecsWithCurrentKeys();
      const setIcon = getBuildingSpriteDataUri('university', p.color);

      host.innerHTML = `
        <div class="pixel-panel modal-window">
          <div class="modal-header">
            <div class="popup-title-wrap">
              <img class="popup-header-icon" src="${setIcon}" alt="" />
              <strong>⚙️ Ayarlar — Müzik & Tuş Atama (Key Bindings)</strong>
            </div>
            <button class="pixel-btn close-win" ${closeBtnAttrs}>✕</button>
          </div>
          ${errHtml}
          <div class="divided-list">
            <div class="divided-item card-row">
              <label for="music-vol-slider"><strong>Arka Plan Müziği Ses Seviyesi:</strong> <span id="music-vol-label">%${volPct}</span></label>
              <input id="music-vol-slider" type="range" min="0" max="100" value="${volPct}" style="width:240px;cursor:pointer" />
            </div>
            <div class="divided-item card-row">
              <span><strong>Müzik Durumu:</strong> ${muted ? '🔇 Susturuldu' : '🔊 Açık'}</span>
              <button class="pixel-btn" id="btn-music-mute">${muted ? '🔊 Sesi Aç' : '🔇 Sustur (Mute)'}</button>
            </div>
          </div>

          <hr class="popup-divider" />
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
            <strong>⌨️ Klavye Kısayolları (Değiştirmek için tuş kutusuna tıklayın)</strong>
            <button class="pixel-btn" id="btn-reset-keys">↺ Varsayılanlara Sıfırla</button>
          </div>
          <div class="keybind-grid">
            ${specs
              .map((sp) => {
                const isListening = this.listeningKeyAction === sp.id;
                return `
                  <div class="keybind-row">
                    <span>${sp.label}</span>
                    <button class="pixel-btn ${isListening ? 'active-btn' : ''}" data-rebind-action="${sp.id}">
                      ${isListening ? 'Tuşa basın...' : `[${sp.displayKey}]`}
                    </button>
                  </div>
                `;
              })
              .join('')}
          </div>
          <div class="muted" style="margin-top:8px">
            Not: <code>WASD</code> ve Ok tuşları haritayı kaydırır. Tarayıcı tam ekran çakışması nedeniyle <code>Esc</code> tuşu atanamaz.
          </div>
        </div>
      `;

      host.querySelector('.close-win')?.addEventListener('click', () => this.openWindow(null, false));
      const slider = host.querySelector('#music-vol-slider') as HTMLInputElement | null;
      slider?.addEventListener('input', () => {
        this.music.ensureStarted();
        const pct = Number(slider.value);
        this.music.setVolume(pct / 100);
        const lbl = document.getElementById('music-vol-label');
        if (lbl) lbl.textContent = `%${pct}`;
      });
      host.querySelector('#btn-music-mute')?.addEventListener('click', () => {
        this.music.ensureStarted();
        this.music.toggleMute();
        this.renderModal();
      });
      host.querySelector('#btn-reset-keys')?.addEventListener('click', () => {
        this.listeningKeyAction = null;
        this.lastErrorMsg = '';
        this.keyBindings.resetDefaults();
        this.renderModal();
      });
      host.querySelectorAll<HTMLButtonElement>('[data-rebind-action]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const act = btn.dataset.rebindAction as KeyActionId;
          this.listeningKeyAction = this.listeningKeyAction === act ? null : act;
          this.lastErrorMsg = '';
          this.renderModal();
        });
      });
    }
  }
}
