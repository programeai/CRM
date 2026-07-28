import {
  BadRequestException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ImportService } from './import.service';
import { CatalogoResolvido } from './catalog-resolver';
import type { SpreadsheetReader } from '../infra/spreadsheet.reader';
import type { CatalogResolver } from './catalog-resolver';
import type { ClientsService } from '../../clients/application/clients.service';
import type { ContactsService } from '../../contacts/application/contacts.service';
import type { CatalogosService } from '../../catalogos/application/catalogos.service';
import type { AuditService } from '../../audit/audit.service';
import type { CatalogItem } from '../../catalogos/domain/catalog.repository';
import type { ClientImportRef } from '../../clients/domain/client.repository';

function catalogo(...nomes: string[]): CatalogoResolvido {
  const itens: CatalogItem[] = nomes.map((name, i) => ({
    id: `fonte-${i}`,
    ownerId: 'owner-1',
    name,
    active: true,
  }));
  return new CatalogoResolvido(itens);
}

describe('ImportService.previa', () => {
  let reader: { ler: jest.Mock };
  let resolver: { carregar: jest.Mock };
  let clients: { listImportRefs: jest.Mock; create: jest.Mock };
  let contacts: { create: jest.Mock };
  let catalogos: { create: jest.Mock; findOne: jest.Mock };
  let audit: { registrar: jest.Mock };
  let service: ImportService;

  beforeEach(() => {
    reader = { ler: jest.fn() };
    resolver = { carregar: jest.fn().mockResolvedValue(catalogo()) };
    clients = {
      listImportRefs: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'cliente-criado' }),
    };
    contacts = { create: jest.fn() };
    catalogos = { create: jest.fn(), findOne: jest.fn() };
    audit = { registrar: jest.fn().mockResolvedValue(undefined) };
    service = new ImportService(
      reader as unknown as SpreadsheetReader,
      resolver as unknown as CatalogResolver,
      clients as unknown as ClientsService,
      contacts as unknown as ContactsService,
      catalogos as unknown as CatalogosService,
      audit as unknown as AuditService,
    );
  });

  it('sugere o mapeamento por rótulo/apelido quando nenhum é informado', async () => {
    reader.ler.mockResolvedValue({
      colunas: ['Nome', 'CNPJ', 'Origem'],
      linhas: [{ Nome: 'Acme', CNPJ: '11222333000181', Origem: 'Indicação' }],
    });
    resolver.carregar.mockResolvedValue(catalogo('Indicação'));

    const previa = await service.previa('owner-1', 'clientes', Buffer.from(''));

    expect(previa.mapeamento).toEqual({
      Nome: 'name',
      CNPJ: 'document',
      Origem: 'sourceId',
    });
    expect(previa.erros).toEqual([]);
    expect(previa.validas).toBe(1);
  });

  it('usa o mapeamento informado, sem sugerir de novo', async () => {
    reader.ler.mockResolvedValue({
      colunas: ['A'],
      linhas: [{ A: 'Acme' }],
    });

    const previa = await service.previa(
      'owner-1',
      'clientes',
      Buffer.from(''),
      { A: 'name' },
    );

    expect(previa.mapeamento).toEqual({ A: 'name' });
  });

  it('lança 400 quando o campo obrigatório "Nome" não está mapeado', async () => {
    reader.ler.mockResolvedValue({
      colunas: ['Alguma coisa'],
      linhas: [{ 'Alguma coisa': 'x' }],
    });

    await expect(
      service.previa('owner-1', 'clientes', Buffer.from(''), {
        'Alguma coisa': null,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('detecta origem desconhecida deduplicada por forma normalizada', async () => {
    reader.ler.mockResolvedValue({
      colunas: ['Nome', 'Origem'],
      linhas: [
        { Nome: 'Acme', Origem: 'Instagram' },
        { Nome: 'Beta', Origem: 'instagram' },
      ],
    });

    const previa = await service.previa('owner-1', 'clientes', Buffer.from(''));

    expect(previa.origensDesconhecidas).toEqual(['Instagram']);
  });

  it('detecta CPF/CNPJ inválido', async () => {
    reader.ler.mockResolvedValue({
      colunas: ['Nome', 'CNPJ'],
      linhas: [{ Nome: 'Acme', CNPJ: '123' }],
    });

    const previa = await service.previa('owner-1', 'clientes', Buffer.from(''));

    expect(previa.erros).toEqual([
      expect.objectContaining({
        linha: 2,
        campo: 'document',
        mensagem:
          'Documento inválido: informe um CPF (11 dígitos) ou um CNPJ (14 dígitos).',
      }),
    ]);
    expect(previa.validas).toBe(0);
  });

  it('detecta documento repetido dentro do arquivo, citando a primeira linha', async () => {
    reader.ler.mockResolvedValue({
      colunas: ['Nome', 'CNPJ'],
      linhas: [
        { Nome: 'Acme', CNPJ: '11.222.333/0001-81' },
        { Nome: 'Acme Filial', CNPJ: '11222333000181' },
      ],
    });

    const previa = await service.previa('owner-1', 'clientes', Buffer.from(''));

    expect(previa.erros).toEqual([
      expect.objectContaining({
        linha: 3,
        campo: 'document',
        mensagem: 'Este CPF/CNPJ aparece também na linha 2 do arquivo.',
      }),
    ]);
  });

  it('cliente sem documento não é erro de linha (personType fica no default)', async () => {
    reader.ler.mockResolvedValue({
      colunas: ['Nome'],
      linhas: [{ Nome: 'Acme' }],
    });

    const previa = await service.previa('owner-1', 'clientes', Buffer.from(''));

    expect(previa.erros).toEqual([]);
  });

  it('exige o mapeamento de identificação do cliente para importar contatos', async () => {
    reader.ler.mockResolvedValue({
      colunas: ['Contato'],
      linhas: [{ Contato: 'Fulano' }],
    });

    await expect(
      service.previa('owner-1', 'contatos', Buffer.from(''), {
        Contato: 'name',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('contatos: cliente não encontrado na base', async () => {
    reader.ler.mockResolvedValue({
      colunas: ['Cliente', 'Contato'],
      linhas: [{ Cliente: 'Acme', Contato: 'Fulano' }],
    });
    clients.listImportRefs.mockResolvedValue([]);

    const previa = await service.previa(
      'owner-1',
      'contatos',
      Buffer.from(''),
      {
        Cliente: 'clienteNome',
        Contato: 'name',
      },
    );

    expect(previa.erros).toEqual([
      expect.objectContaining({
        linha: 2,
        campo: 'clienteDocumento',
        mensagem:
          'Cliente não encontrado na sua base. Cadastre-o antes ou corrija o CPF/CNPJ.',
      }),
    ]);
  });

  it('contatos: cliente ambíguo quando mais de um tem o mesmo nome', async () => {
    const refs: ClientImportRef[] = [
      { id: 'c1', name: 'Acme', document: null },
      { id: 'c2', name: 'Acme', document: null },
    ];
    reader.ler.mockResolvedValue({
      colunas: ['Cliente', 'Contato'],
      linhas: [{ Cliente: 'Acme', Contato: 'Fulano' }],
    });
    clients.listImportRefs.mockResolvedValue(refs);

    const previa = await service.previa(
      'owner-1',
      'contatos',
      Buffer.from(''),
      {
        Cliente: 'clienteNome',
        Contato: 'name',
      },
    );

    expect(previa.erros).toEqual([
      expect.objectContaining({
        linha: 2,
        campo: 'clienteNome',
        mensagem:
          'Há mais de um cliente com este nome. Use a coluna de CPF/CNPJ do cliente para identificar qual.',
      }),
    ]);
  });

  it('a amostra tem no máximo 10 linhas', async () => {
    const linhas = Array.from({ length: 15 }, (_, i) => ({
      Nome: `Cliente ${i}`,
    }));
    reader.ler.mockResolvedValue({ colunas: ['Nome'], linhas });

    const previa = await service.previa('owner-1', 'clientes', Buffer.from(''));

    expect(previa.amostra).toHaveLength(10);
    expect(previa.totalDeLinhas).toBe(15);
  });
});

describe('ImportService.importar', () => {
  let reader: { ler: jest.Mock };
  let resolver: { carregar: jest.Mock };
  let clients: { listImportRefs: jest.Mock; create: jest.Mock };
  let contacts: { create: jest.Mock };
  let catalogos: { create: jest.Mock; findOne: jest.Mock };
  let audit: { registrar: jest.Mock };
  let service: ImportService;

  beforeEach(() => {
    reader = { ler: jest.fn() };
    resolver = { carregar: jest.fn().mockResolvedValue(catalogo()) };
    clients = {
      listImportRefs: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'cliente-criado' }),
    };
    contacts = {
      create: jest.fn().mockResolvedValue({ id: 'contato-criado' }),
    };
    catalogos = { create: jest.fn(), findOne: jest.fn() };
    audit = { registrar: jest.fn().mockResolvedValue(undefined) };
    service = new ImportService(
      reader as unknown as SpreadsheetReader,
      resolver as unknown as CatalogResolver,
      clients as unknown as ClientsService,
      contacts as unknown as ContactsService,
      catalogos as unknown as CatalogosService,
      audit as unknown as AuditService,
    );
  });

  it('cancela tudo quando sobra erro: nenhum clients.create é chamado e a exceção é 422', async () => {
    reader.ler.mockResolvedValue({
      colunas: ['Nome', 'CNPJ'],
      linhas: [
        { Nome: 'Acme', CNPJ: '123' }, // CNPJ inválido
        { Nome: 'Beta', CNPJ: '' },
      ],
    });

    await expect(
      service.importar(
        'owner-1',
        'clientes',
        Buffer.from(''),
        { Nome: 'name', CNPJ: 'document' },
        [],
        'clientes.csv',
        false,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(clients.create).not.toHaveBeenCalled();
    expect(audit.registrar).not.toHaveBeenCalled();
  });

  it('recusa criar origem nova sem catalogo:gerenciar, e não chama catalogos.create', async () => {
    reader.ler.mockResolvedValue({
      colunas: ['Nome'],
      linhas: [{ Nome: 'Acme' }],
    });

    await expect(
      service.importar(
        'owner-1',
        'clientes',
        Buffer.from(''),
        { Nome: 'name' },
        [{ valor: 'Instagram', acao: 'criar' }],
        'clientes.csv',
        false, // sem catalogo:gerenciar
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(catalogos.create).not.toHaveBeenCalled();
  });

  it('cria a origem nova com a permissão, e as linhas com o mesmo valor usam o item criado', async () => {
    const itemCriado: CatalogItem = {
      id: 'fonte-nova',
      ownerId: 'owner-1',
      name: 'Instagram',
      active: true,
    };
    catalogos.create.mockResolvedValue(itemCriado);
    reader.ler.mockResolvedValue({
      colunas: ['Nome', 'Origem'],
      linhas: [
        { Nome: 'Acme', Origem: 'Instagram' },
        { Nome: 'Beta', Origem: 'instagram' }, // mesma origem, outra caixa
      ],
    });

    await service.importar(
      'owner-1',
      'clientes',
      Buffer.from(''),
      { Nome: 'name', Origem: 'sourceId' },
      [{ valor: 'Instagram', acao: 'criar' }],
      'clientes.csv',
      true,
    );

    expect(catalogos.create).toHaveBeenCalledTimes(1);
    expect(clients.create).toHaveBeenCalledTimes(2);
    expect(clients.create).toHaveBeenNthCalledWith(
      1,
      'owner-1',
      expect.objectContaining({ sourceId: 'fonte-nova' }),
    );
    expect(clients.create).toHaveBeenNthCalledWith(
      2,
      'owner-1',
      expect.objectContaining({ sourceId: 'fonte-nova' }),
    );
  });

  it('registra UM evento de auditoria agregado, não um por linha', async () => {
    reader.ler.mockResolvedValue({
      colunas: ['Nome'],
      linhas: [{ Nome: 'Acme' }, { Nome: 'Beta' }, { Nome: 'Gama' }],
    });

    await service.importar(
      'owner-1',
      'clientes',
      Buffer.from(''),
      { Nome: 'name' },
      [],
      'clientes.csv',
      false,
    );

    expect(audit.registrar).toHaveBeenCalledTimes(1);
    expect(audit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'IMPORT',
        action: 'IMPORTAR',
        entityLabel: 'clientes.csv',
        extra: expect.objectContaining({ criados: 3, totalDeLinhas: 3 }),
      }),
    );
  });

  it('grava em série, na ordem das linhas', async () => {
    reader.ler.mockResolvedValue({
      colunas: ['Nome'],
      linhas: [{ Nome: 'Acme' }, { Nome: 'Beta' }],
    });

    await service.importar(
      'owner-1',
      'clientes',
      Buffer.from(''),
      { Nome: 'name' },
      [],
      'clientes.csv',
      false,
    );

    expect(clients.create).toHaveBeenNthCalledWith(
      1,
      'owner-1',
      expect.objectContaining({ name: 'Acme' }),
    );
    expect(clients.create).toHaveBeenNthCalledWith(
      2,
      'owner-1',
      expect.objectContaining({ name: 'Beta' }),
    );
  });

  it('importa contatos casando o cliente por documento', async () => {
    const refs: ClientImportRef[] = [
      { id: 'cliente-1', name: 'Acme', document: '11222333000181' },
    ];
    clients.listImportRefs.mockResolvedValue(refs);
    reader.ler.mockResolvedValue({
      colunas: ['CNPJ do cliente', 'Contato'],
      linhas: [{ 'CNPJ do cliente': '11222333000181', Contato: 'Fulano' }],
    });

    await service.importar(
      'owner-1',
      'contatos',
      Buffer.from(''),
      { 'CNPJ do cliente': 'clienteDocumento', Contato: 'name' },
      [],
      'contatos.csv',
      false,
    );

    expect(contacts.create).toHaveBeenCalledWith(
      'owner-1',
      'cliente-1',
      expect.objectContaining({ name: 'Fulano' }),
    );
  });
});
