import type { RequestHandler } from 'express';
import {
  CABECALHOS_INTEGRACAO as H,
  JANELA_ASSINATURA_SEGUNDOS,
  textoParaAssinar,
} from '@estacionamento/shared';
import { env } from '../../config/env.js';
import {
  assinaturaConfere,
  derivarSegredo,
  integracoesRepository as repo,
  sha256Hex,
  type Escopo,
  type Integracao,
} from '../../integracoes/credenciais.js';
import { registrar } from '../../registro.js';
import { ErroApiPublica } from '../erros.js';

declare module 'express-serve-static-core' {
  interface Request {
    integracao?: Integracao;
    /** Corpo bruto (para conferir a assinatura); o JSON é lido depois. */
    corpoBruto?: Buffer;
  }
}

/** Mesma resposta para qualquer falha de autenticação (não ajuda quem tenta adivinhar). */
const naoAutorizado = () =>
  new ErroApiPublica(401, 'NAO_AUTORIZADO', 'Credencial da integração inválida ou requisição expirada.');

/**
 * Autenticação das integrações (servidor local → nuvem), ARQUITETURA §7.2:
 *  - X-Integracao-Id, X-Timestamp (segundos UNIX), X-Nonce (32 hex) e
 *    X-Assinatura: v1=HMAC-SHA256(segredo, textoParaAssinar(...)) em hex;
 *  - horário com no máximo 5 min de diferença e nonce de uso único (replay);
 *  - durante a troca de chave, a versão anterior ainda vale por um tempo;
 *  - a integração precisa estar ativa e ter o escopo da rota.
 */
export function autenticarIntegracao(escopo: Escopo): RequestHandler {
  return async (req, _res, next) => {
    const recusar = async (motivo: string, integracaoId?: string) => {
      await registrar(req, {
        nivel: 'warn',
        tipo: 'auth.recusada',
        status: 401,
        integracaoId: integracaoId && /^[0-9A-Z]{26}$/.test(integracaoId) ? integracaoId : null,
        detalhes: { motivo },
      });
      next(naoAutorizado());
    };
    try {
      if (!env.SYNC_CHAVE_MESTRA) {
        next(new ErroApiPublica(503, 'INDISPONIVEL', 'Sincronização não configurada nesta API.'));
        return;
      }
      const id = req.get(H.id) ?? '';
      const timestamp = req.get(H.timestamp) ?? '';
      const nonce = req.get(H.nonce) ?? '';
      const assinatura = /^v1=([0-9a-f]{64})$/.exec(req.get(H.assinatura) ?? '')?.[1];
      if (
        !/^[0-9A-Z]{26}$/.test(id) ||
        !/^\d{9,11}$/.test(timestamp) ||
        !/^[0-9a-f]{32}$/.test(nonce) ||
        !assinatura
      )
        return await recusar('cabeçalhos ausentes ou malformados', id);
      if (Math.abs(Date.now() / 1000 - Number(timestamp)) > JANELA_ASSINATURA_SEGUNDOS)
        return await recusar('horário fora da janela de 5 minutos', id);

      const integracao = await repo.obter(id);
      if (!integracao?.ativo) return await recusar('integração inexistente ou revogada', id);

      const texto = textoParaAssinar({
        timestamp,
        nonce,
        metodo: req.method,
        rota: req.originalUrl.split('?')[0]!,
        sha256Corpo: sha256Hex(req.corpoBruto ?? Buffer.alloc(0)),
      });
      const versoes = [integracao.versaoChave];
      if (
        integracao.anteriorValidaAte &&
        integracao.anteriorValidaAte > new Date() &&
        integracao.versaoChave > 1
      )
        versoes.push(integracao.versaoChave - 1);
      if (!versoes.some((v) => assinaturaConfere(derivarSegredo(id, v), texto, assinatura)))
        return await recusar('assinatura inválida', id);
      if (!(await repo.usarNonce(id, nonce)))
        return await recusar('requisição repetida (nonce já usado)', id);
      if (!integracao.escopos.includes(escopo)) {
        await registrar(req, {
          nivel: 'warn',
          tipo: 'auth.recusada',
          status: 403,
          integracaoId: id,
          detalhes: { motivo: `sem o escopo ${escopo}` },
        });
        next(new ErroApiPublica(403, 'PROIBIDO', 'Esta integração não tem permissão para esta operação.'));
        return;
      }
      req.integracao = integracao;
      void repo.marcarUso(id).catch(() => undefined);
      next();
    } catch (erro) {
      next(erro);
    }
  };
}
