import { analyzeMatchup, checkHealth, getAnalysisContext } from './api';
import { toAnalysisErrorViewModel } from './analysis-ux';
import { buildMatchupRequest, invalidateActiveAnalysisRequest, isActiveAnalysisRequest, serializeCheatSheet, toQuickOverlay } from './analysis';
import { initializeChampionCatalog } from './catalog-state';
import type { Champion, ChampionCatalog } from './champions';
import { MatchupHistoryStore } from './history';
import type { MatchupHistoryEntry } from './history';
import { SLOT_IDS, championUnavailableReason, isCompleteSelection, searchChampions, selectChampion, snapshotSelection } from './matchup';
import type { DraftSelection, MatchupSelection, SlotId } from './matchup';
import type { AnalysisContextResponse, MatchupAnalysis, MatchupRequest } from '../shared/analysis-contract';
import './styles/main.css';

interface AnalysisAttempt { readonly snapshot: MatchupSelection; readonly request: MatchupRequest }

const SLOT_META: Record<SlotId, { role: string; team: string }> = {
  allyCarry: { role: 'Carry', team: 'allié' }, allySupport: { role: 'Support', team: 'allié' },
  enemyCarry: { role: 'Carry', team: 'adverse' }, enemySupport: { role: 'Support', team: 'adverse' },
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
let failedAttempt: AnalysisAttempt | undefined;
const historyStore = new MatchupHistoryStore();
let historyEntries = historyStore.getEntries();

app.innerHTML = `
  <header class="topbar"><a class="brand" href="/" aria-label="LaneLens, accueil">LANE<span>LENS</span><i aria-hidden="true">◈</i></a><div class="catalog-meta"><span id="analysis-patch" hidden></span><span id="catalog-version">Chargement des champions...</span><span id="cache-status" hidden>Données en cache</span></div></header>
  <main>
    <div id="selection-view">
      <section class="hero" aria-labelledby="page-title"><p class="eyebrow">COMPOSEZ VOTRE MATCHUP</p><h1 id="page-title">Votre botlane.<br><span>Face à la leur.</span></h1><p>Choisissez les quatre champions pour préparer votre plan de jeu.</p></section>
      <section class="matchup" aria-label="Sélection du matchup"><div class="team-block"><div class="team-heading"><span>01</span><h2>Notre botlane</h2></div><div class="slots" id="ally-slots"></div></div><div class="versus" aria-hidden="true"><span></span><b>VS</b><span></span></div><div class="team-block"><div class="team-heading enemy"><span>02</span><h2>Botlane adverse</h2></div><div class="slots" id="enemy-slots"></div></div></section>
      <p class="catalog-message" id="catalog-message" role="status" aria-live="polite">Chargement des champions...</p><p class="analysis-message" id="analysis-message" role="status" aria-live="polite"></p>
      <div class="actions"><button class="mirror-button" id="mirror" type="button" aria-pressed="false"><span aria-hidden="true">⇄</span> Mirror</button><button class="analyze-button" id="analyze" type="button" disabled>Analyser <span aria-hidden="true">→</span></button></div>
      <section class="loading-card" id="loading-view" role="status" aria-live="polite" hidden><div class="loading-mark" aria-hidden="true"><span></span><i>◈</i><span></span></div><p class="eyebrow">ANALYSE EN COURS</p><div class="loading-matchup-visual" id="loading-matchup-visual"></div><p id="loading-matchup"></p></section>
      <section class="history-section" id="history-section" aria-labelledby="history-title"><div class="history-heading"><p class="eyebrow">HISTORIQUE LOCAL</p><h2 id="history-title">Dernières analyses</h2></div><p class="history-empty" id="history-empty">Aucune analyse récente.</p><div class="history-list" id="history-list"></div></section>
    </div>
    <div id="error-view" hidden></div><div id="result-view" hidden></div>
  </main>
  <footer><span>LANELENS</span><span id="health" role="status">Service : vérification…</span></footer>
  <dialog class="picker" id="picker" aria-labelledby="picker-title"><div class="picker-header"><div><p class="eyebrow">CHAMPION PICKER</p><h2 id="picker-title">Choisir un champion</h2></div><button class="close-button" id="close-picker" type="button" aria-label="Fermer">×</button></div><label class="search"><span aria-hidden="true">⌕</span><span class="sr-only">Rechercher un champion</span><input id="champion-search" type="search" placeholder="Rechercher un champion…" autocomplete="off"></label><p class="picker-hint" id="picker-hint"></p><div class="champion-grid" id="champion-grid" role="list"></div></dialog>
`;

const selectionView = document.querySelector<HTMLElement>('#selection-view')!;
const errorView = document.querySelector<HTMLElement>('#error-view')!;
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

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function reducedMotion(): boolean { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
function transition(update: () => void): Promise<void> { if (!document.startViewTransition || reducedMotion()) { update(); return Promise.resolve(); } return document.startViewTransition(update).finished.catch(() => undefined); }
function scrollTop(): void { window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }); }

