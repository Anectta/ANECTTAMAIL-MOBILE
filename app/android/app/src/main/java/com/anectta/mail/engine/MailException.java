package com.anectta.mail.engine;

/** Erro de e-mail com mensagem já pronta para mostrar ao usuário (em português). */
public class MailException extends Exception {

    public MailException(String userMessage) {
        super(userMessage);
    }

    public MailException(String userMessage, Throwable cause) {
        super(userMessage, cause);
    }
}
