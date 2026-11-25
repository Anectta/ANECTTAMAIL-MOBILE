package com.anectta.mail.engine;

import java.io.InterruptedIOException;
import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.util.HashSet;
import java.util.Set;

import javax.net.ssl.SSLException;
import javax.net.ssl.SSLHandshakeException;

import jakarta.mail.AuthenticationFailedException;
import jakarta.mail.MessagingException;
import jakarta.mail.SendFailedException;

/** Converte erros técnicos de IMAP/SMTP em mensagens claras para o usuário. */
public final class MailErrors {

    private MailErrors() {}

    public static String describe(Throwable e, String stage, String host, int port) {
        if (e instanceof MailException) return e.getMessage();
        String where = host == null || host.trim().isEmpty() ? stage : host.trim() + ":" + port;

        for (Throwable t : chain(e)) {
            if (t instanceof AuthenticationFailedException) {
                return "Usuário ou senha incorretos (" + stage + "). Se a conta usa verificação em duas etapas, "
                        + "crie uma senha de app no seu provedor e use-a aqui.";
            }
            if (t instanceof UnknownHostException) {
                return "Servidor " + stage + " não encontrado (" + (host == null ? "" : host.trim())
                        + "). Confira o endereço e a conexão com a internet.";
            }
            if (t instanceof SSLHandshakeException || t instanceof SSLException) {
                return "Falha na conexão segura com " + where + ". Confira se a porta e o tipo de segurança "
                        + "(SSL/TLS ou STARTTLS) estão corretos.";
            }
            if (t instanceof SocketTimeoutException || t instanceof InterruptedIOException) {
                return "O servidor " + stage + " (" + where + ") demorou demais para responder. Tente de novo.";
            }
            if (t instanceof ConnectException || t instanceof NoRouteToHostException) {
                return "Não foi possível conectar ao servidor " + stage + " (" + where + "). Confira o endereço, "
                        + "a porta e a internet.";
            }
            if (t instanceof SendFailedException) {
                SendFailedException sfe = (SendFailedException) t;
                if (sfe.getInvalidAddresses() != null && sfe.getInvalidAddresses().length > 0) {
                    StringBuilder sb = new StringBuilder();
                    for (jakarta.mail.Address a : sfe.getInvalidAddresses()) {
                        if (sb.length() > 0) sb.append(", ");
                        sb.append(a.toString());
                    }
                    return "Destinatário recusado pelo servidor: " + sb + ".";
                }
            }
        }
        String msg = rootMessage(e);
        if (msg.toLowerCase().contains("starttls")) {
            return "O servidor " + stage + " (" + where + ") não aceita STARTTLS nesta porta. Tente SSL/TLS.";
        }
        return "Erro no servidor " + stage + " (" + where + "): " + msg;
    }

    /** Mensagem mais interna da cadeia de erros (a mais informativa). */
    public static String rootMessage(Throwable e) {
        String last = e.getMessage();
        for (Throwable t : chain(e)) {
            if (t.getMessage() != null && !t.getMessage().trim().isEmpty()) last = t.getMessage();
        }
        return last == null ? e.getClass().getSimpleName() : last.trim();
    }

    private static Iterable<Throwable> chain(Throwable e) {
        java.util.List<Throwable> out = new java.util.ArrayList<>();
        Set<Throwable> seen = new HashSet<>();
        Throwable cur = e;
        while (cur != null && seen.add(cur)) {
            out.add(cur);
            Throwable next = cur.getCause();
            if (next == null && cur instanceof MessagingException) {
                next = ((MessagingException) cur).getNextException();
            }
            cur = next;
        }
        return out;
    }
}
