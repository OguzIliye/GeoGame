import {
  getBuildingSpriteDataUri,
  getCountryFlagDataUri,
  getUnitSpriteDataUri,
} from '../art/pixelSprites';
import { pickRegionAtPoint } from '../map/arenaBuilder';
import { MapCamera } from '../render/camera';
import { getTotalSoldiers, orderArmyMoveToRegion } from '../sim/army';
import { setAutoPauseReason, setGameSpeed } from '../sim/calendar';
import { getRelationStatus } from '../sim/diplomacy';
import {
  getCountryActiveProductionOrders,
  getCountryRegions,
  getEffectiveBuildingCount,
  getRegionBuildingPoint,
  nextUid,
  spawnUnitsIntoCountryBarracks,
} from '../sim/economy';
import type { BuildingType, GameState, Point, Region } from '../types';
import { GameUIController } from './windows';

export const SPOTLIGHT_RADIUS_PX = 20;

export type TutorialStageId =
  | 'inactive'
  | '1_goal'
  | '2a_open_shop'
  | '2a_pick_bank'
  | '2a_place_bank'
  | '2a_wait_bank'
  | '2b_click_bank'
  | '2b_take_loan'
  | '3_open_shop'
  | '3_pick_factory'
  | '3_place_factory'
  | '3_wait_factory'
  | '3_click_factory'
  | '3_order_equip'
  | '3_wait_equip'
  | '4_open_shop'
  | '4_pick_barracks'
  | '4_place_barracks'
  | '4_wait_barracks'
  | '4_click_barracks'
  | '4_train_soldiers'
  | '4_wait_soldiers'
  | '5_click_army'
  | '5_move_border'
  | '5_wait_march'
  | '6_click_army'
  | '6_split_half'
  | '6_merge_armies'
  | '6_wait_merge'
  | '7_open_diplomacy'
  | '7_pick_rival'
  | '7_declare_war'
  | '8a_click_army'
  | '8a_intercept'
  | '8a_wait_defense'
  | '8b_click_army'
  | '8b_attack_region'
  | '8b_wait_capture'
  | '9_open_shop'
  | '9_pick_hospital'
  | '9_place_hospital'
  | '9_wait_rescue'
  | '10_final';

export interface SpotlightTutorialCallbacks {
  onFinishFreshRestart: () => void;
  onFinishKeepPlaying: () => void;
}

export class SpotlightTutorialController {
  stage: TutorialStageId = 'inactive';
  rivalCountryId: string | null = null;
  playerBorderRegionId: string | null = null;
  rivalBorderRegionId: string | null = null;
  vanguardArmyId: string | null = null;
  wrongFlashCount = 0;

  private state: GameState;
  private camera: MapCamera;
  private ui: GameUIController;
  private callbacks: SpotlightTutorialCallbacks;
  private lastFocusedStage: TutorialStageId | null = null;
  private lastRenderedSig = '';
  private flashUntilMs = 0;
  private initialRivalRegionOwnerChecked = false;

  constructor(
    state: GameState,
    camera: MapCamera,
    ui: GameUIController,
    callbacks: SpotlightTutorialCallbacks,
  ) {
    this.state = state;
    this.camera = camera;
    this.ui = ui;
    this.callbacks = callbacks;
    this.installGlobalClickGuard();
  }

  get isActive(): boolean {
    return this.stage !== 'inactive' && this.state.phase === 'playing';
  }

  start(): void {
    const pid = this.state.playerCountryId;
    if (!pid || !this.state.countries[pid]) return;

    this.state.tutorialSeen = true;
    this.state.tutorialPromptOpen = false;
    this.state.tutorialHoldWoundedWithoutHospital = true;
    this.pickControlledRivalAndBorder(pid);
    this.vanguardArmyId = null;
    this.initialRivalRegionOwnerChecked = false;
    this.lastFocusedStage = null;
    this.lastRenderedSig = '';
    this.setStage('1_goal');
  }

  skipOrStop(): void {
    this.stage = 'inactive';
    this.vanguardArmyId = null;
    this.state.tutorialHoldWoundedWithoutHospital = false;
    this.ui.closeButtonLockedByTutorial = false;
    setAutoPauseReason(this.state, 'tutorial_spotlight', false);
    const host = document.getElementById('spotlight-host');
    if (host) host.innerHTML = '';
    this.lastRenderedSig = '';
  }

  private pickControlledRivalAndBorder(pid: string): void {
    const myRegs = getCountryRegions(this.state, pid);
    const otherIds = Object.keys(this.state.countries).filter(
      (id) => id !== pid && !this.state.countries[id].eliminated,
    );

    // Prefer a direct land-border neighbor whose centroids lie strictly on land inside their region
    let fallbackPair: [Region, Region] | null = null;
    for (const r of myRegs) {
      for (const nid of r.neighbors) {
        const nb = this.state.regions[nid];
        if (nb && nb.ownerId !== pid && !this.state.countries[nb.ownerId]?.eliminated) {
          if (!fallbackPair) fallbackPair = [r, nb];
          const myInside = pickRegionAtPoint(r.centroid, this.state.regions)?.id === r.id;
          const nbInside = pickRegionAtPoint(nb.centroid, this.state.regions)?.id === nb.id;
          if (myInside && nbInside) {
            this.rivalCountryId = nb.ownerId;
            this.playerBorderRegionId = r.id;
            this.rivalBorderRegionId = nb.id;
            return;
          }
        }
      }
    }
    if (fallbackPair) {
      this.rivalCountryId = fallbackPair[1].ownerId;
      this.playerBorderRegionId = fallbackPair[0].id;
      this.rivalBorderRegionId = fallbackPair[1].id;
      return;
    }

    // Fallback for island nations: closest active neighbor region
    let bestD = Infinity;
    let bestMy = myRegs[0] ?? null;
    let bestRivalReg: Region | null = null;
    for (const r of myRegs) {
      for (const reg of Object.values(this.state.regions)) {
        if (reg.ownerId === pid || this.state.countries[reg.ownerId]?.eliminated) continue;
        const d = Math.hypot(reg.centroid[0] - r.centroid[0], reg.centroid[1] - r.centroid[1]);
        if (d < bestD) {
          bestD = d;
          bestMy = r;
          bestRivalReg = reg;
        }
      }
    }
    this.rivalCountryId = bestRivalReg?.ownerId ?? otherIds[0] ?? null;
    this.playerBorderRegionId = bestMy?.id ?? null;
    this.rivalBorderRegionId = bestRivalReg?.id ?? null;
  }

  private setStage(next: TutorialStageId): void {
    this.stage = next;
    this.lastRenderedSig = '';
    this.applyStageEntryEffects(next);
    this.syncFrame();
  }

  private isWaitStage(st: TutorialStageId): boolean {
    return (
      st === '2a_wait_bank' ||
      st === '3_wait_factory' ||
      st === '3_wait_equip' ||
      st === '4_wait_barracks' ||
      st === '4_wait_soldiers' ||
      st === '5_wait_march' ||
      st === '6_wait_merge' ||
      st === '8a_wait_defense' ||
      st === '8b_wait_capture' ||
      st === '9_wait_rescue'
    );
  }

