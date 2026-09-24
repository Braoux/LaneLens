import {
  InvalidAnalysisResponseError,
  analyzeMatchup,
  checkHealth,
  getAnalysisContext,
} from './api';
import {
  buildMatchupRequest,
  invalidateActiveAnalysisRequest,
  isActiveAnalysisRequest,
  serializeCheatSheet,
  toQuickOverlay,
} from './analysis';
import { initializeChampionCatalog } from './catalog-state';
import type { Champion, ChampionCatalog } from './champions';
import { MatchupHistoryStore } from './history';
import type { MatchupHistoryEntry } from './history';
import {
  SLOT_IDS,
  championUnavailableReason,
  isCompleteSelection,
  searchChampions,
  selectChampion,
  snapshotSelection,
} from './matchup';
import type { DraftSelection, MatchupSelection, SlotId } from './matchup';
import type { AnalysisContextResponse, MatchupAnalysis } from '../shared/analysis-contract';
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
let analysisContext: AnalysisContextResponse | undefined;
let isAnalyzing = false;
let activeRequestId = 0;
let activeAnalysisController: AbortController | undefined;
const historyStore = new MatchupHistoryStore();
let historyEntries = historyStore.getEntries();

app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="/" aria-label="LaneLens, accueil">LANE<span>LENS</span><i aria-hidden="true">◈</i></a>
    <div class="catalog-meta">
      <span id="analysis-patch" hidden></span>
      <span id="catalog-version">Chargement des champions...</span>
      <span id="cache-status" hidden>Données en cache</span>
    </div>
  </header>
  <main>
    <div id="selection-view">
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
      <p class="analysis-message" id="analysis-message" role="status" aria-live="polite"></p>
      <div class="actions">
        <button class="mirror-button" id="mirror" type="button" aria-pressed="false"><span aria-hidden="true">⇄</span> Mirror</button>
        <button class="analyze-button" id="analyze" type="button" disabled>Analyser <span aria-hidden="true">→</span></button>
      </div>
      <section class="loading-card" id="loading-view" aria-live="polite" hidden>
        <span class="loading-spinner" aria-hidden="true"></span>
        <p class="eyebrow">ANALYSE EN COURS</p>
        <h2>Analyse du matchup...</h2>
        <p id="loading-matchup"></p>
      </section>
      <section class="history-section" id="history-section" aria-labelledby="history-title">
        <div class="history-heading">
          <p class="eyebrow">HISTORIQUE LOCAL</p>
          <h2 id="history-title">Dernières analyses</h2>
        </div>
        <p class="history-empty" id="history-empty">Aucune analyse récente.</p>
        <div class="history-list" id="history-list"></div>
      </section>
    </div>
    <div id="result-view" hidden></div>
  </main>
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

const selectionView = document.querySelector<HTMLElement>('#selection-view')!;
const resultView = document.querySelector<HTMLElement>('#result-view')!;
const loadingView = document.querySelector<HTMLElement>('#loading-view')!;
const picker = document.querySelector<HTMLDialogElement>('#picker')!;
const searchInput = document.querySelector<HTMLInputElement>('#champion-search')!;
const championGrid = document.querySelector<HTMLDivElement>('#champion-grid')!;
const pickerTitle = document.querySelector<HTMLHeadingElement>('#picker-title')!;
const pickerHint = document.querySelector<HTMLParagraphElement>('#picker-hint')!;
const mirrorButton = document.querySelector<HTMLButtonElement>('#mirror')!;
const analyzeButton = document.querySelector<HTMLButtonElement>('#analyze')!;
const catalogMessage = document.querySelector<HTMLParagraphElement>('#catalog-message')!;
const analysisMessage = document.querySelector<HTMLParagraphElement>('#analysis-message')!;
const historyList = document.querySelector<HTMLDivElement>('#history-list')!;
const historyEmpty = document.querySelector<HTMLParagraphElement>('#history-empty')!;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function portrait(champion: Champion, size: 'slot' | 'picker' | 'result'): HTMLElement {
  const frame = element('span', `portrait portrait-${size}`, champion.name.slice(0, 1).toLocaleUpperCase('fr-FR'));
  const image = document.createElement('img');
  image.src = champion.imageUrl;
  image.alt = '';
  image.loading = 'lazy';
  image.addEventListener('load', () => frame.classList.add('loaded'));
  image.addEventListener('error', () => image.remove());
  frame.append(image);
  return frame;
}

