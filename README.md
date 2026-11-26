# Listas (Vue)

Listas de propósito geral (compras, tarefas, desejos, lembretes), instalável como PWA.
Reescrita em Vue 3 + Vite do [listas-estatico](https://github.com/jooemanoel/listas-estatico) (Angular).
Os dados ficam na [listas-api](../listas-api), que é a única a falar com o Firestore.

## Comandos

```bash
npm install
npm run dev       # desenvolvimento (API em http://localhost:3000)
npm run build     # gera docs/ (publicado pelo GitHub Pages)
npm run icones    # gera favicon e ícones do PWA (public/icones) a partir do símbolo "checklist"
```

Para testar sem credenciais do Firebase, rode a API com dados em memória:
`cd ../listas-api && npm run dev:memoria`.

O endereço da API publicada fica em [.env.production](.env.production)
(`https://listas-api-plum.vercel.app`); ajuste se o projeto na Vercel tiver outro nome.

## Telas

A barra superior tem três botões com ícones, no lugar do antigo menu lateral:

| Ícone | Ação |
|---|---|
| `playlist_add` | Nova lista |
| `format_list_bulleted` | Minhas listas |
| `logout` | Sair |

- **Minhas listas**: nome e número de itens; tocar abre a lista, a lixeira exclui a lista com todos os itens (com confirmação).
- **Lista**: campo fixo no topo para adicionar (Enter adiciona e mantém o foco para o próximo item); não há marcação: o que foi resolvido (comprado, feito) é removido, e a lista mostra só o que está pendente. O botão de copiar gera o texto para colar no WhatsApp (título em negrito, um item por linha).
- **Listas de lembretes** (escolha o tipo ao criar a lista): cada item é um texto livre, guardado
  exatamente como foi colado (várias linhas, maiúsculas e minúsculas, emojis), até 3000
  caracteres. Serve para a mensagem de uma consulta marcada, um endereço, um recado. O campo
  cresce com o texto, tem botão de colar (quando o navegador permite) e Ctrl+Enter adiciona;
  lembretes longos aparecem recolhidos ("Mostrar tudo"); cada um pode ser copiado ou
  removido (com confirmação).
- A navegação usa o `#` do endereço (`#/`, `#/nova`, `#/lista/<id>`): o botão voltar do Android funciona e recarregar a página mantém a tela.

## Modo offline

O app funciona sem internet depois de ter sido aberto (e as listas carregadas) uma vez online.

- **Cópia no aparelho:** as listas, como o servidor as devolveu da última vez (cada uma com o
  seu `atualizadoEm`), ficam no `localStorage`, separadas por usuário. Ao abrir o app, essa
  cópia aparece na hora e depois é atualizada pelo servidor.
- **Fila de alterações (histórico):** criar/excluir lista e adicionar/remover item
  entram numa fila, com a hora da alteração e o `atualizadoEm` que o aparelho conhecia. A tela
  mostra a cópia do servidor com a fila aplicada por cima, então tudo responde na hora.
- **Online**, a fila é enviada logo em seguida (`POST /listas/sincronizar`).
  **Sem conexão** (ou sem resposta em 15 s), o app entra no modo offline: chip *Offline* na
  barra, cartão com o número de alterações guardadas, o histórico ("Ver alterações") e o aviso
  para **não alterar as listas em outro aparelho até sincronizar**.
- **Reconexão:** tenta de novo a cada 30 s, quando o navegador avisa que a rede voltou e ao
  voltar para o app (ou no botão *Tentar agora*). A API compara o `atualizadoEm` do Firestore
  com o da alteração; se a lista mudou em outro aparelho, as alterações daqui são aplicadas por
  cima, item a item, e o app avisa para conferir.
- **Data de atualização:** a tela da lista mostra quando ela foi atualizada no servidor, ou
  "alterada … · não sincronizada" enquanto houver alterações só neste aparelho.
- **Sair** apaga a cópia do aparelho (com confirmação se houver alterações não enviadas). Se a
  sessão só expirar, a cópia fica guardada e sincroniza quando a pessoa entrar de novo.
- As listas são de uso geral (compras, tarefas): por isso podem ficar guardadas no aparelho.
  Não use o app para dados sensíveis.

## Estrutura

```
public/sw.js                     service worker (cache dos arquivos do app, inclusive JS/CSS já na instalação; nunca da API)
public/manifest.webmanifest      PWA
scripts/gerar-icones.js          ícones a partir do Material Symbol "checklist"
src/services/api.js              chamadas à listas-api (token no cabeçalho Authorization)
src/composables/useSessao.js     token JWT e nome do usuário (localStorage)
src/composables/useListas.js     listas, cópia no aparelho, fila de alterações e sincronização (modo offline)
src/components/AvisoSincronizacao.vue  cartão do modo offline (pendências, histórico, alerta)
src/formatar.js                  datas ("hoje às 14:32")
src/composables/useRota.js       navegação por hash
src/composables/useAviso.js      mensagens no rodapé
src/components/                  barra superior, telas e ícones SVG
src/estilo.css                   todo o CSS (sem Bootstrap/Material); tema claro/escuro do sistema
```

## O que mudou em relação à versão Angular

| | Angular | Vue |
|---|---|---|
| Acesso aos dados | SDK do Firebase no navegador, banco aberto | só pela listas-api, com token |
| Login | baixava todos os usuários e senhas e comparava no navegador | feito na API (bcrypt); o navegador recebe só o token |
| Sessão no aparelho | usuário com senha em texto puro no `localStorage` | apenas o token assinado (e o nome para exibir) |
| Menu | hambúrguer com 3 opções | 3 botões de ícone na barra |
| Itens | identificados pelo nome; a lista inteira era regravada a cada clique | `id` próprio; cada ação altera só o necessário |
| Excluir lista | sem confirmação | pede confirmação |
| JS + CSS | Angular + Material + Bootstrap + Firebase | 39 KB + 3 KB (gzip) |
| Fontes externas | Roboto + Material Icons (Google Fonts) | nenhuma (fontes do sistema, ícones SVG) |
| Ícone | genérico | Material Symbol `checklist` |
