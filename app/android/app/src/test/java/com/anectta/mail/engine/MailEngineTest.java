package com.anectta.mail.engine;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import com.anectta.mail.engine.MailModels.FolderInfo;
import com.anectta.mail.engine.MailModels.HeaderPage;
import com.anectta.mail.engine.MailModels.MessageBody;
import com.anectta.mail.engine.MailModels.MessageHeader;
import com.anectta.mail.engine.MailModels.OutgoingMessage;
import com.anectta.mail.engine.MailModels.SendResult;
import com.icegreen.greenmail.util.GreenMail;
import com.icegreen.greenmail.util.ServerSetupTest;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.util.Arrays;
import java.util.Base64;
import java.util.Collections;
import java.util.List;
import java.util.Properties;

import jakarta.activation.DataHandler;
import jakarta.mail.Message;
import jakarta.mail.Session;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeBodyPart;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeMultipart;
import jakarta.mail.util.ByteArrayDataSource;

/**
 * Testa o motor de e-mail contra um servidor IMAP/SMTP real em memória (GreenMail).
 * Nenhum dado sai do computador.
 */
public class MailEngineTest {

    private static final String USER = "teste@anectta.test";
    private static final String PASS = "senha-segura";

    private GreenMail greenMail;
    private MailEngine engine;

    @Before
    public void setUp() throws Exception {
        greenMail = new GreenMail(ServerSetupTest.SMTP_IMAP);
        greenMail.start();
        greenMail.setUser(USER, USER, PASS);
        greenMail.setUser("cliente@empresa.test", "cliente@empresa.test", "x");
        engine = new MailEngine();
        // Pastas padrão em português (como em muitos provedores brasileiros)
        for (String name : Arrays.asList("Itens Enviados", "Lixeira", "Arquivo", "Rascunhos", "Spam", "Projetos")) {
            greenMail.getManagers().getImapHostManager()
                    .createMailbox(greenMail.getManagers().getUserManager().getUser(USER), name);
        }
    }

    @After
    public void tearDown() {
        engine.closeAll();
        greenMail.stop();
    }

    private MailAccount account() {
        MailAccount a = new MailAccount();
        a.email = USER;
        a.displayName = "Teste Anectta";
        a.password = PASS;
        a.imapHost = "127.0.0.1";
        a.imapPort = ServerSetupTest.IMAP.getPort();
        a.imapSecurity = MailAccount.Security.NONE;
        a.smtpHost = "127.0.0.1";
        a.smtpPort = ServerSetupTest.SMTP.getPort();
        a.smtpSecurity = MailAccount.Security.NONE;
        return a;
    }

    private void deliverText(String subject, String body) throws Exception {
        MimeMessage m = new MimeMessage(Session.getInstance(new Properties()));
        m.setFrom(new InternetAddress("cliente@empresa.test", "Cliente Exemplo", "UTF-8"));
        m.setRecipients(Message.RecipientType.TO, USER);
        m.setSubject(subject, "UTF-8");
        m.setText(body, "UTF-8");
        m.saveChanges();
        greenMail.getManagers().getUserManager().getUser(USER).deliver(m);
    }

    private void deliverRich() throws Exception {
        Session s = Session.getInstance(new Properties());
        MimeMessage m = new MimeMessage(s);
        m.setFrom(new InternetAddress("financeiro@empresa.test", "Financeiro Ação", "UTF-8"));
        m.setRecipients(Message.RecipientType.TO, USER);
        m.setSubject("Fatura de dezembro — ação necessária", "UTF-8");

        MimeMultipart alt = new MimeMultipart("alternative");
        MimeBodyPart plain = new MimeBodyPart();
        plain.setText("Olá, segue a fatura.", "UTF-8");
        MimeBodyPart html = new MimeBodyPart();
        html.setText("<p>Olá, segue a <b>fatura</b>.</p><img src=\"cid:logo123\">", "UTF-8", "html");
        alt.addBodyPart(plain);
        alt.addBodyPart(html);
        MimeBodyPart altWrapper = new MimeBodyPart();
        altWrapper.setContent(alt);

        MimeMultipart related = new MimeMultipart("related");
        related.addBodyPart(altWrapper);
        MimeBodyPart image = new MimeBodyPart();
        byte[] png = Base64.getDecoder().decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==");
        image.setDataHandler(new DataHandler(new ByteArrayDataSource(png, "image/png")));
        image.setContentID("<logo123>");
        image.setDisposition(MimeBodyPart.INLINE);
        related.addBodyPart(image);
        MimeBodyPart relatedWrapper = new MimeBodyPart();
        relatedWrapper.setContent(related);

        MimeMultipart mixed = new MimeMultipart("mixed");
        mixed.addBodyPart(relatedWrapper);
        MimeBodyPart pdf = new MimeBodyPart();
        pdf.setDataHandler(new DataHandler(new ByteArrayDataSource("%PDF-1.4 teste".getBytes(), "application/pdf")));
        pdf.setFileName("fatura-dezembro.pdf");
        pdf.setDisposition(MimeBodyPart.ATTACHMENT);
        mixed.addBodyPart(pdf);

        m.setContent(mixed);
        m.saveChanges();
        greenMail.getManagers().getUserManager().getUser(USER).deliver(m);
    }

