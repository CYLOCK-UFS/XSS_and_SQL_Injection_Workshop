-- =============================================================================
-- Lab FinBank & ChefLab - carga inicial (DAS v2.2, secao 5)
-- =============================================================================
-- ATENCAO: banco com dados EXCLUSIVAMENTE SINTETICOS, para uso em ambiente
-- academico isolado. Nao publicar este laboratorio em redes expostas.
--
-- Este arquivo e o contrato do laboratorio:
--   * e executado na primeira criacao do volume pelo entrypoint do MySQL;
--   * e reexecutado pela rota POST /api/reset (secao 7 do DAS).
-- Nao altere os nomes de tabelas/colunas sem atualizar o DAS.
-- =============================================================================

CREATE DATABASE IF NOT EXISTS lab_palestra
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;

USE lab_palestra;

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS comentarios_receita;
DROP TABLE IF EXISTS extratos;
DROP TABLE IF EXISTS noticias;
DROP TABLE IF EXISTS clientes;
DROP TABLE IF EXISTS administradores;
DROP TABLE IF EXISTS cartoes_credito;
DROP TABLE IF EXISTS agencias;

SET FOREIGN_KEY_CHECKS = 1;

-- -----------------------------------------------------------------------------
-- agencias: filtro por cidade. A consulta publica de /banco/agencias retorna
-- nome_agencia, endereco, telefone e gerente (4 colunas = oráculo do UNION).
-- -----------------------------------------------------------------------------
CREATE TABLE agencias (
  id_agencia     VARCHAR(20)  NOT NULL,
  nome_agencia   VARCHAR(100) NOT NULL,
  endereco       VARCHAR(150) NOT NULL,
  telefone       VARCHAR(30)  NOT NULL,
  gerente        VARCHAR(80)  NOT NULL,
  cidade         VARCHAR(60)  NOT NULL,
  PRIMARY KEY (id_agencia),
  KEY idx_agencias_cidade (cidade)
) ENGINE=InnoDB;

INSERT INTO agencias
  (id_agencia, nome_agencia, endereco, telefone, gerente, cidade)
VALUES
  ('001', 'FinBank Agencia Centro',     'Rua das Flores, 120 - Centro',      '(11) 4002-8922', 'Ana Ribeiro',      'Sao Paulo'),
  ('002', 'FinBank Agencia Jardins',    'Al. dos Ipês, 45 - Jardins',        '(11) 3555-1043', 'Bruno Tavares',     'Sao Paulo'),
  ('003', 'FinBank Agencia Ipanema',    'Av. Atlantica, 900 - Ipanema',      '(21) 2701-5566', 'Camila Doria',     'Rio de Janeiro'),
  ('004', 'FinBank Agencia Copacabana', 'Rua Barao de Capanema, 30',          '(21) 2547-8890', 'Diego Nogueira',    'Rio de Janeiro'),
  ('005', 'FinBank Agencia Recife',     'Av. Boa Viagem, 1500 - Boa Viagem', '(81) 3222-7070', 'Elisa Maranhão',   'Recife'),
  ('006', 'FinBank Agencia Salvador',   'Av. Afonso Pena, 300 - Centro',     '(71) 3322-4410', 'Fabio Nunes',       'Salvador'),
  ('007', 'FinBank Agencia Campinas',   'Rua Barao de Jaguara, 77',          '(19) 3232-1180', 'Gabriela Prado',    'Campinas'),
  ('008', 'FinBank Agencia Curitiba',   'Rua Sete de Setembro, 450 - Centro','(41) 3012-6600', 'Henrique Sales',    'Curitiba'),
  ('009', 'FinBank Agencia Porto Alegre','Av. Liberdade, 1200 - Santana',     '(51) 3011-2244', 'Isabela Castro',    'Porto Alegre'),
  ('010', 'FinBank Agencia Belo Horizonte','Av. Afonso Pena, 1400 - Centro',  '(31) 3011-8877', 'Joao Pedro Lima',   'Belo Horizonte');

-- -----------------------------------------------------------------------------
-- cartoes_credito: alvo didatico de leitura do cenario UNION (4 colunas:
-- titular, numero_cartao, cvv, validade). Todos os dados sao ficticios e nao
-- corresponden a cartoes reais.
-- -----------------------------------------------------------------------------
CREATE TABLE cartoes_credito (
  id_cartao    VARCHAR(20)  NOT NULL,
  titular      VARCHAR(100) NOT NULL,
  numero_cartao VARCHAR(30) NOT NULL,
  cvv          VARCHAR(10)  NOT NULL,
  validade     VARCHAR(15)  NOT NULL,
  PRIMARY KEY (id_cartao)
) ENGINE=InnoDB;

