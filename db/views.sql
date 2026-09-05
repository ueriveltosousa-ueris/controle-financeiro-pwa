/* =====================================================================
   CONTROLE FINANCEIRO v2 — SQLite
   Script 02 — VIEWS (reproduzem o Dashboard em SQL)
   Executar depois de schema.sql.

   MODELO SIMPLIFICADO: tudo é COMPRA (com 1 ou mais parcelas).
     - Compra À Vista   = compra com 1 parcela
     - Compra Parcelada = compra com N parcelas

   Todos os valores monetários são expostos em CENTAVOS (INTEGER), iguais
   ao armazenamento — a conversão para reais (/100.0) é feita na API/tela.
   As views recalculam sozinhas com base em date('now','localtime')
   (data de hoje no fuso horário local do PC do usuário).

   vw_resumo_por_compra inclui data_compra e qtd_parcelas_pagas, e vw_kpis
   inclui a quebra parcelado/à vista do "a vencer no próximo mês" — campos
   que a tela (index.html) já lê, mas que a view original em SQL Server
   nunca chegou a calcular (ficavam sempre em branco/zero).
   ===================================================================== */

DROP VIEW IF EXISTS vw_kpis;
DROP VIEW IF EXISTS vw_resumo_por_compra;
DROP VIEW IF EXISTS vw_saldo_por_cartao;
DROP VIEW IF EXISTS vw_saldo_por_categoria;
DROP VIEW IF EXISTS vw_projecao_mensal;

/* KPIs do topo do Dashboard.
   - total_em_aberto: TUDO que ainda está pendente (vencido ou não).
   - total_pago: soma do que já foi pago.
   - total_aberto_nao_vencido: do que está em aberto, só o que AINDA NÃO venceu.
   - a_vencer_proximo_mes: soma do que vence no MÊS CALENDÁRIO seguinte ao atual
     (ex.: hoje em agosto/2026 -> soma tudo com vencimento em setembro/2026). */
CREATE VIEW vw_kpis AS
SELECT
    (SELECT IFNULL(SUM(valor_centavos),0) FROM parcelas WHERE status = 'Pendente')
        AS total_em_aberto_centavos,
    (SELECT IFNULL(SUM(valor_centavos),0) FROM parcelas WHERE status = 'Pago')
        AS total_pago_centavos,
    (SELECT IFNULL(SUM(valor_centavos),0) FROM parcelas WHERE status = 'Pendente'
        AND data_vencimento >= date('now','localtime'))
        AS total_aberto_nao_vencido_centavos,
    (SELECT IFNULL(SUM(valor_centavos),0) FROM parcelas WHERE status = 'Pendente'
        AND data_vencimento >= date('now','localtime','start of month','+1 month')
        AND data_vencimento <  date('now','localtime','start of month','+2 month'))
        AS a_vencer_proximo_mes_centavos,
    (SELECT IFNULL(SUM(p.valor_centavos),0) FROM parcelas p JOIN compras c ON c.id = p.compra_id
        WHERE p.status = 'Pendente' AND c.qtd_parcelas > 1
        AND p.data_vencimento >= date('now','localtime','start of month','+1 month')
        AND p.data_vencimento <  date('now','localtime','start of month','+2 month'))
        AS a_vencer_proximo_mes_parcelado_centavos,
    (SELECT IFNULL(SUM(p.valor_centavos),0) FROM parcelas p JOIN compras c ON c.id = p.compra_id
        WHERE p.status = 'Pendente' AND c.qtd_parcelas = 1
        AND p.data_vencimento >= date('now','localtime','start of month','+1 month')
        AND p.data_vencimento <  date('now','localtime','start of month','+2 month'))
        AS a_vencer_proximo_mes_avista_centavos;

