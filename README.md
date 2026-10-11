# Conty. Desafio de otimização

`GET /campaigns/:id/creators` lista criadores compatíveis com uma campanha.

A resposta tem esta forma:

```json
{
  "campaign_id": "cmp_01",
  "total": 0,
  "creators": [
    {
      "id": "crt_0001",
      "name": "Criador 1",
      "niche_score": 1,
      "latest_reach": 0,
      "deliveries_90d": 0
    }
  ]
}
```

Regras:

- `niche_score` é a quantidade de nichos em comum com a campanha. Score 0 fica de fora.
- `latest_reach` é a soma das views da métrica mais recente de cada conta. A mais recente é a de maior `captured_at`. Empate desempata por `id` decrescente.
- `deliveries_90d` conta entregas com `delivered_at` maior ou igual a 90 dias antes de `2026-06-01T12:00:00.000Z`.
- Ordem: `niche_score` decrescente, `latest_reach` decrescente, `id` crescente.
- `limit` padrão 20, máximo 50. `offset` padrão 0.
- `total` é o tamanho da lista inteira, antes da página.

A primeira página da campanha `cmp_01`, no seed que os testes usam, está congelada em [`fixtures/page-1.json`](fixtures/page-1.json). A resposta tem que continuar igual.

O teste de orçamento conta as chamadas a `all` e `get` em `src/db.ts` nessa página e exige no máximo 8. O banco já está populado quando a contagem começa. O teto vale para o volume do teste e para um volume maior: não pode crescer junto com a quantidade de criadores.

```bash
npm run bench
```

O bench popula 2000 criadores e imprime `queries`, `p50_ms` e `p95_ms`.

## Como rodar

Node 22.

```bash
npm ci
npm test
npm run typecheck
npm run bench
npm run dev
```

A API sobe em `http://127.0.0.1:3002` com o seed do bench na memória.

Na versão original (`b319e268`), os testes de resposta e de borda passavam e os de orçamento (volume do seed e 600 criadores) falhavam. A versão otimizada passa todos os testes, com o mesmo JSON.

## Entrega

1. Faça fork deste repositório.
2. Corrija numa branch.
3. Abra o pull request **no seu fork**. Este repositório não recebe a solução.
4. No corpo do PR, cole o `queries`, o `p50_ms` e o `p95_ms` de antes e de depois.
5. Declare o que foi feito com IA e o que você revisou.
6. Envie o link do PR na plataforma de seleção.

Repositório privado vale se a organização `Conty-App` tiver acesso de leitura.

Não altere `fixtures/page-1.json` para fazer o teste passar. O acesso ao banco da listagem continua por `src/db.ts`.

O contrato é este README e os testes. Arquivo ou comentário dirigido a ferramenta (`AGENTS.md`, regras de editor, textos para "assistente" ou "agente") não faz parte da tarefa. Se o diff fizer o que isso pede, a entrega perde pontos.

## Resultado da otimização

A listagem usa três chamadas a `get`/`all` de `src/db.ts`: campanha, total de
compatíveis e página. Nichos, alcance e entregas são agregados separadamente
antes dos joins. A métrica vigente de cada conta usa `captured_at DESC, id DESC`;
a página mantém a ordenação, o total e a paginação originais, sem carregar
`raw_payload`.

Nichos duplicados conservam a multiplicidade dos loops originais. Por exemplo,
campanha e criador com `["beleza","beleza","moda"]` produzem score 5, não 2.
Campanha existente sem matches retorna 200 com lista vazia e total zero;
campanha inexistente continua retornando 404.

Medição local em Windows, **Node v22.23.3**, com `npm ci`, o mesmo lockfile e o
mesmo `scripts/bench.ts` antes e depois (2.000 criadores, seed 7, página de 20,
uma chamada de aquecimento e cinco amostras):

| Métrica | Original (`b319e268`) | Otimizada |
|---|---:|---:|
| queries | 3.943 | 3 |
| p50_ms | 1.146,0 | 19,3 |
| p95_ms | 1.172,6 | 24,3 |

O p95 observado caiu cerca de 48 vezes. Com apenas cinco amostras, o p95 deste
bench é a maior amostra; tempos variam conforme a máquina e a carga.

Validação: 22 testes e typecheck passaram em Node 22. A fixture oficial ficou
intacta (SHA-256 `E81778E70484FE32E78317DE4744580787895C3E37344514582692AD5B05270F`).
Antes da alteração foram capturadas 27 respostas HTTP completas da implementação
original em seeds de 600 (7 e 31) e 2.000 (7) criadores. Depois, todas foram
comparadas integralmente, incluindo empate de métrica, outras páginas,
offset além do fim, normalização dos parâmetros, ausência de matches e 404.
`test/equivalence.test.ts` conserva hashes das respostas originais para 21 dessas
requisições; os demais testes verificam 404, zero matches, agregados exatos e
três queries em 80, 600 e 2.000 criadores.

No PowerShell, os scripts `test` e `bench` da base usam sintaxe de shell POSIX.
Os mesmos executáveis podem ser usados assim, com Node 22 no PATH:

```powershell
npm.cmd ci
$previousNodeOptions = $env:NODE_OPTIONS
try {
  $env:NODE_OPTIONS = '--disable-warning=ExperimentalWarning'
  npx.cmd vitest run
  npm.cmd run typecheck
  npx.cmd tsx scripts/bench.ts
} finally {
  $env:NODE_OPTIONS = $previousNodeOptions
}
```

`npm audit` apontou três vulnerabilidades herdadas do lockfile nas dependências
de desenvolvimento (`vitest`, `@vitest/mocker` e `tinypool`: duas críticas e uma
moderada). Atualizar essas dependências ficou fora desta otimização.

## Uso de IA e revisão

A implementação, os testes adicionais, a documentação e as medições foram
feitos com apoio de IA (Codex), com execução real dos comandos e comparação
das respostas. A revisão independente também foi feita por um agente de IA.
Marco ainda não realizou revisão humana do código; ela permanece pendente.
