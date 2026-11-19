# Anectta MAIL Mobile (Android & iOS + Gateway Stateless)

Projeto mobile independente do **Anectta MAIL**, reaproveitando os serviços de e-mail (`IMAP`/`SMTP`/`POP3`), tipos e identidade visual do Anectta MAIL Desktop.

## Estrutura
- `gateway/` — API Node.js **stateless** (sem armazenamento definitivo de e-mails em banco) pronta para nuvem ou Docker *on-premise*. Reaproveita `mailService.ts`, `pop3Client.ts` e `imapIdleService.ts`.
- `app/` — Aplicativo mobile em **React 18 + Tailwind CSS + Vite + Capacitor** (`com.anectta.mail`), preparado para Android e iOS.

## Como rodar localmente

### 1. Subir o Gateway Stateless
```powershell
cd "C:\ANECTTA MAIL MOBILE\gateway"
npm.cmd install
npm.cmd run dev
```
O gateway ficará disponível em `http://localhost:8787` (`GET /health`).

### 2. Rodar o App Mobile em desenvolvimento (navegador / emulador)
```powershell
cd "C:\ANECTTA MAIL MOBILE\app"
npm.cmd install
npm.cmd run dev
```

### 3. Gerar projeto nativo Android / iOS (Capacitor)
```powershell
cd "C:\ANECTTA MAIL MOBILE\app"
npx.cmd cap add android
npm.cmd run cap:android
```
*(Para iOS, execute `npx cap add ios` e `npm run cap:ios` em macOS com Xcode ou via CI/CD macOS.)*