    private FolderInfo folder(List<FolderInfo> list, String role) {
        for (FolderInfo f : list) if (role.equals(f.role)) return f;
        return null;
    }

    @Test
    public void testaConexaoComSucesso() throws Exception {
        deliverText("Oi", "Olá");
        String msg = engine.testConnection(account());
        assertTrue(msg, msg.contains("1 mensagem"));
    }

    @Test
    public void senhaErradaDaMensagemClara() {
        MailAccount a = account();
        a.password = "errada";
        try {
            engine.testConnection(a);
            fail("deveria falhar");
        } catch (MailException e) {
            assertTrue(e.getMessage(), e.getMessage().contains("Usuário ou senha incorretos (IMAP)"));
        }
    }

    @Test
    public void servidorInexistenteDaMensagemClara() {
        MailAccount a = account();
        a.imapHost = "servidor-que-nao-existe.invalid";
        try {
            engine.testConnection(a);
            fail("deveria falhar");
        } catch (MailException e) {
            assertTrue(e.getMessage(), e.getMessage().contains("não encontrado"));
        }
    }

    @Test
    public void listaPastasComPapeisEmPortugues() throws Exception {
        List<FolderInfo> folders = engine.listFolders(account());
        assertEquals("INBOX", folders.get(0).path);
        assertEquals(MailModels.ROLE_INBOX, folders.get(0).role);
        assertEquals("Itens Enviados", folder(folders, MailModels.ROLE_SENT).name);
        assertEquals("Lixeira", folder(folders, MailModels.ROLE_TRASH).name);
        assertEquals("Arquivo", folder(folders, MailModels.ROLE_ARCHIVE).name);
        assertEquals("Rascunhos", folder(folders, MailModels.ROLE_DRAFTS).name);
        assertEquals("Spam", folder(folders, MailModels.ROLE_JUNK).name);
        FolderInfo projetos = null;
        for (FolderInfo f : folders) if ("Projetos".equals(f.name)) projetos = f;
        assertNotNull(projetos);
        assertEquals(MailModels.ROLE_OTHER, projetos.role);
    }

    @Test
    public void paginaCabecalhosDoMaisNovoParaOMaisAntigo() throws Exception {
        for (int i = 1; i <= 7; i++) deliverText("Mensagem " + i, "corpo " + i);
        HeaderPage p1 = engine.fetchHeaders(account(), "INBOX", 3, 0);
        assertEquals(7, p1.total);
        assertEquals(3, p1.messages.size());
        assertEquals("Mensagem 7", p1.messages.get(0).subject);
        assertEquals("Mensagem 5", p1.messages.get(2).subject);
        assertTrue(p1.hasMore);
        assertEquals("Cliente Exemplo", p1.messages.get(0).from.name);
        assertEquals("cliente@empresa.test", p1.messages.get(0).from.email);
        assertFalse(p1.messages.get(0).seen);

        long oldest = p1.messages.get(2).uid;
        HeaderPage p2 = engine.fetchHeaders(account(), "INBOX", 3, oldest);
        assertEquals("Mensagem 4", p2.messages.get(0).subject);
        assertEquals("Mensagem 2", p2.messages.get(2).subject);
        assertTrue(p2.hasMore);

        HeaderPage p3 = engine.fetchHeaders(account(), "INBOX", 3, p2.messages.get(2).uid);
        assertEquals(1, p3.messages.size());
        assertEquals("Mensagem 1", p3.messages.get(0).subject);
        assertFalse(p3.hasMore);
    }

