import { getTechItemSpriteDataUri, getUnitSpriteDataUri } from '../art/pixelSprites';
import { RetroMusicController } from '../audio/music';
import {
  BUILDINGS,
  CALENDAR,
  SHIELD_ORDER,
  SHIELDS,
  WEAPON_ORDER,
  WEAPONS,
} from '../config/balance';
import { type KeyActionId, KeyBindingsManager } from '../config/keybindings';
import {
  computeArmyAverageStats,
  type EncounterChoice,
  formatUnitKeyLabel,
  getMergeableFriendlyArmies,
  getNonZeroUnits,
  getTotalSoldiers,
  mergeArmies,
  parseUnitKey,
  resolveEncounterChoice,
  splitArmyStack,
} from '../sim/army';
import {
  formatSimDate,
  isAutoPaused,
  setAutoPauseReason,
  setGameSpeed,
} from '../sim/calendar';
import {
  declareWar,
  getDiplomacyEdge,
  getRelationStatus,
  proposeAlliance,
  proposePeace,
} from '../sim/diplomacy';
import {
  getCountryHealthPct,
  getCountryManpowerPerSec,
  getCountryMoneyPerSec,
  getCountryRegions,
  getEffectiveBuildingCount,
  queueBarracksTraining,
  queueFactoryProduction,
  startTechResearch,
} from '../sim/economy';
import { computeStandings } from '../sim/scoring';
import type { BuildingType, GameState, ShieldId, SpeedMultiplier, WeaponId } from '../types';

export type ActiveWindowId =
  | null
  | 'buildings'
  | 'factory'
  | 'barracks'
  | 'science'
  | 'diplomacy'
  | 'army'
  | 'settings';

export interface GameUICallbacks {
  onStartWorldSelect: () => void;
  onReturnToWorld: () => void;
  onReturnToMainMenu: () => void;
  onCycleArmyFocus: () => void;
  onEnterBuildingPlacement: (type: BuildingType) => void;
  onCancelPlacementOrOrder: () => void;
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
  selectedDiplomacyCountryId: string | null = null;
  listeningKeyAction: KeyActionId | null = null;
  tutorialOpen = false;
  tutorialStep = 0;
  lastErrorMsg = '';