function renderControls(): void {
  analyzeButton.disabled = !isCompleteSelection(selection) || analysisContext === undefined || isAnalyzing;
  mirrorButton.disabled = isAnalyzing;
  document.querySelectorAll<HTMLButtonElement>('.champion-slot').forEach((button) => {
    button.disabled = catalog === undefined || isAnalyzing;
  });
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
      const button = element('button', `champion-slot${champion ? ' selected' : ''}`);
      button.type = 'button';
      button.dataset.slot = slot;
      button.setAttribute('aria-label', `${SLOT_META[slot].role} ${SLOT_META[slot].team} : ${champion?.name ?? 'non sélectionné'}`);
      button.append(element('span', 'slot-role', SLOT_META[slot].role));
      if (champion) {
        button.append(portrait(champion, 'slot'), element('strong', undefined, champion.name), element('small', undefined, 'Modifier'));
      } else {
        const plus = element('span', 'slot-plus', '+');
        plus.setAttribute('aria-hidden', 'true');
        button.append(plus, element('strong', undefined, 'Choisir'));
      }
      button.addEventListener('click', () => openPicker(slot));
      container.append(button);
    }
  }
  renderControls();
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
    championGrid.append(element('p', 'empty-results', 'Aucun champion trouvé.'));
    return;
  }
  for (const champion of results) {
    const reason = championUnavailableReason(selection, activeSlot, champion.id, mirrorEnabled);
    const button = element('button', 'champion-card');
    button.type = 'button';
    button.disabled = reason !== undefined;
    button.setAttribute('role', 'listitem');
    button.setAttribute('aria-label', reason ? `${champion.name}, ${reasonLabel(reason)}` : champion.name);
    button.append(portrait(champion, 'picker'), element('span', undefined, champion.name));
    if (reason) button.append(element('small', undefined, reasonLabel(reason)));
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
  if (!catalog || isAnalyzing) return;
  activeSlot = slot;
  searchInput.value = '';
  pickerTitle.textContent = `${SLOT_META[slot].role} ${SLOT_META[slot].team}`;
  renderPicker();
  picker.showModal();
  searchInput.focus();
}

function chooseChampion(champion: Champion): void {
  if (!activeSlot || isAnalyzing) return;
  selection = selectChampion(selection, activeSlot, champion, mirrorEnabled);
  picker.close();
  activeSlot = undefined;
  analysisMessage.textContent = '';
  renderSlots();
}

function resultChampion(champion: Champion): HTMLElement {
  const item = element('div', 'result-champion');
  item.append(portrait(champion, 'result'), element('strong', undefined, champion.name));
  return item;
}

function labeledCard(label: string, value: string, className = ''): HTMLElement {
  const card = element('article', `analysis-card ${className}`.trim());
  card.append(element('h3', undefined, label), element('p', undefined, value));
  return card;
}

function formatHistoryDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function renderResult(
  snapshot: MatchupSelection,
  analysis: MatchupAnalysis,
  historical?: { readonly generatedAt: string },
): void {
  resultView.replaceChildren();
  const header = element('section', 'result-header');
  header.append(element('p', 'eyebrow', historical ? 'ANALYSE SAUVEGARDÉE' : 'MATCHUP ANALYSIS'));
  const matchup = element('div', 'result-matchup');
  const allies = element('div', 'result-team');
  allies.append(resultChampion(snapshot.allyCarry), resultChampion(snapshot.allySupport));
  const enemies = element('div', 'result-team');
  enemies.append(resultChampion(snapshot.enemyCarry), resultChampion(snapshot.enemySupport));
  matchup.append(allies, element('b', 'result-vs', 'VS'), enemies);
  header.append(matchup, element('p', 'result-patch', `Patch ${analysis.matchup.patch.trim()}`));
  if (historical) {
    const saved = element('div', 'saved-analysis-meta');
    saved.append(
      element('strong', undefined, 'Analyse sauvegardée'),
      element('span', undefined, `Générée le ${formatHistoryDate(historical.generatedAt)}`),
    );
    header.append(saved);
  }
  resultView.append(header);

  const quick = toQuickOverlay(analysis);
  const overlay = element('section', 'quick-overlay');
  overlay.append(element('div', 'section-heading', 'QUICK OVERLAY'), labeledCard('Plan', quick.plan, 'quick-plan'));
  const windowGrid = element('div', 'analysis-grid quick-window');
  windowGrid.append(labeledCard('Threat', quick.window.threat), labeledCard('Response', quick.window.response), labeledCard('Window', quick.window.opportunity));
  overlay.append(windowGrid);
  const timingGrid = element('div', 'analysis-grid timing-grid');
  const early = element('article', 'analysis-card');
  early.append(element('h3', undefined, 'Early — N1 / N2 / N3'));
  const earlyList = element('ol', 'compact-list');
  quick.early.forEach((line, index) => earlyList.append(element('li', undefined, `N${index + 1} · ${line}`)));
  early.append(earlyList);
  const mid = element('article', 'analysis-card');
  mid.append(element('h3', undefined, 'Mid — Wave / Niveau 6+ / Roaming'));
  const midList = element('ul', 'compact-list');
  ['Wave', 'Niveau 6+', 'Roaming'].forEach((label, index) => midList.append(element('li', undefined, `${label} · ${quick.mid[index]}`)));
  mid.append(midList);
  timingGrid.append(early, mid);
  overlay.append(timingGrid, labeledCard(`Cible · ${quick.target.champion}`, quick.target.explanation, 'target-card'), labeledCard('Golden Rule', quick.goldenRule, 'golden-card'));
  resultView.append(overlay);

  const full = element('section', 'full-analysis');
  full.append(element('div', 'section-heading', 'FULL ANALYSIS'), labeledCard('Plan de lane', analysis.lanePlan, 'lane-plan-card'));
  const trww = element('div', 'analysis-grid trww-grid');
  trww.append(labeledCard('Threat', analysis.threatResponseWindow.threat), labeledCard('Response', analysis.threatResponseWindow.response), labeledCard('Window', analysis.threatResponseWindow.window), labeledCard('Win condition', analysis.threatResponseWindow.winCondition));
  full.append(trww);
  const levels = element('div', 'analysis-grid level-grid');
  levels.append(labeledCard('Niveau 1', analysis.earlyLevels.level1), labeledCard('Niveau 2', analysis.earlyLevels.level2), labeledCard('Niveau 3', analysis.earlyLevels.level3));
  full.append(levels);
  const details = element('div', 'analysis-grid details-grid');
  details.append(labeledCard('Wave plan', analysis.wavePlan), labeledCard(`Target priority · ${analysis.targetPriority.primaryTarget}`, analysis.targetPriority.explanation, 'target-card'), labeledCard('Niveau 6+', analysis.postLevel6), labeledCard('Roaming', analysis.roamPlan));
  full.append(details);

  const cheat = element('article', 'analysis-card cheat-card');
  const cheatHeader = element('div', 'cheat-header');
  cheatHeader.append(element('h3', undefined, 'Cheat sheet'));
  const copyButton = element('button', 'copy-button', 'Copier la cheat sheet');
  const copyStatus = element('span', 'copy-status');
  copyStatus.setAttribute('role', 'status');
  cheatHeader.append(copyButton, copyStatus);
  const cheatList = element('ul', 'compact-list');
  analysis.cheatSheet.forEach((line) => cheatList.append(element('li', undefined, line)));
  cheat.append(cheatHeader, cheatList);
  copyButton.addEventListener('click', async () => {
    let message = 'Copie impossible';
    let duration = 2000;
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(serializeCheatSheet(analysis.cheatSheet));
      message = 'Copié';
      duration = 1500;
    } catch {
      // The analysis remains usable when clipboard access is unavailable.
    }
    copyStatus.textContent = message;
    window.setTimeout(() => {
      if (copyStatus.textContent === message) copyStatus.textContent = '';
    }, duration);
  });
  full.append(cheat, labeledCard('Golden Rule', analysis.goldenRule, 'golden-card'));

  if (analysis.sources && analysis.sources.length > 0) {
    const sources = element('section', 'sources-block');
    sources.append(element('h3', undefined, 'Sources'));
    const list = element('ul', 'source-list');
    for (const source of analysis.sources) {
      const item = element('li');
      if (source.url) {
        const link = element('a', undefined, source.name);
        link.href = source.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        item.append(link);
      } else item.textContent = source.name;
      list.append(item);
    }
    sources.append(list);
    full.append(sources);
  }
  resultView.append(full);

  const newAnalysis = element('button', 'new-analysis-button', 'Nouvelle analyse');
  newAnalysis.type = 'button';
  newAnalysis.addEventListener('click', () => {
    activeRequestId = invalidateActiveAnalysisRequest(activeRequestId, activeAnalysisController);
    activeAnalysisController = undefined;
    isAnalyzing = false;
    loadingView.hidden = true;
    resultView.hidden = true;
    resultView.replaceChildren();
    selectionView.hidden = false;
    analysisMessage.textContent = '';
    renderControls();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  const resultActions = element('div', 'result-actions');
  resultActions.append(newAnalysis);
  resultView.append(resultActions);
}

function showHistoricalAnalysis(entry: MatchupHistoryEntry): void {
  activeRequestId = invalidateActiveAnalysisRequest(activeRequestId, activeAnalysisController);
  activeAnalysisController = undefined;
  isAnalyzing = false;
  loadingView.hidden = true;
  if (picker.open) picker.close();
  analysisMessage.textContent = '';
  renderControls();
  renderResult(entry.selection, entry.analysis, { generatedAt: entry.generatedAt });
  selectionView.hidden = true;
  resultView.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderHistory(): void {
  historyList.replaceChildren();
  historyEmpty.hidden = historyEntries.length > 0;
  for (const entry of historyEntries) {
    const button = element('button', 'history-card');
    button.type = 'button';
    const matchup = element('span', 'history-matchup');
    matchup.append(
      element('strong', undefined, `${entry.selection.allyCarry.name} + ${entry.selection.allySupport.name}`),
      element('small', undefined, 'vs'),
      element('strong', undefined, `${entry.selection.enemyCarry.name} + ${entry.selection.enemySupport.name}`),
    );
    const metadata = element('span', 'history-metadata');
    const savedAt = element('time', undefined, `Sauvegardée le ${formatHistoryDate(entry.generatedAt)}`);
    savedAt.dateTime = entry.generatedAt;
    metadata.append(
      element('span', undefined, `Patch ${entry.patch.trim()}`),
      savedAt,
    );
    button.append(matchup, metadata);
    button.addEventListener('click', () => showHistoricalAnalysis(entry));
    historyList.append(button);
  }
}

async function submitAnalysis(): Promise<void> {
  const snapshot = snapshotSelection(selection);
  if (!snapshot || !analysisContext || isAnalyzing) return;
  const request = buildMatchupRequest(snapshot, analysisContext.patch);
  const requestId = ++activeRequestId;
  const controller = new AbortController();
  activeAnalysisController = controller;
  isAnalyzing = true;
  analysisMessage.textContent = '';
  document.querySelector('#loading-matchup')!.textContent = `${request.allyCarry} + ${request.allySupport} vs ${request.enemyCarry} + ${request.enemySupport}`;
  loadingView.hidden = false;
  renderControls();

  try {
    const analysis = await analyzeMatchup(request, controller.signal);
    if (!isActiveAnalysisRequest(requestId, activeRequestId)) return;
    renderResult(snapshot, analysis);
    selectionView.hidden = true;
    resultView.hidden = false;
    historyEntries = historyStore.add(snapshot, analysis);
    renderHistory();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    if (!isActiveAnalysisRequest(requestId, activeRequestId)) return;
    analysisMessage.textContent = error instanceof InvalidAnalysisResponseError ? 'L’analyse reçue est invalide.' : 'Impossible de générer l’analyse.';
    analysisMessage.dataset.state = 'error';
  } finally {
    if (isActiveAnalysisRequest(requestId, activeRequestId)) {
      if (activeAnalysisController === controller) activeAnalysisController = undefined;
      isAnalyzing = false;
      loadingView.hidden = true;
      renderControls();
    }
  }
}

mirrorButton.addEventListener('click', () => {
  if (isAnalyzing) return;
  mirrorEnabled = !mirrorEnabled;
  mirrorButton.setAttribute('aria-pressed', String(mirrorEnabled));
  mirrorButton.classList.toggle('active', mirrorEnabled);
  if (picker.open) renderPicker();
});
searchInput.addEventListener('input', renderPicker);
document.querySelector('#close-picker')!.addEventListener('click', () => picker.close());
picker.addEventListener('click', (event) => { if (event.target === picker) picker.close(); });
picker.addEventListener('close', () => {
  activeSlot = undefined;
  mirrorButton.classList.remove('suggested');
});
analyzeButton.addEventListener('click', () => void submitAnalysis());

async function start(): Promise<void> {
  renderSlots();
  renderHistory();
  const [catalogResult, contextResult] = await Promise.allSettled([
    initializeChampionCatalog(),
    getAnalysisContext(),
  ]);

  if (catalogResult.status === 'fulfilled' && catalogResult.value.status === 'ready') {
    catalog = catalogResult.value.catalog;
    document.querySelector('#catalog-version')!.textContent = `Data Dragon ${catalog.dataDragonVersion}`;
    document.querySelector<HTMLElement>('#cache-status')!.hidden = !catalog.stale;
    catalogMessage.hidden = true;
  } else {
    catalogMessage.textContent = 'Impossible de charger les champions.';
    catalogMessage.dataset.state = 'error';
  }

  if (contextResult.status === 'fulfilled') {
    analysisContext = contextResult.value;
    const patch = document.querySelector<HTMLElement>('#analysis-patch')!;
    patch.textContent = `Patch ${analysisContext.patch}`;
    patch.hidden = false;
  } else {
    analysisMessage.textContent = 'Analyse indisponible : patch non disponible.';
    analysisMessage.dataset.state = 'error';
  }
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
