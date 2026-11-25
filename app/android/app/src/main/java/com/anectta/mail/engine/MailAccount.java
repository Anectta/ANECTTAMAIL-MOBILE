package com.anectta.mail.engine;

/**
 * Dados de conexão de uma conta (IMAP para ler, SMTP para enviar).
 * A senha nunca é persistida aqui: vem do cofre do aparelho a cada operação.
 */
public final class MailAccount {

    /** Segurança da conexão: SSL/TLS direto, STARTTLS obrigatório ou sem criptografia. */
    public enum Security { SSL, STARTTLS, NONE }

    public String email = "";
    public String displayName = "";
    public String username = "";
    public String password = "";

    public String imapHost = "";
    public int imapPort = 993;
    public Security imapSecurity = Security.SSL;

    public String smtpHost = "";
    public int smtpPort = 465;
    public Security smtpSecurity = Security.SSL;

    /** Usuário de login (se vazio, usa o próprio e-mail). */
    public String loginUser() {
        return username != null && !username.trim().isEmpty() ? username.trim() : email.trim();
    }

    /** Chave que identifica a conexão IMAP (para reaproveitar a sessão aberta). */
    public String connectionKey() {
        return loginUser().toLowerCase() + "@" + imapHost.trim().toLowerCase() + ":" + imapPort;
    }

    public static Security parseSecurity(String value, Security fallback) {
        if (value == null) return fallback;
        switch (value.trim().toLowerCase()) {
            case "ssl":
            case "tls":
                return Security.SSL;
            case "starttls":
                return Security.STARTTLS;
            case "none":
                return Security.NONE;
            default:
                return fallback;
        }
    }
}
