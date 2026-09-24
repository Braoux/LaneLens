import type { PatchContext } from '../../analysis/types.js';

export const PATCH_CONTEXTS: readonly PatchContext[] = [
  {
    patch: '26.19',
    contextVersion: '26.19-v1',
    facts: [
      {
        subject: 'Aphelios — W (Skittering Frenzy)',
        text: 'Le bonus de vitesse d’attaque passe de 60/75/90/105/120 % à 70/85/100/115/130 %.',
      },
      {
        subject: 'Lucian — passif Vigilance',
        text: 'Les dégâts à l’impact renforcés passent de 15 (+20 % AD) à 5 (+15 % AD).',
      },
      {
        subject: 'Lucian — Q (Piercing Light)',
        text: 'Les dégâts de base passent de 80/115/150/185/220 à 90/130/170/210/250, avec un ratio inchangé de 100 % bonus AD.',
      },
      {
        subject: 'World Atlas et Runic Compass',
        text: 'Les PV accordés passent de 30/100/200 à 0/60/200 et la régénération de PV de 25/50/75 % à 50/75/75 %, ce qui favorise davantage la tenue de lane des supports mêlée.',
      },
    ],
  },
];
