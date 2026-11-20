import type { RequestHandler } from 'express';

/**
 * Produção: só HTTPS. GET/HEAD em HTTP são redirecionados (301); o resto é
 * recusado (o navegador já teria enviado dados sem criptografia). Atrás do
 * proxy do provedor, o protocolo vem de X-Forwarded-Proto (CONFIAR_PROXY).
 */
export function exigirHttps(ativo: boolean): RequestHandler {
  return (req, res, next) => {
    if (!ativo || req.secure) return next();
    if (req.method === 'GET' || req.method === 'HEAD') {
      res.redirect(301, `https://${req.get('host')}${req.originalUrl}`);
      return;
    }
    res.status(403).json({ erro: { codigo: 'REQUISICAO_INVALIDA', mensagem: 'Use HTTPS.' } });
  };
}