function portrait(champion: Champion, size: 'slot' | 'picker' | 'result' | 'loading', transitionName?: string): HTMLElement {
  const frame = element('span', `portrait portrait-${size}`, champion.name.slice(0, 1).toLocaleUpperCase('fr-FR'));
  if (transitionName && !reducedMotion()) frame.style.viewTransitionName = transitionName;
  const image = document.createElement('img'); image.src = champion.imageUrl; image.alt = ''; image.loading = 'lazy';
  image.addEventListener('load', () => frame.classList.add('loaded')); image.addEventListener('error', () => image.remove()); frame.append(image); return frame;
}

function renderControls(): void { analyzeButton.disabled = !isCompleteSelection(selection) || analysisContext === undefined || isAnalyzing; mirrorButton.disabled = isAnalyzing; document.querySelectorAll<HTMLButtonElement>('.champion-slot').forEach((button) => { button.disabled = catalog === undefined || isAnalyzing; }); }
function renderSlots(): void {
  for (const [containerId, slots] of [['ally-slots', SLOT_IDS.slice(0, 2)], ['enemy-slots', SLOT_IDS.slice(2)]] as const) {
    const container = document.querySelector<HTMLDivElement>(`#${containerId}`)!; container.replaceChildren();
    for (const slot of slots) {
      const champion = selection[slot]; const button = element('button', `champion-slot${champion ? ' selected' : ''}`); button.type = 'button'; button.dataset.slot = slot;
      button.setAttribute('aria-label', `${SLOT_META[slot].role} ${SLOT_META[slot].team} : ${champion?.name ?? 'non sélectionné'}`); button.append(element('span', 'slot-role', SLOT_META[slot].role));
      if (champion) button.append(portrait(champion, 'slot', `champion-${slot}`), element('strong', undefined, champion.name), element('small', undefined, 'Modifier'));
      else { const plus = element('span', 'slot-plus', '+'); plus.setAttribute('aria-hidden', 'true'); button.append(plus, element('strong', undefined, 'Choisir')); }
      button.addEventListener('click', () => openPicker(slot)); container.append(button);
    }
  }
  renderControls();
}

