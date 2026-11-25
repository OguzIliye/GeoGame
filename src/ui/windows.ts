import {
  BUILDINGS,
  COMBINED_UPGRADE_COSTS,
  SHIELD_ORDER,
  SHIELDS,
  WEAPON_ORDER,
  WEAPONS,
} from '../config/balance';
import {
  formatUnitKeyLabel,
  getMergeableFriendlyArmies,
  getNonZeroUnits,
  getTotalSoldiers,
  mergeArmies,
  splitArmyStack,
} from '../sim/army';
import { formatSimDate, setGameSpeed } from '../sim/calendar';
import { declareWar, getDiplomacyEdge, proposeAlliance, proposePeace } from '../sim/diplomacy';
import {
  getCountryHealthPct,
  getCountryManpowerPerSec,
  getCountryMoneyPerSec,
  getCountryRegions,
  getEffectiveBuildingCount,
  queueBarracksTraining,
  queueFactoryProduction,
  startBuildingConstruction,
  startCombinedBuildingUpgrade,
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

export class GameUIController {
  activeWindow: ActiveWindowId = null;
  selectedDiplomacyCountryId: string | null = null;
  lastErrorMsg = '';
  private root: HTMLDivElement;
  private state: GameState;
  private onReturnToWorld: () => void;
  private mountedPhase: string | null = null;

  constructor(root: HTMLDivElement, state: GameState, onReturnToWorld: () => void) {
    this.root = root;
    this.state = state;
    this.onReturnToWorld = onReturnToWorld;
  }

  openWindow(win: ActiveWindowId, toggle = true): void {
    this.activeWindow = toggle && this.activeWindow === win ? null : win;
    this.lastErrorMsg = '';
    this.renderModal();
    this.syncDockButtons();
  }

  forceRefresh(): void {
    this.mountedPhase = null;
    this.syncFrame();
    this.renderModal();
  }

  syncFrame(): void {
    if (this.state.phase === 'world_select') {
      if (this.mountedPhase !== 'world_select') {
        this.mountedPhase = 'world_select';
        this.activeWindow = null;
        this.root.innerHTML = `
          <div class="pixel-panel top-banner">
            <strong>GEOGAME</strong>
            <span>Başlamak için dünya haritasından bir ülkeye tıklayın</span>
            <span id="world-hover-badge" class="badge" style="display:none"></span>
          </div>
        `;
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
  }

  private mountEndedScreen(): void {
    const standings = computeStandings(this.state);
    const playerRow = standings.find((s) => s.isPlayer);
    let title = '🏁 1 Ocak 2020 — Oyun Sonu Stat Karşılaştırması';
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
            <button class="pixel-btn" id="btn-play-again">🌍 Yeni Oyun</button>
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
      this.onReturnToWorld();
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
    this.root.innerHTML = `
      <div class="hud-topbar pixel-panel">
        <div class="hud-group">
          <strong id="hud-country">★ Ülke</strong>
          <span id="hud-date" class="badge">1 Oca 2000</span>
          <span id="hud-order-hint" class="badge" style="display:none;background:#854d0e;border-color:#facc15">
            🎯 Hedefe Sol Tıkla (Sağ Tık: İptal)
          </span>
        </div>
        <div class="hud-group">
          <span title="Para ve saniyelik gelir">💰 <b id="hud-money">300</b> (<span id="hud-money-rate">+5</span>/s)</span>
          <span title="Manpower ve saniyelik artış">👥 <b id="hud-mp">50</b> (<span id="hud-mp-rate">+1</span>/s)</span>
          <span title="Ülke sağlık oranı">❤️ <b id="hud-health">%50</b></span>
          <span title="Sahada toplam asker">⚔️ <b id="hud-soldiers">0</b></span>
        </div>
        <div class="hud-group speed-controls">
          <button class="pixel-btn speed-btn" data-speed="0">⏸</button>
          <button class="pixel-btn speed-btn" data-speed="0.5">0.5x</button>
          <button class="pixel-btn speed-btn" data-speed="1">1x</button>
          <button class="pixel-btn speed-btn" data-speed="2">2x</button>
        </div>
      </div>

      <div id="toast-strip" class="toast-strip"></div>

      <div class="hud-dock pixel-panel">
        <button class="pixel-btn dock-btn" data-win="buildings">🏗️ Binalar</button>
        <button class="pixel-btn dock-btn" data-win="factory">⚙️ Fabrika</button>
        <button class="pixel-btn dock-btn" data-win="barracks">🛡️ Kışla</button>
        <button class="pixel-btn dock-btn" data-win="science">🔬 Bilim</button>
        <button class="pixel-btn dock-btn" data-win="diplomacy">📜 Diplomasi</button>
        <button class="pixel-btn" id="btn-world-reset">🌍 Harita</button>
      </div>

      <div id="region-bar" class="side-inspector pixel-panel" style="display:none"></div>
      <div id="modal-host" class="modal-host"></div>
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

    document.getElementById('btn-world-reset')?.addEventListener('click', () => {
      this.onReturnToWorld();
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

    const hintEl = document.getElementById('hud-order-hint');
    if (hintEl) {
      hintEl.style.display = this.state.moveOrderMode ? 'inline-block' : 'none';
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
        const carried = getTotalSoldiers(sh.units);
        regEl.style.display = 'block';
        regEl.innerHTML = `
          <div><strong>⚓ Taşıma Gemisi</strong> (${this.state.countries[sh.countryId]?.name ?? '-'})</div>
          <div><strong>Taşınan Asker:</strong> ${carried} (Kapasite: Sınırsız)</div>
          <div class="muted">Kıyı bölgesine sol tıklayarak gönderin. Asker bindirmek için önce askere sonra gemiye tıklayın.</div>
        `;
      } else {
        const reg = this.state.selectedRegionId ? this.state.regions[this.state.selectedRegionId] : null;
        if (!reg) {
          regEl.style.display = 'none';
        } else {
          regEl.style.display = 'block';
          const owner = this.state.countries[reg.ownerId];
          const bText = reg.building
            ? `${BUILDINGS[reg.building.type].name}${reg.building.type === 'combined' ? ` Lv.${reg.building.level}` : ''}${reg.building.constructing ? ` (%${Math.floor((reg.building.progressSec / Math.max(0.1, reg.building.totalSec)) * 100)})` : ''}`
            : 'Yok (Boş)';
          regEl.innerHTML = `
            <div><strong>Bölge:</strong> ${reg.id} (${owner?.name ?? '-'})</div>
            <div><strong>Bina:</strong> ${bText}</div>
            <div><strong>Durum:</strong> ${reg.biome} | ${reg.isCoastal ? '🌊 Kıyı' : '🏔️ Kara'}</div>
          `;
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
        liveBox.textContent = `Araştırılıyor: ${name} (%${pct})`;
      } else {
        liveBox.textContent = 'Aktif araştırma yok.';
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
          <div class="muted" style="margin-bottom:8px">
            ${isMine ? 'Haritada hedef bölgeye, düşman ordusuna veya dost gemiye sol tıklayarak gönderebilirsiniz (Sağ tık = İptal).' : 'Yabancı ordu kümesi.'}
          </div>
          <div class="card-list">
            ${entries
              .map(
                ([key, cnt]) => `
                <div class="card-row">
                  <span><b>${formatUnitKeyLabel(key)}</b></span>
                  <div style="display:flex;align-items:center;gap:10px">
                    <span class="badge">${cnt} asker</span>
                    ${
                      isMine && total > 1
                        ? `<label>Ayır: <input class="pixel-input split-input" data-unit="${key}" type="number" min="0" max="${cnt}" value="0" style="width:68px" /></label>`
                        : ''
                    }
                  </div>
                </div>
              `,
              )
              .join('')}
          </div>
          ${
            isMine
              ? `
            <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
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
      if (!this.selectedDiplomacyCountryId || !this.state.countries[this.selectedDiplomacyCountryId] || this.state.countries[this.selectedDiplomacyCountryId].eliminated) {
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
      const selectedReg =
        (this.state.selectedRegionId &&
        this.state.regions[this.state.selectedRegionId]?.ownerId === pid
          ? this.state.regions[this.state.selectedRegionId]
          : null) ??
        owned.find((r) => !r.building) ??
        owned[0];

      const buildTypes: Exclude<BuildingType, 'combined'>[] = [
        'barracks',
        'hospital',
        'bank',
        'factory',
        'university',
        'port',
      ];

      const smallUpgradeSection = p.isSmallCountry
        ? (() => {
            const compReg = owned.find((r) => r.building?.type === 'combined') ?? selectedReg;
            const curLv = compReg?.building?.type === 'combined' ? compReg.building.level : 0;
            const nextCost = curLv === 0 ? BUILDINGS.combined.cost : COMBINED_UPGRADE_COSTS[curLv + 1];
            return `
              <div class="card-row highlight-row">
                <div>
                  <strong>🏛️ Merkez Kompleks (Küçük Ülke Birleşik Bina)</strong>
                  <div class="muted">Mevcut Seviye: ${curLv}/3 — Tüm 5 binanın (kıyıysa Liman dahil) işlevini tek bölgede toplar.</div>
                </div>
                ${
                  nextCost
                    ? `<button class="pixel-btn" id="btn-upgrade-combined" data-reg="${compReg?.id ?? ''}">${curLv === 0 ? 'Kur' : 'Yükselt'} (${nextCost}💰)</button>`
                    : `<span class="badge">MAKS</span>`
                }
              </div>
            `;
          })()
        : '';

      host.innerHTML = `
        <div class="pixel-panel modal-window">
          <div class="modal-header">
            <strong>🏗️ Satın Alma & Binalar</strong>
            <button class="pixel-btn close-win">✕</button>
          </div>
          ${errHtml}
          <div class="muted" style="margin-bottom:8px">
            Seçili Bölge: <b>${selectedReg ? `${selectedReg.id} ${selectedReg.isCoastal ? '(🌊 Kıyı)' : '(Kara)'}` : 'Yok'}</b>
            — Haritadan kendi boş bölgenize tıklayarak hedef bölgeyi değiştirebilirsiniz.
          </div>
          ${smallUpgradeSection}
          <div class="card-list">
            ${buildTypes
              .map((bt) => {
                const spec = BUILDINGS[bt];
                const count = getEffectiveBuildingCount(this.state, pid, bt);
                const disabledCoast = bt === 'port' && (!selectedReg || !selectedReg.isCoastal);
                return `
                  <div class="card-row">
                    <div>
                      <strong>${spec.name}</strong> <span class="badge">Aktif: ${count}</span>
                      <div class="muted">${spec.description} (${spec.buildSec} sn)</div>
                    </div>
                    <button class="pixel-btn btn-build" data-type="${bt}" data-reg="${selectedReg?.id ?? ''}" ${disabledCoast ? 'disabled' : ''}>
                      İnşa Et (${spec.cost}💰)
                    </button>
                  </div>
                `;
              })
              .join('')}
          </div>
        </div>
      `;

      host.querySelector('.close-win')?.addEventListener('click', () => this.openWindow(null, false));
      host.querySelector('#btn-upgrade-combined')?.addEventListener('click', (ev) => {
        const regId = (ev.currentTarget as HTMLButtonElement).dataset.reg || '';
        const res = startCombinedBuildingUpgrade(this.state, pid, regId);
        this.lastErrorMsg = res.ok ? '' : res.error || '';
        this.renderModal();
      });
      host.querySelectorAll<HTMLButtonElement>('.btn-build').forEach((btn) => {
        btn.addEventListener('click', () => {
          const bt = btn.dataset.type as Exclude<BuildingType, 'combined'>;
          const regId = btn.dataset.reg || '';
          const res = startBuildingConstruction(this.state, pid, regId, bt);
          this.lastErrorMsg = res.ok ? '' : res.error || '';
          this.renderModal();
        });
      });
      return;
    }

    if (this.activeWindow === 'science') {
      const nextW = WEAPON_ORDER.find((w) => !p.unlockedWeapons.includes(w));
      const nextS = SHIELD_ORDER.find((s) => !p.unlockedShields.includes(s));
      host.innerHTML = `
        <div class="pixel-panel modal-window">
          <div class="modal-header">
            <strong>🔬 Üniversite — Gelişim Ağacı</strong>
            <button class="pixel-btn close-win">✕</button>
          </div>
          ${errHtml}
          <div id="modal-live-status" class="status-line"></div>
          <div class="two-col">
            <div class="branch-col">
              <h4>⚔️ Saldırı Dalı (Hasar)</h4>
              ${WEAPON_ORDER.map((w) => {
                const sp = WEAPONS[w];
                const unlocked = p.unlockedWeapons.includes(w);
                const isNext = w === nextW;
                return `
                  <div class="tech-node ${unlocked ? 'tech-unlocked' : ''}">
                    <div><b>T${sp.tier} ${sp.name}</b> — Hasar: ${sp.damage}</div>
                    ${
                      unlocked
                        ? '<span class="badge">Açık</span>'
                        : isNext
                          ? `<button class="pixel-btn" id="btn-res-weapon">Araştır (${sp.researchCost}💰 / ${sp.researchSec}sn)</button>`
                          : '<span class="muted">Kilitli</span>'
                    }
                  </div>
                `;
              }).join('')}
            </div>
            <div class="branch-col">
              <h4>🛡️ Savunma Dalı (Koruma)</h4>
              ${SHIELD_ORDER.map((s) => {
                const sp = SHIELDS[s];
                const unlocked = p.unlockedShields.includes(s);
                const isNext = s === nextS;
                return `
                  <div class="tech-node ${unlocked ? 'tech-unlocked' : ''}">
                    <div><b>T${sp.tier} ${sp.name}</b> — Koruma: ${sp.defense}</div>
                    ${
                      unlocked
                        ? '<span class="badge">Açık</span>'
                        : isNext
                          ? `<button class="pixel-btn" id="btn-res-shield">Araştır (${sp.researchCost}💰 / ${sp.researchSec}sn)</button>`
                          : '<span class="muted">Kilitli</span>'
                    }
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      `;
      host.querySelector('.close-win')?.addEventListener('click', () => this.openWindow(null, false));
      host.querySelector('#btn-res-weapon')?.addEventListener('click', () => {
        const res = startTechResearch(this.state, pid, 'weapon');
        this.lastErrorMsg = res.ok ? '' : res.error || '';
        this.renderModal();
      });
      host.querySelector('#btn-res-shield')?.addEventListener('click', () => {
        const res = startTechResearch(this.state, pid, 'shield');
        this.lastErrorMsg = res.ok ? '' : res.error || '';
        this.renderModal();
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
          <div style="margin:8px 0">
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
                      <span><b>${sp.name}</b> (Hasar ${sp.damage}, ${sp.prodCost}💰/ad)</span>
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
                      <span><b>${sp.name}</b> (Koruma ${sp.defense}, ${sp.prodCost}💰/ad)</span>
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
    }
  }
}
