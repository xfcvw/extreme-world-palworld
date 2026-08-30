# Rastreador de atividade e decay

Registra entradas e saídas detectadas pela API nativa do Palworld. Ele não modifica o save, não concede itens e não precisa do PaluAdmin.

## Instalação em cada servidor

1. Copie a pasta `PlayerActivityTracker` para o computador do respectivo servidor.
2. Copie `config.example.ps1` para `config.ps1`.
3. Preencha o número do servidor, URL local da API, usuário, senha e a mesma chave usada pela ponte de entrega.
4. No PowerShell, abra a pasta e execute:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\PlayerActivityAgent.ps1
```

Deixe a janela aberta ou registre o script no Agendador de Tarefas do Windows. Execute uma cópia no Sem Wipe (`ServerNumber = 1`) e outra no Com Wipe (`ServerNumber = 2`).

## Como o painel calcula o aviso

- Sem Wipe: atenção após 48 h e crítico após 72 h.
- Com Wipe: atenção após 96 h e crítico após 120 h.

Na primeira inicialização, quem já estiver online aparece como **observado**. A hora exata de entrada passa a ser registrada a partir das próximas entradas detectadas, com precisão aproximada ao intervalo configurado (30 segundos por padrão).
