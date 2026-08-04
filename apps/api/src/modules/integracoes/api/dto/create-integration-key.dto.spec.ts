import { validate } from 'class-validator';
import { CreateIntegrationKeyDto } from './create-integration-key.dto';

function dto(nome: string, escopos: unknown): CreateIntegrationKeyDto {
  const d = new CreateIntegrationKeyDto();
  d.nome = nome;
  d.escopos = escopos as string[];
  return d;
}

describe('CreateIntegrationKeyDto', () => {
  it('aceita uma lista de escopos válidos', async () => {
    const erros = await validate(
      dto('ERP da produção', [
        'cliente:escrever',
        'negociacao:escrever',
        'atividade:escrever',
        'tarefa:escrever',
      ]),
    );
    expect(erros).toHaveLength(0);
  });

  it('recusa lead:receber — pertence ao canal de captação', async () => {
    const erros = await validate(dto('ERP', ['lead:receber']));
    expect(erros).toHaveLength(1);
    expect(erros[0].property).toBe('escopos');
  });

  it('recusa escopo fora do catálogo', async () => {
    const erros = await validate(dto('ERP', ['inventado']));
    expect(erros).toHaveLength(1);
    expect(erros[0].property).toBe('escopos');
  });

  it('recusa lista vazia', async () => {
    const erros = await validate(dto('ERP', []));
    expect(erros).toHaveLength(1);
    expect(erros[0].property).toBe('escopos');
    expect(erros[0].constraints).toHaveProperty('arrayNotEmpty');
  });
});
