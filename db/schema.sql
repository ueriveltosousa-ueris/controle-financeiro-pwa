/* =====================================================================
   CONTROLE FINANCEIRO v2 — SQLite
   Script 01 — ESQUEMA (estrutura das tabelas)
   Ordem de execução: schema.sql -> views.sql -> (seed opcional)

   Equivalente ao esquema original em SQL Server (C:\portal_compras_db),
   adaptado às limitações/particularidades do SQLite:
     - Sem tipo DECIMAL nativo: valores monetários são guardados em
       CENTAVOS como INTEGER (evita erro de arredondamento em ponto
       flutuante). A conversão para reais (/100.0) é feita na camada
       de exibição (views/API/tela), nunca no armazenamento.
     - Datas guardadas como TEXT no formato ISO 'YYYY-MM-DD', compatível
       com as funções date()/julianday() do SQLite.
     - "recorrentes" foi deixado de fora: não tem tela no app (o modelo
       unificado é só "compras", com qtd_parcelas=1 cobrindo à vista).
   ===================================================================== */

PRAGMA foreign_keys = ON;

-- Remove as tabelas na ordem segura (filhas antes das pais), para
-- permitir rodar este script de novo sem erro.
DROP TABLE IF EXISTS parcelas;
DROP TABLE IF EXISTS compras;
DROP TABLE IF EXISTS orcamento_itens;
DROP TABLE IF EXISTS cartoes;
DROP TABLE IF EXISTS categorias;

-- 1) Tabelas de referência -------------------------------------------------

-- Categorias de GASTO (ex.: Alimentação, Transporte, Lazer) — não confundir
-- com "cartões", que são as categorias de DESPESA/forma de pagamento abaixo.
CREATE TABLE categorias (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL UNIQUE
);

-- Categorias de despesa (antigo "cartões"): cartões de crédito E outras
-- formas de pagamento (PIX, débito à vista) numa única tabela.
-- dia_vencimento NULO = sem fatura; o vencimento é a própria data da despesa.
CREATE TABLE cartoes (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    nome           TEXT NOT NULL UNIQUE,
    dia_fechamento INTEGER NULL CHECK (dia_fechamento IS NULL OR (dia_fechamento BETWEEN 1 AND 31)),
    dia_vencimento INTEGER NULL CHECK (dia_vencimento IS NULL OR (dia_vencimento BETWEEN 1 AND 31)),
    ativo          INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1))
);

-- 2) Tabelas principais -----------------------------------------------------

-- Cabeçalho da compra (à vista = qtd_parcelas 1; parcelada = qtd_parcelas > 1).
-- Não existem dois fluxos separados: é sempre uma "compra" com N parcelas.
CREATE TABLE compras (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    descricao            TEXT NOT NULL,
    cartao_id            INTEGER NOT NULL REFERENCES cartoes(id),
    categoria_id         INTEGER NULL REFERENCES categorias(id),
    valor_total_centavos INTEGER NOT NULL CHECK (valor_total_centavos >= 0),
    qtd_parcelas         INTEGER NOT NULL DEFAULT 1 CHECK (qtd_parcelas >= 1),
    data_compra          TEXT NOT NULL,   -- 'YYYY-MM-DD'; referência, não entra em cálculo de vencimento
    observacoes          TEXT NULL
);

-- Uma linha por parcela. FK com ON DELETE CASCADE: apagar a compra apaga as parcelas.
CREATE TABLE parcelas (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    compra_id       INTEGER NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
    num_parcela     INTEGER NOT NULL,
    valor_centavos  INTEGER NOT NULL CHECK (valor_centavos >= 0),
    data_vencimento TEXT NOT NULL,        -- 'YYYY-MM-DD'
    status          TEXT NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente','Pago')),
    data_pagamento  TEXT NULL,
    UNIQUE (compra_id, num_parcela)
);

-- Orçamento mensal com itens identificados (ex.: Salário, Freela, Economia).
-- ano_mes guarda sempre o dia 1 do mês ('YYYY-MM-01'); o total do mês é a
-- soma dos itens daquele mês — não existe um valor único de orçamento por mês.
CREATE TABLE orcamento_itens (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    ano_mes        TEXT NOT NULL,         -- 'YYYY-MM-01'
    descricao      TEXT NOT NULL,
    valor_centavos INTEGER NOT NULL CHECK (valor_centavos >= 0)
);

-- 3) Índices para acelerar os filtros mais usados pelas views/telas
CREATE INDEX IX_parcelas_status_venc ON parcelas(status, data_vencimento);
CREATE INDEX IX_parcelas_compra      ON parcelas(compra_id);
CREATE INDEX IX_compras_cartao       ON compras(cartao_id);
CREATE INDEX IX_compras_categoria    ON compras(categoria_id);
CREATE INDEX IX_orcamento_ano_mes    ON orcamento_itens(ano_mes);
