import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { CheckCircle2, Upload } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FileDrop } from '@/components/ui/file-drop';
import { Stepper } from '@/components/ui/stepper';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Spinner } from '@/components/ui/spinner';
import { useCan } from '@/hooks/use-can';
import { extractApiMessage } from '@/lib/api-error';
import { useCatalogo } from '@/features/catalogos/api/hooks';
import { usePreviaDeImportacao, useImportar } from './api/hooks';
import type {
  DecisaoDeOrigem,
  PreviaDeImportacao,
  RelatorioDeImportacao,
  TipoDeImportacao,
} from './api/types';

const PASSOS = [
  { label: 'Arquivo' },
  { label: 'Colunas' },
  { label: 'Origens' },
  { label: 'Conferir' },
];

/** Sentinela do Select — o valor real de "não importar" é `null`, não uma string. */
const NAO_IMPORTAR = '__nao_importar__';

const TIPO_LABEL: Record<TipoDeImportacao, string> = {
  clientes: 'Clientes',
  contatos: 'Contatos',
};

/**
 * Wizard de importação em quatro passos: arquivo → mapeamento de colunas →
 * origens desconhecidas → prévia e confirmação. Página, não diálogo — um
 * wizard de quatro passos não cabe num modal (e modal sobre modal é
 * proibido). Estado local só: o `File` fica em memória entre os passos
 * porque tanto a prévia quanto o commit reenviam o arquivo inteiro.
 */