  private applyStageEntryEffects(st: TutorialStageId): void {
    const pid = this.state.playerCountryId;
    if (!pid) return;

    const waiting = this.isWaitStage(st);
    setAutoPauseReason(this.state, 'tutorial_spotlight', !waiting && st !== 'inactive');
    if (waiting && this.state.speed === 0) {
      setGameSpeed(this.state, 1);
    }

    // Lock modal close button while inside a guided modal step
    this.ui.closeButtonLockedByTutorial =
      st === '2a_pick_bank' ||
      st === '2b_take_loan' ||
      st === '3_pick_factory' ||
      st === '3_order_equip' ||
      st === '4_pick_barracks' ||
      st === '4_train_soldiers' ||
      st === '6_split_half' ||
      st === '7_pick_rival' ||
      st === '7_declare_war' ||
      st === '9_pick_hospital';

    if (this.lastFocusedStage === st) return;
    this.lastFocusedStage = st;

    // Smooth camera auto-focus (`focusOnPoint`) on map target steps!
    if (
      st === '2a_place_bank' ||
      st === '3_place_factory' ||
      st === '4_place_barracks' ||
      st === '9_place_hospital'
    ) {
      const rec = this.getRecommendedEmptyRegion(pid);
      if (rec) this.camera.focusOnPoint(rec.centroid[0], rec.centroid[1]);
    } else if (st === '2b_click_bank') {
      const b = this.findPlayerBuilding(pid, 'bank');
      if (b) {
        const [x, y] = getRegionBuildingPoint(b);
        this.camera.focusOnPoint(x, y);
      }
    } else if (st === '3_click_factory') {
      const f = this.findPlayerBuilding(pid, 'factory');
      if (f) {
        const [x, y] = getRegionBuildingPoint(f);
        this.camera.focusOnPoint(x, y);
      }
    } else if (st === '4_click_barracks') {
      const br = this.findPlayerBuilding(pid, 'barracks');
      if (br) {
        const [x, y] = getRegionBuildingPoint(br);
        this.camera.focusOnPoint(x, y);
      }
    } else if (st === '5_click_army' || st === '6_click_army' || st === '8a_click_army' || st === '8b_click_army') {
      this.state.selectedArmyId = null;
      this.state.selectedArmyIds = [];
      this.state.moveOrderMode = false;
      if (st === '6_click_army') {
        // Ensure at least 2 soldiers exist so 50/50 split is always valid
        const a = this.getPlayerArmies(pid)[0];
        if (a && getTotalSoldiers(a.units) < 2) {
          a.units['sword:wood'] = (a.units['sword:wood'] ?? 0) + 2;
        }
      }
      const a = this.getPlayerArmies(pid)[0];
      if (a) this.camera.focusOnPoint(a.x, a.y);
    } else if (st === '5_move_border') {
      const bReg = this.playerBorderRegionId ? this.state.regions[this.playerBorderRegionId] : null;
      if (bReg) this.camera.focusOnPoint(bReg.centroid[0], bReg.centroid[1]);
    } else if (st === '8a_intercept' && this.vanguardArmyId && this.state.armies[this.vanguardArmyId]) {
      const v = this.state.armies[this.vanguardArmyId];
      this.camera.focusOnPoint(v.x, v.y);
    } else if (st === '8b_attack_region' && this.rivalBorderRegionId) {
      const rReg = this.state.regions[this.rivalBorderRegionId];
      if (rReg) this.camera.focusOnPoint(rReg.centroid[0], rReg.centroid[1]);
    }
  }

  getRecommendedEmptyRegion(pid: string): Region | null {
    const allEmpty = getCountryRegions(this.state, pid).filter((r) => !r.building);
    if (allEmpty.length === 0) return null;
    const solidEmpty = allEmpty.filter(
      (r) => pickRegionAtPoint(r.centroid, this.state.regions)?.id === r.id,
    );
    const empty = solidEmpty.length > 0 ? solidEmpty : allEmpty;

    const myWounded = this.state.wounded.find((w) => w.countryId === pid);
    if (myWounded) {
      empty.sort(
        (a, b) =>
          Math.hypot(a.centroid[0] - myWounded.from[0], a.centroid[1] - myWounded.from[1]) -
          Math.hypot(b.centroid[0] - myWounded.from[0], b.centroid[1] - myWounded.from[1]),
      );
      return empty[0];
    }
    if (this.playerBorderRegionId) {
      const border = this.state.regions[this.playerBorderRegionId];
      if (
        border &&
        !border.building &&
        border.ownerId === pid &&
        pickRegionAtPoint(border.centroid, this.state.regions)?.id === border.id
      ) {
        return border;
      }
    }
    return empty[0];
  }

  private findPlayerBuilding(pid: string, type: BuildingType, includeConstructing = false): Region | null {
    return (
      getCountryRegions(this.state, pid).find(
        (r) =>
          r.building?.type === type && (includeConstructing || !r.building.constructing),
      ) ?? null
    );
  }

  private getPlayerArmies(pid: string) {
    return Object.values(this.state.armies).filter(
      (a) => a.countryId === pid && getTotalSoldiers(a.units) > 0,
    );
  }

  private spawnControlledRivalVanguard(pid: string): void {
    if (!this.rivalCountryId || !this.rivalBorderRegionId || !this.playerBorderRegionId) return;
    const rivalReg = this.state.regions[this.rivalBorderRegionId];
    const myBorder = this.state.regions[this.playerBorderRegionId];
    if (!rivalReg || !myBorder) return;

    const myTotal = this.getPlayerArmies(pid).reduce((s, a) => s + getTotalSoldiers(a.units), 0);
    const vanguardCount = Math.max(2, Math.min(4, Math.floor(Math.max(4, myTotal) * 0.45)));
    const vg = spawnUnitsIntoCountryBarracks(
      this.state,
      this.rivalCountryId,
      'sword:none',
      vanguardCount,
      rivalReg.id,
    );
    if (!vg) return;
    // Position vanguard inside our border region so Homeland Defense (+10%) applies!
    vg.x = myBorder.centroid[0] * 0.82 + rivalReg.centroid[0] * 0.18;
    vg.y = myBorder.centroid[1] * 0.82 + rivalReg.centroid[1] * 0.18;
    vg.currentRegionId = myBorder.id;
    orderArmyMoveToRegion(this.state, vg.id, myBorder.id);
    this.vanguardArmyId = vg.id;
  }

  private ensureTutorialFieldWounded(pid: string): void {
    const anyWounded = this.state.wounded.some((w) => w.countryId === pid);
    if (anyWounded) return;
    const myArmy = this.getPlayerArmies(pid)[0];
    const origin: Point = myArmy
      ? [myArmy.x + 0.18, myArmy.y - 0.14]
      : this.playerBorderRegionId && this.state.regions[this.playerBorderRegionId]
        ? [...this.state.regions[this.playerBorderRegionId].centroid]
        : [this.camera.cx, this.camera.cy];

    this.state.wounded.push({
      id: nextUid('wnd'),
      countryId: pid,
      units: { 'sword:wood': 2 },
      from: origin,
      toRegionId: '',
      to: [...origin],
      travelProgress: 0,
      healElapsedSec: 0,
      healRequiredSec: 8,
      waitingForHospital: true,
    });
  }

  triggerWrongClickFlash(): void {
    this.wrongFlashCount += 1;
    this.flashUntilMs = Date.now() + 600;
    const ring = document.querySelector<SVGElement>('.tut-pulse-ring');
    if (ring) {
      ring.classList.remove('tut-wrong-flash');
      void ring.getBoundingClientRect();
      ring.classList.add('tut-wrong-flash');
    }
  }

