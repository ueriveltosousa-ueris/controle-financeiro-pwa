// js/db.js — abre (ou cria) o banco SQLite local, guardado no IndexedDB do
// navegador (nada sai do aparelho, nada depende de servidor). Usa sql.js
// (SQLite compilado para WebAssembly) — script clássico, sem módulos.
//
// Estratégia de persistência: o sql.js mantém o banco inteiro em memória
// durante a sessão; a cada gravação, exportamos os bytes (db.export()) e
// salvamos no IndexedDB. Como as gravações aqui são sempre ações humanas
// (clicar em salvar/pagar/excluir), não uma escrita em loop, isso é rápido
// o bastante sem precisar de OPFS/Worker.
//
// PRAGMA user_version guarda a versão do schema/views já aplicada nesse
// banco salvo — permite reaplicar só as VIEWS (DROP+CREATE, não mexe em
// dado) quando o código deste app evoluir, sem tocar no schema.sql
// (que tem DROP TABLE e só pode rodar num banco novo).

const CHAVE_INDEXEDDB = 'financeiro-sqlite-v1';
const NOME_ARQUIVO_DB = 'db';
const NOME_METADADOS = 'meta';
// v2 passou a cobrir não só as views como também a migração de schema das
// bases editáveis (Grupo de Despesa / Tipo de Despesa / Forma de Pagamento).
// v3: Tipo de Despesa deixa de exigir um Grupo fixo — o grupo passa a ser
// escolhido livremente em cada lançamento (compras.grupo_despesa_id).
// v4: vw_resumo_por_compra trocou JOIN por LEFT JOIN em formas_pagamento —
// uma compra com cartao_id inválido/órfão (ex.: sobra de uma migração antiga)
// sumia inteira da tabela "Resumo por compra" em vez de só aparecer com
// forma de pagamento em branco, causando totais divergentes de outras telas
// (ex.: Projeção) que somam direto de "parcelas", sem esse JOIN.
// v5: vw_projecao_mensal deixa de filtrar status = 'Pendente' — o gráfico
// "Projeção dos próximos 24 meses" passa a mostrar o valor TOTAL de cada mês
// (pago + pendente); marcar uma parcela como paga não pode mais "sumir" com
// o gasto daquele mês nesse gráfico. Os cards do topo e os gráficos "Em
// Aberto" continuam olhando só o pendente, de propósito.
// v6: vw_resumo_por_compra ganha proximo_vencimento (MIN da data de
// vencimento entre as parcelas pendentes da compra) — usado pra padronizar
// as tabelas de compras com uma coluna "Data de Vencimento" ao lado de
// "Data da Compra".
const VERSAO_ATUAL_VIEWS = 6;

let SQL = null;   // módulo sql.js carregado (initSqlJs())
let db = null;    // instância do banco (SQL.Database)

function abrirIndexedDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CHAVE_INDEXEDDB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(chave) {
  const conexao = await abrirIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = conexao.transaction('kv', 'readonly');
    const req = tx.objectStore('kv').get(chave);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(chave, valor) {
  const conexao = await abrirIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = conexao.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(valor, chave);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function buscarTexto(caminho) {
  const resp = await fetch(caminho);
  if (!resp.ok) throw new Error('Não consegui carregar ' + caminho);
  return resp.text();
}

// Salva o estado atual do banco no IndexedDB. Chamada ao final de toda
// operação que grava dado (ver dados.js).
async function salvarBanco() {
  const bytes = db.export();
  await idbSet(NOME_ARQUIVO_DB, bytes);
}

async function obterMetadados() {
  const m = await idbGet(NOME_METADADOS);
  return m || { ultimoBackupExportadoEm: null };
}

async function salvarMetadados(meta) {
  await idbSet(NOME_METADADOS, meta);
}

// Roda um bloco de operações numa transação SQLite. sql.js não tem um
// helper .transaction() pronto (nem node:sqlite tem) — BEGIN/COMMIT/ROLLBACK
// manual, igual à versão servidor.
function transacao(fn) {
  db.exec('BEGIN');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function versaoViewsAtual() {
  const r = db.exec('PRAGMA user_version');
  return r.length ? r[0].values[0][0] : 0;
}

function tabelaExiste(nome) {
  return !!primeiraLinha("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [nome]);
}
function colunaExiste(tabela, coluna) {
  return todasLinhas('PRAGMA table_info(' + tabela + ')').some((c) => c.name === coluna);
}

// Migra as tabelas antigas ("cartoes", "categorias") para a nova estrutura em
// 3 bases editáveis (Grupo de Despesa > Tipo de Despesa, e Forma de
// Pagamento) SEM apagar nenhum dado — só renomeia e completa o que faltar.
// Idempotente: cada passo confere antes de agir, seguro rodar de novo (e é
// um no-op numa instalação nova, onde schema.sql já cria os nomes certos).
function migrarParaBasesEditaveis() {
  if (tabelaExiste('cartoes') && !tabelaExiste('formas_pagamento')) {
    db.exec('ALTER TABLE cartoes RENAME TO formas_pagamento');
  }
  if (!tabelaExiste('grupos_despesa')) {
    db.exec('CREATE TABLE grupos_despesa (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL UNIQUE)');
  }
  if (tabelaExiste('categorias') && !tabelaExiste('tipos_despesa')) {
    db.exec('ALTER TABLE categorias RENAME TO tipos_despesa');
  }
  if (!tabelaExiste('tipos_despesa')) {
    db.exec('CREATE TABLE tipos_despesa (id INTEGER PRIMARY KEY AUTOINCREMENT, grupo_id INTEGER, nome TEXT NOT NULL)');
  }
  if (!colunaExiste('tipos_despesa', 'grupo_id')) {
    db.exec('ALTER TABLE tipos_despesa ADD COLUMN grupo_id INTEGER REFERENCES grupos_despesa(id)');
  }
  // grupo_despesa_id: o Grupo de cada despesa agora é escolhido livremente no
  // lançamento (independente do Tipo de Despesa escolhido — Tipo deixou de
  // exigir um Grupo fixo). Não reatribui mais tipo_despesa.grupo_id órfão a
  // "Outros": grupo_id NULO num tipo agora é normal, não sobra de migração.
  if (tabelaExiste('compras') && !colunaExiste('compras', 'grupo_despesa_id')) {
    db.exec('ALTER TABLE compras ADD COLUMN grupo_despesa_id INTEGER REFERENCES grupos_despesa(id)');
  }
}

const GRUPOS_TIPOS_PADRAO = {
  'Alimentação': ['Supermercado', 'Restaurantes'],
  'Transporte': ['Combustível', 'Transporte por aplicativo'],
  'Moradia': ['Aluguel/Financiamento', 'Energia Elétrica', 'Água', 'Internet'],
  'Saúde': ['Medicamentos', 'Plano de Saúde', 'Consultas e Exames'],
  'Educação': ['Mensalidade', 'Cursos'],
  'Lazer': ['Assinaturas e Streaming', 'Viagens'],
  'Outros': ['Outros'],
};
const FORMAS_PAGAMENTO_PADRAO = ['Cartão de Crédito', 'Cartão de Débito', 'PIX', 'Boleto', 'Dinheiro'];

// Semeia exemplos só se a base estiver completamente vazia (instalação nova,
// ou 1ª vez que a migração roda numa instalação antiga sem nada cadastrado)
// — nunca duplica nem mexe se o usuário já tiver qualquer item próprio.
function semearBasesPadrao() {
  const nGrupos = primeiraLinha('SELECT COUNT(*) AS n FROM grupos_despesa').n;
  if (nGrupos === 0) {
    for (const grupo of Object.keys(GRUPOS_TIPOS_PADRAO)) {
      executar('INSERT INTO grupos_despesa (nome) VALUES (?)', [grupo]);
      const grupoId = ultimoIdInserido();
      for (const tipo of GRUPOS_TIPOS_PADRAO[grupo]) {
        executar('INSERT INTO tipos_despesa (grupo_id, nome) VALUES (?, ?)', [grupoId, tipo]);
      }
    }
  }
  const nFormas = primeiraLinha('SELECT COUNT(*) AS n FROM formas_pagamento').n;
  if (nFormas === 0) {
    for (const nome of FORMAS_PAGAMENTO_PADRAO) {
      executar('INSERT INTO formas_pagamento (nome) VALUES (?)', [nome]);
    }
  }
}

// O banco está no formato que este código espera? Confere as TABELAS de
// verdade, não só o PRAGMA user_version: um backup restaurado traz junto o
// user_version que ele tinha, e um banco pode acabar com a versão "nova" mas
// as tabelas antigas. Checar a estrutura real deixa isso auto-corrigível.
function bancoPrecisaPreparo() {
  return versaoViewsAtual() < VERSAO_ATUAL_VIEWS
    || !tabelaExiste('formas_pagamento')
    || !tabelaExiste('grupos_despesa')
    || !tabelaExiste('tipos_despesa')
    || !colunaExiste('compras', 'grupo_despesa_id');
}

// Põe um banco já existente no formato atual: migra as tabelas, recria as
// views e carimba a versão. Idempotente — roda no carregamento e também
// depois de restaurar um backup (que pode ser de uma versão bem antiga).
async function prepararBancoExistente() {
  const semear = versaoViewsAtual() < VERSAO_ATUAL_VIEWS;
  transacao(() => {
    migrarParaBasesEditaveis();
    // Só semeia exemplos quando o banco ainda não tinha passado por esta
    // versão — não repovoa bases que o usuário esvaziou de propósito.
    if (semear) semearBasesPadrao();
  });
  const views = await buscarTexto('db/views.sql');
  db.exec(views);
  db.exec('PRAGMA user_version = ' + VERSAO_ATUAL_VIEWS);
  await salvarBanco();
}

async function inicializarBanco() {
  SQL = await initSqlJs({ locateFile: (f) => 'vendor/sqljs/' + f });

  const bytesSalvos = await idbGet(NOME_ARQUIVO_DB);
  if (bytesSalvos) {
    db = new SQL.Database(new Uint8Array(bytesSalvos));
    db.exec('PRAGMA foreign_keys = ON;');
    if (bancoPrecisaPreparo()) await prepararBancoExistente();
    return { criadoAgora: false };
  }

  db = new SQL.Database();
  db.exec('PRAGMA foreign_keys = ON;');
  const [schema, views] = await Promise.all([buscarTexto('db/schema.sql'), buscarTexto('db/views.sql')]);
  db.exec(schema);
  db.exec(views);
  semearBasesPadrao();
  db.exec('PRAGMA user_version = ' + VERSAO_ATUAL_VIEWS);
  await salvarBanco();
  return { criadoAgora: true };
}

// ---- helpers de consulta (sql.js devolve resultados num formato
// colunas+linhas; converte pra array de objetos, como o driver do node:sqlite) ----
function todasLinhas(sql, params) {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  const linhas = [];
  while (stmt.step()) linhas.push(stmt.getAsObject());
  stmt.free();
  return linhas;
}

function primeiraLinha(sql, params) {
  const linhas = todasLinhas(sql, params);
  return linhas.length ? linhas[0] : undefined;
}

function executar(sql, params) {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  stmt.step();
  stmt.free();
  return { changes: db.getRowsModified() };
}

function ultimoIdInserido() {
  return primeiraLinha('SELECT last_insert_rowid() AS id').id;
}

// Gera um arquivo .sqlite (bytes reais, abre em qualquer programa de SQLite)
// para download — backup manual do usuário.
function exportarBytes() {
  return db.export();
}

// Substitui o banco atual pelos bytes de um backup importado.
// O backup pode ter sido gerado por uma versão bem mais antiga do app, então
// passa pela mesma migração/recriação de views do carregamento normal — sem
// isso o app fica rodando código novo sobre tabelas antigas (ex.: consultas
// que fazem JOIN em formas_pagamento quebravam com "no such table").
async function importarBytes(bytes) {
  db = new SQL.Database(new Uint8Array(bytes));
  db.exec('PRAGMA foreign_keys = ON;');
  if (bancoPrecisaPreparo()) await prepararBancoExistente();
  else await salvarBanco();
}