  private root: HTMLDivElement;
  private state: GameState;
  private music: RetroMusicController;
  private keyBindings: KeyBindingsManager;
  private callbacks: GameUICallbacks;
  private mountedPhase: string | null = null;
  private mountedEncounterKey: string | null = null;
  private mountedPromptOpen = false;
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
        if (!res.ok) {
          this.lastErrorMsg = res.error || 'Tuş atanamadı.';
        } else if (res.swappedWith) {
          this.lastErrorMsg = '';
        } else {
          this.lastErrorMsg = '';
        }
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
    this.listeningKeyAction = null;
    const next = toggle && this.activeWindow === win ? null : win;
    if (next !== null && this.state.placingBuildingType) {
      this.state.placingBuildingType = null;
      this.state.placementHoverPoint = null;
      setAutoPauseReason(this.state, 'building_placement', false);
    }
    this.activeWindow = next;
    this.lastErrorMsg = '';
    this.hideTooltip();
    this.renderModal();
    this.syncDockButtons();
  }

  forceRefresh(): void {
    this.mountedPhase = null;
    this.mountedEncounterKey = null;
    this.hideTooltip();
    this.syncFrame();
    this.renderModal();
    if (this.tutorialOpen) this.renderTutorialOverlay();
  }

  syncFrame(): void {
    if (this.state.phase === 'main_menu') {
      if (
        this.mountedPhase !== 'main_menu' ||
        this.mountedPromptOpen !== this.state.tutorialPromptOpen
      ) {
        this.mountedPhase = 'main_menu';
        this.mountedPromptOpen = this.state.tutorialPromptOpen;
        this.activeWindow = null;
        this.mountMainMenu();
      }
      return;
    }

    if (this.state.phase === 'world_select') {
      if (this.mountedPhase !== 'world_select') {
        this.mountedPhase = 'world_select';
        this.activeWindow = null;
        this.root.innerHTML = `
          <div class="pixel-panel top-banner">
            <strong>PIXEL WORLD</strong>
            <span>Başlamak için dünya haritasından bir ülkeye tıklayın</span>
            <span id="world-hover-badge" class="badge" style="display:none"></span>
            <button class="pixel-btn" id="btn-world-tutorial" data-key-action="openTutorial">📖 Tutorial</button>
            <button class="pixel-btn" id="btn-back-main">← Ana Ekran</button>
          </div>
          <div id="tutorial-host"></div>
        `;
        document
          .getElementById('btn-world-tutorial')
          ?.addEventListener('click', () => this.openTutorial(0));
        document
          .getElementById('btn-back-main')
          ?.addEventListener('click', () => this.callbacks.onReturnToMainMenu());
        if (this.tutorialOpen) this.renderTutorialOverlay();
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
    this.updateToasts();
    this.updateLiveProgressInsideModal();
    this.syncEncounterOverlay();
  }

  private mountMainMenu(): void {
    const promptHtml = this.state.tutorialPromptOpen
      ? `
        <div class="tutorial-prompt-modal">
          <div class="pixel-panel modal-window" style="max-width:640px;text-align:center">
            <div class="modal-header" style="justify-content:center">
              <strong>📖 Tutorial Seçeneği</strong>
            </div>
            <p style="margin:16px 0;line-height:1.65;font-size:16.5px">
              Oyuna başlamadan önce <b>Pixel World</b>'ün nasıl oynandığını gösteren kısa Tutorial'ı oynamak / incelemek ister misiniz?
            </p>
            <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:18px">
              <button class="pixel-btn active-btn" id="btn-prompt-yes">📖 Evet, Tutorial'ı Aç</button>
              <button class="pixel-btn" id="btn-prompt-no">▶ Hayır, Direkt Haritaya Geç</button>
            </div>
          </div>
        </div>
      `
      : '';

    this.root.innerHTML = `
      <div class="main-menu-shell">
        <div class="pixel-panel main-menu-actions">
          <div class="muted" style="font-size:15px;color:#e2e8f0;text-align:center">
            Bölgesel Strateji • Ekonomi • Teknoloji • Savaş
          </div>
          <div class="main-menu-btn-row">
            <button class="pixel-btn hero-btn hero-btn-primary" id="btn-main-play">▶ Oyna</button>
            <button class="pixel-btn hero-btn" id="btn-main-tutorial">📖 Tutorial</button>
          </div>
        </div>
      </div>
      ${promptHtml}
      <div id="tutorial-host"></div>
    `;

    document.getElementById('btn-main-play')?.addEventListener('click', () => {
      if (!this.state.tutorialSeen) {
        this.state.tutorialPromptOpen = true;
        this.syncFrame();
      } else {
        this.callbacks.onStartWorldSelect();
      }
    });

    document.getElementById('btn-main-tutorial')?.addEventListener('click', () => {
      this.openTutorial(0);
    });

    document.getElementById('btn-prompt-yes')?.addEventListener('click', () => {
      this.openTutorial(0);
    });

    document.getElementById('btn-prompt-no')?.addEventListener('click', () => {
      this.state.tutorialSeen = true;
      this.state.tutorialPromptOpen = false;
      this.callbacks.onStartWorldSelect();
    });

    if (this.tutorialOpen) this.renderTutorialOverlay();
  }

  private renderTutorialOverlay(): void {
    const host = document.getElementById('tutorial-host');
    if (!host) return;
    if (!this.tutorialOpen) {
      host.innerHTML = '';
      return;
    }

    const bazookaUri = getUnitSpriteDataUri('bazooka', 'forcefield', '#3b82f6');
    const spearUri = getUnitSpriteDataUri('spear', 'bronze', '#22c55e');
    const rootSciUri = getTechItemSpriteDataUri('root', 'base');

    const steps = [
      {
        title: '1/5 — Dünya Haritası & Bölgesel Arena',
        body: `
          <p>🌍 Haritadan dilediğiniz ülkeye tıklayarak oyuna başlarsınız. Seçtiğiniz ülkenin etrafında en fazla <b>15 AI ülke</b> içeren aktif bir bölgesel arena açılır.</p>
          <p style="margin-top:10px">⏱️ <b>Zaman Akışı:</b> <code>1x</code> hızda gerçek 1 saniye çeyrek oyun günüdür (<code>4 sn = 1 gün</code>). Tam kampanya <code>1 Ocak 2000 → 1 Ocak ${CALENDAR.END_YEAR}</code> (~4 saat) sürer; tüm bölgeyi daha erken fethederseniz erken zafer kazanırsınız.</p>
          <p style="margin-top:10px">🔍 Fare tekerleğiyle haritaya yaklaştığınızda binalar ve askerler haritayla birlikte büyür; detaylı pixel art'ları yakından inceleyebilirsiniz.</p>
        `,
      },
      {
        title: '2/5 — Ekonomi & Fareyle Manuel Bina Kurma',
        body: `
          <p>💰 <b>Banka</b> para (<code>+12/sn</code>), ❤️ <b>Hastane</b> sağlık ve Manpower artışı sağlar. Her bölgeye en fazla <b>1 bina</b> kurulur.</p>
          <p style="margin-top:10px">🖱️ <b>Manuel Yerleştirme & Otomatik Duraklatma:</b> <b>Binalar</b> menüsünden bir bina seçtiğinizde <b>oyun otomatik durur</b> ve binayı haritada fareyle istediğiniz noktaya sol tıklayarak yerleştirirsiniz (Sağ tık = İptal).</p>
        `,
      },
      {
        title: '3/5 — Görsel Bilim Ağacı, Fabrika & Kışla',
        body: `
          <div style="display:flex;align-items:center;gap:14px;margin-bottom:10px">
            <img src="${rootSciUri}" style="width:56px;height:56px" alt="Bilim" />
            <span>🔬 <b>Üniversite (Bilim Ağacı):</b> Başlangıç düğümünden <b>Silah</b> ve <b>Kalkan</b> olarak iki dala ayrılır. İkonların altında gereken para yazar, fareyle üstüne gelince tüm statlar görünür.</span>
          </div>
          <p>⚙️ <b>Fabrika</b>'da açtığınız silah ve kalkanları üretir, 🛡️ <b>Kışla</b>'da Manpower + ekipman birleştirerek asker yetiştirirsiniz.</p>
        `,
      },
      {
        title: '4/5 — Ordular, Karşılaşma Popup\'ı, Hastane & Liman',
        body: `
          <div style="display:flex;align-items:center;gap:14px;margin-bottom:10px">
            <img src="${spearUri}" style="width:60px;height:54px" alt="Asker" />
            <img src="${bazookaUri}" style="width:60px;height:54px" alt="Bazuka" />
            <span>⚔️ Ordunuza sol tıklayınca oyun düşünmeniz için duraklatılır; gideceği hedefe sol tıklayın (Sağ tık = İptal). Ordular günde ~1 bölge hızıyla ilerler ve yalnızca durup savaştıkları/hedefledikleri bölgeyi fetheder.</span>
          </div>
          <p>🚨 <b>Karşılaşma Popup'ı:</b> Önünüze başka devletin askeri çıkarsa oyun durur; iki tarafın ikonlu birlik sayıları ve üstte <b>Diplomasi</b> sekmesiyle karar verirsiniz. Çatışmada düşenlerin <b>%30'u</b> ayakta Hastane varsa iyileşip eski ekipmanıyla döner. Kıyı ülkeleri <b>Liman</b> gemisiyle denizden asker taşır.</p>
        `,
      },
      {
        title: '5/5 — Ordu Odaklanma (Q), Diplomasi & Tuş Atama',
        body: `
          <p>🎯 <b>Ordularınızı Bulma:</b> Kendi ordularınız haritada parlak ülke rengi dış çizgi ve <code>★</code> yıldızlı rozetle görünür. Üst bardaki <b>🎯 Ordum</b> butonuna veya <b>[${this.keyBindings.getDisplayLabel('cycleArmy')}]</b> tuşuna her bastığınızda kamera sırayla birliklerinizin üzerine zoomlar.</p>
          <p style="margin-top:10px">⌨️ <b>Tuş Atama (Key Binding):</b> <b>Ayarlar</b> menüsünden tüm kısayolları değiştirebilirsiniz. Ekranda klavyeyle kontrol edilebilen herhangi bir butonun üstüne fareyle geldiğinizde atalı tuş not olarak gösterilir.</p>
        `,
      },
    ];

    const cur = steps[this.tutorialStep] ?? steps[0];

    host.innerHTML = `
      <div class="tutorial-prompt-modal">
        <div class="pixel-panel modal-window" style="max-width:880px">
          <div class="modal-header">
            <strong>📖 Pixel World — ${cur.title}</strong>
            <button class="pixel-btn" id="btn-tut-close">✕</button>
          </div>
          <div class="tab-strip">
            ${steps
              .map(
                (_, idx) => `
              <button class="pixel-btn ${idx === this.tutorialStep ? 'active-btn' : ''}" data-tut-step="${idx}">
                Adım ${idx + 1}
              </button>
            `,
              )
              .join('')}
          </div>
          <div style="line-height:1.7;font-size:16.5px;padding:10px 4px;min-height:185px">
            ${cur.body}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;gap:10px;flex-wrap:wrap">
            <div style="display:flex;gap:10px">
              <button class="pixel-btn" id="btn-tut-prev" ${this.tutorialStep === 0 ? 'disabled' : ''}>◀ Önceki</button>
              <button class="pixel-btn" id="btn-tut-next" ${this.tutorialStep === steps.length - 1 ? 'disabled' : ''}>Sonraki ▶</button>
            </div>
            ${
              this.state.phase === 'main_menu'
                ? `<button class="pixel-btn active-btn" id="btn-tut-start-play">▶ Haritaya Geç / Oyna</button>`
                : `<button class="pixel-btn active-btn" id="btn-tut-done">✓ Anladım, Devam Et</button>`
            }
          </div>
        </div>
      </div>
    `;

    host.querySelector('#btn-tut-close')?.addEventListener('click', () => this.closeTutorial());
    host.querySelector('#btn-tut-done')?.addEventListener('click', () => this.closeTutorial());
    host.querySelector('#btn-tut-prev')?.addEventListener('click', () => {
      if (this.tutorialStep > 0) this.openTutorial(this.tutorialStep - 1);
    });
    host.querySelector('#btn-tut-next')?.addEventListener('click', () => {
      if (this.tutorialStep < steps.length - 1) this.openTutorial(this.tutorialStep + 1);
    });
    host.querySelectorAll<HTMLButtonElement>('[data-tut-step]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.openTutorial(Number(btn.dataset.tutStep || 0));
      });
    });
    host.querySelector('#btn-tut-start-play')?.addEventListener('click', () => {
      this.closeTutorial();
      this.callbacks.onStartWorldSelect();
    });
  }

  private mountEndedScreen(): void {
    const standings = computeStandings(this.state);
    const playerRow = standings.find((s) => s.isPlayer);
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
            <strong>${title}</strong>
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
                    <td>${s.isPlayer ? '★ ' : ''}${s.name}${s.eliminated ? ' (Elendi)' : ''}</td>
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
          <span>💰 <b id="hud-money">300</b> (<span id="hud-money-rate">+5</span>/s)</span>
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
          <button class="pixel-btn dock-btn" data-win="settings" data-key-action="openSettings">⚙️ Ayarlar</button>
        </div>
      </div>

      <div id="toast-strip" class="toast-strip"></div>

      <div class="hud-dock pixel-panel">
        <button class="pixel-btn dock-btn" data-win="buildings" data-key-action="openBuildings">🏗️ Binalar</button>
        <button class="pixel-btn dock-btn" data-win="factory" data-key-action="openFactory">⚙️ Fabrika</button>
        <button class="pixel-btn dock-btn" data-win="barracks" data-key-action="openBarracks">🛡️ Kışla</button>
        <button class="pixel-btn dock-btn" data-win="science" data-key-action="openScience">🔬 Bilim</button>
        <button class="pixel-btn dock-btn" data-win="diplomacy" data-key-action="openDiplomacy">📜 Diplomasi</button>
        <button class="pixel-btn" id="btn-world-reset">🌍 Harita</button>
      </div>

      <div id="region-bar" class="side-inspector pixel-panel" style="display:none"></div>
      <div id="modal-host" class="modal-host"></div>
      <div id="encounter-host"></div>
      <div id="tutorial-host"></div>
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

    document.getElementById('btn-cycle-army')?.addEventListener('click', () => {
      this.callbacks.onCycleArmyFocus();
    });

    document.getElementById('btn-hud-tutorial')?.addEventListener('click', () => {
      this.toggleTutorial();
    });

    document.getElementById('btn-cancel-action')?.addEventListener('click', () => {
      this.callbacks.onCancelPlacementOrOrder();
    });

    document.getElementById('btn-world-reset')?.addEventListener('click', () => {
      this.callbacks.onReturnToWorld();
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

    setTxt('hud-country', `★ ${p.name}`);
    setTxt('hud-date', formatSimDate(this.state.simDaysElapsed));
    setTxt('hud-money', `${Math.floor(p.money)}`);
    setTxt('hud-money-rate', `+${getCountryMoneyPerSec(this.state, pid)}`);
    setTxt('hud-mp', `${Math.floor(p.manpower)}`);
    setTxt('hud-mp-rate', `+${getCountryManpowerPerSec(this.state, pid)}`);
    setTxt('hud-health', `%${getCountryHealthPct(this.state, pid)}`);

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
        autoBadge.textContent = '⏸ Eylem İçin Duraklatıldı';
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
        const reg = this.state.selectedRegionId ? this.state.regions[this.state.selectedRegionId] : null;
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

    let bodyHtml = '';
    if (enc.activeTab === 'encounter') {
      const actionButtons =
        enc.relation === 'war'
          ? `
            <button class="pixel-btn active-btn" data-enc-choice="attack">⚔️ Saldır / Çatışmaya Gir</button>
            <button class="pixel-btn" data-enc-choice="stand_down">🏃 Dur / Geri Çekil</button>
          `
          : enc.relation === 'neutral'
            ? `
            <button class="pixel-btn" style="border-color:#ef4444;color:#fecaca" data-enc-choice="declare_war_attack">⚔️ Savaş İlan Et ve Saldır</button>
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
            <div class="unit-icon-grid">
              ${myUnits.map(([k, c]) => renderUnitIconCardHtml(k, c, me.color)).join('')}
            </div>
          </div>
          <div class="army-vs-box">
            <strong>🚩 ${otherCountry.name} Ordusu</strong>
            <div class="muted">Toplam: <b>${otherStats.count} Asker</b> | Ort. Hasar: <b>${otherStats.avgDamage.toFixed(1)}</b> | Ort. Koruma: <b>${otherStats.avgDefense.toFixed(1)}</b></div>
            <div class="unit-icon-grid">
              ${otherUnits.map(([k, c]) => renderUnitIconCardHtml(k, c, otherCountry.color)).join('')}
            </div>
          </div>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px">
          ${actionButtons}
        </div>
      `;
    } else {
      // Diplomacy tab inside Encounter popup showing inter-country relations!
      const activeCountries = Object.values(this.state.countries).filter((c) => !c.eliminated);
      const others = activeCountries.filter((c) => c.id !== pid);
      const focusDipId =
        this.selectedDiplomacyCountryId && this.state.countries[this.selectedDiplomacyCountryId]
          ? this.selectedDiplomacyCountryId
          : otherCountry.id;
      const dipTarget = this.state.countries[focusDipId] ?? otherCountry;
      const dipEdge = getDiplomacyEdge(this.state, pid, dipTarget.id);

      const getForeignRelationsSummary = (cid: string) => {
        const wars: string[] = [];
        const allies: string[] = [];
        for (const other of activeCountries) {
          if (other.id === cid) continue;
          const st = getRelationStatus(this.state, cid, other.id);
          if (st === 'war') wars.push(other.name);
          else if (st === 'allied') allies.push(other.name);
        }
        return {
          wars: wars.length > 0 ? wars.join(', ') : 'Yok',
          allies: allies.length > 0 ? allies.join(', ') : 'Yok',
        };
      };

      const relSummary = getForeignRelationsSummary(dipTarget.id);

      bodyHtml = `
        <div class="status-line">
          📜 <b>Ülkeler Arası İlişkiler</b> — Karşılaştığınız <b>${otherCountry.name}</b> ve diğer devletlerin diplomatik durumu:
        </div>
        <div class="two-col">
          <div class="branch-col" style="max-height:340px;overflow-y:auto">
            ${others
              .map((c) => {
                const r = getRelationStatus(this.state, pid, c.id);
                const mark = c.id === otherCountry.id ? '⚔️ ' : '';
                return `
                  <button class="pixel-btn ${c.id === dipTarget.id ? 'active-btn' : ''}" data-enc-dip="${c.id}" style="display:flex;justify-content:space-between">
                    <span>${mark}${c.name}</span>
                    <span>${relLabels[r]}</span>
                  </button>
                `;
              })
              .join('')}
          </div>
          <div class="army-vs-box">
            <strong>${dipTarget.name} — Diplomatik Dosya</strong>
            <div>Bizimle İlişki: <b>${relLabels[dipEdge?.status ?? 'neutral']} (${dipEdge?.score ?? 0})</b></div>
            <div>Müttefikleri: <b>${relSummary.allies}</b></div>
            <div>Savaşta Oldukları: <b>${relSummary.wars}</b></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
              ${
                dipEdge?.status !== 'war'
                  ? `<button class="pixel-btn" id="btn-enc-dip-war">⚔️ Savaş İlan Et</button>`
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
            <strong>⚔️ Ordu Karşılaşması — ${otherCountry.name}</strong>
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
        resolveEncounterChoice(this.state, ch);
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
      declareWar(this.state, pid, focusDipId);
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

    const liveBox = document.getElementById('modal-live-status');
    if (!liveBox) return;

    if (this.activeWindow === 'science') {
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
          'Aktif araştırma yok — Ağaçtaki sarı çerçeveli sıradaki ikona tıklayarak araştırma başlatın (İkonların üstüne gelince statlar görünür).';
      }
    } else if (this.activeWindow === 'factory') {
      const q = p.productionQueue[0];
      const wSummary = WEAPON_ORDER.map((w) => `${WEAPONS[w].name}:${p.weaponsStock[w]}`).join(' ');
      const sSummary = SHIELD_ORDER.map((s) => `${SHIELDS[s].name}:${p.shieldsStock[s]}`).join(' ');
      liveBox.textContent = q
        ? `Üretiliyor: ${q.itemId} (Kalan: ${q.remainingCount}) | Silah: [${wSummary}] | Kalkan: [${sSummary}]`
        : `Fabrika boşta | Silah: [${wSummary}] | Kalkan: [${sSummary}]`;
    } else if (this.activeWindow === 'barracks') {
      const q = p.trainingQueue[0];
      liveBox.textContent = q
        ? `Eğitiliyor: ${WEAPONS[q.weapon].name} + ${q.shield === 'none' ? 'Kalkansız' : SHIELDS[q.shield].name} (Kalan: ${q.remainingCount})`
        : 'Kışla boşta.';
    }
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
      const mergeable = isMine ? getMergeableFriendlyArmies(this.state, army.id) : [];

      host.innerHTML = `
        <div class="pixel-panel modal-window">
          <div class="modal-header">
            <strong>⚔️ Ordu Kümesi — ${owner?.name ?? ''} (Toplam: ${total} Asker)</strong>
            <button class="pixel-btn close-win">✕</button>
          </div>
          ${errHtml}
          <div class="muted" style="margin-bottom:10px">
            Birlik ikonlarının üstüne fare tutarak sayı, silah ve kalkan statlarını inceleyebilirsiniz.
            ${isMine ? ' Haritada hedefe sol tıklayarak yürüyüş emri verin (Sağ tık = İptal).' : ''}
          </div>
          <div class="unit-icon-grid">
            ${entries
              .map(([key, cnt]) => {
                const splitHtml =
                  isMine && total > 1
                    ? `<label style="font-size:13.5px;margin-top:4px">Ayır: <input class="pixel-input split-input" data-unit="${key}" type="number" min="0" max="${cnt}" value="0" style="width:68px;padding:4px 6px" /></label>`
                    : '';
                return renderUnitIconCardHtml(key, cnt, owner?.color ?? '#3b82f6', splitHtml);
              })
              .join('')}
          </div>
          ${
            isMine
              ? `
            <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
              ${
                total > 1
                  ? `<button class="pixel-btn" id="btn-split-army">✂️ Belirtilen Sayılarla Ayır</button>`
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

    if (this.activeWindow === 'diplomacy') {
      const others = Object.values(this.state.countries).filter((c) => c.id !== pid && !c.eliminated);
      if (
        !this.selectedDiplomacyCountryId ||
        !this.state.countries[this.selectedDiplomacyCountryId] ||
        this.state.countries[this.selectedDiplomacyCountryId].eliminated
      ) {
        this.selectedDiplomacyCountryId = others[0]?.id ?? null;
      }
      const target = this.selectedDiplomacyCountryId
        ? this.state.countries[this.selectedDiplomacyCountryId]
        : null;
      const edge = target ? getDiplomacyEdge(this.state, pid, target.id) : null;
      const statusLabels = {
        neutral: '⚪ Nötr',
        allied: '🟢 İttifak',
        war: '🔴 Savaşta',
      };

      host.innerHTML = `
        <div class="pixel-panel modal-window">
          <div class="modal-header">
            <strong>📜 Diplomasi — Aktif Ülkeler (${others.length})</strong>
            <button class="pixel-btn close-win">✕</button>
          </div>
          ${errHtml}
          <div class="two-col">
            <div class="branch-col">
              <h4>Ülkeler</h4>
              ${others
                .map((c) => {
                  const rel = getDiplomacyEdge(this.state, pid, c.id)?.status ?? 'neutral';
                  const regCnt = getCountryRegions(this.state, c.id).length;
                  return `
                    <button class="pixel-btn ${c.id === target?.id ? 'active-btn' : ''}" data-dip-id="${c.id}" style="text-align:left;display:flex;justify-content:space-between">
                      <span>${c.name} (${regCnt})</span>
                      <span>${statusLabels[rel]}</span>
                    </button>
                  `;
                })
                .join('')}
            </div>
            <div class="branch-col">
              ${
                target && edge
                  ? `
                <h4>${target.name} Sayfası</h4>
                <div class="card-row"><span>İlişki Durumu:</span> <b>${statusLabels[edge.status]} (${edge.score})</b></div>
                <div class="card-row"><span>Bölge Sayısı:</span> <b>${getCountryRegions(this.state, target.id).length}</b></div>
                <div class="card-row"><span>Profil:</span> <b>${target.personality}</b></div>
                <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
                  ${
                    edge.status !== 'war'
                      ? `<button class="pixel-btn" id="btn-dip-war">⚔️ Savaş İlan Et</button>`
                      : `<button class="pixel-btn" id="btn-dip-peace">🕊️ Barış Teklif Et</button>`
                  }
                  ${
                    edge.status === 'neutral'
                      ? `<button class="pixel-btn" id="btn-dip-ally">🤝 İttifak Teklif Et</button>`
                      : ''
                  }
                </div>
              `
                  : '<div class="muted">Aktif ülke kalmadı.</div>'
              }
            </div>
          </div>
        </div>
      `;

      host.querySelector('.close-win')?.addEventListener('click', () => this.openWindow(null, false));
      host.querySelectorAll<HTMLButtonElement>('[data-dip-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.selectedDiplomacyCountryId = btn.dataset.dipId || null;
          this.lastErrorMsg = '';
          this.renderModal();
        });
      });
      host.querySelector('#btn-dip-war')?.addEventListener('click', () => {
        if (!target) return;
        const res = declareWar(this.state, pid, target.id);
        this.lastErrorMsg = res.ok ? '' : res.error || '';
        this.renderModal();
      });
      host.querySelector('#btn-dip-ally')?.addEventListener('click', () => {
        if (!target) return;
        const res = proposeAlliance(this.state, pid, target.id);
        this.lastErrorMsg = !res.ok
          ? res.error || ''
          : res.accepted
            ? ''
            : `${target.name} ittifak teklifini reddetti.`;
        this.renderModal();
      });
      host.querySelector('#btn-dip-peace')?.addEventListener('click', () => {
        if (!target) return;
        const res = proposePeace(this.state, pid, target.id);
        this.lastErrorMsg = !res.ok
          ? res.error || ''
          : res.accepted
            ? ''
            : `${target.name} barış teklifini reddetti.`;
        this.renderModal();
      });
      return;
    }

    if (this.activeWindow === 'buildings') {
      const owned = getCountryRegions(this.state, pid);
      const hasCoastal = owned.some((r) => r.isCoastal);

      const buildTypes: BuildingType[] = [
        'barracks',
        'hospital',
        'bank',
        'factory',
        'university',
        'port',
      ];

      host.innerHTML = `
        <div class="pixel-panel modal-window">
          <div class="modal-header">
            <strong>🏗️ Satın Alma & Fareyle Bina Yerleştirme</strong>
            <button class="pixel-btn close-win">✕</button>
          </div>
          ${errHtml}
          <div class="status-line">
            🖱️ Kurmak istediğiniz binayı seçin → <b>Oyun otomatik duraklatılır</b> ve binayı haritada fareyle tam istediğiniz noktaya sol tıklayarak yerleştirirsiniz (Sağ tık = İptal).
          </div>
          <div class="card-list">
            ${buildTypes
              .map((bt) => {
                const spec = BUILDINGS[bt];
                const count = getEffectiveBuildingCount(this.state, pid, bt);
                const disabledCoast = bt === 'port' && !hasCoastal;
                return `
                  <div class="card-row">
                    <div>
                      <strong>${spec.name}</strong> <span class="badge">Aktif: ${count}</span>
                      <div class="muted">${spec.description} (${spec.buildSec} sn)</div>
                    </div>
                    <button class="pixel-btn btn-place-building" data-type="${bt}" ${disabledCoast ? 'disabled' : ''}>
                      🖱️ Haritaya Yerleştir (${spec.cost}💰)
                    </button>
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
            this.lastErrorMsg = `Yetersiz para (${BUILDINGS[bt].cost} gerekli).`;
            this.renderModal();
            return;
          }
          this.callbacks.onEnterBuildingPlacement(bt);
        });
      });
      return;
    }

    if (this.activeWindow === 'science') {
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
        const statusStr = unlocked
          ? 'Açık (Fabrikada üretilebilir)'
          : isResearching
            ? 'Şu an araştırılıyor'
            : isNext
              ? 'Tıkla: Araştırmayı Başlat'
              : 'Önceki kademe gerekli';
        const tip = escapeAttr(
          `T${sp.tier} ${sp.name}\nHasar: ${sp.damage}\nAraştırma: ${sp.researchCost} Para / ${sp.researchSec} sn\nFabrika Üretimi: ${sp.prodCost} Para / ${sp.prodSec} sn\nDurum: ${statusStr}`,
        );
        const edgeCls = unlocked ? 'edge-unlocked' : isResearching ? 'edge-active' : '';
        const edgeHtml = idx > 0 ? `<div class="tech-edge ${edgeCls}"></div>` : '';
        const iconUri = getTechItemSpriteDataUri('weapon', w);
        return `
          ${edgeHtml}
          <button class="tech-tree-node ${cls}" data-tech-branch="weapon" data-tech-id="${w}" data-tech-next="${isNext ? '1' : '0'}" data-hover-tip="${tip}">
            <img src="${iconUri}" alt="${sp.name}" />
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
        const statusStr = unlocked
          ? 'Açık (Fabrikada üretilebilir)'
          : isResearching
            ? 'Şu an araştırılıyor'
            : isNext
              ? 'Tıkla: Araştırmayı Başlat'
              : 'Önceki kademe gerekli';
        const tip = escapeAttr(
          `T${sp.tier} ${sp.name}\nKoruma: ${sp.defense}\nAraştırma: ${sp.researchCost} Para / ${sp.researchSec} sn\nFabrika Üretimi: ${sp.prodCost} Para / ${sp.prodSec} sn\nDurum: ${statusStr}`,
        );
        const edgeCls = unlocked ? 'edge-unlocked' : isResearching ? 'edge-active' : '';
        const edgeHtml = idx > 0 ? `<div class="tech-edge ${edgeCls}"></div>` : '';
        const iconUri = getTechItemSpriteDataUri('shield', s);
        return `
          ${edgeHtml}
          <button class="tech-tree-node ${cls}" data-tech-branch="shield" data-tech-id="${s}" data-tech-next="${isNext ? '1' : '0'}" data-hover-tip="${tip}">
            <img src="${iconUri}" alt="${sp.name}" />
            <span class="node-title">${sp.name}</span>
            <span class="node-cost">${costLabel}</span>
          </button>
        `;
      }).join('');

      host.innerHTML = `
        <div class="pixel-panel modal-window">
          <div class="modal-header">
            <strong>🔬 Üniversite — Görsel Bilim Ağacı</strong>
            <button class="pixel-btn close-win">✕</button>
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
              <div class="science-branch-row">
                <span class="science-branch-tag">🛡️ Kalkanlar</span>
                ${renderShieldBranch}
              </div>
            </div>
          </div>
        </div>
      `;

      host.querySelector('.close-win')?.addEventListener('click', () => this.openWindow(null, false));
      host.querySelectorAll<HTMLButtonElement>('[data-tech-next="1"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const branch = btn.dataset.techBranch as 'weapon' | 'shield';
          const res = startTechResearch(this.state, pid, branch);
          this.lastErrorMsg = res.ok ? '' : res.error || '';
          this.renderModal();
        });
      });
      this.updateLiveProgressInsideModal();
      return;
    }

    if (this.activeWindow === 'factory') {
      host.innerHTML = `
        <div class="pixel-panel modal-window">
          <div class="modal-header">
            <strong>⚙️ Fabrika — Ekipman Üretimi</strong>
            <button class="pixel-btn close-win">✕</button>
          </div>
          ${errHtml}
          <div id="modal-live-status" class="status-line"></div>
          <div style="margin:10px 0">
            Emir Adedi: <input id="prod-qty" class="pixel-input" type="number" min="1" max="500" value="10" />
          </div>
          <div class="two-col">
            <div class="branch-col">
              <h4>Açık Silahlar</h4>
              ${p.unlockedWeapons
                .map((w) => {
                  const sp = WEAPONS[w];
                  return `
                    <div class="card-row">
                      <span style="display:flex;align-items:center;gap:10px">
                        <img src="${getTechItemSpriteDataUri('weapon', w)}" style="width:32px;height:32px;image-rendering:pixelated" alt="" />
                        <b>${sp.name}</b> (Hasar ${sp.damage}, ${sp.prodCost}💰/ad)
                      </span>
                      <button class="pixel-btn btn-prod" data-cat="weapon" data-id="${w}">Üret</button>
                    </div>
                  `;
                })
                .join('')}
            </div>
            <div class="branch-col">
              <h4>Açık Kalkanlar</h4>
              ${p.unlockedShields
                .map((s) => {
                  const sp = SHIELDS[s];
                  return `
                    <div class="card-row">
                      <span style="display:flex;align-items:center;gap:10px">
                        <img src="${getTechItemSpriteDataUri('shield', s)}" style="width:32px;height:32px;image-rendering:pixelated" alt="" />
                        <b>${sp.name}</b> (Koruma ${sp.defense}, ${sp.prodCost}💰/ad)
                      </span>
                      <button class="pixel-btn btn-prod" data-cat="shield" data-id="${s}">Üret</button>
                    </div>
                  `;
                })
                .join('')}
            </div>
          </div>
        </div>
      `;
      host.querySelector('.close-win')?.addEventListener('click', () => this.openWindow(null, false));
      host.querySelectorAll<HTMLButtonElement>('.btn-prod').forEach((btn) => {
        btn.addEventListener('click', () => {
          const qty = Math.max(
            1,
            Number((document.getElementById('prod-qty') as HTMLInputElement)?.value || 1),
          );
          const cat = btn.dataset.cat as 'weapon' | 'shield';
          const id = btn.dataset.id as WeaponId | Exclude<ShieldId, 'none'>;
          const res = queueFactoryProduction(this.state, pid, cat, id, qty);
          this.lastErrorMsg = res.ok ? '' : res.error || '';
          if (!res.ok) this.renderModal();
          else this.updateLiveProgressInsideModal();
        });
      });
      this.updateLiveProgressInsideModal();
      return;
    }

    if (this.activeWindow === 'barracks') {
      host.innerHTML = `
        <div class="pixel-panel modal-window">
          <div class="modal-header">
            <strong>🛡️ Kışla — Asker Yetiştirme</strong>
            <button class="pixel-btn close-win">✕</button>
          </div>
          ${errHtml}
          <div id="modal-live-status" class="status-line"></div>
          <div class="form-grid">
            <label>Silah Seçimi:
              <select id="train-weapon" class="pixel-input">
                ${p.unlockedWeapons
                  .map(
                    (w) =>
                      `<option value="${w}">${WEAPONS[w].name} (Stok: ${p.weaponsStock[w]})</option>`,
                  )
                  .join('')}
              </select>
            </label>
            <label>Kalkan Seçimi:
              <select id="train-shield" class="pixel-input">
                <option value="none">Kalkansız (Koruma 0)</option>
                ${p.unlockedShields
                  .map(
                    (s) =>
                      `<option value="${s}">${SHIELDS[s].name} (Stok: ${p.shieldsStock[s]})</option>`,
                  )
                  .join('')}
              </select>
            </label>
            <label>Asker Sayısı:
              <input id="train-qty" class="pixel-input" type="number" min="1" max="500" value="5" />
            </label>
            <button class="pixel-btn" id="btn-train-submit">Asker Yetiştir</button>
          </div>
        </div>
      `;
      host.querySelector('.close-win')?.addEventListener('click', () => this.openWindow(null, false));
      host.querySelector('#btn-train-submit')?.addEventListener('click', () => {
        const w = (document.getElementById('train-weapon') as HTMLSelectElement).value as WeaponId;
        const s = (document.getElementById('train-shield') as HTMLSelectElement).value as ShieldId;
        const qty = Math.max(
          1,
          Number((document.getElementById('train-qty') as HTMLInputElement).value || 1),
        );
        const res = queueBarracksTraining(this.state, pid, w, s, qty);
        this.lastErrorMsg = res.ok ? '' : res.error || '';
        this.renderModal();
      });
      this.updateLiveProgressInsideModal();
      return;
    }

    if (this.activeWindow === 'settings') {
      const volPct = Math.round(this.music.getVolume() * 100);
      const muted = this.music.isMuted();
      const specs = this.keyBindings.getAllSpecsWithCurrentKeys();

      host.innerHTML = `
        <div class="pixel-panel modal-window">
          <div class="modal-header">
            <strong>⚙️ Ayarlar — Müzik & Tuş Atama (Key Bindings)</strong>
            <button class="pixel-btn close-win">✕</button>
          </div>
          ${errHtml}
          <div class="card-list">
            <div class="card-row">
              <label for="music-vol-slider"><strong>Arka Plan Müziği Ses Seviyesi:</strong> <span id="music-vol-label">%${volPct}</span></label>
              <input id="music-vol-slider" type="range" min="0" max="100" value="${volPct}" style="width:240px;cursor:pointer" />
            </div>
            <div class="card-row">
              <span><strong>Müzik Durumu:</strong> ${muted ? '🔇 Susturuldu' : '🔊 Açık'}</span>
              <button class="pixel-btn" id="btn-music-mute">${muted ? '🔊 Sesi Aç' : '🔇 Sustur (Mute)'}</button>
            </div>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px">
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
            Not: Tarayıcı tam ekran çakışması nedeniyle <code>Esc</code> tuşu atanamaz. Kısayol atanmış butonların üstüne fareyle geldiğinizde güncel tuş otomatik olarak gösterilir.
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