INSERT INTO cartoes_credito
  (id_cartao, titular, numero_cartao, cvv, validade)
VALUES
  ('CC001', 'Ana Ribeiro',     '0000 0000 0000 0001', '123', '12/29'),
  ('CC002', 'Bruno Tavares',    '0000 0000 0000 0002', '456', '11/29'),
  ('CC003', 'Camila Doria',    '0000 0000 0000 0003', '789', '10/29'),
  ('CC004', 'Diego Nogueira',   '0000 0000 0000 0004', '321', '09/29'),
  ('CC005', 'Elisa Maranhao',   '0000 0000 0000 0005', '654', '08/29'),
  ('CC006', 'Fabio Nunes',     '0000 0000 0000 0006', '987', '07/29');

-- -----------------------------------------------------------------------------
-- administradores: artefato didatico do cenario 2 (SQLi baseada em erro).
-- senha_hash guarda o SHA-256 da senha sintetica de laboratorio.
-- A coluna senha (texto puro) existe APENAS para permitir a extracao didatica
-- via EXTRACTVALUE; senha em texto puro nao representa pratica real de seguranca.
-- -----------------------------------------------------------------------------
CREATE TABLE administradores (
  id_admin   VARCHAR(20)  NOT NULL,
  username   VARCHAR(50)  NOT NULL,
  senha_hash VARCHAR(100) NOT NULL,
  senha      VARCHAR(50)  NOT NULL,
  PRIMARY KEY (id_admin)
) ENGINE=InnoDB;

INSERT INTO administradores
  (id_admin, username, senha_hash, senha)
VALUES
  ('1', 'admin',    '36bbe50ed96841d10443bcb670d6554f0a34b761be67ec9c4a8ad2c0c44ca42c', 'abcde'),
  ('2', 'suporte',  'a36cac71d1a44a1593a22d98403455bd2d6f737e465c4cf3fcead29381a08335', 'segredo');

-- -----------------------------------------------------------------------------
-- clientes: dados complementares, todos sinteticos. numero_telefone e
-- saldo_conta sao VARCHAR de proposito (tipos simplificados para o laboratorio).
-- -----------------------------------------------------------------------------
CREATE TABLE clientes (
  id_cliente      VARCHAR(20)  NOT NULL,
  nome            VARCHAR(100) NOT NULL,
  cpf             VARCHAR(20)  NOT NULL,
  numero_telefone VARCHAR(30)  NOT NULL,
  saldo_conta     VARCHAR(30)  NOT NULL,
  PRIMARY KEY (id_cliente)
) ENGINE=InnoDB;

INSERT INTO clientes
  (id_cliente, nome, cpf, numero_telefone, saldo_conta)
VALUES
  ('CLI001', 'Ana Ribeiro',     '111.111.111-11', '(11) 98888-0001', 'R$ 12.450,00'),
  ('CLI002', 'Bruno Tavares',    '222.222.222-22', '(11) 98888-0002', 'R$ 3.120,50'),
  ('CLI003', 'Camila Doria',    '333.333.333-33', '(21) 98888-0003', 'R$ 45.900,00'),
  ('CLI004', 'Diego Nogueira',   '444.444.444-44', '(21) 98888-0004', 'R$ 780,00'),
  ('CLI005', 'Elisa Maranhao',   '555.555.555-55', '(81) 98888-0005', 'R$ 22.310,75'),
  ('CLI006', 'Fabio Nunes',     '666.666.666-66', '(71) 98888-0006', 'R$ 8.045,10');

-- -----------------------------------------------------------------------------
-- extratos: suporte a rota /banco/extrato. id_conta referencia clientes.id_cliente
-- apenas para fins de demonstracao (sem FK para manter o laboratorio simples).
-- -----------------------------------------------------------------------------
CREATE TABLE extratos (
  id_lancamento    VARCHAR(20)  NOT NULL,
  id_conta         VARCHAR(20)  NOT NULL,
  descricao        VARCHAR(100) NOT NULL,
  valor            VARCHAR(30)  NOT NULL,
  data_lancamento  VARCHAR(20)  NOT NULL,
  PRIMARY KEY (id_lancamento),
  KEY idx_extratos_id_conta (id_conta)
) ENGINE=InnoDB;

INSERT INTO extratos
  (id_lancamento, id_conta, descricao, valor, data_lancamento)
