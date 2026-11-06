# Monitor externo do site

Este kit vigia o site da NYDROBS de fora, a cada 10 minutos. Se o site cair, abre uma "issue" no GitHub (o GitHub avisa o dono por e-mail). Quando o site volta, o monitor comenta e fecha a issue sozinho. Nunca abre duas issues para o mesmo problema.

## Como usar

1. Crie um repositório **público** novo no GitHub (repositórios públicos não gastam minutos do Actions).
2. Copie o conteúdo desta pasta (`check.mjs`, `sites.json`, `status.json`, `.github/`, `README.md`) para a raiz do repositório novo.
3. No GitHub, vá em Settings > Actions > General e deixe "Read and write permissions" ligado em Workflow permissions.
4. Em Actions, abra "Site monitor" e clique em "Run workflow" para testar.
5. Confira que as notificações por e-mail de Issues estão ligadas na sua conta (Settings > Notifications).

Não precisa de token pessoal nem de segredo: o monitor usa só o acesso automático que o GitHub dá ao repositório.

## Trocar os sites vigiados

Edite `sites.json`. Cada item tem `name`, `url` e `expectStatus` (o código esperado, normalmente 200).

## Detalhes

- Cada endereço é testado com limite de 15 segundos e uma segunda tentativa antes de ser dado como fora do ar.
- `status.json` guarda o último estado e é salvo quando algo muda e pelo menos uma vez por mês. Isso conta como atividade e evita que o GitHub desligue a rotina após 60 dias sem movimento.
- Para desligar: Actions > Site monitor > menu "..." > Disable workflow, ou apague o repositório.
