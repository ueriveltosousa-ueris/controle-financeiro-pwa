# Controle Financeiro — PWA

Controle de compras parceladas e à vista por cartão de crédito, com dashboard, gráficos e orçamento mensal.

**100% local**: o banco de dados (SQLite, via [sql.js](https://github.com/sql-js/sql.js)) roda inteiro dentro do seu navegador e fica salvo no armazenamento do próprio aparelho (IndexedDB). Não existe servidor, não existe login, nenhum dado sai do seu computador ou celular.

## Usar

Abra o link do GitHub Pages deste repositório no navegador (Chrome, Edge, Safari) — em qualquer computador ou celular (Android/iOS). No menu do navegador, use **"Adicionar à Tela de Início"** (celular) ou **"Instalar app"** (desktop) para instalar como um aplicativo normal, com ícone próprio, funcionando offline depois da primeira vez.

## Backup

Como todo dado fica só no seu aparelho, use os botões **💾 Backup** (baixa um arquivo `.sqlite`) e **📂 Restaurar** periodicamente — principalmente em iPhone, onde o navegador pode apagar dados de apps sob pressão de armazenamento do aparelho.

## Desenvolvimento

Arquivos estáticos puros (sem build). Para rodar localmente, sirva a pasta por HTTP (Service Worker exige http/https, não funciona abrindo o `index.html` direto como arquivo):

```bash
npx serve .
```

Schema e regras de negócio em [db/schema.sql](db/schema.sql), [db/views.sql](db/views.sql) e [js/datas.js](js/datas.js).