VALUES
  ('L001', 'CLI001', 'Credito mensal',        'R$ 5.000,00',  '2024-01-05'),
  ('L002', 'CLI001', 'Compra mercado',         '-R$ 389,90',  '2024-01-08'),
  ('L003', 'CLI001', 'Transferencia recebida', 'R$ 1.200,00',  '2024-01-12'),
  ('L004', 'CLI002', 'Pagamento cartao',       '-R$ 799,00',  '2024-01-06'),
  ('L005', 'CLI002', 'Saque em caixa',         '-R$ 200,00',  '2024-01-15'),
  ('L006', 'CLI003', 'Credito anual',          'R$ 30.000,00', '2024-01-02'),
  ('L007', 'CLI003', 'Assinatura streaming',    '-R$ 55,90',   '2024-01-09'),
  ('L008', 'CLI004', 'Tarifa mensal',           '-R$ 29,90',   '2024-01-10'),
  ('L009', 'CLI005', 'Venda registrada',        'R$ 2.150,00', '2024-01-11'),
  ('L010', 'CLI006', 'Empresto contratado',     'R$ 5.000,00', '2024-01-17');

-- -----------------------------------------------------------------------------
-- noticias: oraculo booleano (inferencial) da rota /banco/noticia.
-- id = '5' e o registro-base usado no roteiro de demonstracao.
-- -----------------------------------------------------------------------------
CREATE TABLE noticias (
  id               VARCHAR(20)  NOT NULL,
  titulo           VARCHAR(150) NOT NULL,
  conteudo         TEXT         NOT NULL,
  data_publicacao  VARCHAR(20)  NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB;

INSERT INTO noticias (id, titulo, conteudo, data_publicacao) VALUES
  ('1', 'FinBank anuncia nova linha de credito',
       'O FinBank lancerou uma linha de credito com taxa reduzida para clientes pessoa juridica.', '2024-01-05'),
  ('2', 'FinBank amplia horario de atendimento',
       'As agencias do FinBank passam a atender ate as 20h durante a semana.', '2024-01-08'),
  ('3', 'Aplicativo FinBank passa a oferecer comprovante digital',
       'O aplicativo FinBank agora emite comprovantes em PDF para todas as transacoes.', '2024-01-09'),
  ('4', 'FinBank investe em seguranca da informacao',
       'O banco destinou recursos para auditorias independentes e umaouvidoria de dados.', '2024-01-10'),
  ('5', 'FinBank instala ATMs nas principais cidades',
       'A rede de caixas eletronicos do FinBank cresce com a instalacao de 40 novos equipamentos em cidades do Sudeste. Clientes podem sacar ate R$ 2.000 por transacao.',
       '2024-01-11'),
  ('6', 'FinBank cria programa de estagio em tecnologia',
       'O programa recebe 60 estudantes por semestre em areas de desenvolvimento, dados e seguranca.',
       '2024-01-12'),
  ('7', 'FinBank moderniza o app com autenticacao em dois fatores',
       'A nova versao do aplicativo inclui autenticacao em dois fatores e notificacoes de movimentacao.',
       '2024-01-13'),
  ('8', 'FinBank adota atendimento digital nas secoes de atendimento',
       'O atendimento remoto foi ampliado e novos agendamentos podem ser feitos pelo aplicativo.',
       '2024-01-14');

-- -----------------------------------------------------------------------------
-- comentarios_receita: persistencia do ChefLab. O risco de XSS esta na
-- RENDERIZACAO DA SAIDA (src/public/receitas), nao no INSERT.
-- Os dois comentarios abaixo sao o estado inicial restaurado por /api/reset.
-- -----------------------------------------------------------------------------
CREATE TABLE comentarios_receita (
  id_comentario   INT AUTO_INCREMENT NOT NULL,
  nome_autor      VARCHAR(80) NOT NULL,
  texto_comentario TEXT        NOT NULL,
  data_postagem   DATETIME     NOT NULL,
  PRIMARY KEY (id_comentario)
) ENGINE=InnoDB;

INSERT INTO comentarios_receita (nome_autor, texto_comentario, data_postagem) VALUES
  ('Chef Ana',    'Molho branco de alho fica perfeito com massa fresca: deixo o caldo em fogo baixo.',
   '2024-01-10 18:30:00'),
  ('Chef Bruno',  'Use a agua do cozimento para finalizar o risoto: ela concentra todo o sabor.',
   '2024-01-11 19:45:00');

-- =============================================================================
-- Fim da carga inicial. Nenhum registro real de cliente e utilizada aqui.
-- =============================================================================
