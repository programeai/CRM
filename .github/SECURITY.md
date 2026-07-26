# Política de Segurança

## Como reportar uma vulnerabilidade

**Não abra issue pública para falha de segurança.**

Use o reporte privado do GitHub:
[Report a vulnerability](https://github.com/programeai/CRM/security/advisories/new).
O relato chega como advisory privado, visível só para os mantenedores, e é o
canal com o melhor histórico de resposta.

Ao reportar, inclua se possível: versão ou commit afetado, passos para
reproduzir, impacto observado e qualquer log ou requisição relevante (sem
credenciais reais).

## Prazo de resposta

Este é um projeto mantido por uma equipe pequena. O compromisso é confirmar o
recebimento em até **7 dias** e informar o encaminhamento (correção, mitigação
ou recusa) em até **30 dias**. Não há programa de recompensa (bug bounty).

## Escopo

Vale para o código deste repositório: a API (`apps/api`), o frontend
(`apps/web`), os Dockerfiles e os workflows.

**Fora de escopo:** a instância hospedada em `crm.programeai.com.br` e a
infraestrutura em volta dela; instâncias autohospedadas por terceiros; e
comportamento que dependa de má configuração da própria instância — por exemplo
`REGISTRATION_ENABLED=true` com `TURNSTILE_SECRET_KEY` vazia, que é uma escolha
documentada de quem opera, não um defeito do código.

## Versões suportadas

Só a `main`. Não há releases com suporte estendido.
