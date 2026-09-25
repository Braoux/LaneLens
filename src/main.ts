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
import { applyDocumentLocale, createTranslator, loadAppLocale, localeLabel, persistAppLocale, SUPPORTED_LOCALES } from './i18n';
import './styles/main.css';

interface AnalysisAttempt { readonly snapshot: MatchupSelection; readonly request: MatchupRequest }

const activeLocale = loadAppLocale();
const t = createTranslator(activeLocale);
persistAppLocale(activeLocale);
applyDocumentLocale(activeLocale);

const SLOT_META: Record<SlotId, { role: string; team: string }> = {
  allyCarry: { role: t('role.carry'), team: t('team.ally') }, allySupport: { role: t('role.support'), team: t('team.ally') },
  enemyCarry: { role: t('role.carry'), team: t('team.enemy') }, enemySupport: { role: t('role.support'), team: t('team.enemy') },
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
const historyStore = new MatchupHistoryStore(undefined, undefined, activeLocale);
let historyEntries = historyStore.getEntries();

app.innerHTML = `
  <header class="topbar"><a class="brand" href="/" aria-label="${t('app.home')}">LANE<span>LENS</span><i aria-hidden="true">◈</i></a><div class="topbar-actions"><div class="catalog-meta"><span id="analysis-patch" hidden></span><span id="catalog-version">${t('catalog.loading')}</span><span id="cache-status" hidden>${t('catalog.cached')}</span></div><details class="language-selector"><summary aria-label="${t('app.language')} : ${localeLabel(activeLocale)}">🌐 <span>${activeLocale.slice(0, 2).toLocaleUpperCase(activeLocale)}</span></summary><div id="language-options" role="listbox" aria-label="${t('app.language')}"></div></details></div></header>
  <main>
    <div id="selection-view">
      <section class="hero" aria-labelledby="page-title"><p class="eyebrow">${t('selection.eyebrow')}</p><h1 id="page-title">${t('selection.title')}<br><span>${t('selection.titleOpponent')}</span></h1><p>${t('selection.intro')}</p></section>
      <section class="matchup" aria-label="${t('selection.aria')}"><div class="team-block"><div class="team-heading"><span>01</span><h2>${t('selection.allies')}</h2></div><div class="slots" id="ally-slots"></div></div><div class="versus" aria-hidden="true"><span></span><b>${t('common.vs')}</b><span></span></div><div class="team-block"><div class="team-heading enemy"><span>02</span><h2>${t('selection.enemies')}</h2></div><div class="slots" id="enemy-slots"></div></div></section>
      <p class="catalog-message" id="catalog-message" role="status" aria-live="polite">${t('catalog.loading')}</p><p class="analysis-message" id="analysis-message" role="status" aria-live="polite"></p>
      <div class="actions"><button class="mirror-button" id="mirror" type="button" aria-pressed="false"><span aria-hidden="true">⇄</span> ${t('selection.mirror')}</button><button class="analyze-button" id="analyze" type="button" disabled>${t('selection.analyze')} <span aria-hidden="true">→</span></button></div>
      <section class="loading-card" id="loading-view" role="status" aria-live="polite" hidden><div class="loading-mark" aria-hidden="true"><span></span><i>◈</i><span></span></div><p class="eyebrow">${t('loading.title')}</p><div class="loading-matchup-visual" id="loading-matchup-visual"></div><p id="loading-matchup"></p></section>
      <section class="history-section" id="history-section" aria-labelledby="history-title"><div class="history-heading"><p class="eyebrow">${t('history.eyebrow')}</p><h2 id="history-title">${t('history.title')}</h2></div><p class="history-empty" id="history-empty">${t('history.empty')}</p><div class="history-list" id="history-list"></div></section>
    </div>
    <div id="error-view" hidden></div><div id="result-view" hidden></div>
  </main>
  <footer><span>LANELENS</span><span id="health" role="status">${t('health.checking')}</span></footer>
  <dialog class="picker" id="picker" aria-labelledby="picker-title"><div class="picker-header"><div><p class="eyebrow">${t('picker.eyebrow')}</p><h2 id="picker-title">${t('picker.title')}</h2></div><button class="close-button" id="close-picker" type="button" aria-label="${t('common.close')}">×</button></div><label class="search"><span aria-hidden="true">⌕</span><span class="sr-only">${t('picker.search')}</span><input id="champion-search" type="search" placeholder="${t('picker.search')}" autocomplete="off"></label><p class="picker-hint" id="picker-hint"></p><div class="champion-grid" id="champion-grid" role="list"></div></dialog>
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
const languageOptions = document.querySelector<HTMLDivElement>('#language-options')!;

for (const locale of SUPPORTED_LOCALES) {
  const option = element('button', 'language-option', localeLabel(locale));
  option.type = 'button';
  option.setAttribute('role', 'option');
  option.setAttribute('aria-selected', String(locale === activeLocale));
  option.disabled = locale === activeLocale;
  option.addEventListener('click', () => {
    persistAppLocale(locale);
    window.location.reload();
  });
  languageOptions.append(option);
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function reducedMotion(): boolean { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
function transition(update: () => void): Promise<void> { if (!document.startViewTransition || reducedMotion()) { update(); return Promise.resolve(); } return document.startViewTransition(update).finished.catch(() => undefined); }
function scrollTop(): void { window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }); }

function portrait(champion: Champion, size: 'slot' | 'picker' | 'result' | 'loading' | 'target', transitionName?: string): HTMLElement {
  const frame = element('span', `portrait portrait-${size}`, champion.name.slice(0, 1).toLocaleUpperCase(activeLocale));
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
      button.setAttribute('aria-label', `${SLOT_META[slot].role} ${SLOT_META[slot].team} : ${champion?.name ?? t('selection.unselected')}`); button.append(element('span', 'slot-role', SLOT_META[slot].role));
      if (champion) button.append(portrait(champion, 'slot', `champion-${slot}`), element('strong', undefined, champion.name), element('small', undefined, t('selection.edit')));
      else { const plus = element('span', 'slot-plus', '+'); plus.setAttribute('aria-hidden', 'true'); button.append(plus, element('strong', undefined, t('selection.choose'))); }
      button.addEventListener('click', () => openPicker(slot)); container.append(button);
    }
  }
  renderControls();
}

function reasonLabel(reason: ReturnType<typeof championUnavailableReason>): string { if (reason === 'same-team') return t('picker.sameTeam'); if (reason === 'opponent-duplicate') return t('picker.mirrorRequired'); return t('picker.maximum'); }
function renderPicker(): void {
  if (!catalog || !activeSlot) return; const results = searchChampions(catalog.champions, searchInput.value, activeLocale); championGrid.replaceChildren(); pickerHint.textContent = t('catalog.count', { count: results.length, plural: results.length > 1 ? 's' : '' });
  if (!results.length) { championGrid.append(element('p', 'empty-results', t('picker.empty'))); return; }
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
function formatHistoryDate(value: string): string { return new Intl.DateTimeFormat(activeLocale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }
function championFromSnapshot(snapshot: MatchupSelection, name: string): Champion | undefined { const normalized = name.trim().toLocaleLowerCase(activeLocale); return SLOT_IDS.map((slot) => snapshot[slot]).find((champion) => champion.name.trim().toLocaleLowerCase(activeLocale) === normalized); }

function resetToSelection(): void {
  activeRequestId = invalidateActiveAnalysisRequest(activeRequestId, activeAnalysisController); activeAnalysisController = undefined; isAnalyzing = false; failedAttempt = undefined; loadingView.hidden = true; if (picker.open) picker.close();
  void transition(() => { resultView.hidden = true; errorView.hidden = true; resultView.replaceChildren(); errorView.replaceChildren(); selectionView.hidden = false; }).then(() => { renderControls(); scrollTop(); analyzeButton.focus(); });
}
function newMatchupButton(compact = false): HTMLButtonElement { const button = element('button', `new-analysis-button${compact ? ' compact' : ''}`, t('result.newMatchup')); button.type = 'button'; button.addEventListener('click', resetToSelection); return button; }

function renderResult(snapshot: MatchupSelection, analysis: MatchupAnalysis, historical?: { readonly generatedAt: string }): void {
  resultView.replaceChildren();
  const toolbar = element('nav', 'result-toolbar'); toolbar.setAttribute('aria-label', t('result.actions')); toolbar.append(element('span', 'toolbar-matchup', `${snapshot.allyCarry.name} + ${snapshot.allySupport.name} ${t('common.vs').toLocaleLowerCase(activeLocale)} ${snapshot.enemyCarry.name} + ${snapshot.enemySupport.name}`), element('span', 'toolbar-patch', t('common.patch', { patch: analysis.matchup.patch.trim() })), newMatchupButton(true)); resultView.append(toolbar);
  const header = element('section', 'result-header');
  const matchup = element('div', 'result-matchup'); const allies = element('div', 'result-team'); allies.append(resultChampion(snapshot.allyCarry, 'allyCarry'), resultChampion(snapshot.allySupport, 'allySupport')); const enemies = element('div', 'result-team'); enemies.append(resultChampion(snapshot.enemyCarry, 'enemyCarry'), resultChampion(snapshot.enemySupport, 'enemySupport')); matchup.append(allies, element('b', 'result-vs', t('common.vs')), enemies); header.append(matchup);
  if (historical) { const saved = element('p', 'saved-analysis-meta'); saved.textContent = t('history.savedCompact', { date: formatHistoryDate(historical.generatedAt) }); header.append(saved); }
  resultView.append(header);

  const quick = toQuickOverlay(analysis); const overlay = element('section', 'quick-overlay'); overlay.setAttribute('aria-labelledby', 'quick-title'); const quickHeading = element('div', 'section-heading'); quickHeading.append(element('span', undefined, t('result.summaryEyebrow')), element('h2', undefined, t('result.summaryTitle'))); quickHeading.querySelector('h2')!.id = 'quick-title'; overlay.append(quickHeading, labeledBlock(t('result.plan'), quick.plan, 'quick-plan'));
  const sequence = element('div', 'tactical-sequence'); [['⚠', t('result.threat'), quick.window.threat], ['◈', t('result.response'), quick.window.response], ['✦', t('result.window'), quick.window.opportunity]].forEach(([icon, label, value], index) => { sequence.append(labeledBlock(`${icon} ${label}`, value, `tactical-step step-${index + 1}`)); if (index < 2) sequence.append(element('span', 'sequence-arrow', '→')); }); overlay.append(sequence);
  const early = element('section', 'early-timeline'); early.append(element('h3', undefined, t('result.early'))); const earlyTrack = element('ol'); quick.early.forEach((line, index) => { const item = element('li'); item.append(element('span', undefined, `0${index + 1}`), element('p', undefined, line)); earlyTrack.append(item); }); early.append(earlyTrack); overlay.append(early);
  const target = element('article', 'target-block'); const targetChampion = championFromSnapshot(snapshot, quick.target.champion); if (targetChampion) target.append(portrait(targetChampion, 'target')); const targetCopy = element('div'); targetCopy.append(element('h3', undefined, t('result.target')), element('strong', undefined, quick.target.champion), element('p', undefined, quick.target.explanation)); target.append(targetCopy); overlay.append(target);
  const golden = element('section', 'golden-rule'); golden.append(element('span', 'golden-symbol', '◈'), element('h3', undefined, t('result.goldenRule')), element('p', undefined, quick.goldenRule)); overlay.append(golden); resultView.append(overlay);

  const disclosure = element('details', 'full-analysis'); const summary = element('summary'); summary.append(element('span', undefined, t('result.detailsOpen')), element('i', undefined, '↓')); disclosure.append(summary); const detailBody = element('div', 'full-analysis-body'); detailBody.append(labeledBlock(t('result.winCondition'), analysis.threatResponseWindow.winCondition, 'win-condition'));
  const progression = element('section', 'game-progression'); progression.append(element('h3', undefined, t('result.progression'))); const progressTrack = element('ol'); [[t('result.wave'), analysis.wavePlan], [t('result.postLevel6'), analysis.postLevel6], [t('result.roam'), analysis.roamPlan]].forEach(([label, value]) => { const item = element('li'); item.append(element('h4', undefined, label), element('p', undefined, value)); progressTrack.append(item); }); progression.append(progressTrack); detailBody.append(progression);
  const cheat = element('article', 'cheat-sheet'); const cheatHeader = element('div', 'cheat-header'); cheatHeader.append(element('h3', undefined, t('result.memo'))); const copyButton = element('button', 'copy-button', t('common.copy')); copyButton.type = 'button'; const copyStatus = element('span', 'copy-status'); copyStatus.setAttribute('role', 'status'); copyStatus.setAttribute('aria-live', 'polite'); cheatHeader.append(copyButton, copyStatus); const cheatList = element('ul'); analysis.cheatSheet.forEach((line) => cheatList.append(element('li', undefined, line))); cheat.append(cheatHeader, cheatList);
  copyButton.addEventListener('click', async () => { let message = t('common.copyFailed'); try { if (!navigator.clipboard) throw new Error(); await navigator.clipboard.writeText(serializeCheatSheet(analysis.cheatSheet)); message = t('common.copied'); } catch { /* non bloquant */ } copyStatus.textContent = message; window.setTimeout(() => { if (copyStatus.textContent === message) copyStatus.textContent = ''; }, 1800); }); detailBody.append(cheat);
  if (analysis.sources?.length) { const sources = element('section', 'sources-block'); sources.append(element('h3', undefined, t('common.sources'))); const list = element('ul'); for (const source of analysis.sources) { const item = element('li'); if (source.url) { const link = element('a', undefined, source.name); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; item.append(link); } else item.textContent = source.name; list.append(item); } sources.append(list); detailBody.append(sources); }
  disclosure.append(detailBody); resultView.append(disclosure); disclosure.addEventListener('toggle', () => { summary.querySelector('span')!.textContent = disclosure.open ? t('result.detailsClose') : t('result.detailsOpen'); summary.querySelector('i')!.textContent = disclosure.open ? '↑' : '↓'; });
}

function showHistoricalAnalysis(entry: MatchupHistoryEntry): void { activeRequestId = invalidateActiveAnalysisRequest(activeRequestId, activeAnalysisController); activeAnalysisController = undefined; isAnalyzing = false; failedAttempt = undefined; loadingView.hidden = true; if (picker.open) picker.close(); analysisMessage.textContent = ''; renderControls(); renderResult(entry.selection, entry.analysis, { generatedAt: entry.generatedAt }); void transition(() => { selectionView.hidden = true; errorView.hidden = true; resultView.hidden = false; }).then(scrollTop); }
function renderHistory(): void { historyList.replaceChildren(); historyEmpty.hidden = historyEntries.length > 0; for (const entry of historyEntries) { const button = element('button', 'history-card'); button.type = 'button'; const matchup = element('span', 'history-matchup'); matchup.append(element('strong', undefined, `${entry.selection.allyCarry.name} + ${entry.selection.allySupport.name}`), element('small', undefined, t('common.vs').toLocaleLowerCase(activeLocale)), element('strong', undefined, `${entry.selection.enemyCarry.name} + ${entry.selection.enemySupport.name}`)); const metadata = element('span', 'history-metadata'); const savedAt = element('time', undefined, t('history.savedAt', { date: formatHistoryDate(entry.generatedAt) })); savedAt.dateTime = entry.generatedAt; metadata.append(element('span', undefined, t('common.patch', { patch: entry.patch.trim() })), savedAt); button.append(matchup, metadata); button.addEventListener('click', () => showHistoricalAnalysis(entry)); historyList.append(button); } }

function renderLoading(attempt: AnalysisAttempt): void { document.querySelector('#loading-matchup')!.textContent = `${attempt.request.allyCarry} + ${attempt.request.allySupport} ${t('common.vs').toLocaleLowerCase(activeLocale)} ${attempt.request.enemyCarry} + ${attempt.request.enemySupport}`; const visual = document.querySelector<HTMLElement>('#loading-matchup-visual')!; visual.replaceChildren(); visual.append(portrait(attempt.snapshot.allyCarry, 'loading'), portrait(attempt.snapshot.allySupport, 'loading'), element('strong', undefined, t('common.vs')), portrait(attempt.snapshot.enemyCarry, 'loading'), portrait(attempt.snapshot.enemySupport, 'loading')); loadingView.hidden = false; }
function renderAnalysisError(error: unknown, attempt: AnalysisAttempt): void {
  const model = toAnalysisErrorViewModel(error, t); failedAttempt = attempt; errorView.replaceChildren(); const card = element('section', 'error-state'); card.setAttribute('role', 'alert'); card.append(element('span', 'error-symbol', '!'), element('p', 'eyebrow', t('error.interrupted')), element('h1', undefined, model.title), element('p', 'error-message', model.message), element('p', 'error-matchup', `${attempt.request.allyCarry} + ${attempt.request.allySupport} ${t('common.vs').toLocaleLowerCase(activeLocale)} ${attempt.request.enemyCarry} + ${attempt.request.enemySupport} · ${t('common.patch', { patch: attempt.request.patch })}`)); const actions = element('div', 'error-actions'); const primary = element('button', 'error-primary', model.primaryLabel); primary.type = 'button'; primary.addEventListener('click', () => { if (model.primaryAction === 'back') resetToSelection(); else if (failedAttempt) void runAnalysis(failedAttempt); }); actions.append(primary); if (model.allowBack) { const back = element('button', 'error-secondary', t('error.back')); back.type = 'button'; back.addEventListener('click', resetToSelection); actions.append(back); } card.append(actions); if (model.requestId) { const details = element('details', 'technical-details'); details.append(element('summary', undefined, t('error.details')), element('code', undefined, t('error.reference', { requestId: model.requestId }))); card.append(details); } errorView.append(card);
}

async function runAnalysis(attempt: AnalysisAttempt): Promise<void> {
  if (isAnalyzing) return; const requestId = ++activeRequestId; const controller = new AbortController(); activeAnalysisController = controller; isAnalyzing = true; analysisMessage.textContent = ''; errorView.hidden = true; resultView.hidden = true; selectionView.hidden = false; renderLoading(attempt); renderControls();
  try { const analysis = await analyzeMatchup(attempt.request, controller.signal); if (!isActiveAnalysisRequest(requestId, activeRequestId)) return; failedAttempt = undefined; renderResult(attempt.snapshot, analysis); historyEntries = historyStore.add(attempt.snapshot, analysis); renderHistory(); await transition(() => { loadingView.hidden = true; selectionView.hidden = true; errorView.hidden = true; resultView.hidden = false; }); scrollTop(); }
  catch (error) { if (!isActiveAnalysisRequest(requestId, activeRequestId)) return; renderAnalysisError(error, attempt); await transition(() => { loadingView.hidden = true; selectionView.hidden = true; resultView.hidden = true; errorView.hidden = false; }); scrollTop(); }
  finally { if (isActiveAnalysisRequest(requestId, activeRequestId)) { if (activeAnalysisController === controller) activeAnalysisController = undefined; isAnalyzing = false; loadingView.hidden = true; renderControls(); } }
}
function submitAnalysis(): void { const snapshot = snapshotSelection(selection); if (!snapshot || !analysisContext || isAnalyzing) return; void runAnalysis(Object.freeze({ snapshot, request: Object.freeze(buildMatchupRequest(snapshot, analysisContext.patch, activeLocale)) })); }

mirrorButton.addEventListener('click', () => { if (isAnalyzing) return; mirrorEnabled = !mirrorEnabled; mirrorButton.setAttribute('aria-pressed', String(mirrorEnabled)); mirrorButton.classList.toggle('active', mirrorEnabled); if (picker.open) renderPicker(); });
searchInput.addEventListener('input', renderPicker); document.querySelector('#close-picker')!.addEventListener('click', () => picker.close()); picker.addEventListener('click', (event) => { if (event.target === picker) picker.close(); }); picker.addEventListener('close', () => { activeSlot = undefined; mirrorButton.classList.remove('suggested'); }); analyzeButton.addEventListener('click', submitAnalysis);

async function start(): Promise<void> {
  renderSlots(); renderHistory(); const [catalogResult, contextResult] = await Promise.allSettled([initializeChampionCatalog(activeLocale), getAnalysisContext()]);
  if (catalogResult.status === 'fulfilled' && catalogResult.value.status === 'ready') { catalog = catalogResult.value.catalog; document.querySelector('#catalog-version')!.textContent = t('catalog.version', { version: catalog.dataDragonVersion }); document.querySelector<HTMLElement>('#cache-status')!.hidden = !catalog.stale; catalogMessage.hidden = true; } else { catalogMessage.textContent = t('catalog.unavailable'); catalogMessage.dataset.state = 'error'; }
  if (contextResult.status === 'fulfilled') { analysisContext = contextResult.value; const patch = document.querySelector<HTMLElement>('#analysis-patch')!; patch.textContent = t('common.patch', { patch: analysisContext.patch }); patch.hidden = false; } else { analysisMessage.textContent = t('analysis.contextUnavailable'); analysisMessage.dataset.state = 'error'; }
  renderSlots();
}
async function refreshHealth(): Promise<void> { const health = document.querySelector<HTMLElement>('#health')!; try { await checkHealth(); health.textContent = t('health.available'); health.dataset.state = 'ok'; } catch { health.textContent = t('health.unavailable'); health.dataset.state = 'error'; } }
void start(); void refreshHealth();
