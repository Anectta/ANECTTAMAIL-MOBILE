import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { MailService, type MailServerConfig, type SupportedFolder } from './services/mailService';
import { pairingService, type PairingAccountPayload } from './services/pairingService';
import { pushRelayService, type PushRegistrationRequest } from './services/pushRelayService';
import { mobileOAuthService, type OAuthProvider } from './services/mobileOAuthService';

const app = express();
const PORT = Number(process.env.PORT || 8787);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(helmet());
app.use(
  cors({
    origin: ALLOWED_ORIGINS.includes('*') ? true : ALLOWED_ORIGINS,
    credentials: true,
  })
);
app.use(express.json({ limit: '25mb' }));

/**
 * Healthcheck do Gateway Stateless
 */
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'anectta-mail-gateway',
    mode: 'stateless',
    push: pushRelayService.getStats(),
    oauth: mobileOAuthService.getAvailableProviders(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * OAuth 2.0 (Google & Microsoft)
 */
app.get('/api/oauth/providers', (_req, res) => {
  res.json({ success: true, providers: mobileOAuthService.getAvailableProviders() });
});

app.get('/api/oauth/:provider/start', (req, res) => {
  try {
    const provider = req.params.provider as OAuthProvider;
    if (provider !== 'google' && provider !== 'microsoft') {
      res.status(400).json({ success: false, error: 'Provedor OAuth inválido.' });
      return;
    }
    const redirectUri = String(req.query.redirectUri || 'anecttamail://oauth-callback');
    const url = mobileOAuthService.createAuthUrl(provider, redirectUri);
    res.redirect(url);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || 'Erro ao iniciar OAuth.' });
  }
});

app.get('/api/oauth/:provider/callback', async (req, res) => {
  try {
    const provider = req.params.provider as OAuthProvider;
    if (provider !== 'google' && provider !== 'microsoft') {
      res.status(400).send('Provedor OAuth inválido.');
      return;
    }
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    const result = await mobileOAuthService.handleCallback(provider, code, state);
    const params = new URLSearchParams({
      provider: result.provider,
      accessToken: result.accessToken,
      ...(result.refreshToken ? { refreshToken: result.refreshToken } : {}),
      imapHost: result.imapHost,
      imapPort: String(result.imapPort),
      smtpHost: result.smtpHost,
      smtpPort: String(result.smtpPort),
    });
    res.redirect(`${result.appRedirectUri}?${params.toString()}`);
  } catch (err: any) {
    res.status(400).send(`Erro no OAuth: ${err?.message || 'Falha desconhecida'}`);
  }
});

app.post('/api/oauth/:provider/refresh', async (req, res) => {
  try {
    const provider = req.params.provider as OAuthProvider;
    if (provider !== 'google' && provider !== 'microsoft') {
      res.status(400).json({ success: false, error: 'Provedor OAuth inválido.' });
      return;
    }
    const refreshToken = String(req.body?.refreshToken || '');
    if (!refreshToken) {
      res.status(400).json({ success: false, error: 'refreshToken obrigatório.' });
      return;
    }
    const refreshed = await mobileOAuthService.refreshAccessToken(provider, refreshToken);
    res.json({ success: true, ...refreshed });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || 'Erro ao renovar token.' });
  }
});

/**
 * Pareamento Desktop -> Mobile (efêmero, uso único, sem senhas)
 */
app.post('/api/pairing/create', (req, res) => {
  try {
    const accounts = req.body?.accounts as PairingAccountPayload[];
    if (!Array.isArray(accounts) || accounts.length === 0) {
      res.status(400).json({ success: false, error: 'Informe ao menos uma conta para pareamento.' });
      return;
    }
    const session = pairingService.createSession(accounts);
    res.json({ success: true, ...session });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Erro ao gerar código de pareamento.' });
  }
});

app.post('/api/pairing/claim', (req, res) => {
  try {
    const code = String(req.body?.code || '');
    const accounts = pairingService.claimSession(code);
    if (!accounts) {
      res.status(404).json({ success: false, error: 'Código inválido ou expirado.' });
      return;
    }
    res.json({ success: true, accounts });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Erro ao resgatar pareamento.' });
  }
});

/**
 * Registro de Push Relay (IMAP IDLE -> FCM/APNs wakeup)
 */
app.post('/api/push/register', (req, res) => {
  try {
    const body = req.body as PushRegistrationRequest;
    if (!body?.deviceId || !body?.pushToken || !body?.accountId || !body?.imapConfig?.host) {
      res.status(400).json({ success: false, error: 'Dados incompletos para registro de Push.' });
      return;
    }
    const result = pushRelayService.register(body);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Erro ao registrar Push.' });
  }
});

app.post('/api/push/unregister', (req, res) => {
  try {
    const { deviceId, accountId } = req.body || {};
    if (!deviceId) {
      res.status(400).json({ success: false, error: 'deviceId obrigatório.' });
      return;
    }
    const result = pushRelayService.unregister(String(deviceId), accountId ? String(accountId) : undefined);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Erro ao remover registro de Push.' });
  }
});

/**
 * Testa conexão IMAP ou POP3
 */
app.post('/api/mail/test-connection', async (req, res) => {
  try {
    const config = req.body as MailServerConfig;
    const result = await MailService.testIncomingConnection(config);
    res.status(result.success ? 200 : 400).json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || 'Erro interno ao testar conexão.' });
  }
});

/**
 * Sincroniza uma pasta específica (inbox, sent, drafts, archive, trash, junk ou pasta IMAP)
 */
app.post('/api/mail/folder', async (req, res) => {
  try {
    const { config, folder = 'inbox', limit = 50 } = req.body as {
      config: MailServerConfig;
      folder?: SupportedFolder | string;
      limit?: number;
    };
    const result =
      config.protocol === 'pop3'
        ? await MailService.fetchPop3Inbox(config)
        : await MailService.fetchFolderMessages(config, folder as SupportedFolder, limit);
    res.status(result.success ? 200 : 400).json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Erro ao buscar mensagens.' });
  }
});

/**
 * Sincroniza todas as pastas da conta (modo stateless — retorna direto para o cache do celular)
 */
app.post('/api/mail/sync', async (req, res) => {
  try {
    const { config, limitPerFolder = 40 } = req.body as {
      config: MailServerConfig;
      limitPerFolder?: number;
    };
    const result =
      config.protocol === 'pop3'
        ? await MailService.fetchPop3Inbox(config)
        : await MailService.syncAllFolders(config, limitPerFolder);
    res.status(result.success ? 200 : 400).json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Erro na sincronização.' });
  }
});

/**
 * Envia e-mail via SMTP (reaproveitando MailService.sendSmtp)
 */
app.post('/api/mail/send', async (req, res) => {
  try {
    const { smtpConfig, mailOptions, imapConfig } = req.body;
    const result = await MailService.sendSmtp(
      { ...smtpConfig, incomingHost: imapConfig?.host },
      mailOptions
    );
    res.status(result.success ? 200 : 400).json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Erro ao enviar e-mail.' });
  }
});

/**
 * Cria pasta IMAP
 */
app.post('/api/mail/folders/create', async (req, res) => {
  try {
    const { config, folderName, parentImapPath } = req.body;
    const result = await MailService.createImapFolder(config, folderName, parentImapPath);
    res.status(result.success ? 200 : 400).json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Erro ao criar pasta.' });
  }
});

app.listen(PORT, () => {
  console.log(`[Anectta MAIL Gateway] Stateless API rodando na porta ${PORT}`);
});
