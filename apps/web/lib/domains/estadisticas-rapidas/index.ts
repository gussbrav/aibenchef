export {
  getPeriodosDisponiblesSF,
  getPeriodosDisponiblesCOOPAC,
  getEstadisticasSF,
  getEstadisticasCOOPAC,
  getTrayectoria,
} from "./queries";

export type {
  FilaSF,
  FilaCOOPAC,
  PeriodoItem,
  SubsistemasSF,
  NivelCOOPAC,
  TrayectoriaEntidad,
  EjeMetrica,
} from "./types";

export {
  LABEL_SUBSISTEMA,
  LABEL_NIVEL,
  LABEL_EJE,
  EJE_ALTO_ES_BUENO,
} from "./types";