function reasonLabel(reason: ReturnType<typeof championUnavailableReason>): string { if (reason === 'same-team') return 'Déjà utilisé dans cette équipe'; if (reason === 'opponent-duplicate') return 'Activez Mirror pour ce face-à-face'; return 'Déjà utilisé deux fois'; }
function renderPicker(): void {
  if (!catalog || !activeSlot) return; const results = searchChampions(catalog.champions, searchInput.value); championGrid.replaceChildren(); pickerHint.textContent = `${results.length} champion${results.length > 1 ? 's' : ''}`;
  if (!results.length) { championGrid.append(element('p', 'empty-results', 'Aucun champion trouvé.')); return; }
  for (const champion of results) {
    const reason = championUnavailableReason(selection, activeSlot, champion.id, mirrorEnabled); const button = element('button', 'champion-card'); button.type = 'button'; button.disabled = reason !== undefined; button.setAttribute('role', 'listitem'); button.setAttribute('aria-label', reason ? `${champion.name}, ${reasonLabel(reason)}` : champion.name); button.append(portrait(champion, 'picker'), element('span', undefined, champion.name)); if (reason) button.append(element('small', undefined, reasonLabel(reason)));
    if (reason === 'opponent-duplicate') { const emphasize = () => mirrorButton.classList.add('suggested'); const restore = () => mirrorButton.classList.remove('suggested'); button.addEventListener('mouseenter', emphasize); button.addEventListener('mouseleave', restore); button.addEventListener('focus', emphasize); button.addEventListener('blur', restore); }
    button.addEventListener('click', () => chooseChampion(champion)); championGrid.append(button);
  }
}
function openPicker(slot: SlotId): void { if (!catalog || isAnalyzing) return; activeSlot = slot; searchInput.value = ''; pickerTitle.textContent = `${SLOT_META[slot].role} ${SLOT_META[slot].team}`; renderPicker(); picker.showModal(); searchInput.focus(); }
function chooseChampion(champion: Champion): void { if (!activeSlot || isAnalyzing) return; selection = selectChampion(selection, activeSlot, champion, mirrorEnabled); picker.close(); activeSlot = undefined; analysisMessage.textContent = ''; renderSlots(); }

function resultChampion(champion: Champion, slot: SlotId): HTMLElement { const item = element('div', 'result-champion'); item.append(portrait(champion, 'result', `champion-${slot}`), element('strong', undefined, champion.name)); return item; }
function labeledBlock(label: string, value: string, className = ''): HTMLElement { const block = element('article', `analysis-block ${className}`.trim()); block.append(element('h3', undefined, label), element('p', undefined, value)); return block; }
function formatHistoryDate(value: string): string { return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }

function resetToSelection(): void {
  activeRequestId = invalidateActiveAnalysisRequest(activeRequestId, activeAnalysisController); activeAnalysisController = undefined; isAnalyzing = false; failedAttempt = undefined; loadingView.hidden = true; if (picker.open) picker.close();
  void transition(() => { resultView.hidden = true; errorView.hidden = true; resultView.replaceChildren(); errorView.replaceChildren(); selectionView.hidden = false; }).then(() => { renderControls(); scrollTop(); analyzeButton.focus(); });
}
function newMatchupButton(compact = false): HTMLButtonElement { const button = element('button', `new-analysis-button${compact ? ' compact' : ''}`, 'Nouveau matchup'); button.type = 'button'; button.addEventListener('click', resetToSelection); return button; }

