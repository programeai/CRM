import { BadRequestException } from '@nestjs/common';
import { isEmail } from 'class-validator';
import type { ClientStatus } from '@prisma/client';
import {
  inferPersonType,
  isValidDocument,
  onlyDigits,
} from '../../../shared/document';
import type { ClientImportRef } from '../../clients/domain/client.repository';
import type { CatalogoResolvido } from './catalog-resolver';
import { normalizar } from './normalizar';
import type {
  CampoImportavel,
  LinhaComErro,
  TipoDeImportacao,
} from '../domain/import';

/**
 * Para cada coluna da planilha, casa `normalizar(coluna)` contra o rótulo (e os
 * apelidos, já normalizados) de cada campo; o primeiro campo que casar e ainda
 * não tem dono vence. Coluna sem casamento vira `null` — "não importar".
 */
export function sugerirMapeamento(
  colunas: string[],
  campos: CampoImportavel[],
): Record<string, string | null> {
  const usados = new Set<string>();
  const mapeamento: Record<string, string | null> = {};
  for (const coluna of colunas) {
    const chaveColuna = normalizar(coluna);
    const campo = campos.find(
      (c) =>
        !usados.has(c.chave) &&
        (normalizar(c.rotulo) === chaveColuna ||
          (c.apelidos ?? []).some((a) => normalizar(a) === chaveColuna)),
    );
    if (campo) {
      mapeamento[coluna] = campo.chave;
      usados.add(campo.chave);
    } else {
      mapeamento[coluna] = null;
    }
  }
  return mapeamento;
}

/**
 * `400` em pt-BR se um campo obrigatório não tem coluna, se o mapeamento cita
 * uma chave que não existe no catálogo de campos, ou se (para `contatos`) nem
 * `clienteDocumento` nem `clienteNome` foram mapeados.
 */
export function assertMapeamentoCompleto(
  tipo: TipoDeImportacao,
  mapeamento: Record<string, string | null>,
  campos: CampoImportavel[],
): void {
  const chavesMapeadas = new Set(
    Object.values(mapeamento).filter((v): v is string => v !== null),
  );
  const chavesValidas = new Set(campos.map((c) => c.chave));
  for (const chave of chavesMapeadas) {
    if (!chavesValidas.has(chave)) {
      throw new BadRequestException(
        `O mapeamento cita um campo que não existe: "${chave}".`,
      );
    }
  }
  for (const campo of campos) {
    if (campo.obrigatorio && !chavesMapeadas.has(campo.chave)) {
      throw new BadRequestException(
        `Mapeie a coluna do campo obrigatório "${campo.rotulo}".`,
      );
    }
  }
  if (
    tipo === 'contatos' &&
    !chavesMapeadas.has('clienteDocumento') &&
    !chavesMapeadas.has('clienteNome')
  ) {
    throw new BadRequestException(
      'Mapeie a coluna que identifica o cliente (CPF/CNPJ do cliente ou Nome do cliente) — sem ela não dá para saber a quem o contato pertence.',
    );
  }
}

/** Reindexa a linha bruta (por nome de coluna) para a chave de campo do mapeamento. */
export function aplicar(
  bruta: Record<string, string>,
  mapeamento: Record<string, string | null>,
): Record<string, string> {
  const linha: Record<string, string> = {};
  for (const [coluna, valor] of Object.entries(bruta)) {
    const chave = mapeamento[coluna];
    if (chave) linha[chave] = valor;
  }
  return linha;
}

/**
 * Documento (dígitos) → número da PRIMEIRA linha em que ele aparece no
 * arquivo. Uma linha posterior com o mesmo documento não repete no mapa — é
 * assim que ela reconhece "eu sou a repetição" ao comparar o próprio número
 * contra o valor guardado.
 */
export function indexarDocumentosNoArquivo(
  linhas: Record<string, string>[],
): Map<string, number> {
  const mapa = new Map<string, number>();
  linhas.forEach((linha, i) => {
    const digitos = linha.document ? onlyDigits(linha.document) : '';
    if (digitos && !mapa.has(digitos)) mapa.set(digitos, i + 2);
  });
  return mapa;
}

export interface ClientesIndexados {
  /** Por documento (só dígitos) — casamento inequívoco. */
  porDocumento: Map<string, ClientImportRef>;
  /** Por nome normalizado — guarda a LISTA, para detectar ambiguidade (mais de um). */
  porNome: Map<string, ClientImportRef[]>;
}

