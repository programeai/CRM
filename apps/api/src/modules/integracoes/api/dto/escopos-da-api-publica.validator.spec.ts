import { EscoposDaApiPublica } from './escopos-da-api-publica.validator';

describe('EscoposDaApiPublica', () => {
  const validador = new EscoposDaApiPublica();

  it('aceita uma lista de escopos válidos', () => {
    expect(
      validador.validate([
        'cliente:escrever',
        'negociacao:escrever',
        'atividade:escrever',
        'tarefa:escrever',
      ]),
    ).toBe(true);
  });

  it('recusa lead:receber — pertence ao canal de captação', () => {
    expect(validador.validate(['lead:receber'])).toBe(false);
    expect(validador.validate(['cliente:escrever', 'lead:receber'])).toBe(
      false,
    );
  });

  it('recusa escopo fora do catálogo', () => {
    expect(validador.validate(['inventado'])).toBe(false);
  });

  it('lista vazia passa NESTE validador — quem recusa é o @ArrayNotEmpty do DTO', () => {
    // Vacuamente `true` no `every`: este validador só cuida do CONTEÚDO da
    // lista. O caso "recusa lista vazia" do DTO está em
    // `create-integration-key.dto.spec.ts`.
    expect(validador.validate([])).toBe(true);
  });

  it('recusa valor que não é lista', () => {
    expect(validador.validate('cliente:escrever')).toBe(false);
    expect(validador.validate(undefined)).toBe(false);
  });
});
