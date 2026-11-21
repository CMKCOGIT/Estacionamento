import type { RequestHandler } from 'express';

/** Limite de requisições por IP numa janela de 1 minuto (memória do processo). */
export function limitarPorIp(
  maximo: number,
  aoExceder?: (req: Parameters<RequestHandler>[0]) => void,
): RequestHandler & { limpar: () => void } {
  const janelas = new Map<string, { inicio: number; total: number }>();
  const meio: RequestHandler = (req, res, next) => {
    const agora = Date.now();
    const ip = req.ip ?? 'desconhecido';
    const j = janelas.get(ip);
    if (!j || agora - j.inicio >= 60_000) {
      janelas.set(ip, { inicio: agora, total: 1 });
      if (janelas.size > 50_000) janelas.clear(); // nunca cresce sem limite
      return next();
    }
    j.total++;
    if (j.total > maximo) {
      // Registra só a primeira recusa de cada janela (não enche o registro num ataque)
      if (j.total === maximo + 1) aoExceder?.(req);
      res.set('Retry-After', String(Math.ceil((60_000 - (agora - j.inicio)) / 1000)));
      res
        .status(429)
        .json({ erro: { codigo: 'MUITAS_TENTATIVAS', mensagem: 'Muitas consultas. Aguarde um minuto.' } });
      return;
    }
    next();
  };
  return Object.assign(meio, { limpar: () => janelas.clear() });
}

export interface Recusa {
  segundos: number;
  primeira: boolean;
}

/** Contador em janela de 1 minuto por chave qualquer (IP, token...). */
export function janelaPorMinuto(maximo: number) {
  const janelas = new Map<string, { inicio: number; total: number }>();
  const atual = (chave: string, agora: number) => {
    const j = janelas.get(chave);
    if (j && agora - j.inicio < 60_000) return j;
    const nova = { inicio: agora, total: 0 };
    if (janelas.size > 50_000) janelas.clear();
    janelas.set(chave, nova);
    return nova;
  };
  return {
    /** Soma 1; se passou do máximo, devolve a espera (e se é a 1ª recusa da janela). */
    consumir(chave: string): Recusa | null {
      const agora = Date.now();
      const j = atual(chave, agora);
      j.total++;
      return j.total > maximo
        ? { segundos: Math.ceil((60_000 - (agora - j.inicio)) / 1000), primeira: j.total === maximo + 1 }
        : null;
    },
    /** Já chegou ao máximo? (sem somar) */
    excedido(chave: string): Recusa | null {
      const agora = Date.now();
      const j = atual(chave, agora);
      return j.total >= maximo
        ? { segundos: Math.ceil((60_000 - (agora - j.inicio)) / 1000), primeira: false }
        : null;
    },
    limpar: () => janelas.clear(),
  };
}
