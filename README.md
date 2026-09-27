# FinBank & ChefLab

Laboratório didático de **SQL Injection** e **XSS armazenado** para palestras e
workshops. Aplicação monolítica modular em Node.js + Express + mysql2 + MySQL 8.0,
com um modo **vulnerável** e um modo **seguro** para o mesmo cenário lado a lado.

> **Ambiente acadêmico isolado.** Todos os dados são sintéticos. Não há cartão,
> CPF, telefone ou credencial real. **Não publique este serviço fora da rede de
> treinamento** — as portas estão presas ao loopback justamente por isso.

## Como subir

```bash
docker compose up --build
```

A aplicação fica em <http://127.0.0.1:3000> e o MySQL em `127.0.0.1:3306`
(`lab_user` / `lab_password`, base `lab_palestra`).

Para derrubar: `docker compose down`. Para apagar também o volume do banco e
recomeçar do zero: `docker compose down -v`.

## Modo vulnerável × modo seguro

O modo vive num **cookie `lab_mode`**, nunca na URL — a query string é reservada
aos parâmetros do cenário. A barra no topo de cada página alterna o modo.

| Item | Vulnerável (`vuln`) | Seguro (`safe`) |
| --- | --- | --- |
| SQL | interpolação de texto | prepared statement (`execute`) |
| Erros | expõe `sqlMessage` do MySQL | log interno + mensagem genérica |
| XSS | `innerHTML` | `textContent` |
| Reset | `POST /api/reset` | mesma rotina |

Sem cookie — ou com valor inválido — o laboratório assume `vuln`. Essa é a
**regra única**, sem exceção em nenhum ponto do código.

## Os quatro cenários

| # | Página | Vulnerabilidade | Entrada |
| --- | --- | --- | --- |
| 1 | `/banco/agencias.html` | SQLi UNION | `GET cidade` |
| 2 | `/banco/extrato.html` | SQLi baseada em erro | `GET id_conta` |
| 3 | `/banco/noticia.html` | SQLi inferencial (cega) | `GET id` |
| 4 | `/receitas/receitas.html` | XSS armazenado | `POST comentario` |

### Cenário 1 — UNION

A consulta pública devolve **4 colunas** (`nome_agencia`, `endereco`,
`telefone`, `gerente`). Essa contagem é a assinatura do ataque: o payload precisa
fornecer exatamente 4 colunas.

```
' UNION SELECT titular, numero_cartao, cvv, validade FROM cartoes_credito -- 
```

- **vuln** → 6 linhas de `cartoes_credito` aparecem na tabela de agências.
- **safe** → o payload vira um nome de cidade e a consulta volta **0 linhas**.

### Cenário 2 — erro (o mais didático)

```
98765' AND EXTRACTVALUE(1, CONCAT(0x7e, (SELECT senha FROM administradores WHERE id_admin='1'))) -- 
```

- **vuln** → HTTP 500 com `XPATH syntax error: '~abcde'`. O `EXTRACTVALUE` recebe
  um XPath inválido e o MySQL devolve o erro **contendo o resultado da subquery**:
  a senha sintética do administrador. Confirmado no MySQL 8.0.46 fixado no Docker.
- **safe** → o payload é enviado como **valor** de um placeholder, nunca vira SQL.
  A resposta é 200 com zero lançamentos, e nenhum detalhe do banco aparece.

> O espaço final depois de `--` é obrigatório. É por isso que o DAS escreve
> `--%20`: sem ele o MySQL não reconhece o comentário. Na query string o payload
> precisa estar URL-encoded — na interface use o botão **Usar no campo**, que já
> faz a codificação.

### Cenário 3 — cega (oráculo booleano)

Registro-base: `id = 5`.

```
5' AND 1=1 --     ->  HTTP 200 (notícia encontrada)
5' AND 1=2 --     ->  HTTP 404 (registro desapareceu)
```

Esses dois status são o único canal de resposta, e é isso que permite responder
perguntas sobre o banco byte a byte. No modo **safe** a validação numérica
complementar rejeita as duas entradas e o oráculo deixa de responder.

