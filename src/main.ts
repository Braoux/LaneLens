import { checkHealth } from './api';
import './styles/main.css';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Élément #app introuvable');

app.innerHTML = `
  <header><a class="brand" href="/" aria-label="LaneLens, accueil">LANE<span>LENS</span><span class="brand-mark" aria-hidden="true">◈</span></a><span class="badge">EN CONSTRUCTION</span></header>
  <section class="intro" aria-labelledby="title">
    <p class="eyebrow">VOTRE PROCHAIN AVANTAGE EN BOTLANE</p>
    <h1 id="title">Comprendre la lane.<br><span>Avant de la jouer.</span></h1>
    <p class="description">Un plan de jeu clair pour votre duo, face au leur.<br>LaneLens prend forme. L’analyse des matchups arrive bientôt.</p>
  </section>
  <section class="connection" aria-labelledby="connection-title">
    <div><h2 id="connection-title">Connexion au service</h2><p id="health" role="status" aria-live="polite">Vérification en cours…</p></div>
    <button id="retry" type="button">Vérifier la connexion</button>
  </section>
  <footer>LANELENS <span>Know the matchup before it knows you.</span></footer>
`;

const status = document.querySelector<HTMLParagraphElement>('#health')!;
const retry = document.querySelector<HTMLButtonElement>('#retry')!;

async function refreshHealth(): Promise<void> {
  retry.disabled = true;
  status.dataset.state = 'pending';
  status.textContent = 'Vérification en cours…';
  try {
    await checkHealth();
    status.dataset.state = 'ok';
    status.textContent = 'Service disponible';
  } catch {
    status.dataset.state = 'error';
    status.textContent = 'Service indisponible. Réessayez dans un instant.';
  } finally {
    retry.disabled = false;
  }
}

retry.addEventListener('click', () => void refreshHealth());
void refreshHealth();
