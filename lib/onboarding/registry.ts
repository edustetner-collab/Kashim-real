// Registro central de tours — config-driven: para adicionar um tour novo,
// crie o arquivo em content/ e adicione na lista. Nenhuma tela precisa mudar.

import { Tour, TourScreen } from './types';
import { planoTour } from './content/plano';
import { gastosFrequentesTour } from './content/gastosFrequentes';
import { metasTour } from './content/metas';
import { desempenhoTour } from './content/desempenho';

export const ALL_TOURS: Tour[] = [
  planoTour,
  gastosFrequentesTour,
  metasTour,
  desempenhoTour,
];

export function getTourForScreen(screen: TourScreen): Tour | undefined {
  return ALL_TOURS.find(t => t.screen === screen);
}

export function getTourById(id: string): Tour | undefined {
  return ALL_TOURS.find(t => t.id === id);
}
