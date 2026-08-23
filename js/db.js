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
const VERSAO_ATUAL_VIEWS = 1;

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

async function inicializarBanco() {
  SQL = await initSqlJs({ locateFile: (f) => 'vendor/sqljs/' + f });

  const bytesSalvos = await idbGet(NOME_ARQUIVO_DB);
  if (bytesSalvos) {
    db = new SQL.Database(new Uint8Array(bytesSalvos));
    db.exec('PRAGMA foreign_keys = ON;');
    if (versaoViewsAtual() < VERSAO_ATUAL_VIEWS) {
      const views = await buscarTexto('db/views.sql');
      db.exec(views);
      db.exec('PRAGMA user_version = ' + VERSAO_ATUAL_VIEWS);
      await salvarBanco();
    }
    return { criadoAgora: false };
  }

  db = new SQL.Database();
  db.exec('PRAGMA foreign_keys = ON;');
  const [schema, views] = await Promise.all([buscarTexto('db/schema.sql'), buscarTexto('db/views.sql')]);
  db.exec(schema);
  db.exec(views);
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
async function importarBytes(bytes) {
  db = new SQL.Database(new Uint8Array(bytes));
  db.exec('PRAGMA foreign_keys = ON;');
  await salvarBanco();
}