/* Resumo por compra (parceladas e à vista) */
CREATE VIEW vw_resumo_por_compra AS
SELECT
    c.id                                                                          AS compra_id,
    c.descricao,
    c.data_compra,
    ca.nome                                                                       AS cartao,
    cat.nome                                                                      AS categoria,
    c.valor_total_centavos,
    c.qtd_parcelas,
    COUNT(CASE WHEN p.status = 'Pago' THEN 1 END)                                 AS qtd_parcelas_pagas,
    IFNULL(SUM(CASE WHEN p.status = 'Pago'     THEN p.valor_centavos END),0)      AS total_pago_centavos,
    IFNULL(SUM(CASE WHEN p.status = 'Pendente' THEN p.valor_centavos END),0)      AS saldo_aberto_centavos,
    CASE WHEN IFNULL(SUM(p.valor_centavos),0) = 0 THEN 0.0
         ELSE CAST(SUM(CASE WHEN p.status = 'Pago' THEN p.valor_centavos ELSE 0 END) AS REAL)
              / SUM(p.valor_centavos)
    END                                                                           AS pct_concluido,
    CASE WHEN IFNULL(SUM(CASE WHEN p.status = 'Pendente' THEN p.valor_centavos END),0) = 0
         THEN 'Quitada' ELSE 'Em Aberto' END                                      AS situacao
FROM compras c
LEFT JOIN formas_pagamento ca ON ca.id  = c.cartao_id
LEFT JOIN tipos_despesa cat ON cat.id = c.categoria_id
LEFT JOIN parcelas p     ON p.compra_id = c.id
GROUP BY c.id, c.descricao, c.data_compra, ca.nome, cat.nome, c.valor_total_centavos, c.qtd_parcelas;

/* Saldo em aberto por forma de pagamento */
CREATE VIEW vw_saldo_por_cartao AS
SELECT
    ca.nome AS cartao,
    IFNULL((SELECT SUM(p.valor_centavos)
            FROM parcelas p JOIN compras c ON c.id = p.compra_id
            WHERE c.cartao_id = ca.id AND p.status = 'Pendente'),0)               AS parcelado_pendente_centavos,
    IFNULL((SELECT SUM(p.valor_centavos)
            FROM parcelas p JOIN compras c ON c.id = p.compra_id
            WHERE c.cartao_id = ca.id AND p.status = 'Pendente'
              AND p.data_vencimento < date('now','localtime')),0)                 AS parcelas_atraso_centavos
FROM formas_pagamento ca;

/* Saldo em aberto por tipo de despesa */
CREATE VIEW vw_saldo_por_categoria AS
SELECT
    cat.nome AS categoria,
    IFNULL((SELECT SUM(p.valor_centavos)
            FROM parcelas p JOIN compras c ON c.id = p.compra_id
            WHERE c.categoria_id = cat.id AND p.status = 'Pendente'),0)           AS parcelado_pendente_centavos
FROM tipos_despesa cat;

/* Projeção dos próximos 24 meses (TODAS as parcelas do mês, pagas ou não —
   pagar uma parcela não pode "sumir" com o gasto do mês nesse gráfico;
   quem quer só o que falta pagar usa os gráficos "Em Aberto" ou os cards do
   Dashboard, que continuam olhando só status = 'Pendente'). */
CREATE VIEW vw_projecao_mensal AS
WITH RECURSIVE meses(mes, n) AS (
    SELECT date('now','localtime','start of month'), 0
    UNION ALL
    SELECT date(mes,'+1 month'), n + 1 FROM meses WHERE n < 23
),
calc AS (
    SELECT
        m.mes,
        IFNULL((SELECT SUM(p.valor_centavos)
                FROM parcelas p
                WHERE p.data_vencimento >= m.mes
                  AND p.data_vencimento <  date(m.mes,'+1 month')),0)             AS parcelas_total_centavos
    FROM meses m
)
SELECT
    mes,
    parcelas_total_centavos,
    SUM(parcelas_total_centavos) OVER (ORDER BY mes ROWS UNBOUNDED PRECEDING)     AS acumulado_centavos
FROM calc;
