// Registro central de tours — config-driven: para adicionar um tour novo,
// crie o arquivo em content/ e adicione na lista. Nenhuma tela precisa mudar.

import { Tour, TourScreen } from './types';
import { planoTour } from './content/plano';
import { gastosFrequentesTour } from './content/gastosFrequentes';
import { metasTour } from './content/metas';
import { desempenhoTour } from './content/desempenho';
import { lancarTour } from './content/lancar';
import { cartoesTour } from './content/cartoes';

export const ALL_TOURS: Tour[] = [
  planoTour,
  gastosFrequentesTour,
  metasTour,
  desempenhoTour,
  lancarTour,
  cartoesTour,
];

// Tours que auto-iniciam no primeiro acesso da tela — o primeiro de cada
// screen. Os demais (lancar, cartoes) só abrem pelo botão de ajuda.
export function getTourForScreen(screen: TourScreen): Tour | undefined {
  return ALL_TOURS.find(t => t.screen === screen);
}

export function getTourById(id: string): Tour | undefined {
  return ALL_TOURS.find(t => t.id === id);
}
