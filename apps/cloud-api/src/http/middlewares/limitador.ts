import type { RequestHandler } from 'express';

/** Limite de requisições por IP numa janela de 1 minuto (memória do processo). */
export function limitarPorIp(maximo: number): RequestHandler & { limpar: () => void } {
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