function renderResult(snapshot: MatchupSelection, analysis: MatchupAnalysis, historical?: { readonly generatedAt: string }): void {
  resultView.replaceChildren();
  const toolbar = element('nav', 'result-toolbar'); toolbar.setAttribute('aria-label', 'Actions du résultat'); toolbar.append(element('span', 'toolbar-matchup', `${snapshot.allyCarry.name} + ${snapshot.allySupport.name} vs ${snapshot.enemyCarry.name} + ${snapshot.enemySupport.name}`), element('span', 'toolbar-patch', `Patch ${analysis.matchup.patch.trim()}`), newMatchupButton(true)); resultView.append(toolbar);
  const header = element('section', 'result-header'); header.append(element('p', 'eyebrow', historical ? 'ANALYSE SAUVEGARDÉE' : 'PLAN DE JEU'));
  const matchup = element('div', 'result-matchup'); const allies = element('div', 'result-team'); allies.append(resultChampion(snapshot.allyCarry, 'allyCarry'), resultChampion(snapshot.allySupport, 'allySupport')); const enemies = element('div', 'result-team'); enemies.append(resultChampion(snapshot.enemyCarry, 'enemyCarry'), resultChampion(snapshot.enemySupport, 'enemySupport')); matchup.append(allies, element('b', 'result-vs', 'VS'), enemies); header.append(matchup, element('p', 'result-patch', `Patch ${analysis.matchup.patch.trim()}`));
  if (historical) { const saved = element('div', 'saved-analysis-meta'); saved.append(element('strong', undefined, 'Analyse sauvegardée'), element('span', undefined, `Générée le ${formatHistoryDate(historical.generatedAt)}`)); header.append(saved); }
  resultView.append(header);

  const quick = toQuickOverlay(analysis); const overlay = element('section', 'quick-overlay'); overlay.setAttribute('aria-labelledby', 'quick-title'); const quickHeading = element('div', 'section-heading'); quickHeading.append(element('span', undefined, 'QUICK OVERLAY'), element('h2', undefined, 'Votre plan avant la game')); quickHeading.querySelector('h2')!.id = 'quick-title'; overlay.append(quickHeading, labeledBlock('Plan', quick.plan, 'quick-plan'));
  const sequence = element('div', 'tactical-sequence'); [['⚠', 'Threat', quick.window.threat], ['◈', 'Response', quick.window.response], ['✦', 'Window', quick.window.opportunity]].forEach(([icon, label, value], index) => { sequence.append(labeledBlock(`${icon} ${label}`, value, `tactical-step step-${index + 1}`)); if (index < 2) sequence.append(element('span', 'sequence-arrow', '→')); }); overlay.append(sequence);
  const early = element('section', 'early-timeline'); early.append(element('h3', undefined, 'Early game')); const earlyTrack = element('ol'); quick.early.forEach((line, index) => { const item = element('li'); item.append(element('span', undefined, `0${index + 1}`), element('p', undefined, line)); earlyTrack.append(item); }); early.append(earlyTrack); overlay.append(early, labeledBlock(`Cible prioritaire · ${quick.target.champion}`, quick.target.explanation, 'target-block'));
  const golden = element('section', 'golden-rule'); golden.append(element('span', 'golden-symbol', '◈'), element('h3', undefined, 'Golden Rule'), element('p', undefined, quick.goldenRule)); overlay.append(golden); resultView.append(overlay);

  const disclosure = element('details', 'full-analysis'); const summary = element('summary'); summary.append(element('span', undefined, 'Voir l’analyse détaillée'), element('i', undefined, '↓')); disclosure.append(summary); const detailBody = element('div', 'full-analysis-body'); detailBody.append(labeledBlock('Condition de victoire', analysis.threatResponseWindow.winCondition, 'win-condition'));
  const progression = element('section', 'game-progression'); progression.append(element('h3', undefined, 'Progression de game')); const progressTrack = element('ol'); [['Early · Wave', analysis.wavePlan], ['Niveau 6+', analysis.postLevel6], ['Mid · Roaming', analysis.roamPlan]].forEach(([label, value]) => { const item = element('li'); item.append(element('h4', undefined, label), element('p', undefined, value)); progressTrack.append(item); }); progression.append(progressTrack); detailBody.append(progression);
  const cheat = element('article', 'cheat-sheet'); const cheatHeader = element('div', 'cheat-header'); cheatHeader.append(element('h3', undefined, 'Cheat sheet')); const copyButton = element('button', 'copy-button', 'Copier'); copyButton.type = 'button'; const copyStatus = element('span', 'copy-status'); copyStatus.setAttribute('role', 'status'); copyStatus.setAttribute('aria-live', 'polite'); cheatHeader.append(copyButton, copyStatus); const cheatList = element('ul'); analysis.cheatSheet.forEach((line) => cheatList.append(element('li', undefined, line))); cheat.append(cheatHeader, cheatList);
  copyButton.addEventListener('click', async () => { let message = 'Copie impossible'; try { if (!navigator.clipboard) throw new Error(); await navigator.clipboard.writeText(serializeCheatSheet(analysis.cheatSheet)); message = 'Copié'; } catch { /* non bloquant */ } copyStatus.textContent = message; window.setTimeout(() => { if (copyStatus.textContent === message) copyStatus.textContent = ''; }, 1800); }); detailBody.append(cheat);
  if (analysis.sources?.length) { const sources = element('section', 'sources-block'); sources.append(element('h3', undefined, 'Sources')); const list = element('ul'); for (const source of analysis.sources) { const item = element('li'); if (source.url) { const link = element('a', undefined, source.name); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; item.append(link); } else item.textContent = source.name; list.append(item); } sources.append(list); detailBody.append(sources); }
  disclosure.append(detailBody); resultView.append(disclosure); summary.addEventListener('click', () => { window.setTimeout(() => { summary.querySelector('span')!.textContent = disclosure.open ? 'Réduire l’analyse détaillée' : 'Voir l’analyse détaillée'; }, 0); });
}