export function indexarClientes(refs: ClientImportRef[]): ClientesIndexados {
  const porDocumento = new Map<string, ClientImportRef>();
  const porNome = new Map<string, ClientImportRef[]>();
  for (const ref of refs) {
    if (ref.document) porDocumento.set(ref.document, ref);
    const chave = normalizar(ref.name);
    const lista = porNome.get(chave) ?? [];
    lista.push(ref);
    porNome.set(chave, lista);
  }
  return { porDocumento, porNome };
}

/** Resultado de casar uma linha de contato contra a base de clientes do owner. */
export type ClienteResolvido = ClientImportRef | 'ambiguo' | null;

/**
 * `clienteDocumento` vence quando informado (casamento inequívoco); senão casa
 * por `clienteNome` — e mais de um cliente com o mesmo nome é ambiguidade, não
 * "primeiro que achar".
 */
export function resolverCliente(
  linha: Record<string, string>,
  clientes: ClientesIndexados,
): ClienteResolvido {
  const documento = linha.clienteDocumento
    ? onlyDigits(linha.clienteDocumento)
    : '';
  if (documento) return clientes.porDocumento.get(documento) ?? null;
  const nome = linha.clienteNome?.trim();
  if (!nome) return null;
  const lista = clientes.porNome.get(normalizar(nome)) ?? [];
  if (lista.length === 0) return null;
  if (lista.length > 1) return 'ambiguo';
  return lista[0];
}

const STATUS_POR_ROTULO: Record<string, ClientStatus> = {
  lead: 'LEAD',
  ativo: 'ACTIVE',
  inativo: 'INACTIVE',
  perdido: 'LOST',
};

/** Rótulo pt-BR da planilha → enum. Exportado: a gravação (Fase 3) reusa para montar o DTO. */
export function resolverStatus(texto: string): ClientStatus | null {
  return STATUS_POR_ROTULO[normalizar(texto)] ?? null;
}

/**
 * Valida uma linha já mapeada (chave de campo → valor de texto). A validação
 * de documento reusa `shared/document.ts` — nunca reimplementa — mas, ao
 * contrário de `resolveDocument` (Fase 1), aqui **não** se checa unicidade
 * contra o banco (isso é do commit, Fase 3): a prévia checa só repetição
 * DENTRO do próprio arquivo, que `resolveDocument` não teria como ver.
 */
export function validarLinha(
  tipo: TipoDeImportacao,
  linha: Record<string, string>,
  numeroDaLinha: number,
  catalogo: CatalogoResolvido,
  clientes: ClientesIndexados | null,
  documentosNoArquivo: Map<string, number>,
): LinhaComErro[] {
  const erros: LinhaComErro[] = [];
  const erro = (mensagem: string, campo?: string) =>
    erros.push({ linha: numeroDaLinha, campo, mensagem });

  const nome = linha.name?.trim() ?? '';
  if (!nome) erro('O nome é obrigatório.', 'name');
  else if (nome.length < 2)
    erro('O nome deve ter no mínimo 2 caracteres.', 'name');

  if (linha.email && !isEmail(linha.email)) erro('E-mail inválido.', 'email');

  if (tipo === 'clientes') {
    if (linha.document) {
      const digitos = onlyDigits(linha.document);
      const personType = inferPersonType(digitos);
      if (!personType) {
        erro(
          'Documento inválido: informe um CPF (11 dígitos) ou um CNPJ (14 dígitos).',
          'document',
        );
      } else if (!isValidDocument(digitos, personType)) {
        erro(
          personType === 'INDIVIDUAL' ? 'CPF inválido.' : 'CNPJ inválido.',
          'document',
        );
      } else {
        const primeira = documentosNoArquivo.get(digitos);
        if (primeira !== undefined && primeira !== numeroDaLinha) {
          erro(
            `Este CPF/CNPJ aparece também na linha ${primeira} do arquivo.`,
            'document',
          );
        }
      }
    }
    if (linha.status && !resolverStatus(linha.status)) {
      erro('Status inválido: use Lead, Ativo, Inativo ou Perdido.', 'status');
    }
  } else if (clientes) {
    const resolvido = resolverCliente(linha, clientes);
    if (resolvido === 'ambiguo') {
      erro(
        'Há mais de um cliente com este nome. Use a coluna de CPF/CNPJ do cliente para identificar qual.',
        'clienteNome',
      );
    } else if (resolvido === null) {
      erro(
        'Cliente não encontrado na sua base. Cadastre-o antes ou corrija o CPF/CNPJ.',
        'clienteDocumento',
      );
    }
  }

  return erros;
}
