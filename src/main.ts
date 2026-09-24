import { checkHealth } from './api';
import { initializeChampionCatalog } from './catalog-state';
import type { Champion, ChampionCatalog } from './champions';
import {
  SLOT_IDS,
  championUnavailableReason,
  isCompleteSelection,
  searchChampions,
  selectChampion,
  snapshotSelection,
} from './matchup';
import type { DraftSelection, MatchupSelection, SlotId } from './matchup';
import './styles/main.css';

const SLOT_META: Record<SlotId, { role: string; team: string }> = {
  allyCarry: { role: 'Carry', team: 'allié' },
  allySupport: { role: 'Support', team: 'allié' },
  enemyCarry: { role: 'Carry', team: 'adverse' },
  enemySupport: { role: 'Support', team: 'adverse' },
};

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Élément #app introuvable');

let selection: DraftSelection = Object.freeze({});
let activeSlot: SlotId | undefined;
let mirrorEnabled = false;
let catalog: ChampionCatalog | undefined;
let lastAnalyzedSelection: MatchupSelection | undefined;

app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="/" aria-label="LaneLens, accueil">LANE<span>LENS</span><i aria-hidden="true">◈</i></a>
    <div class="catalog-meta"><span id="catalog-version">Chargement des champions...</span><span id="cache-status" hidden>Données en cache</span></div>
  </header>
  <section class="hero" aria-labelledby="page-title">
    <p class="eyebrow">COMPOSEZ VOTRE MATCHUP</p>
    <h1 id="page-title">Votre botlane.<br><span>Face à la leur.</span></h1>
    <p>Choisissez les quatre champions pour préparer votre plan de jeu.</p>
  </section>
  <section class="matchup" aria-label="Sélection du matchup">
    <div class="team-block">
      <div class="team-heading"><span>01</span><h2>Notre botlane</h2></div>
      <div class="slots" id="ally-slots"></div>
    </div>
    <div class="versus" aria-hidden="true"><span></span><b>VS</b><span></span></div>
    <div class="team-block">
      <div class="team-heading enemy"><span>02</span><h2>Botlane adverse</h2></div>
      <div class="slots" id="enemy-slots"></div>
    </div>
  </section>
  <p class="catalog-message" id="catalog-message" role="status" aria-live="polite">Chargement des champions...</p>
  <div class="actions">
    <button class="mirror-button" id="mirror" type="button" aria-pressed="false"><span aria-hidden="true">⇄</span> Mirror</button>
    <button class="analyze-button" id="analyze" type="button" disabled>Analyser <span aria-hidden="true">→</span></button>
  </div>
  <footer><span>LANELENS</span><span id="health" role="status">Service : vérification…</span></footer>
  <dialog class="picker" id="picker" aria-labelledby="picker-title">
    <div class="picker-header">
      <div><p class="eyebrow">CHAMPION PICKER</p><h2 id="picker-title">Choisir un champion</h2></div>
      <button class="close-button" id="close-picker" type="button" aria-label="Fermer">×</button>
    </div>
    <label class="search"><span aria-hidden="true">⌕</span><span class="sr-only">Rechercher un champion</span><input id="champion-search" type="search" placeholder="Rechercher un champion…" autocomplete="off"></label>
    <p class="picker-hint" id="picker-hint"></p>
    <div class="champion-grid" id="champion-grid" role="list"></div>
  </dialog>
`;

const picker = document.querySelector<HTMLDialogElement>('#picker')!;
const searchInput = document.querySelector<HTMLInputElement>('#champion-search')!;
const championGrid = document.querySelector<HTMLDivElement>('#champion-grid')!;
const pickerTitle = document.querySelector<HTMLHeadingElement>('#picker-title')!;
const pickerHint = document.querySelector<HTMLParagraphElement>('#picker-hint')!;
const mirrorButton = document.querySelector<HTMLButtonElement>('#mirror')!;
const analyzeButton = document.querySelector<HTMLButtonElement>('#analyze')!;
const catalogMessage = document.querySelector<HTMLParagraphElement>('#catalog-message')!;

function portrait(champion: Champion, size: 'slot' | 'picker'): HTMLElement {
  const frame = document.createElement('span');
  frame.className = `portrait portrait-${size}`;
  frame.textContent = champion.name.slice(0, 1).toLocaleUpperCase('fr-FR');
  const image = document.createElement('img');
  image.src = champion.imageUrl;
  image.alt = '';
  image.loading = 'lazy';
  image.addEventListener('load', () => frame.classList.add('loaded'));
  image.addEventListener('error', () => image.remove());
  frame.append(image);
  return frame;
}

function renderSlots(): void {
  for (const [containerId, slots] of [
    ['ally-slots', SLOT_IDS.slice(0, 2)],
    ['enemy-slots', SLOT_IDS.slice(2)],
  ] as const) {
    const container = document.querySelector<HTMLDivElement>(`#${containerId}`)!;
    container.replaceChildren();
    for (const slot of slots) {
      const champion = selection[slot];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `champion-slot${champion ? ' selected' : ''}`;
      button.disabled = !catalog;
      button.dataset.slot = slot;
      button.setAttribute('aria-label', `${SLOT_META[slot].role} ${SLOT_META[slot].team} : ${champion?.name ?? 'non sélectionné'}`);
      const role = document.createElement('span');
      role.className = 'slot-role';
      role.textContent = SLOT_META[slot].role;
      button.append(role);
      if (champion) {
        button.append(portrait(champion, 'slot'));
        const name = document.createElement('strong');
        name.textContent = champion.name;
        button.append(name);
        const edit = document.createElement('small');
        edit.textContent = 'Modifier';
        button.append(edit);
      } else {
        const plus = document.createElement('span');
        plus.className = 'slot-plus';
        plus.setAttribute('aria-hidden', 'true');
        plus.textContent = '+';
        button.append(plus);
        const label = document.createElement('strong');
        label.textContent = 'Choisir';
        button.append(label);
      }
      button.addEventListener('click', () => openPicker(slot));
      container.append(button);
    }
  }
  analyzeButton.disabled = !isCompleteSelection(selection);
}