function showHistoricalAnalysis(entry: MatchupHistoryEntry): void { activeRequestId = invalidateActiveAnalysisRequest(activeRequestId, activeAnalysisController); activeAnalysisController = undefined; isAnalyzing = false; failedAttempt = undefined; loadingView.hidden = true; if (picker.open) picker.close(); analysisMessage.textContent = ''; renderControls(); renderResult(entry.selection, entry.analysis, { generatedAt: entry.generatedAt }); void transition(() => { selectionView.hidden = true; errorView.hidden = true; resultView.hidden = false; }).then(scrollTop); }
function renderHistory(): void { historyList.replaceChildren(); historyEmpty.hidden = historyEntries.length > 0; for (const entry of historyEntries) { const button = element('button', 'history-card'); button.type = 'button'; const matchup = element('span', 'history-matchup'); matchup.append(element('strong', undefined, `${entry.selection.allyCarry.name} + ${entry.selection.allySupport.name}`), element('small', undefined, 'vs'), element('strong', undefined, `${entry.selection.enemyCarry.name} + ${entry.selection.enemySupport.name}`)); const metadata = element('span', 'history-metadata'); const savedAt = element('time', undefined, `Sauvegardée le ${formatHistoryDate(entry.generatedAt)}`); savedAt.dateTime = entry.generatedAt; metadata.append(element('span', undefined, `Patch ${entry.patch.trim()}`), savedAt); button.append(matchup, metadata); button.addEventListener('click', () => showHistoricalAnalysis(entry)); historyList.append(button); } }

function renderLoading(attempt: AnalysisAttempt): void { document.querySelector('#loading-matchup')!.textContent = `${attempt.request.allyCarry} + ${attempt.request.allySupport} vs ${attempt.request.enemyCarry} + ${attempt.request.enemySupport}`; const visual = document.querySelector<HTMLElement>('#loading-matchup-visual')!; visual.replaceChildren(); visual.append(portrait(attempt.snapshot.allyCarry, 'loading'), portrait(attempt.snapshot.allySupport, 'loading'), element('strong', undefined, 'VS'), portrait(attempt.snapshot.enemyCarry, 'loading'), portrait(attempt.snapshot.enemySupport, 'loading')); loadingView.hidden = false; }
function renderAnalysisError(error: unknown, attempt: AnalysisAttempt): void {
  const model = toAnalysisErrorViewModel(error); failedAttempt = attempt; errorView.replaceChildren(); const card = element('section', 'error-state'); card.setAttribute('role', 'alert'); card.append(element('span', 'error-symbol', '!'), element('p', 'eyebrow', 'ANALYSE INTERROMPUE'), element('h1', undefined, model.title), element('p', 'error-message', model.message), element('p', 'error-matchup', `${attempt.request.allyCarry} + ${attempt.request.allySupport} vs ${attempt.request.enemyCarry} + ${attempt.request.enemySupport} · Patch ${attempt.request.patch}`)); const actions = element('div', 'error-actions'); const primary = element('button', 'error-primary', model.primaryLabel); primary.type = 'button'; primary.addEventListener('click', () => { if (model.primaryAction === 'back') resetToSelection(); else if (failedAttempt) void runAnalysis(failedAttempt); }); actions.append(primary); if (model.allowBack) { const back = element('button', 'error-secondary', 'Retour à la sélection'); back.type = 'button'; back.addEventListener('click', resetToSelection); actions.append(back); } card.append(actions); if (model.requestId) { const details = element('details', 'technical-details'); details.append(element('summary', undefined, 'Détails techniques'), element('code', undefined, `Référence : ${model.requestId}`)); card.append(details); } errorView.append(card);
}