  private advanceTransitions(pid: string): void {
    const p = this.state.countries[pid];
    if (!p) return;

    switch (this.stage) {
      case '2a_open_shop':
        if (this.ui.activeWindow === 'shop') this.setStage('2a_pick_bank');
        break;
      case '2a_pick_bank':
        if (this.state.placingBuildingType === 'bank') this.setStage('2a_place_bank');
        break;
      case '2a_place_bank':
        if (this.findPlayerBuilding(pid, 'bank', true)) this.setStage('2a_wait_bank');
        break;
      case '2a_wait_bank':
        if (getEffectiveBuildingCount(this.state, pid, 'bank') >= 1) this.setStage('2b_click_bank');
        break;
      case '2b_click_bank':
        if (this.ui.activeWindow === 'bank') this.setStage('2b_take_loan');
        break;
      case '2b_take_loan':
        if (p.debt > 0) {
          this.ui.closeButtonLockedByTutorial = false;
          this.ui.openWindow(null, false);
          // Ensure comfortable tutorial budget if player spent earlier
          if (p.money < 550) p.money = 550;
          this.setStage('3_open_shop');
        }
        break;

      case '3_open_shop':
        if (this.ui.activeWindow === 'shop') this.setStage('3_pick_factory');
        break;
      case '3_pick_factory':
        if (this.state.placingBuildingType === 'factory') this.setStage('3_place_factory');
        break;
      case '3_place_factory':
        if (this.findPlayerBuilding(pid, 'factory', true)) this.setStage('3_wait_factory');
        break;
      case '3_wait_factory':
        if (getEffectiveBuildingCount(this.state, pid, 'factory') >= 1) this.setStage('3_click_factory');
        break;
      case '3_click_factory':
        if (this.ui.activeWindow === 'factory') this.setStage('3_order_equip');
        break;
      case '3_order_equip': {
        const activeOrders = getCountryActiveProductionOrders(this.state, pid);
        const totalWeaponsPendingOrStock =
          p.weaponsStock.sword +
          activeOrders
            .filter((o) => o.order.category === 'weapon')
            .reduce((s, o) => s + o.order.remainingCount, 0);
        if (totalWeaponsPendingOrStock >= 4 && this.ui.activeWindow !== 'factory') {
          this.setStage('3_wait_equip');
        } else if (totalWeaponsPendingOrStock >= 4) {
          // Unlock close button so player sees the per-item loading bars and can click ✕ or ▶ Devam
          this.ui.closeButtonLockedByTutorial = false;
        }
        break;
      }
      case '3_wait_equip': {
        const activeOrders = getCountryActiveProductionOrders(this.state, pid);
        if (p.weaponsStock.sword >= 4 && activeOrders.length === 0) {
          if (p.money < 200) p.money = 220;
          this.setStage('4_open_shop');
        }
        break;
      }

      case '4_open_shop':
        if (this.ui.activeWindow === 'shop') this.setStage('4_pick_barracks');
        break;
      case '4_pick_barracks':
        if (this.state.placingBuildingType === 'barracks') this.setStage('4_place_barracks');
        break;
      case '4_place_barracks':
        if (this.findPlayerBuilding(pid, 'barracks', true)) this.setStage('4_wait_barracks');
        break;
      case '4_wait_barracks':
        if (getEffectiveBuildingCount(this.state, pid, 'barracks') >= 1) this.setStage('4_click_barracks');
        break;
      case '4_click_barracks':
        if (this.ui.activeWindow === 'barracks') this.setStage('4_train_soldiers');
        break;
      case '4_train_soldiers': {
        const bar = this.findPlayerBuilding(pid, 'barracks');
        const queued = (bar?.building?.trainingQueue ?? []).reduce((s, o) => s + o.remainingCount, 0);
        const existingSoldiers = this.getPlayerArmies(pid).reduce(
          (s, a) => s + getTotalSoldiers(a.units),
          0,
        );
        if (queued > 0 || existingSoldiers >= 2) {
          this.ui.closeButtonLockedByTutorial = false;
          this.ui.openWindow(null, false);
          this.setStage('4_wait_soldiers');
        }
        break;
      }
      case '4_wait_soldiers': {
        const bar = this.findPlayerBuilding(pid, 'barracks');
        const queued = (bar?.building?.trainingQueue ?? []).reduce((s, o) => s + o.remainingCount, 0);
        const totalSoldiers = this.getPlayerArmies(pid).reduce(
          (s, a) => s + getTotalSoldiers(a.units),
          0,
        );
        if (queued === 0 && totalSoldiers >= 2) {
          this.setStage('5_click_army');
        }
        break;
      }

      case '5_click_army':
        if (this.state.selectedArmyId && this.state.armies[this.state.selectedArmyId]?.countryId === pid) {
          this.setStage('5_move_border');
        }
        break;
      case '5_move_border': {
        const moving = this.getPlayerArmies(pid).some((a) => a.targetX !== null);
        if (moving) {
          if (this.ui.activeWindow === 'army') this.ui.openWindow(null, false);
          this.setStage('5_wait_march');
        }
        break;
      }
      case '5_wait_march': {
        const moving = this.getPlayerArmies(pid).some((a) => a.targetX !== null);
        if (!moving && this.getPlayerArmies(pid).length >= 1) {
          this.setStage('6_click_army');
        }
        break;
      }

      case '6_click_army':
        if (this.ui.activeWindow === 'army' && this.state.selectedArmyId) {
          this.setStage('6_split_half');
        }
        break;
      case '6_split_half':
        if (this.getPlayerArmies(pid).length >= 2) {
          this.ui.closeButtonLockedByTutorial = false;
          this.ui.openWindow(null, false);
          this.setStage('6_merge_armies');
        }
        break;
      case '6_merge_armies': {
        const armies = this.getPlayerArmies(pid);
        if (armies.length === 1) {
          this.setStage('7_open_diplomacy');
        } else if (armies.some((a) => Boolean(a.mergeTargetArmyId))) {
          this.setStage('6_wait_merge');
        }
        break;
      }
      case '6_wait_merge':
        if (this.getPlayerArmies(pid).length === 1) {
          this.setStage('7_open_diplomacy');
        }
        break;

      case '7_open_diplomacy':
        if (this.ui.activeWindow === 'diplomacy') this.setStage('7_pick_rival');
        break;
      case '7_pick_rival':
        if (this.ui.activeWindow === 'diplomacy' && this.ui.diplomacyPageCountryId) {
          this.rivalCountryId = this.ui.diplomacyPageCountryId;
          // Refresh rivalBorderRegionId for chosen rival if needed
          const rivalRegs = getCountryRegions(this.state, this.rivalCountryId);
          if (rivalRegs.length > 0 && (!this.rivalBorderRegionId || this.state.regions[this.rivalBorderRegionId]?.ownerId !== this.rivalCountryId)) {
            const myArmy = this.getPlayerArmies(pid)[0];
            rivalRegs.sort(
              (a, b) =>
                Math.hypot(a.centroid[0] - (myArmy?.x ?? 0), a.centroid[1] - (myArmy?.y ?? 0)) -
                Math.hypot(b.centroid[0] - (myArmy?.x ?? 0), b.centroid[1] - (myArmy?.y ?? 0)),
            );
            this.rivalBorderRegionId = rivalRegs[0].id;
          }
          this.setStage('7_declare_war');
        }
        break;
      case '7_declare_war':
        if (this.rivalCountryId && getRelationStatus(this.state, pid, this.rivalCountryId) === 'war') {
          this.ui.closeButtonLockedByTutorial = false;
          this.ui.openWindow(null, false);
          this.spawnControlledRivalVanguard(pid);
          this.setStage('8a_click_army');
        }
        break;

      case '8a_click_army':
        if (
          !this.vanguardArmyId ||
          !this.state.armies[this.vanguardArmyId]
        ) {
          this.ensureTutorialFieldWounded(pid);
          this.setStage('8b_click_army');
        } else if (
          this.state.selectedArmyId &&
          this.state.armies[this.state.selectedArmyId]?.countryId === pid
        ) {
          this.setStage('8a_intercept');
        } else if (this.getPlayerArmies(pid).some((a) => Boolean(a.inCombatWithArmyId))) {
          this.setStage('8a_wait_defense');
        }
        break;
      case '8a_intercept': {
        const myArmies = this.getPlayerArmies(pid);
        if (
          !this.vanguardArmyId ||
          !this.state.armies[this.vanguardArmyId] ||
          myArmies.some((a) => Boolean(a.inCombatWithArmyId) || a.targetX !== null || a.targetArmyId !== null)
        ) {
          if (this.ui.activeWindow === 'army') this.ui.openWindow(null, false);
          this.setStage('8a_wait_defense');
        }
        break;
      }
      case '8a_wait_defense': {
        // Auto-dismiss any encounter prompt by attacking during defense step
        if (this.state.activeEncounter) {
          this.state.activeEncounter = null;
          setAutoPauseReason(this.state, 'encounter', false);
        }
        // Ensure player army engages vanguard if idle
        if (this.vanguardArmyId && this.state.armies[this.vanguardArmyId]) {
          const vg = this.state.armies[this.vanguardArmyId];
          const myA = this.getPlayerArmies(pid)[0];
          if (myA && !myA.inCombatWithArmyId && myA.targetX === null) {
            myA.targetArmyId = vg.id;
            myA.targetX = vg.x;
            myA.targetY = vg.y;
          }
        } else {
          this.ensureTutorialFieldWounded(pid);
          this.setStage('8b_click_army');
        }
        break;
      }

      case '8b_click_army':
        if (this.state.selectedArmyId && this.state.armies[this.state.selectedArmyId]?.countryId === pid) {
          this.setStage('8b_attack_region');
        }
        break;
      case '8b_attack_region': {
        const movingToEnemy = this.getPlayerArmies(pid).some(
          (a) =>
            Boolean(a.targetRegionId && this.state.regions[a.targetRegionId]?.ownerId !== pid) ||
            Object.values(this.state.regions).some((r) => r.capture?.attackerCountryId === pid),
        );
        if (movingToEnemy) {
          if (this.ui.activeWindow === 'army') this.ui.openWindow(null, false);
          this.initialRivalRegionOwnerChecked = true;
          this.setStage('8b_wait_capture');
        }
        break;
      }
      case '8b_wait_capture': {
        if (this.state.activeEncounter) {
          this.state.activeEncounter = null;
          setAutoPauseReason(this.state, 'encounter', false);
        }
        const capturedAny =
          this.initialRivalRegionOwnerChecked &&
          Object.values(this.state.regions).some(
            (r) => r.ownerId === pid && r.initialOwnerId !== pid,
          );
        if (capturedAny) {
          this.setStage('9_open_shop');
        }
        break;
      }

      case '9_open_shop':
        if (this.ui.activeWindow === 'shop') this.setStage('9_pick_hospital');
        break;
      case '9_pick_hospital':
        if (this.state.placingBuildingType === 'hospital') this.setStage('9_place_hospital');
        break;
      case '9_place_hospital':
        if (this.findPlayerBuilding(pid, 'hospital', true)) this.setStage('9_wait_rescue');
        break;
      case '9_wait_rescue': {
        const hospDone = getEffectiveBuildingCount(this.state, pid, 'hospital') >= 1;
        const myWounded = this.state.wounded.filter((w) => w.countryId === pid);
        if (myWounded.length > 0) {
          const w0 = myWounded[0];
          const wx = w0.from[0] + (w0.to[0] - w0.from[0]) * w0.travelProgress;
          const wy = w0.from[1] + (w0.to[1] - w0.from[1]) * w0.travelProgress;
          this.camera.focusOnPoint(wx, wy);
        }
        if (hospDone && myWounded.length === 0) {
          this.setStage('10_final');
        }
        break;
      }
    }
  }

