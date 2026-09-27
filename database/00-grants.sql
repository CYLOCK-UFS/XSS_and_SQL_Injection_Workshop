-- =============================================================================
-- Permissoes do usuario de aplicacao (DAS v2.2, secao 7)
-- =============================================================================
-- Este arquivo e executado pelo entrypoint do MySQL ANTES do 01-init.sql.
-- O POST /api/reset reexecuta o init.sql inteiro, o que inclui
-- "CREATE DATABASE IF NOT EXISTS lab_palestra" e DROP/CREATE de todas as
-- tabelas. Sem estas grants o reset falharia com acesso negado, porque o
-- usuario criado por MYSQL_USER so recebe privilegios sobre lab_palestra.*.
--
-- Escopo restrito de proposito: apenas lab_palestra.* mais o privilegio
-- global CREATE, exigido pelo CREATE DATABASE do init.sql.
-- Ambiente academico isolado, dados sinteticos.
-- =============================================================================

GRANT ALL PRIVILEGES ON lab_palestra.* TO 'lab_user'@'%';
GRANT CREATE ON *.* TO 'lab_user'@'%';
FLUSH PRIVILEGES;