export default function ImportacaoPage() {
  const { can } = useCan();
  const podeGerenciarCatalogo = can('catalogo:gerenciar');
  const { data: fontes } = useCatalogo('fontes-de-lead');

  const previaMutation = usePreviaDeImportacao();
  const importarMutation = useImportar();

  const [step, setStep] = useState(0);
  const [tipo, setTipo] = useState<TipoDeImportacao>('clientes');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<PreviaDeImportacao | null>(null);
  const [mapeamento, setMapeamento] = useState<Record<string, string | null>>({});
  const [decisoes, setDecisoes] = useState<Record<string, DecisaoDeOrigem>>({});
  const [relatorio, setRelatorio] = useState<RelatorioDeImportacao | null>(null);

  function reiniciar() {
    setStep(0);
    setArquivo(null);
    setPrevia(null);
    setMapeamento({});
    setDecisoes({});
    setRelatorio(null);
  }

  async function handleFileSelected(file: File) {
    setArquivo(file);
    try {
      const resultado = await previaMutation.mutateAsync({ arquivo: file, tipo });
      aplicarPrevia(resultado);
      setStep(1);
    } catch (err) {
      toast.error(extractApiMessage(err, 'Falha ao ler a planilha.'));
    }
  }

  function aplicarPrevia(resultado: PreviaDeImportacao) {
    setPrevia(resultado);
    setMapeamento(resultado.mapeamento);
    setDecisoes((atual) => {
      const proximo: Record<string, DecisaoDeOrigem> = {};
      for (const valor of resultado.origensDesconhecidas) {
        proximo[valor] = atual[valor] ?? { valor, acao: 'ignorar' };
      }
      return proximo;
    });
  }

  // `items`: sem isto o Select mostra a CHAVE técnica no gatilho (ex.: "name")
  // em vez do rótulo pt-BR — ver a doc do `items` em `@base-ui/react/select`.
  const campoItems: Record<string, string> = {
    [NAO_IMPORTAR]: 'Não importar',
    ...Object.fromEntries(
      (previa?.campos ?? []).map((c) => [
        c.chave,
        c.obrigatorio ? `${c.rotulo} *` : c.rotulo,
      ]),
    ),
  };

  const camposObrigatoriosFaltando =
    previa?.campos.filter(
      (c) => c.obrigatorio && !Object.values(mapeamento).includes(c.chave),
    ) ?? [];
  const faltaIdentificarCliente =
    tipo === 'contatos' &&
    !Object.values(mapeamento).includes('clienteDocumento') &&
    !Object.values(mapeamento).includes('clienteNome');

  async function confirmarMapeamento() {
    if (!arquivo) return;
    try {
      const resultado = await previaMutation.mutateAsync({ arquivo, tipo, mapeamento });
      aplicarPrevia(resultado);
      setStep(resultado.origensDesconhecidas.length > 0 ? 2 : 3);
    } catch (err) {
      toast.error(extractApiMessage(err, 'Falha ao aplicar o mapeamento.'));
    }
  }

  async function confirmarImportacao() {
    if (!arquivo || !previa) return;
    try {
      const resultado = await importarMutation.mutateAsync({
        arquivo,
        tipo,
        mapeamento,
        origens: Object.values(decisoes),
      });
      setRelatorio(resultado);
      setStep(4);
    } catch (err) {
      toast.error(extractApiMessage(err, 'Falha ao importar a planilha.'));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold">Importação</h1>
        <p className="text-sm text-muted-foreground">
          Suba uma planilha de clientes ou de contatos e grave os registros em massa na
          base da sua workspace.
        </p>
      </div>

      {step < 4 && <Stepper steps={PASSOS} current={step} />}

      {step === 0 && (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">O que você está importando?</label>
              <Select<TipoDeImportacao>
                items={TIPO_LABEL}
                value={tipo}
                onValueChange={(v) => v && setTipo(v)}
              >
                <SelectTrigger className="max-w-xs" />
                <SelectContent>
                  <SelectItem value="clientes">Clientes</SelectItem>
                  <SelectItem value="contatos">Contatos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <FileDrop
              disabled={previaMutation.isPending}
              onFileSelected={(file) => void handleFileSelected(file)}
            />
            {previaMutation.isPending && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner />
                Lendo a planilha…
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {step === 1 && previa && (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Confira para qual campo do CRM cada coluna da sua planilha deve ir. Colunas
              que não fizerem sentido podem ficar como "Não importar".
            </p>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Coluna da planilha</TableHead>
                    <TableHead>Campo do CRM</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previa.colunas.map((coluna) => (
                    <TableRow key={coluna}>
                      <TableCell className="font-medium">{coluna}</TableCell>
                      <TableCell>
                        <Select<string>
                          items={campoItems}
                          value={mapeamento[coluna] ?? NAO_IMPORTAR}
                          onValueChange={(v) =>
                            setMapeamento((m) => ({
                              ...m,
                              [coluna]: v === NAO_IMPORTAR ? null : v,
                            }))
                          }
                        >
                          <SelectTrigger className="max-w-xs" />
                          <SelectContent>
                            <SelectItem value={NAO_IMPORTAR}>Não importar</SelectItem>
                            {previa.campos.map((campo) => (
                              <SelectItem key={campo.chave} value={campo.chave}>
                                {campo.rotulo}
                                {campo.obrigatorio ? ' *' : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {(camposObrigatoriosFaltando.length > 0 || faltaIdentificarCliente) && (
              <p role="alert" className="text-sm text-destructive">
                {faltaIdentificarCliente
                  ? 'Mapeie a coluna que identifica o cliente (CPF/CNPJ do cliente ou Nome do cliente) — sem ela não dá para saber a quem o contato pertence.'
                  : `Mapeie a coluna do campo obrigatório "${camposObrigatoriosFaltando[0].rotulo}".`}
              </p>
            )}

            <div className="flex items-center justify-between">
              <Button variant="ghost" onClick={() => setStep(0)}>
                Voltar
              </Button>
              <Button
                disabled={
                  camposObrigatoriosFaltando.length > 0 ||
                  faltaIdentificarCliente ||
                  previaMutation.isPending
                }
                onClick={() => void confirmarMapeamento()}
              >
                {previaMutation.isPending ? <Spinner data-icon="inline-start" /> : null}
                Continuar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && previa && (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Estas origens de lead não existem no seu catálogo. Decida o que fazer com
              cada uma.
            </p>
            <div className="flex flex-col gap-4">
              {previa.origensDesconhecidas.map((valor) => (
                <OrigemDesconhecida
                  key={valor}
                  valor={valor}
                  decisao={decisoes[valor]}
                  podeGerenciarCatalogo={podeGerenciarCatalogo}
                  fontes={fontes ?? []}
                  onChange={(decisao) =>
                    setDecisoes((d) => ({ ...d, [valor]: decisao }))
                  }
                />
              ))}
            </div>
            <div className="flex items-center justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>
                Voltar
              </Button>
              <Button onClick={() => setStep(3)}>Continuar</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && previa && (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <span className="text-muted-foreground">Linhas na planilha: </span>
                <span className="font-medium">{previa.totalDeLinhas}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Prontas para importar: </span>
                <span className="font-medium">{previa.validas}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Com erro: </span>
                <span className="font-medium text-destructive">{previa.erros.length}</span>
              </div>
            </div>

            {previa.erros.length > 0 && (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Linha</TableHead>
                      <TableHead>Campo</TableHead>
                      <TableHead>Erro</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previa.erros.map((erro, i) => (
                      <TableRow key={i}>
                        <TableCell>{erro.linha}</TableCell>
                        <TableCell>{erro.campo ?? '—'}</TableCell>
                        <TableCell>{erro.mensagem}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {previa.colunas
                      .map((coluna) => mapeamento[coluna])
                      .filter((chave): chave is string => Boolean(chave))
                      .filter((chave, i, arr) => arr.indexOf(chave) === i)
                      .map((chave) => (
                        <TableHead key={chave}>
                          {previa.campos.find((c) => c.chave === chave)?.rotulo ?? chave}
                        </TableHead>
                      ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previa.amostra.length > 0 ? (
                    previa.amostra.map((linha, i) => (
                      <TableRow key={i}>
                        {previa.colunas
                          .map((coluna) => mapeamento[coluna])
                          .filter((chave): chave is string => Boolean(chave))
                          .filter((chave, idx, arr) => arr.indexOf(chave) === idx)
                          .map((chave) => (
                            <TableCell key={chave}>{linha[chave] ?? '—'}</TableCell>
                          ))}
                      </TableRow>
                    ))
                  ) : (
                    <TableEmpty colSpan={1}>Nenhuma linha na amostra.</TableEmpty>
                  )}
                </TableBody>
              </Table>
            </div>

            <p className="text-sm text-muted-foreground">
              A importação é tudo-ou-nada: se sobrar erro em qualquer linha, nenhum
              registro é gravado.
            </p>

            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                onClick={() => setStep(previa.origensDesconhecidas.length > 0 ? 2 : 1)}
              >
                Voltar
              </Button>
              <Button
                disabled={previa.erros.length > 0 || importarMutation.isPending}
                onClick={() => void confirmarImportacao()}
              >
                {importarMutation.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Upload data-icon="inline-start" />
                )}
                Importar {previa.totalDeLinhas} registro
                {previa.totalDeLinhas === 1 ? '' : 's'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 4 && relatorio && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <CheckCircle2 className="size-10 text-primary" />
            <p className="font-heading text-lg font-medium">
              {relatorio.criados} {TIPO_LABEL[relatorio.tipo].toLowerCase()} importado
              {relatorio.criados === 1 ? '' : 's'}
            </p>
            {relatorio.origensCriadas.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Origens criadas: {relatorio.origensCriadas.join(', ')}
              </p>
            )}
            <div className="mt-2 flex items-center gap-2">
              <Button variant="outline" onClick={reiniciar}>
                Nova importação
              </Button>
              <Link to="/clientes" className={buttonVariants({ variant: 'default' })}>
                Ver clientes
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Uma linha de decisão sobre uma origem desconhecida — criar, usar uma existente ou ignorar. */
function OrigemDesconhecida({
  valor,
  decisao,
  podeGerenciarCatalogo,
  fontes,
  onChange,
}: {
  valor: string;
  decisao: DecisaoDeOrigem | undefined;
  podeGerenciarCatalogo: boolean;
  fontes: { id: string; name: string }[];
  onChange: (decisao: DecisaoDeOrigem) => void;
}) {
  const acao = decisao?.acao ?? 'ignorar';
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <p className="font-medium">"{valor}"</p>
      <div className="flex flex-col gap-2 text-sm">
        {podeGerenciarCatalogo && (
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name={`origem-${valor}`}
              className="size-4 accent-primary"
              checked={acao === 'criar'}
              onChange={() => onChange({ valor, acao: 'criar' })}
            />
            Criar no catálogo
          </label>
        )}
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="radio"
            name={`origem-${valor}`}
            className="size-4 accent-primary"
            checked={acao === 'usar'}
            onChange={() => onChange({ valor, acao: 'usar', itemId: decisao?.itemId })}
          />
          Usar uma existente
        </label>
        {acao === 'usar' && (
          <Select<string>
            items={Object.fromEntries(fontes.map((f) => [f.id, f.name]))}
            value={decisao?.itemId}
            onValueChange={(itemId) => itemId && onChange({ valor, acao: 'usar', itemId })}
          >
            <SelectTrigger className="ml-6 max-w-xs" placeholder="Selecione a fonte" />
            <SelectContent>
              {fontes.map((fonte) => (
                <SelectItem key={fonte.id} value={fonte.id}>
                  {fonte.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="radio"
            name={`origem-${valor}`}
            className="size-4 accent-primary"
            checked={acao === 'ignorar'}
            onChange={() => onChange({ valor, acao: 'ignorar' })}
          />
          Deixar em branco
        </label>
      </div>
    </div>
  );
}
