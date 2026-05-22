export type GenieRequest = {
  prompt: string;
  contextoExtra?: string; // hint adicional opcional del usuario
};

export type GenieResponse = {
  id: number;
  sql: string;
  explicacion: string;
  modelo: string;
  tokensInput: number;
  tokensOutput: number;
  duracionMs: number;
};

export type GenieHistory = {
  id: number;
  userId: string;
  prompt: string;
  sqlGenerado: string | null;
  explicacion: string | null;
  modelo: string | null;
  tokensInput: number | null;
  tokensOutput: number | null;
  duracionMs: number | null;
  ejecutado: boolean;
  exitoso: boolean | null;
  error: string | null;
  feedback: 1 | -1 | null;
  createdAt: string;
};