async function runAnalysis(attempt: AnalysisAttempt): Promise<void> {
  if (isAnalyzing) return; const requestId = ++activeRequestId; const controller = new AbortController(); activeAnalysisController = controller; isAnalyzing = true; analysisMessage.textContent = ''; errorView.hidden = true; resultView.hidden = true; selectionView.hidden = false; renderLoading(attempt); renderControls();
  try { const analysis = await analyzeMatchup(attempt.request, controller.signal); if (!isActiveAnalysisRequest(requestId, activeRequestId)) return; failedAttempt = undefined; renderResult(attempt.snapshot, analysis); historyEntries = historyStore.add(attempt.snapshot, analysis); renderHistory(); await transition(() => { loadingView.hidden = true; selectionView.hidden = true; errorView.hidden = true; resultView.hidden = false; }); scrollTop(); }
  catch (error) { if (!isActiveAnalysisRequest(requestId, activeRequestId)) return; renderAnalysisError(error, attempt); await transition(() => { loadingView.hidden = true; selectionView.hidden = true; resultView.hidden = true; errorView.hidden = false; }); scrollTop(); }
  finally { if (isActiveAnalysisRequest(requestId, activeRequestId)) { if (activeAnalysisController === controller) activeAnalysisController = undefined; isAnalyzing = false; loadingView.hidden = true; renderControls(); } }
}
function submitAnalysis(): void { const snapshot = snapshotSelection(selection); if (!snapshot || !analysisContext || isAnalyzing) return; void runAnalysis(Object.freeze({ snapshot, request: Object.freeze(buildMatchupRequest(snapshot, analysisContext.patch)) })); }

mirrorButton.addEventListener('click', () => { if (isAnalyzing) return; mirrorEnabled = !mirrorEnabled; mirrorButton.setAttribute('aria-pressed', String(mirrorEnabled)); mirrorButton.classList.toggle('active', mirrorEnabled); if (picker.open) renderPicker(); });
searchInput.addEventListener('input', renderPicker); document.querySelector('#close-picker')!.addEventListener('click', () => picker.close()); picker.addEventListener('click', (event) => { if (event.target === picker) picker.close(); }); picker.addEventListener('close', () => { activeSlot = undefined; mirrorButton.classList.remove('suggested'); }); analyzeButton.addEventListener('click', submitAnalysis);

async function start(): Promise<void> {
  renderSlots(); renderHistory(); const [catalogResult, contextResult] = await Promise.allSettled([initializeChampionCatalog(), getAnalysisContext()]);
  if (catalogResult.status === 'fulfilled' && catalogResult.value.status === 'ready') { catalog = catalogResult.value.catalog; document.querySelector('#catalog-version')!.textContent = `Data Dragon ${catalog.dataDragonVersion}`; document.querySelector<HTMLElement>('#cache-status')!.hidden = !catalog.stale; catalogMessage.hidden = true; } else { catalogMessage.textContent = 'Impossible de charger les champions.'; catalogMessage.dataset.state = 'error'; }
  if (contextResult.status === 'fulfilled') { analysisContext = contextResult.value; const patch = document.querySelector<HTMLElement>('#analysis-patch')!; patch.textContent = `Patch ${analysisContext.patch}`; patch.hidden = false; } else { analysisMessage.textContent = 'Analyse indisponible : patch non disponible.'; analysisMessage.dataset.state = 'error'; }
  renderSlots();
}
async function refreshHealth(): Promise<void> { const health = document.querySelector<HTMLElement>('#health')!; try { await checkHealth(); health.textContent = 'Service disponible'; health.dataset.state = 'ok'; } catch { health.textContent = 'Service indisponible'; health.dataset.state = 'error'; } }
void start(); void refreshHealth();
