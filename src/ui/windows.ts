import {
  BUILDINGS,
  COMBINED_UPGRADE_COSTS,
  SHIELD_ORDER,
  SHIELDS,
  WEAPON_ORDER,
  WEAPONS,
} from '../config/balance';
import { formatSimDate, setGameSpeed } from '../sim/calendar';
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

  openWindow(win: ActiveWindowId): void {
    this.activeWindow = this.activeWindow === win ? null : win;
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
      const badge = document.getElementById('world-hover-badge');
      if (badge) {
        if (this.state.hoveredWorldCountryId) {
          badge.style.display = 'inline-block';
          badge.textContent = badge.dataset.label || '';
        } else {
          badge.style.display = 'none';
        }
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

    let totalSoldiers = 0;
    for (const a of Object.values(this.state.armies)) {
      if (a.countryId !== pid) continue;
      for (const cnt of Object.values(a.units)) totalSoldiers += cnt;
    }
    setTxt('hud-soldiers', `${totalSoldiers}`);

    this.root.querySelectorAll<HTMLButtonElement>('.speed-btn').forEach((btn) => {
      btn.classList.toggle('active-btn', Number(btn.dataset.speed) === this.state.speed);
    });

    // Selected region inspector
    const regEl = document.getElementById('region-bar');
    if (regEl) {
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
      liveBox.textContent = q
        ? `Üretiliyor: ${q.itemId} (Kalan: ${q.remainingCount} adet, Kuyruk: ${p.productionQueue.length}) | Stok Silah: ${JSON.stringify(p.weaponsStock)} | Kalkan: ${JSON.stringify(p.shieldsStock)}`
        : `Fabrika boşta. Stok Silah: Kılıç ${p.weaponsStock.sword}, Mızrak ${p.weaponsStock.spear}, Pistol ${p.weaponsStock.pistol}, AK ${p.weaponsStock.ak}, Bazuka ${p.weaponsStock.bazooka} | Kalkan: Tahta ${p.shieldsStock.wood}, Bronz ${p.shieldsStock.bronze}, Çelik ${p.shieldsStock.steel}, Elmas ${p.shieldsStock.diamond}, FF ${p.shieldsStock.forcefield}`;
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
            — Haritadan kendi boş bölgenize tıklayarak hedef bölgeyi değiştirebilirsiniz (normal ülkelerde bölge başına maks. 1 bina).
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

      host.querySelector('.close-win')?.addEventListener('click', () => this.openWindow(null));
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
      host.querySelector('.close-win')?.addEventListener('click', () => this.openWindow(null));
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
      host.querySelector('.close-win')?.addEventListener('click', () => this.openWindow(null));
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
      host.querySelector('.close-win')?.addEventListener('click', () => this.openWindow(null));
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
