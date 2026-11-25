# Anectta MAIL Mobile (Android)

Cliente de e-mail do Anectta MAIL para celular. **Conexão direta**: o aparelho conversa com o servidor de e-mail do usuário (IMAP para ler, SMTP para enviar). Não existe servidor intermediário da Anectta.

- A senha de cada conta fica cifrada no **Android Keystore** (AES-256-GCM). Ela nunca sai do aparelho.
- O app funciona com qualquer provedor IMAP/SMTP, como Gmail, Outlook, Yahoo, iCloud, Locaweb, UOL, BOL, Terra, Zoho ou um servidor próprio.

## Estrutura

```
app/
  src/                      App (React 18 + Tailwind + Vite, dentro do Capacitor)
    native/anecttaMail.ts   Ponte para o motor nativo (+ caixa de demonstração no navegador)
    hooks/useMailbox.ts     Pastas, lista, carregar mais e ações (lido, estrela, arquivar, excluir)
    screens/                Cadastro de conta, caixa, leitura, escrever, configurações
    services/               Provedores conhecidos e armazenamento local (sem senha)
  android/app/src/main/java/com/anectta/mail/
    engine/                 Motor de e-mail em Java puro (Angus Mail): IMAP/SMTP
    plugin/                 Plugin Capacitor "AnecttaMail" + cofre de senhas (Keystore)
  android/app/src/test/     Testes do motor contra servidor IMAP/SMTP em memória (GreenMail)
```

## Desenvolvimento

```powershell
cd "C:\ANECTTA MAIL MOBILE\app"
npm.cmd install
npm.cmd run dev        # navegador: modo demonstração (sem IMAP real)
```

No navegador não existe IMAP. Por isso o app abre uma **caixa de demonstração** em memória, com qualquer e-mail e senha. No celular, a conexão é real.

## Android

São necessários um JDK 17 e o Android SDK (variável `sdk.dir` no `local.properties`).

```powershell
cd "C:\ANECTTA MAIL MOBILE\app"
npm.cmd run build
npx.cmd cap sync android
cd android
.\gradlew.bat testDebugUnitTest   # testes do motor de e-mail
.\gradlew.bat assembleDebug       # APK em app\build\outputs\apk\debug\app-debug.apk
```

O GitHub Actions roda os testes e gera o APK de teste a cada push na `main`. O APK fica como artefato do workflow "Build Android Debug APK".

## Licenças de terceiros

Veja [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
