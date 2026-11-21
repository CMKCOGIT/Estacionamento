import { z } from 'zod';

/**
 * Validação de TUDO que chega do servidor local. Só entram os campos da
 * projeção pública (ver docs/API-EXTERNA.md, "Dados públicos"); qualquer
 * campo a mais é descartado e não chega ao banco da nuvem.
 */
const ulid = z.string().regex(/^[0-9A-Z]{26}$/, 'identificador inválido');
const dataIso = z.iso.datetime({ offset: true });
const centavos = z.number().int().min(0).max(100_000_000);
const texto = (max: number) => z.string().trim().min(1).max(max);

export const schemaSite = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug inválido')
    .max(60),
  nome: texto(120),
  endereco: z.string().max(255).nullable(),
  telefone: z.string().max(20).nullable(),
  horasAcessoAposSaida: z.number().int().min(0).max(168),
});

export const schemaDisponibilidade = z.object({
  categorias: z
    .array(
      z
        .object({
          id: ulid,
          nome: texto(60),
          ordem: z.number().int().min(0).max(65_535),
          total: z.number().int().min(0).max(100_000),
          livres: z.number().int().min(0).max(100_000),
        })
        .refine((c) => c.livres <= c.total, 'livres maior que o total'),
    )
    .max(50),
});

export const schemaTabela = z.object({
  tabelaId: ulid,
  versao: z.number().int().min(1),
  vigenteDesde: dataIso,
  tarifas: z
    .array(
      z.object({
        id: ulid,
        categoria: texto(60),
        ordem: z.number().int().min(0).max(65_535),
        nome: texto(60),
        especial: z.boolean(),
        condicao: z.string().max(120).nullable(),
        linhas: z.array(z.string().max(200)).max(20),
      }),
    )
    .max(200),
});

const regra = z.object({
  toleranciaMin: z.number().int().min(0),
  primeiraHoraCentavos: centavos,
  horaAdicionalCentavos: centavos,
  fracaoMin: z.number().int().min(1).nullable(),
  fracaoCentavos: centavos.nullable(),
  carenciaMin: z.number().int().min(0),
  diariaMaximaCentavos: centavos.nullable(),
  diariaCentavos: centavos.nullable(),
  valorFixoCentavos: centavos.nullable(),
});

export const schemaTicket = z.object({
  id: ulid,
  numero: z.number().int().min(1),
  placa: z.string().regex(/^[A-Z0-9]{5,10}$/, 'placa inválida'),
  categoria: texto(60),
  vaga: z.string().max(20).nullable(),
  modalidade: z.enum(['AVULSO', 'DIARIA']),
  situacao: z.enum(['ESTACIONADO', 'ENCERRADO', 'CANCELADO']),
  entradaEm: dataIso,
  saidaEm: dataIso.nullable(),
  regra,
  tarifaNome: texto(80),
  tarifaDescricao: texto(255),
  valorFinalCentavos: centavos.nullable(),
  itensFinal: z
    .array(
      z.object({
        descricao: texto(120),
        quantidade: z.number().int().min(0),
        unitarioCentavos: z.number().int(),
        totalCentavos: z.number().int(),
      }),
    )
    .max(50)
    .nullable(),
  pagoCentavos: centavos,
  acessoExpiraEm: dataIso.nullable(),
  tokens: z
    .array(z.object({ hash: z.string().regex(/^[0-9a-f]{64}$/), revogadoEm: dataIso.nullable() }))
    .max(50),
});

export const schemaDados = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('site'), site: schemaSite }),
  z.object({ tipo: z.literal('disponibilidade'), disponibilidade: schemaDisponibilidade }),
  z.object({ tipo: z.literal('tabela_tarifa'), tabela: schemaTabela }),
  z.object({ tipo: z.literal('tabela_tarifa_arquivada'), tabelaId: ulid }),
  z.object({ tipo: z.literal('ticket'), ticket: schemaTicket }),
]);

/** Envelope do evento: validado primeiro; os `dados` são validados um a um (rejeição individual). */
export const schemaEvento = z.object({
  eventId: ulid,
  seq: z.number().int().min(1),
  tipo: z
    .string()
    .regex(/^[a-z_]+(\.[a-z_]+)+$/)
    .max(80),
  versao: z.number().int().min(1),
  ocorridoEm: dataIso,
  agregado: z.object({ tipo: z.string().max(40), id: z.string().max(26) }),
  dados: z.unknown(),
});

export const schemaLote = z.object({
  siteId: ulid,
  eventos: z.array(schemaEvento).max(100),
});

export const schemaParteSnapshot = z.object({
  siteId: ulid,
  snapshotId: ulid,
  parte: z.number().int().min(1),
  totalPartes: z.number().int().min(1).max(1000),
  seq: z.number().int().min(0),
  site: schemaSite.optional(),
  disponibilidade: schemaDisponibilidade.optional(),
  tabelas: z.array(schemaTabela).max(20).optional(),
  tickets: z.array(schemaTicket).max(200).optional(),
});