  private getTargetCenterAndInfo(
    pid: string,
    viewW: number,
    viewH: number,
  ): {
    cx: number;
    cy: number;
    stepBadge: string;
    title: string;
    body: string;
    iconUri: string;
    showContinueBtn?: boolean;
    showFactoryProceedBtn?: boolean;
    isFinal?: boolean;
  } | null {
    const p = this.state.countries[pid];
    const pColor = p?.color ?? '#3b82f6';
    const centerOfSelector = (sel: string): Point | null => {
      if (typeof document === 'undefined') return null;
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 && r.height <= 0) return null;
      return [r.left + r.width * 0.5, r.top + r.height * 0.5];
    };
    const screenOfMap = (pt: Point): Point => this.camera.mapToScreen(pt[0], pt[1], viewW, viewH);

    switch (this.stage) {
      case '1_goal': {
        const btnPt = centerOfSelector('#btn-tut-step-continue') ?? [viewW * 0.5, viewH * 0.56];
        return {
          cx: btnPt[0],
          cy: btnPt[1],
          stepBadge: 'Adım 1 / 11',
          title: '🎯 Oyunun Amacı',
          body: 'Oyunda amacımız <b>toprak yönetimi, gelişme, ekonomi, insan yönetimi (Manpower)</b> ve <b>toprak ele geçirme</b>. <b>1 Ocak 2010</b> tarihinin sonunda en çok statlara sahip ülke kazanır!',
          iconUri: getCountryFlagDataUri(pColor),
          showContinueBtn: true,
        };
      }

      case '2a_open_shop': {
        const pt = centerOfSelector('#btn-dock-shop') ?? [viewW * 0.44, viewH - 32];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 2 / 11',
          title: '🏪 İlk Bina: Mağaza\'yı Aç',
          body: 'Cebimizde <b>100 💰</b> var ve ülkemizde yalnızca <b>1 Üniversite</b> bulunuyor. Alt bardaki <b>🏪 Mağaza</b> butonuna tıklayarak ilk Bankamızı alalım.',
          iconUri: getBuildingSpriteDataUri('bank', pColor),
        };
      }