    @Test
    public void corpoComHtmlImagemEmbutidaEAnexo() throws Exception {
        deliverRich();
        HeaderPage page = engine.fetchHeaders(account(), "INBOX", 10, 0);
        MessageHeader h = page.messages.get(0);
        assertEquals("Fatura de dezembro — ação necessária", h.subject);
        assertEquals("Financeiro Ação", h.from.name);
        assertTrue(h.hasAttachments);

        MessageBody body = engine.fetchBody(account(), "INBOX", h.uid, true);
        assertEquals("Olá, segue a fatura.", body.text.trim());
        assertTrue(body.html, body.html.contains("<b>fatura</b>"));
        assertTrue("imagem cid: deve virar data URI", body.html.contains("data:image/png;base64,"));
        assertFalse(body.html.contains("cid:logo123"));

        MailModels.AttachmentInfo pdf = null;
        for (MailModels.AttachmentInfo a : body.attachments) if (!a.inline) pdf = a;
        assertNotNull(pdf);
        assertEquals("fatura-dezembro.pdf", pdf.name);
        assertEquals("application/pdf", pdf.contentType);

        // Abrir com markSeen=true marca como lida no servidor
        assertTrue(engine.fetchHeaders(account(), "INBOX", 10, 0).messages.get(0).seen);
    }

    @Test
    public void marcaLidaEEstrelaNoServidor() throws Exception {
        deliverText("Importante", "x");
        long uid = engine.fetchHeaders(account(), "INBOX", 10, 0).messages.get(0).uid;
        engine.setFlags(account(), "INBOX", new long[] {uid}, true, true);
        MessageHeader h = engine.fetchHeaders(account(), "INBOX", 10, 0).messages.get(0);
        assertTrue(h.seen);
        assertTrue(h.flagged);
        engine.setFlags(account(), "INBOX", new long[] {uid}, false, null);
        h = engine.fetchHeaders(account(), "INBOX", 10, 0).messages.get(0);
        assertFalse(h.seen);
        assertTrue("estrela não deve mudar", h.flagged);
    }

    @Test
    public void moveEExcluiNoServidor() throws Exception {
        deliverText("Para arquivar", "a");
        deliverText("Para excluir", "b");
        List<MessageHeader> inbox = engine.fetchHeaders(account(), "INBOX", 10, 0).messages;
        long arquivar = inbox.get(1).uid;
        long excluir = inbox.get(0).uid;

        engine.moveMessages(account(), "INBOX", new long[] {arquivar}, "Arquivo");
        engine.deleteMessages(account(), "INBOX", new long[] {excluir}, "Lixeira");

        assertEquals(0, engine.fetchHeaders(account(), "INBOX", 10, 0).total);
        assertEquals("Para arquivar", engine.fetchHeaders(account(), "Arquivo", 10, 0).messages.get(0).subject);
        HeaderPage trash = engine.fetchHeaders(account(), "Lixeira", 10, 0);
        assertEquals("Para excluir", trash.messages.get(0).subject);

        // Excluir de dentro da Lixeira apaga de vez
        engine.deleteMessages(account(), "Lixeira", new long[] {trash.messages.get(0).uid}, "Lixeira");
        assertEquals(0, engine.fetchHeaders(account(), "Lixeira", 10, 0).total);
    }

    @Test
    public void enviaPorSmtpEGuardaCopiaEmEnviados() throws Exception {
        OutgoingMessage out = new OutgoingMessage();
        out.to = Collections.singletonList("Cliente <cliente@empresa.test>");
        out.subject = "Proposta comercial — revisão";
        out.text = "Segue a proposta revisada.";
        out.html = "<p>Segue a proposta <b>revisada</b>.</p>";
        out.inReplyTo = "<original@empresa.test>";
        out.references = "<original@empresa.test>";

        SendResult r = engine.send(account(), out);
        assertTrue(r.messageId.length() > 0);
        assertTrue(r.savedToSent);
        assertEquals("Itens Enviados", r.sentFolderPath);

        assertTrue(greenMail.waitForIncomingEmail(5000, 1));
        MimeMessage received = greenMail.getReceivedMessagesForDomain("empresa.test")[0];
        assertEquals("Proposta comercial — revisão", received.getSubject());
        assertEquals("<original@empresa.test>", received.getHeader("In-Reply-To")[0]);
        assertEquals("Teste Anectta", ((InternetAddress) received.getFrom()[0]).getPersonal());

        HeaderPage sent = engine.fetchHeaders(account(), "Itens Enviados", 10, 0);
        assertEquals(1, sent.total);
        assertTrue(sent.messages.get(0).seen);
    }

    @Test
    public void semDestinatarioNaoEnvia() {
        try {
            engine.send(account(), new OutgoingMessage());
            fail("deveria falhar");
        } catch (MailException e) {
            assertTrue(e.getMessage().contains("destinatário"));
        }
    }
}