### Cenário 4 — XSS armazenado

Payload:

```html
<img src=x onerror=alert(document.domain)>
```

O `INSERT` em `src/repositories/receitasRepository.js` é **parametrizado nos dois
modos** — a marcação é gravada exatamente como digitada. A diferença está inteira
na **saída**, em `src/public/receitas/receitas.js`:

- **vuln** → `renderizarComInnerHTML()`, que monta o item com `innerHTML`.
  O `onerror` dispara a cada visita, sem nova interação — daí "armazenado".
- **safe** → `renderizarComTextContent()`, que monta nós de texto. A mesma
  marcação aparece como texto literal. Não existe `innerHTML` nesse caminho.

Ative o payload com o botão **Usar no campo** e recarregue a página.

## Roteiro sugerido para a apresentação

1. Deixe o modo em **Vulnerável** (acento vermelho na barra).
2. Cenário 1: consulta normal, depois o payload UNION. A tabela troca agências por
   dados de cartão.
3. Cenário 2: o payload de erro. A senha aparece dentro da mensagem do MySQL.
4. Cenário 3: compare `200` e `404`.
5. Cenário 4: grave o comentário com HTML e recarregue.
6. Alterne para **Seguro** e repita os quatro. O payload passa a ser tratado como texto.
7. **Restaurar laboratório** para deixar o estado inicial para a próxima turma.

Cada página mostra o resultado **e** a resposta JSON bruta — é no JSON que o
aluno enxerga as linhas extras do UNION e o `~abcde` vazar.

## API de laboratório

| Rota | Efeito |
| --- | --- |
| `GET /api/mode` | devolve o modo vigente |
| `POST /api/mode` | `{ "mode": "vuln" \| "safe" }` → `Set-Cookie: lab_mode=…` |
| `POST /api/reset` | restaura o estado **inteiro** reexecutando `database/init.sql` |
| `GET /api/health` | aplicação + banco + contagem de tabelas |

`POST /receitas/reset` existe como alias de laboratório; o contrato oficial é
`/api/reset`. O reset restaura os dois comentários originais **e** todos os
registros-base das demais tabelas, não só os comentários.

## Testes

O plano de aceite T01–T09 do DAS está implementado em `tests/acceptance.test.js`
(`node:test` + `supertest`, 28 verificações).

```bash
docker compose up -d db   # os testes rodam no host, não no container
npm test
```

Os testes **não** rodam dentro da imagem: o `Dockerfile` instala com
`--omit=dev`, então o `supertest` não existe no container. Suba só o banco e
execute `npm test` na máquina.

## Estrutura

```
docker-compose.yml
database/init.sql              contrato de schema e seeds (DAS §5)
database/00-grants.sql         privilégios para o /api/reset rodar como lab_user
src/server.js                  bootstrap, espera o MySQL, shutdown gracioso
src/app.js                     composição do Express
src/config/database.js         pool; multipleStatements só na conexão de reset
src/middleware/mode.js         contrato do cookie lab_mode
src/middleware/errorHandler.js erro didático (vuln) x genérico (safe)
src/routes/                    bancoRoutes, receitasRoutes, labRoutes
src/repositories/              SQL: interpolado (vuln) x parametrizado (safe)
src/public/banco/              cenários 1 a 3
src/public/receitas/           cenário 4 (sink XSS)
src/public/css/lab.css         CSS próprio, sem CDN — o lab roda offline
src/public/js/lab.js           modo, reset, roteiros clicáveis
tests/                         T01–T09
```

O CSS é escrito à mão e não usa Tailwind nem CDN de propósito: o laboratório roda
em rede isolada e precisa funcionar sem internet no projetor.

## O que este laboratório ensina

| Vulnerabilidade | Mitigação aplicada no modo seguro |
| --- | --- |
| SQLi UNION | prepared statement — separa código de valor |
| SQLi por erro | prepared statement + log interno e mensagem genérica |
| SQLi cega | parametrização **e** validação de formato |
| XSS armazenado | `textContent` em vez de `innerHTML` |