      case '2a_pick_bank': {
        const pt = centerOfSelector('[data-shop-type="bank"]') ?? [viewW * 0.7, 250];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 2 / 11',
          title: '🏦 Banka (100 💰) Seç',
          body: 'Her Banka <code>5 sn</code>\'de bir <b>+60 💰</b> ek gelir basar ve kredi imkânı açar. <b>Banka — Haritaya Yerleştir (100💰)</b> butonuna tıklayın.',
          iconUri: getBuildingSpriteDataUri('bank', pColor),
        };
      }

      case '2a_place_bank': {
        const rec = this.getRecommendedEmptyRegion(pid);
        const pt = rec ? screenOfMap(rec.centroid) : [viewW * 0.5, viewH * 0.5];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 2 / 11',
          title: '📍 Bankayı Toprağına Kur',
          body: 'Önerilen boş bölgenin merkezine (veya kendi ülkenizdeki <b>herhangi bir geçerli boş bölgeye</b>) sol tıklayarak Bankayı yerleştirin.',
          iconUri: getBuildingSpriteDataUri('bank', pColor),
        };
      }

      case '2b_click_bank': {
        const b = this.findPlayerBuilding(pid, 'bank');
        const pt = b ? screenOfMap(getRegionBuildingPoint(b)) : [viewW * 0.5, viewH * 0.5];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 3 / 11',
          title: '🏦 Bankaya Tıkla',
          body: 'Bankamız tamamlandı! Haritadaki <b>Banka binasına</b> sol tıklayarak işlem penceresini açın.',
          iconUri: getBuildingSpriteDataUri('bank', pColor),
        };
      }

      case '2b_take_loan': {
        const pt = centerOfSelector('#btn-loan-500') ?? [viewW * 0.4, 420];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 3 / 11',
          title: '💳 İlk Sermaye: +500 💰 Borç Al',
          body: 'Fabrika, Kışla ve ekipman üretimi için hızlı sermaye oluşturalım! <b>+500 💰 Borç Al</b> butonuna tıklayın (%15 faizle her 5 sn gelirinden otomatik ödenir).',
          iconUri: getBuildingSpriteDataUri('bank', pColor),
        };
      }

      case '3_open_shop': {
        const pt = centerOfSelector('#btn-dock-shop') ?? [viewW * 0.44, viewH - 32];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 4 / 11',
          title: '⚙️ Fabrika İçin Mağaza\'yı Aç',
          body: 'Silah ve kalkan üretmek için bir Fabrikaya ihtiyacımız var. <b>🏪 Mağaza</b> butonuna tıklayın.',
          iconUri: getBuildingSpriteDataUri('factory', pColor),
        };
      }

      case '3_pick_factory': {
        const pt = centerOfSelector('[data-shop-type="factory"]') ?? [viewW * 0.7, 310];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 4 / 11',
          title: '⚙️ Fabrika (180 💰) Seç',
          body: '<b>Fabrika — Haritaya Yerleştir (180💰)</b> butonuna tıklayın.',
          iconUri: getBuildingSpriteDataUri('factory', pColor),
        };
      }

      case '3_place_factory': {
        const rec = this.getRecommendedEmptyRegion(pid);
        const pt = rec ? screenOfMap(rec.centroid) : [viewW * 0.5, viewH * 0.5];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 4 / 11',
          title: '📍 Fabrikayı Haritaya Yerleştir',
          body: 'Kendi toprağınızdaki boş bir bölgeye sol tıklayarak Fabrikayı kurun.',
          iconUri: getBuildingSpriteDataUri('factory', pColor),
        };
      }

      case '3_click_factory': {
        const f = this.findPlayerBuilding(pid, 'factory');
        const pt = f ? screenOfMap(getRegionBuildingPoint(f)) : [viewW * 0.5, viewH * 0.5];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 4 / 11',
          title: '⚙️ Fabrikaya Tıkla',
          body: 'Haritadaki <b>Fabrika</b> binasına tıklayarak paralel ekipman üretim penceresini açın.',
          iconUri: getBuildingSpriteDataUri('factory', pColor),
        };
      }

      case '3_order_equip': {
        const activeOrders = getCountryActiveProductionOrders(this.state, pid);
        const totalW =
          (p?.weaponsStock.sword ?? 0) +
          activeOrders
            .filter((o) => o.order.category === 'weapon')
            .reduce((s, o) => s + o.order.remainingCount, 0);
        const alreadyOrdered = totalW >= 4;
        const pt = alreadyOrdered
          ? centerOfSelector('.close-win') ?? [viewW * 0.75, 110]
          : centerOfSelector('#btn-factory-start') ?? [viewW * 0.72, 460];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 4 / 11',
          title: alreadyOrdered
            ? '⏳ Paralel Hatlar Hazır — Kapat & İzle'
            : '⚔️🛡️ Silah & Kalkan Siparişi Ver',
          body: alreadyOrdered
            ? 'Harika! Satırlardaki ayrı loading bar\'ları gördünüz. Şimdi <b>✕</b> (veya aşağıdaki <b>▶ Üretimi İzle</b>) butonuna basarak üretimin tamamlanmasını izleyin.'
            : 'Sol sütundaki <b>Kılıç</b> ve sağ sütundaki <b>Tahta Kalkan</b> ikonlarının yanından <code>+5</code> butonlarıyla en az <b>4 silah & kalkan</b> seçip <b>⚙️ Üretimi Başlat</b>\'a basın.',
          iconUri: getBuildingSpriteDataUri('factory', pColor),
          showFactoryProceedBtn: alreadyOrdered,
        };
      }

      case '4_open_shop': {
        const pt = centerOfSelector('#btn-dock-shop') ?? [viewW * 0.44, viewH - 32];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 5 / 11',
          title: '🛡️ Kışla İçin Mağaza\'yı Aç',
          body: 'Ekipmanlarımız stokta! Şimdi asker yetiştirmek için <b>🏪 Mağaza</b>\'dan Kışla alalım.',
          iconUri: getBuildingSpriteDataUri('barracks', pColor),
        };
      }

      case '4_pick_barracks': {
        const pt = centerOfSelector('[data-shop-type="barracks"]') ?? [viewW * 0.7, 370];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 5 / 11',
          title: '🛡️ Kışla (160 💰) Seç',
          body: 'Her Kışla kendi konumunda bağımsız asker eğitir. <b>Kışla — Haritaya Yerleştir (160💰)</b> butonuna tıklayın.',
          iconUri: getBuildingSpriteDataUri('barracks', pColor),
        };
      }

      case '4_place_barracks': {
        const rec = this.getRecommendedEmptyRegion(pid);
        const pt = rec ? screenOfMap(rec.centroid) : [viewW * 0.5, viewH * 0.5];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 5 / 11',
          title: '📍 Kışlayı Haritaya Yerleştir',
          body: 'Askerlerin doğmasını istediğiniz boş bölgenize sol tıklayarak Kışlayı kurun.',
          iconUri: getBuildingSpriteDataUri('barracks', pColor),
        };
      }

      case '4_click_barracks': {
        const br = this.findPlayerBuilding(pid, 'barracks');
        const pt = br ? screenOfMap(getRegionBuildingPoint(br)) : [viewW * 0.5, viewH * 0.5];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 5 / 11',
          title: '🛡️ Kışlaya Tıkla',
          body: 'Tamamlanan <b>Kışla</b> binasına tıklayarak ikonlu asker eğitim ekranını açın.',
          iconUri: getBuildingSpriteDataUri('barracks', pColor),
        };
      }

      case '4_train_soldiers': {
        const pt = centerOfSelector('#btn-barracks-train') ?? [viewW * 0.7, 250];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 5 / 11',
          title: '⚔️ İlk Ordunu Yetiştir',
          body: 'Asker sayısını (veya <code>MAX</code>) belirleyin, alt satırlarda <b>Kılıç</b> ve <b>Kalkan</b> için <code>MAX</code> / <code>+5</code> seçip <b>⚔️ Asker Yetiştir</b> butonuna tıklayın!',
          iconUri: getBuildingSpriteDataUri('barracks', pColor),
        };
      }

      case '5_click_army': {
        const a = this.getPlayerArmies(pid)[0];
        const pt = a ? screenOfMap([a.x, a.y]) : [viewW * 0.5, viewH * 0.5];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 6 / 11',
          title: '🎯 Ordunu Seç',
          body: 'Kışlanın yanında doğan <b>ordumuza</b> haritada sol tıklayın.',
          iconUri: getUnitSpriteDataUri('sword', 'wood', pColor),
        };
      }

      case '5_move_border': {
        const bReg = this.playerBorderRegionId ? this.state.regions[this.playerBorderRegionId] : null;
        const pt = bReg ? screenOfMap(bReg.centroid) : [viewW * 0.5, viewH * 0.5];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 6 / 11',
          title: '🚶 Sınır Bölgesine Yürüt',
          body: 'Haritada işaretli sınır bölgemize (veya kendi toprağınızdaki başka bir bölgeye) sol tıklayarak ordunuzu yürütün.',
          iconUri: getUnitSpriteDataUri('sword', 'wood', pColor),
        };
      }

      case '6_click_army': {
        const a = this.getPlayerArmies(pid)[0];
        const pt = a ? screenOfMap([a.x, a.y]) : [viewW * 0.5, viewH * 0.5];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 7 / 11',
          title: '✂️ Bölme İçin Orduya Tıkla',
          body: 'Ordumuzu iki parçaya bölmeyi denemek için tekrar <b>ordumuza</b> sol tıklayın.',
          iconUri: getUnitSpriteDataUri('sword', 'wood', pColor),
        };
      }

      case '6_split_half': {
        const pt = centerOfSelector('#btn-split-half') ?? [viewW * 0.35, 420];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 7 / 11',
          title: '✂️ Yarıya Böl (50/50)',
          body: 'Ordu penceresindeki <b>✂️ Yarıya Böl (50/50)</b> butonuna tıklayarak tek tıkla 2 ayrı birlik oluşturun.',
          iconUri: getUnitSpriteDataUri('sword', 'wood', pColor),
        };
      }

      case '6_merge_armies': {
        const mergeBtnPt = centerOfSelector('#btn-multi-merge');
        if (mergeBtnPt) {
          return {
            cx: mergeBtnPt[0],
            cy: mergeBtnPt[1],
            stepBadge: 'Adım 7 / 11',
            title: '🔗 Seçilenleri Birleştir!',
            body: 'Süper! Sağ altta açılan çoklu ordu panelindeki <b>🔗 Seçilenleri Birleştir</b> butonuna tıklayın.',
            iconUri: getUnitSpriteDataUri('sword', 'wood', pColor),
          };
        }
        const a = this.getPlayerArmies(pid)[0];
        const pt = a ? screenOfMap([a.x, a.y]) : [viewW * 0.5, viewH * 0.5];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 7 / 11',
          title: '🟩 Kutu Seçimiyle İki Birliği Seç',
          body: 'Haritada <b>sol tık basılı tutup sürükleyerek (Box-Select)</b> iki birliği birden çerçeve içine alın (veya birine tıklayıp diğerinin üstüne tıklayın)!',
          iconUri: getUnitSpriteDataUri('sword', 'wood', pColor),
        };
      }

      case '7_open_diplomacy': {
        const pt = centerOfSelector('#btn-dock-diplomacy') ?? [viewW * 0.5, viewH - 32];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 8 / 11',
          title: '📜 2 Sayfalı Diplomasi\'yi Aç',
          body: 'Komşu ülkelerle ilişkileri incelemek ve savaş ilan etmek için alt menüdeki <b>📜 Diplomasi</b> butonuna tıklayın.',
          iconUri: getCountryFlagDataUri(pColor),
        };
      }

      case '7_pick_rival': {
        const sel = this.rivalCountryId
          ? `[data-dip-card="${this.rivalCountryId}"]`
          : '[data-dip-card]';
        const pt = centerOfSelector(sel) ?? centerOfSelector('[data-dip-card]') ?? [viewW * 0.4, 280];
        const rivalName =
          (this.rivalCountryId && this.state.countries[this.rivalCountryId]?.name) || 'komşu ülkeye';
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 8 / 11',
          title: '🏳️ Sayfa 1: Komşu Ülkeyi Seç',
          body: `Aktif ülkeler listesinden sınır komşumuz <b>${rivalName}</b> kartına (veya dilediğiniz komşu ülkeye) tıklayarak 2. sayfadaki ilişki dosyasına geçin.`,
          iconUri: getCountryFlagDataUri(
            (this.rivalCountryId && this.state.countries[this.rivalCountryId]?.color) || '#ef4444',
          ),
        };
      }

      case '7_declare_war': {
        const pt = centerOfSelector('#btn-dip-war') ?? [viewW * 0.72, 340];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 8 / 11',
          title: '⚔️ Sayfa 2: Savaş İlan Et',
          body: '2. sayfada ilişki puan çubuğunu ve 7 diplomatik aksiyonu görüyorsunuz. Şimdi <b>⚔️ Savaş İlan Et</b> butonuna tıklayın!',
          iconUri: getCountryFlagDataUri('#ef4444'),
        };
      }

      case '8a_click_army': {
        const a = this.getPlayerArmies(pid)[0];
        const pt = a ? screenOfMap([a.x, a.y]) : [viewW * 0.5, viewH * 0.5];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 9 / 11',
          title: '🛡️ Alan Savunması: Ordunu Seç!',
          body: 'Dikkat! Komşu ülkeden küçük bir öncü birlik sınırımıza yürüyor. Kendi toprağımızda <b>+%10 Vatan Savunması</b> bonusumuz var — hemen <b>ordumuza</b> tıklayın!',
          iconUri: getUnitSpriteDataUri('sword', 'wood', pColor),
        };
      }

      case '8a_intercept': {
        const vg = this.vanguardArmyId ? this.state.armies[this.vanguardArmyId] : null;
        const pt = vg ? screenOfMap([vg.x, vg.y]) : [viewW * 0.5, viewH * 0.5];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 9 / 11',
          title: '⚔️ Düşman Öncüsünü Karşıla!',
          body: 'Gelen <b>düşman birliğinin</b> (veya sınır bölgemizin) üzerine sol tıklayarak vatan savunmasını başlatın!',
          iconUri: getUnitSpriteDataUri('sword', 'none', '#ef4444'),
        };
      }

      case '8b_click_army': {
        const a = this.getPlayerArmies(pid)[0];
        const pt = a ? screenOfMap([a.x, a.y]) : [viewW * 0.5, viewH * 0.5];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 9 / 11',
          title: '🏴 Karşı Saldırı: Ordunu Seç',
          body: 'Savunmayı kazandık! Sahada <b>🩹 Yaralı — Hastane Bekliyor</b> birliğimiz oluştu. Önce karşı saldırı ile <b>+1.000 💰</b> ganimet almak için <b>ordumuza</b> tıklayın!',
          iconUri: getUnitSpriteDataUri('sword', 'wood', pColor),
        };
      }

      case '8b_attack_region': {
        const rReg = this.rivalBorderRegionId ? this.state.regions[this.rivalBorderRegionId] : null;
        const pt = rReg ? screenOfMap(rReg.centroid) : [viewW * 0.5, viewH * 0.5];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 9 / 11',
          title: '🏴 Komşu Bölgeye Saldır (+1.000 💰)',
          body: 'Komşunun <b>sınır bölgesine</b> sol tıklayarak ordunuzu gönderin; bölge ele geçirilince içindeki düşman binası yıkılır ve anında <b>+1.000 💰</b> ödül yatar!',
          iconUri: getCountryFlagDataUri('#ef4444'),
        };
      }

      case '9_open_shop': {
        const pt = centerOfSelector('#btn-dock-shop') ?? [viewW * 0.44, viewH - 32];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 10 / 11',
          title: '🏥 Yaralıları Kurtar: Mağaza\'yı Aç',
          body: 'Fetihten <b>+1.000 💰</b> kazandık! Şimdi sahada bekleyen <b>🩹 Yaralı</b> askerlerimizi kurtarmak için <b>🏪 Mağaza</b>\'dan bir Hastane kuralım.',
          iconUri: getBuildingSpriteDataUri('hospital', pColor),
        };
      }

      case '9_pick_hospital': {
        const pt = centerOfSelector('[data-shop-type="hospital"]') ?? [viewW * 0.7, 430];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 10 / 11',
          title: '🏥 Hastane (150 💰) Seç',
          body: 'Hastane hem <b>+%15 sağlık (+2 Manpower/sn)</b> verir hem de yaralıları eski ekipmanlarıyla iyileştirir. <b>Hastane — Haritaya Yerleştir</b>\'e tıklayın.',
          iconUri: getBuildingSpriteDataUri('hospital', pColor),
        };
      }

      case '9_place_hospital': {
        const rec = this.getRecommendedEmptyRegion(pid);
        const pt = rec ? screenOfMap(rec.centroid) : [viewW * 0.5, viewH * 0.5];
        return {
          cx: pt[0],
          cy: pt[1],
          stepBadge: 'Adım 10 / 11',
          title: '📍 Hastaneyi Cepheye Yakın Kur',
          body: 'Kendi boş bölgenize sol tıklayarak Hastaneyi kurun — tamamlandığı an yaralıların Hastaneye koşup iyileşmesini izleyeceğiz!',
          iconUri: getBuildingSpriteDataUri('hospital', pColor),
        };
      }

      case '10_final': {
        return {
          cx: viewW * 0.5,
          cy: viewH * 0.5,
          stepBadge: 'Adım 11 / 11',
          title: '🏆 Artık Pixel World\'e Hazırsın!',
          body: 'Ekonomi, Banka kredisi, paralel Fabrika, Kışla, RTS kutu seçimi, 2 sayfalı Diplomasi, fetih ve Hastane yaralı kurtarma mekaniklerinin tamamını başarıyla tamamladınız!',
          iconUri: getCountryFlagDataUri(pColor),
          isFinal: true,
        };
      }
    }

    return null;
  }

  private getWaitBadgeText(pid: string): string {
    const p = this.state.countries[pid];
    switch (this.stage) {
      case '2a_wait_bank': {
        const b = this.findPlayerBuilding(pid, 'bank', true)?.building;
        const pct = b ? Math.min(100, Math.round((b.progressSec / Math.max(0.1, b.totalSec)) * 100)) : 0;
        return `⏳ Görev: İlk Banka inşa ediliyor (3× hız) — %${pct}`;
      }
      case '3_wait_factory': {
        const b = this.findPlayerBuilding(pid, 'factory', true)?.building;
        const pct = b ? Math.min(100, Math.round((b.progressSec / Math.max(0.1, b.totalSec)) * 100)) : 0;
        return `⏳ Görev: Fabrika inşa ediliyor (3× hız) — %${pct}`;
      }
      case '3_wait_equip': {
        const orders = getCountryActiveProductionOrders(this.state, pid);
        const rem = orders.reduce((s, o) => s + o.order.remainingCount, 0);
        return `⏳ Görev: Silah & kalkan üretimi tamamlanıyor — Stok Kılıç: ${p?.weaponsStock.sword ?? 0} (Kalan: ${rem})`;
      }
      case '4_wait_barracks': {
        const b = this.findPlayerBuilding(pid, 'barracks', true)?.building;
        const pct = b ? Math.min(100, Math.round((b.progressSec / Math.max(0.1, b.totalSec)) * 100)) : 0;
        return `⏳ Görev: Kışla inşa ediliyor (3× hız) — %${pct}`;
      }
      case '4_wait_soldiers': {
        const bar = this.findPlayerBuilding(pid, 'barracks')?.building;
        const rem = (bar?.trainingQueue ?? []).reduce((s, o) => s + o.remainingCount, 0);
        return `⏳ Görev: Kışlada ilk ordumuz eğitiliyor — Kalan: ${rem} Asker`;
      }
      case '5_wait_march':
        return '⏳ Görev: Ordumuz sınır bölgesine yürüyor...';
      case '6_wait_merge':
        return '⏳ Görev: Seçili birlikler buluşma noktasında birleşiyor...';
      case '8a_wait_defense':
        return '⏳ Görev: Vatan savunması çatışması devam ediyor (+%10 Savunma Bonusu)...';
      case '8b_wait_capture': {
        const capReg = Object.values(this.state.regions).find(
          (r) => r.capture?.attackerCountryId === pid,
        );
        const pct = capReg?.capture
          ? Math.min(100, Math.round((capReg.capture.elapsedSec / Math.max(0.1, capReg.capture.requiredSec)) * 100))
          : 0;
        return pct > 0
          ? `⏳ Görev: Düşman bölgesi ele geçiriliyor (+1.000💰 ödül) — %${pct}`
          : '⏳ Görev: Ordumuz düşman sınır bölgesine ilerliyor...';
      }
      case '9_wait_rescue': {
        const hospDone = getEffectiveBuildingCount(this.state, pid, 'hospital') >= 1;
        if (!hospDone) {
          const b = this.findPlayerBuilding(pid, 'hospital', true)?.building;
          const pct = b ? Math.min(100, Math.round((b.progressSec / Math.max(0.1, b.totalSec)) * 100)) : 0;
          return `⏳ Görev: Hastane inşa ediliyor — %${pct}`;
        }
        const w = this.state.wounded.find((x) => x.countryId === pid);
        if (w && w.travelProgress < 1) {
          return `⏳ Görev: 🩹 Yaralı askerler yeni Hastaneye koşuyor — %${Math.round(w.travelProgress * 100)}`;
        }
        const healPct = w
          ? Math.min(100, Math.round((w.healElapsedSec / Math.max(0.1, w.healRequiredSec)) * 100))
          : 100;
        return `⏳ Görev: Hastanede yaralılar iyileşiyor (+X İyileşti!) — %${healPct}`;
      }
      default:
        return '⏳ Görev devam ediyor...';
    }
  }

  syncFrame(): void {
    const host = document.getElementById('spotlight-host');
    const pid = this.state.playerCountryId;
    if (!host || !this.isActive || !pid) {
      if (host && host.innerHTML !== '') host.innerHTML = '';
      return;
    }

    this.advanceTransitions(pid);
    if (!this.isActive) return;

    const viewW = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const viewH = typeof window !== 'undefined' ? window.innerHeight : 720;

    // 1. Live Waiting Task Badge (mask lifted, game flows!)
    if (this.isWaitStage(this.stage)) {
      const badgeText = this.getWaitBadgeText(pid);
      const sig = `wait|${this.stage}|${badgeText}`;
      if (this.lastRenderedSig === sig) return;
      this.lastRenderedSig = sig;

      host.innerHTML = `
        <div class="tut-live-task-bar" id="tut-live-task-badge">
          <span>${badgeText}</span>
          <button class="pixel-btn mini-qty-btn" id="btn-skip-spotlight-tutorial">Tutorial'ı Geç ✕</button>
        </div>
      `;
      host.querySelector('#btn-skip-spotlight-tutorial')?.addEventListener('click', () => {
        this.skipOrStop();
        this.callbacks.onFinishKeepPlaying();
      });
      return;
    }

    // 2. Active 20px SVG Spotlight + Target-Anchored Card!
    const info = this.getTargetCenterAndInfo(pid, viewW, viewH);
    if (!info) return;

    // Final Step 11 (2-option release modal)
    if (info.isFinal) {
      const sig = 'final_11';
      if (this.lastRenderedSig === sig) return;
      this.lastRenderedSig = sig;
      host.innerHTML = `
        <div class="tutorial-prompt-modal" style="z-index:96">
          <div class="pixel-panel modal-window" style="max-width:680px;border-color:#facc15">
            <div class="modal-header">
              <div class="popup-title-wrap">
                <img class="popup-header-icon" src="${info.iconUri}" alt="" />
                <strong>${info.title}</strong>
              </div>
              <span class="tut-step-pill">${info.stepBadge}</span>
            </div>
            <p style="font-size:16px;line-height:1.6">${info.body}</p>
            <hr class="popup-divider" />
            <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:12px">
              <button class="pixel-btn" id="btn-tut-finish-fresh">🔄 Sıfırdan Adil Başla (1 Oca 2000 • 100💰)</button>
              <button class="pixel-btn active-btn" id="btn-tut-finish-keep">▶ Kurduklarımla Devam Et</button>
            </div>
          </div>
        </div>
      `;
      host.querySelector('#btn-tut-finish-fresh')?.addEventListener('click', () => {
        this.skipOrStop();
        this.callbacks.onFinishFreshRestart();
      });
      host.querySelector('#btn-tut-finish-keep')?.addEventListener('click', () => {
        this.skipOrStop();
        this.callbacks.onFinishKeepPlaying();
      });
      return;
    }

    const cx = Math.round(Math.max(24, Math.min(viewW - 24, info.cx)));
    const cy = Math.round(Math.max(24, Math.min(viewH - 24, info.cy)));

    // Position explanation card right above or below `(cx, cy)` without overflowing viewport or covering the 20px circle!
    const cardW = Math.min(430, viewW - 24);
    const estCardH = info.showContinueBtn || info.showFactoryProceedBtn ? 245 : 210;
    let cardLeft = Math.round(cx - cardW * 0.5);
    cardLeft = Math.max(12, Math.min(viewW - cardW - 12, cardLeft));

    let cardTop: number;
    if (this.stage === '1_goal') {
      // On Step 1, place card centered and spotlight directly on `#btn-tut-step-continue` inside it!
      cardLeft = Math.round((viewW - cardW) * 0.5);
      cardTop = Math.max(90, Math.round(viewH * 0.32));
    } else if (cy + SPOTLIGHT_RADIUS_PX + 24 + estCardH <= viewH - 12) {
      cardTop = cy + SPOTLIGHT_RADIUS_PX + 24;
    } else {
      cardTop = Math.max(12, cy - SPOTLIGHT_RADIUS_PX - estCardH - 24);
    }

    const flashActive = Date.now() < this.flashUntilMs;
    const sig = `${this.stage}|${cx},${cy}|${cardLeft},${cardTop}|${info.title}|${Boolean(info.showFactoryProceedBtn)}`;
    if (this.lastRenderedSig === sig) return;
    this.lastRenderedSig = sig;

    host.innerHTML = `
      <div class="spotlight-overlay-wrap">
        <svg class="spotlight-svg" width="${viewW}" height="${viewH}" viewBox="0 0 ${viewW} ${viewH}">
          <defs>
            <mask id="tut-spot-mask">
              <rect x="0" y="0" width="${viewW}" height="${viewH}" fill="white" />
              <circle cx="${cx}" cy="${cy}" r="${SPOTLIGHT_RADIUS_PX}" fill="black" />
            </mask>
          </defs>
          <rect x="0" y="0" width="${viewW}" height="${viewH}" fill="rgba(15, 23, 42, 0.58)" mask="url(#tut-spot-mask)" />
        </svg>

        <div class="tut-spotlight-card" style="left:${cardLeft}px;top:${cardTop}px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">
            <div style="display:flex;align-items:center;gap:8px">
              <img src="${info.iconUri}" style="width:28px;height:26px;image-rendering:pixelated" alt="" />
              <strong style="color:#fef08a">${info.title}</strong>
            </div>
            <span class="tut-step-pill">${info.stepBadge}</span>
          </div>
          <hr class="popup-divider" style="margin:6px 0" />
          <div style="margin-bottom:10px">${info.body}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <button class="pixel-btn mini-qty-btn" id="btn-skip-spotlight-tutorial">Tutorial'ı Geç ✕</button>
            ${
              info.showContinueBtn
                ? `<button class="pixel-btn active-btn" id="btn-tut-step-continue">▶ Devam</button>`
                : info.showFactoryProceedBtn
                  ? `<button class="pixel-btn active-btn" id="btn-tut-factory-proceed">▶ Üretimi İzle</button>`
                  : `<span class="muted" style="font-size:12.5px">Sarı halkalı hedefe tıklayın</span>`
            }
          </div>
        </div>

        <svg class="spotlight-ring-svg" width="${viewW}" height="${viewH}" viewBox="0 0 ${viewW} ${viewH}">
          <circle cx="${cx}" cy="${cy}" r="${SPOTLIGHT_RADIUS_PX + 2}" class="tut-pulse-ring ${flashActive ? 'tut-wrong-flash' : ''}" />
        </svg>
      </div>
    `;

    host.querySelector('#btn-skip-spotlight-tutorial')?.addEventListener('click', () => {
      this.skipOrStop();
      this.callbacks.onFinishKeepPlaying();
    });

    host.querySelector('#btn-tut-step-continue')?.addEventListener('click', () => {
      if (this.stage === '1_goal') {
        this.setStage('2a_open_shop');
      }
    });

    host.querySelector('#btn-tut-factory-proceed')?.addEventListener('click', () => {
      this.ui.closeButtonLockedByTutorial = false;
      this.ui.openWindow(null, false);
      this.setStage('3_wait_equip');
    });

    // Re-align Step 1 20px circle onto exact #btn-tut-step-continue button coordinates once mounted
    if (this.stage === '1_goal') {
      const btn = host.querySelector<HTMLElement>('#btn-tut-step-continue');
      if (btn) {
        const r = btn.getBoundingClientRect();
        if (r.width > 0) {
          const bx = Math.round(r.left + r.width * 0.5);
          const by = Math.round(r.top + r.height * 0.5);
          const maskCircle = host.querySelector('#tut-spot-mask circle');
          const pulseCircle = host.querySelector('.tut-pulse-ring');
          maskCircle?.setAttribute('cx', String(bx));
          maskCircle?.setAttribute('cy', String(by));
          pulseCircle?.setAttribute('cx', String(bx));
          pulseCircle?.setAttribute('cy', String(by));
        }
      }
    } else {
      // Ensure card never overlaps the 20px spotlight target circle after actual layout height is measured
      const cardEl = host.querySelector<HTMLElement>('.tut-spotlight-card');
      if (cardEl) {
        const cr = cardEl.getBoundingClientRect();
        const pad = SPOTLIGHT_RADIUS_PX + 18;
        if (cr.height > 0 && cy >= cr.top - pad && cy <= cr.bottom + pad) {
          if (cy + pad + cr.height <= viewH - 10) {
            cardEl.style.top = `${Math.round(cy + pad)}px`;
          } else {
            cardEl.style.top = `${Math.max(10, Math.round(cy - pad - cr.height))}px`;
          }
        }
      }
    }
  }

  private isMapInteractionStage(st: TutorialStageId): boolean {
    return (
      st === '2a_place_bank' ||
      st === '2b_click_bank' ||
      st === '3_place_factory' ||
      st === '3_click_factory' ||
      st === '4_place_barracks' ||
      st === '4_click_barracks' ||
      st === '5_click_army' ||
      st === '5_move_border' ||
      st === '6_click_army' ||
      st === '6_merge_armies' ||
      st === '8a_click_army' ||
      st === '8a_intercept' ||
      st === '8b_click_army' ||
      st === '8b_attack_region' ||
      st === '9_place_hospital'
    );
  }

  private getAllowedSelectorForStage(st: TutorialStageId): string | null {
    switch (st) {
      case '1_goal':
        return '#btn-tut-step-continue';
      case '2a_open_shop':
      case '3_open_shop':
      case '4_open_shop':
      case '9_open_shop':
        return '#btn-dock-shop';
      case '2a_pick_bank':
        return '[data-shop-type="bank"]';
      case '2b_take_loan':
        return '#btn-loan-500';
      case '3_pick_factory':
        return '[data-shop-type="factory"]';
      case '3_order_equip':
        return '.modal-window'; // Allow +1/+5/+10/MAX, inputs, Start, and ✕ once ordered
      case '4_pick_barracks':
        return '[data-shop-type="barracks"]';
      case '4_train_soldiers':
        return '.modal-window'; // Allow MAX, +1/+5/+10, inputs, and Asker Yetiştir
      case '6_split_half':
        return '#btn-split-half';
      case '7_open_diplomacy':
        return '#btn-dock-diplomacy';
      case '7_pick_rival':
        return '[data-dip-card]';
      case '7_declare_war':
        return '#btn-dip-war';
      case '9_pick_hospital':
        return '[data-shop-type="hospital"]';
      case '10_final':
        return '.modal-window';
      default:
        return null;
    }
  }

  private installGlobalClickGuard(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener(
      'mousedown',
      (ev) => {
        if (!this.isActive || this.isWaitStage(this.stage)) return;
        // Always allow right/middle mouse drag panning
        if (ev.button === 1 || ev.button === 2) return;

        const target = ev.target as HTMLElement | null;
        if (!target) return;

        // Always allow Tutorial'ı Geç & Tutorial card action buttons
        if (
          target.closest('#btn-skip-spotlight-tutorial') ||
          target.closest('#btn-tut-step-continue') ||
          target.closest('#btn-tut-factory-proceed') ||
          target.closest('#btn-tut-finish-fresh') ||
          target.closest('#btn-tut-finish-keep')
        ) {
          return;
        }

        // Map interaction stages: allow canvas clicks (and #btn-multi-merge in 6_merge_armies!)
        if (this.isMapInteractionStage(this.stage)) {
          if (this.stage === '6_merge_armies' && target.closest('#multi-army-panel')) {
            return;
          }
          if (target.id === 'map-canvas') {
            return;
          }
          ev.preventDefault();
          ev.stopPropagation();
          this.triggerWrongClickFlash();
          return;
        }

        const allowedSel = this.getAllowedSelectorForStage(this.stage);
        if (allowedSel && target.closest(allowedSel)) {
          // Block locked close button inside modal
          if (target.closest('.close-win') && this.ui.closeButtonLockedByTutorial) {
            ev.preventDefault();
            ev.stopPropagation();
            this.triggerWrongClickFlash();
            return;
          }
          return;
        }

        // Wrong click on dimmed background -> 2x red-yellow flash on the 20px spotlight!
        ev.preventDefault();
        ev.stopPropagation();
        this.triggerWrongClickFlash();
      },
      true,
    );
  }
}