function reasonLabel(reason: ReturnType<typeof championUnavailableReason>): string {
  if (reason === 'same-team') return 'Déjà utilisé dans cette équipe';
  if (reason === 'opponent-duplicate') return 'Activez Mirror pour ce face-à-face';
  return 'Déjà utilisé deux fois';
}

function renderPicker(): void {
  if (!catalog || !activeSlot) return;
  const results = searchChampions(catalog.champions, searchInput.value);
  championGrid.replaceChildren();
  pickerHint.textContent = `${results.length} champion${results.length > 1 ? 's' : ''}`;
  if (results.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-results';
    empty.textContent = 'Aucun champion trouvé.';
    championGrid.append(empty);
    return;
  }
  for (const champion of results) {
    const reason = championUnavailableReason(selection, activeSlot, champion.id, mirrorEnabled);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'champion-card';
    button.disabled = reason !== undefined;
    button.setAttribute('role', 'listitem');
    button.setAttribute('aria-label', reason ? `${champion.name}, ${reasonLabel(reason)}` : champion.name);
    button.append(portrait(champion, 'picker'));
    const name = document.createElement('span');
    name.textContent = champion.name;
    button.append(name);
    if (reason) {
      const unavailable = document.createElement('small');
      unavailable.textContent = reasonLabel(reason);
      button.append(unavailable);
    }
    if (reason === 'opponent-duplicate') {
      const emphasize = () => mirrorButton.classList.add('suggested');
      const restore = () => mirrorButton.classList.remove('suggested');
      button.addEventListener('mouseenter', emphasize);
      button.addEventListener('mouseleave', restore);
      button.addEventListener('focus', emphasize);
      button.addEventListener('blur', restore);
    }
    button.addEventListener('click', () => chooseChampion(champion));
    championGrid.append(button);
  }
}

function openPicker(slot: SlotId): void {
  if (!catalog) return;
  activeSlot = slot;
  searchInput.value = '';
  pickerTitle.textContent = `${SLOT_META[slot].role} ${SLOT_META[slot].team}`;
  renderPicker();
  picker.showModal();
  searchInput.focus();
}

function chooseChampion(champion: Champion): void {
  if (!activeSlot) return;
  selection = selectChampion(selection, activeSlot, champion, mirrorEnabled);
  picker.close();
  activeSlot = undefined;
  renderSlots();
}

mirrorButton.addEventListener('click', () => {
  mirrorEnabled = !mirrorEnabled;
  mirrorButton.setAttribute('aria-pressed', String(mirrorEnabled));
  mirrorButton.classList.toggle('active', mirrorEnabled);
  if (picker.open) renderPicker();
});
searchInput.addEventListener('input', renderPicker);
document.querySelector('#close-picker')!.addEventListener('click', () => picker.close());
picker.addEventListener('click', (event) => {
  if (event.target === picker) picker.close();
});
picker.addEventListener('close', () => {
  activeSlot = undefined;
  mirrorButton.classList.remove('suggested');
});
analyzeButton.addEventListener('click', () => {
  const snapshot = snapshotSelection(selection);
  if (!snapshot) return;
  lastAnalyzedSelection = snapshot;
  app.dispatchEvent(new CustomEvent<MatchupSelection>('lanelens:analyze', { detail: snapshot }));
  analyzeButton.classList.add('confirmed');
  analyzeButton.firstChild!.textContent = 'Sélection prête ';
  window.setTimeout(() => {
    analyzeButton.classList.remove('confirmed');
    analyzeButton.firstChild!.textContent = 'Analyser ';
  }, 1600);
});

export function getLastAnalyzedSelection(): MatchupSelection | undefined {
  return lastAnalyzedSelection;
}

async function start(): Promise<void> {
  renderSlots();
  const result = await initializeChampionCatalog();
  if (result.status === 'error') {
    catalogMessage.textContent = 'Impossible de charger les champions.';
    catalogMessage.dataset.state = 'error';
    return;
  }
  catalog = result.catalog;
  document.querySelector('#catalog-version')!.textContent = `Data Dragon ${catalog.dataDragonVersion}`;
  const cacheStatus = document.querySelector<HTMLElement>('#cache-status')!;
  cacheStatus.hidden = !catalog.stale;
  catalogMessage.hidden = true;
  renderSlots();
}

async function refreshHealth(): Promise<void> {
  const health = document.querySelector<HTMLElement>('#health')!;
  try {
    await checkHealth();
    health.textContent = 'Service disponible';
    health.dataset.state = 'ok';
  } catch {
    health.textContent = 'Service indisponible';
    health.dataset.state = 'error';
  }
}

void start();
void refreshHealth();
