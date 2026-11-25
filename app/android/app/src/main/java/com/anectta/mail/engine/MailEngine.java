package com.anectta.mail.engine;

import com.anectta.mail.engine.MailModels.Address;
import com.anectta.mail.engine.MailModels.AttachmentInfo;
import com.anectta.mail.engine.MailModels.FolderInfo;
import com.anectta.mail.engine.MailModels.HeaderPage;
import com.anectta.mail.engine.MailModels.MessageBody;
import com.anectta.mail.engine.MailModels.MessageHeader;
import com.anectta.mail.engine.MailModels.OutgoingMessage;
import com.anectta.mail.engine.MailModels.SendResult;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.Set;

import jakarta.mail.FetchProfile;
import jakarta.mail.Flags;
import jakarta.mail.Folder;
import jakarta.mail.FolderClosedException;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Multipart;
import jakarta.mail.Part;
import jakarta.mail.Session;
import jakarta.mail.StoreClosedException;
import jakarta.mail.Transport;
import jakarta.mail.UIDFolder;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeBodyPart;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeMultipart;
import jakarta.mail.internet.MimePart;
import jakarta.mail.internet.MimeUtility;
import org.eclipse.angus.mail.imap.IMAPFolder;
import org.eclipse.angus.mail.imap.IMAPStore;

/**
 * Motor de e-mail do Anectta MAIL Mobile: o aparelho conversa direto com o servidor do
 * usuário (IMAP para ler, SMTP para enviar), sem nenhum servidor intermediário.
 *
 * Não depende do Android: é testado na JVM contra um servidor IMAP/SMTP de teste.
 * As chamadas são bloqueantes; quem usa deve chamá-las fora da thread de interface.
 */
public final class MailEngine {

    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int IO_TIMEOUT_MS = 45_000;
    /** Limite total de imagens embutidas (cid:) convertidas para exibição. */
    private static final int MAX_INLINE_IMAGES_BYTES = 3 * 1024 * 1024;

    private final Map<String, IMAPStore> stores = new HashMap<>();

    // ------------------------------------------------------------------ conexão

    private static String imapProtocol(MailAccount a) {
        return a.imapSecurity == MailAccount.Security.SSL ? "imaps" : "imap";
    }

    private static String smtpProtocol(MailAccount a) {
        return a.smtpSecurity == MailAccount.Security.SSL ? "smtps" : "smtp";
    }

    static Properties imapProperties(MailAccount a) {
        String proto = imapProtocol(a);
        String pre = "mail." + proto + ".";
        Properties p = new Properties();
        p.put("mail.store.protocol", proto);
        p.put(pre + "host", a.imapHost.trim());
        p.put(pre + "port", String.valueOf(a.imapPort));
        p.put(pre + "connectiontimeout", String.valueOf(CONNECT_TIMEOUT_MS));
        p.put(pre + "timeout", String.valueOf(IO_TIMEOUT_MS));
        p.put(pre + "writetimeout", String.valueOf(IO_TIMEOUT_MS));
        p.put(pre + "fetchsize", String.valueOf(512 * 1024));
        // Ler o corpo não marca como lido: o app marca explicitamente quando o usuário abre.
        p.put(pre + "peek", "true");
        applySecurity(p, pre, a.imapSecurity);
        return p;
    }

    static Properties smtpProperties(MailAccount a) {
        String proto = smtpProtocol(a);
        String pre = "mail." + proto + ".";
        Properties p = new Properties();
        p.put("mail.transport.protocol", proto);
        p.put("mail.from", a.email.trim());
        p.put(pre + "host", a.smtpHost.trim());
        p.put(pre + "port", String.valueOf(a.smtpPort));
        p.put(pre + "auth", "true");
        p.put(pre + "connectiontimeout", String.valueOf(CONNECT_TIMEOUT_MS));
        p.put(pre + "timeout", String.valueOf(IO_TIMEOUT_MS));
        p.put(pre + "writetimeout", String.valueOf(IO_TIMEOUT_MS));
        applySecurity(p, pre, a.smtpSecurity);
        return p;
    }

    private static void applySecurity(Properties p, String pre, MailAccount.Security security) {
        if (security == MailAccount.Security.SSL) {
            p.put(pre + "ssl.enable", "true");
            p.put(pre + "ssl.checkserveridentity", "true");
        } else if (security == MailAccount.Security.STARTTLS) {
            p.put(pre + "starttls.enable", "true");
            p.put(pre + "starttls.required", "true");
            p.put(pre + "ssl.checkserveridentity", "true");
        }
    }

    private static IMAPStore openStore(MailAccount a) throws MessagingException {
        Session session = Session.getInstance(imapProperties(a));
        IMAPStore store = (IMAPStore) session.getStore(imapProtocol(a));
        store.connect(a.imapHost.trim(), a.imapPort, a.loginUser(), a.password);
        return store;
    }

    /** Conexão IMAP reaproveitada entre chamadas (reabre sozinha se caiu). */
    private synchronized IMAPStore store(MailAccount a) throws MessagingException {
        String key = a.connectionKey();
        IMAPStore existing = stores.get(key);
        if (existing != null && existing.isConnected()) return existing;
        if (existing != null) closeQuietly(existing);
        IMAPStore fresh = openStore(a);
        stores.put(key, fresh);
        return fresh;
    }

    private synchronized void dropStore(MailAccount a) {
        IMAPStore s = stores.remove(a.connectionKey());
        if (s != null) closeQuietly(s);
    }

    /** Encerra todas as conexões abertas (ex.: ao remover uma conta ou sair do app). */
    public synchronized void closeAll() {
        for (IMAPStore s : stores.values()) closeQuietly(s);
        stores.clear();
    }

    /** Encerra a conexão de uma conta (ex.: depois de trocar a senha). */
    public void disconnect(MailAccount a) {
        dropStore(a);
    }

    private interface StoreCall<T> {
        T run(IMAPStore store) throws MessagingException, IOException, MailException;
    }

    /** Executa com a conexão da conta; se ela tinha caído, reconecta e tenta mais uma vez. */
    private <T> T withStore(MailAccount a, StoreCall<T> call) throws MessagingException, IOException, MailException {
        try {
            return call.run(store(a));
        } catch (StoreClosedException | FolderClosedException e) {
            dropStore(a);
            return call.run(store(a));
        }
    }

    private static void closeQuietly(IMAPStore s) {
        try {
            s.close();
        } catch (Exception ignored) {
        }
    }

    private static void closeQuietly(Folder f, boolean expunge) {
        try {
            if (f != null && f.isOpen()) f.close(expunge);
        } catch (Exception ignored) {
        }
    }

    // ------------------------------------------------------------------ testar conta

    /**
     * Testa a conta de verdade: entra no IMAP (abre a Caixa de Entrada) e, se houver SMTP
     * configurado, autentica no SMTP. Não usa a conexão em cache.
     */
    public String testConnection(MailAccount a) throws MailException {
        IMAPStore s = null;
        try {
            s = openStore(a);
            Folder inbox = s.getFolder("INBOX");
            inbox.open(Folder.READ_ONLY);
            int total = inbox.getMessageCount();
            inbox.close(false);
            if (!a.smtpHost.trim().isEmpty()) {
                try {
                    Session smtp = Session.getInstance(smtpProperties(a));
                    Transport t = smtp.getTransport(smtpProtocol(a));
                    t.connect(a.smtpHost.trim(), a.smtpPort, a.loginUser(), a.password);
                    t.close();
                } catch (Exception e) {
                    throw new MailException(MailErrors.describe(e, "SMTP", a.smtpHost, a.smtpPort), e);
                }
            }
            return "Conexão bem-sucedida. Caixa de Entrada com " + total + (total == 1 ? " mensagem." : " mensagens.");
        } catch (MailException e) {
            throw e;
        } catch (Exception e) {
            throw new MailException(MailErrors.describe(e, "IMAP", a.imapHost, a.imapPort), e);
        } finally {
            if (s != null) closeQuietly(s);
        }
    }

    // ------------------------------------------------------------------ pastas

    public List<FolderInfo> listFolders(MailAccount a) throws MailException {
        try {
            return withStore(a, store -> {
                Folder[] all = store.getDefaultFolder().list("*");
                List<FolderInfo> out = new ArrayList<>();
                Map<String, String[]> attrsByPath = new HashMap<>();
                for (Folder f : all) {
                    FolderInfo info = new FolderInfo();
                    info.path = f.getFullName();
                    info.name = f.getName();
                    String[] attrs = f instanceof IMAPFolder ? ((IMAPFolder) f).getAttributes() : new String[0];
                    attrsByPath.put(info.path, attrs);
                    info.selectable = (f.getType() & Folder.HOLDS_MESSAGES) != 0
                            && !hasAttr(attrs, "\\Noselect") && !hasAttr(attrs, "\\NonExistent");
                    if (!info.selectable) continue;
                    try {
                        info.total = f.getMessageCount();
                        info.unread = f.getUnreadMessageCount();
                    } catch (MessagingException ignored) {
                        // Alguns servidores recusam STATUS em certas pastas; segue sem contagem.
                    }
                    out.add(info);
                }
                assignRoles(out, attrsByPath);
                out.sort(FOLDER_ORDER);
                return out;
            });
        } catch (Exception e) {
            throw new MailException(MailErrors.describe(e, "IMAP", a.imapHost, a.imapPort), e);
        }
    }

    private static final List<String> ROLE_ORDER = Arrays.asList(
            MailModels.ROLE_INBOX, MailModels.ROLE_SENT, MailModels.ROLE_DRAFTS, MailModels.ROLE_ARCHIVE,
            MailModels.ROLE_JUNK, MailModels.ROLE_TRASH, MailModels.ROLE_OTHER);

    private static final Comparator<FolderInfo> FOLDER_ORDER = (x, y) -> {
        int rx = ROLE_ORDER.indexOf(x.role), ry = ROLE_ORDER.indexOf(y.role);
        if (rx != ry) return Integer.compare(rx, ry);
        return x.path.compareToIgnoreCase(y.path);
    };

    private static boolean hasAttr(String[] attrs, String wanted) {
        if (attrs == null) return false;
        for (String s : attrs) if (s != null && s.equalsIgnoreCase(wanted)) return true;
        return false;
    }

    private static final Map<String, Set<String>> ROLE_NAMES = new HashMap<>();

    static {
        ROLE_NAMES.put(MailModels.ROLE_SENT, new HashSet<>(Arrays.asList(
                "sent", "sent items", "sent mail", "sent messages", "enviados", "enviadas",
                "itens enviados", "mensagens enviadas", "e-mails enviados")));
        ROLE_NAMES.put(MailModels.ROLE_DRAFTS, new HashSet<>(Arrays.asList(
                "drafts", "draft", "rascunhos", "rascunho")));
        ROLE_NAMES.put(MailModels.ROLE_TRASH, new HashSet<>(Arrays.asList(
                "trash", "deleted", "deleted items", "deleted messages", "bin", "lixeira",
                "itens excluidos", "excluidos", "itens apagados", "apagados")));
        ROLE_NAMES.put(MailModels.ROLE_JUNK, new HashSet<>(Arrays.asList(
                "junk", "spam", "junk e-mail", "junk email", "lixo eletronico", "bulk mail", "lixo")));
        ROLE_NAMES.put(MailModels.ROLE_ARCHIVE, new HashSet<>(Arrays.asList(
                "archive", "archives", "arquivo", "arquivos", "arquivados", "arquivo morto")));
    }

    static String normalizeName(String name) {
        String n = Normalizer.normalize(name == null ? "" : name, Normalizer.Form.NFD)
                .replaceAll("\\p{M}+", "");
        return n.trim().toLowerCase(Locale.ROOT);
    }

    /**
     * Define o papel de cada pasta: primeiro pelos atributos que o servidor informa
     * (RFC 6154: \Sent, \Trash...), depois pelo nome (em português e inglês).
     */
    static void assignRoles(List<FolderInfo> folders, Map<String, String[]> attrsByPath) {
        Set<String> taken = new HashSet<>();
        for (FolderInfo f : folders) {
            if (f.path.equalsIgnoreCase("INBOX")) {
                f.role = MailModels.ROLE_INBOX;
                taken.add(MailModels.ROLE_INBOX);
            }
        }
        String[][] attrRoles = {
                {"\\Sent", MailModels.ROLE_SENT}, {"\\Drafts", MailModels.ROLE_DRAFTS},
                {"\\Trash", MailModels.ROLE_TRASH}, {"\\Junk", MailModels.ROLE_JUNK},
                {"\\Archive", MailModels.ROLE_ARCHIVE},
        };
        for (String[] ar : attrRoles) {
            for (FolderInfo f : folders) {
                if (!MailModels.ROLE_OTHER.equals(f.role) || taken.contains(ar[1])) continue;
                if (hasAttr(attrsByPath.get(f.path), ar[0])) {
                    f.role = ar[1];
                    taken.add(ar[1]);
                }
            }
        }
        // Gmail: "Todos os e-mails" (\All) é o arquivo.
        if (!taken.contains(MailModels.ROLE_ARCHIVE)) {
            for (FolderInfo f : folders) {
                if (MailModels.ROLE_OTHER.equals(f.role) && hasAttr(attrsByPath.get(f.path), "\\All")) {
                    f.role = MailModels.ROLE_ARCHIVE;
                    taken.add(MailModels.ROLE_ARCHIVE);
                    break;
                }
            }
        }
        for (Map.Entry<String, Set<String>> entry : ROLE_NAMES.entrySet()) {
            if (taken.contains(entry.getKey())) continue;
            for (FolderInfo f : folders) {
                if (!MailModels.ROLE_OTHER.equals(f.role)) continue;
                if (entry.getValue().contains(normalizeName(f.name))) {
                    f.role = entry.getKey();
                    taken.add(entry.getKey());
                    break;
                }
            }
        }
    }

    /** Caminho da pasta com o papel pedido (ex.: "sent"), ou null se a conta não tiver. */
    public String findFolderByRole(MailAccount a, String role) throws MailException {
        for (FolderInfo f : listFolders(a)) {
            if (role.equals(f.role)) return f.path;
        }
        return null;
    }

    // ------------------------------------------------------------------ mensagens

    /**
     * Página de cabeçalhos, da mais nova para a mais antiga.
     *
     * @param beforeUid 0 para a página mais recente; ou o menor UID já carregado, para "carregar mais".
     */
    public HeaderPage fetchHeaders(MailAccount a, String folderPath, int limit, long beforeUid) throws MailException {
        final int pageSize = Math.max(1, Math.min(limit, 200));
        try {
            return withStore(a, store -> {
                IMAPFolder folder = (IMAPFolder) store.getFolder(folderPath);
                folder.open(Folder.READ_ONLY);
                try {
                    HeaderPage page = new HeaderPage();
                    page.folderPath = folderPath;
                    page.uidValidity = folder.getUIDValidity();
                    page.total = folder.getMessageCount();
                    Message[] msgs;
                    if (page.total == 0) {
                        msgs = new Message[0];
                    } else if (beforeUid > 1) {
                        Message[] older = folder.getMessagesByUID(1, beforeUid - 1);
                        int from = Math.max(0, older.length - pageSize);
                        msgs = Arrays.copyOfRange(older, from, older.length);
                    } else if (beforeUid == 1) {
                        msgs = new Message[0];
                    } else {
                        int start = Math.max(1, page.total - pageSize + 1);
                        msgs = folder.getMessages(start, page.total);
                    }
                    FetchProfile fp = new FetchProfile();
                    fp.add(FetchProfile.Item.ENVELOPE);
                    fp.add(FetchProfile.Item.FLAGS);
                    fp.add(FetchProfile.Item.CONTENT_INFO);
                    fp.add(FetchProfile.Item.SIZE);
                    fp.add(UIDFolder.FetchProfileItem.UID);
                    fp.add("References");
                    folder.fetch(msgs, fp);
                    int lowestSeq = Integer.MAX_VALUE;
                    for (int i = msgs.length - 1; i >= 0; i--) {
                        Message m = msgs[i];
                        if (m == null || m.isExpunged()) continue;
                        lowestSeq = Math.min(lowestSeq, m.getMessageNumber());
                        page.messages.add(toHeader(folder, (MimeMessage) m));
                    }
                    page.messages.sort((x, y) -> Long.compare(y.uid, x.uid));
                    page.hasMore = lowestSeq != Integer.MAX_VALUE && lowestSeq > 1;
                    return page;
                } finally {
                    closeQuietly(folder, false);
                }
            });
        } catch (Exception e) {
            throw new MailException(MailErrors.describe(e, "IMAP", a.imapHost, a.imapPort), e);
        }
    }

    private static MessageHeader toHeader(IMAPFolder folder, MimeMessage m) throws MessagingException {
        MessageHeader h = new MessageHeader();
        h.uid = folder.getUID(m);
        h.messageId = safe(m.getMessageID());
        h.inReplyTo = safe(firstHeader(m, "In-Reply-To"));
        h.references = safe(firstHeader(m, "References"));
        jakarta.mail.Address[] from = m.getFrom();
        if (from != null && from.length > 0) h.from = toAddress(from[0]);
        h.to = toAddresses(m.getRecipients(Message.RecipientType.TO));
        h.cc = toAddresses(m.getRecipients(Message.RecipientType.CC));
        h.subject = safe(m.getSubject());
        Date sent = m.getSentDate();
        Date received = m.getReceivedDate();
        Date when = received != null ? received : sent;
        h.dateMillis = when != null ? when.getTime() : 0L;
        Flags flags = m.getFlags();
        h.seen = flags.contains(Flags.Flag.SEEN);
        h.flagged = flags.contains(Flags.Flag.FLAGGED);
        h.answered = flags.contains(Flags.Flag.ANSWERED);
        h.hasAttachments = m.isMimeType("multipart/mixed");
        h.size = Math.max(0, m.getSize());
        return h;
    }

    private static String firstHeader(MimeMessage m, String name) {
        try {
            String[] v = m.getHeader(name);
            return v != null && v.length > 0 ? v[0] : "";
        } catch (MessagingException e) {
            return "";
        }
    }

    private static Address toAddress(jakarta.mail.Address addr) {
        if (addr instanceof InternetAddress) {
            InternetAddress ia = (InternetAddress) addr;
            return new Address(safe(ia.getPersonal()), safe(ia.getAddress()));
        }
        return new Address("", addr == null ? "" : addr.toString());
    }

    private static List<Address> toAddresses(jakarta.mail.Address[] list) {
        List<Address> out = new ArrayList<>();
        if (list == null) return out;
        for (jakarta.mail.Address a : list) out.add(toAddress(a));
        return out;
    }

    private static String safe(String s) {
        return s == null ? "" : s;
    }

    /** Corpo completo (texto, HTML e lista de anexos). Marca como lida se pedido. */
    public MessageBody fetchBody(MailAccount a, String folderPath, long uid, boolean markSeen) throws MailException {
        try {
            return withStore(a, store -> {
                IMAPFolder folder = (IMAPFolder) store.getFolder(folderPath);
                folder.open(markSeen ? Folder.READ_WRITE : Folder.READ_ONLY);
                try {
                    Message m = folder.getMessageByUID(uid);
                    if (m == null) {
                        throw new MailException("Mensagem não encontrada. Ela pode ter sido movida ou excluída em outro aparelho.");
                    }
                    BodyCollector collector = new BodyCollector();
                    collector.walk(m, "");
                    MessageBody body = new MessageBody();
                    body.uid = uid;
                    body.text = collector.text.toString();
                    body.html = collector.resolveInlineImages(collector.html.toString());
                    body.attachments = collector.attachments;
                    if (markSeen && !m.isSet(Flags.Flag.SEEN)) m.setFlag(Flags.Flag.SEEN, true);
                    return body;
                } finally {
                    closeQuietly(folder, false);
                }
            });
        } catch (MailException e) {
            throw e;
        } catch (Exception e) {
            throw new MailException(MailErrors.describe(e, "IMAP", a.imapHost, a.imapPort), e);
        }
    }

    /** Percorre as partes MIME separando texto, HTML, anexos e imagens embutidas. */
    static final class BodyCollector {
        final StringBuilder text = new StringBuilder();
        final StringBuilder html = new StringBuilder();
        final List<AttachmentInfo> attachments = new ArrayList<>();
        private final Map<String, String> inlineDataUris = new HashMap<>();
        private int inlineBytes = 0;

        void walk(Part p, String partId) throws MessagingException, IOException {
            if (p.isMimeType("multipart/*")) {
                Object content = p.getContent();
                if (content instanceof Multipart) {
                    Multipart mp = (Multipart) content;
                    boolean alternative = p.isMimeType("multipart/alternative");
                    for (int i = 0; i < mp.getCount(); i++) {
                        String child = partId.isEmpty() ? String.valueOf(i + 1) : partId + "." + (i + 1);
                        Part bp = mp.getBodyPart(i);
                        // Em "alternative", só a melhor versão de cada tipo entra.
                        if (alternative && bp.isMimeType("text/plain") && text.length() > 0) continue;
                        if (alternative && bp.isMimeType("text/html") && html.length() > 0) continue;
                        walk(bp, child);
                    }
                    return;
                }
            }
            String disposition = p.getDisposition();
            String fileName = decodeFileName(p.getFileName());
            boolean isAttachmentDisposition = Part.ATTACHMENT.equalsIgnoreCase(disposition);
            boolean isText = p.isMimeType("text/plain") || p.isMimeType("text/html");
            if (isText && !isAttachmentDisposition && fileName.isEmpty()) {
                String value = readText(p);
                if (p.isMimeType("text/html")) {
                    if (html.length() > 0) html.append("<hr>");
                    html.append(value);
                } else {
                    if (text.length() > 0) text.append("\n\n");
                    text.append(value);
                }
                return;
            }
            AttachmentInfo att = new AttachmentInfo();
            att.partId = partId.isEmpty() ? "1" : partId;
            att.contentType = baseContentType(p.getContentType());
            att.name = !fileName.isEmpty() ? fileName : (p.isMimeType("message/rfc822") ? "mensagem.eml" : "anexo");
            att.size = Math.max(0, p.getSize());
            String cid = p instanceof MimePart ? safe(((MimePart) p).getContentID()) : "";
            att.contentId = cid.replaceAll("^<|>$", "");
            att.inline = Part.INLINE.equalsIgnoreCase(disposition) || !att.contentId.isEmpty();
            if (!att.contentId.isEmpty() && att.contentType.startsWith("image/")) {
                captureInlineImage(p, att);
            }
            attachments.add(att);
        }

        private void captureInlineImage(Part p, AttachmentInfo att) {
            if (att.size > 0 && inlineBytes + att.size > MAX_INLINE_IMAGES_BYTES) return;
            try (InputStream in = p.getInputStream()) {
                byte[] bytes = readAll(in, MAX_INLINE_IMAGES_BYTES - inlineBytes + 1);
                if (bytes == null) return;
                inlineBytes += bytes.length;
                inlineDataUris.put(att.contentId,
                        "data:" + att.contentType + ";base64," + Base64.getEncoder().encodeToString(bytes));
            } catch (Exception ignored) {
                // Sem a imagem, o HTML só mostra o espaço vazio.
            }
        }

        String resolveInlineImages(String value) {
            if (value.isEmpty() || inlineDataUris.isEmpty()) return value;
            String out = value;
            for (Map.Entry<String, String> e : inlineDataUris.entrySet()) {
                out = out.replace("cid:" + e.getKey(), e.getValue());
            }
            return out;
        }
    }

    private static String readText(Part p) throws MessagingException, IOException {
        try {
            Object c = p.getContent();
            if (c instanceof String) return (String) c;
        } catch (IOException | MessagingException e) {
            // Charset desconhecido: lê os bytes e tenta UTF-8.
        }
        try (InputStream in = p.getInputStream()) {
            byte[] bytes = readAll(in, 8 * 1024 * 1024);
            return bytes == null ? "" : new String(bytes, StandardCharsets.UTF_8);
        }
    }

    /** Lê até {@code max} bytes; retorna null se passar do limite. */
    private static byte[] readAll(InputStream in, int max) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16 * 1024];
        int n;
        while ((n = in.read(buf)) != -1) {
            out.write(buf, 0, n);
            if (out.size() > max) return null;
        }
        return out.toByteArray();
    }

    private static String decodeFileName(String raw) {
        if (raw == null) return "";
        try {
            return MimeUtility.decodeText(raw).trim();
        } catch (Exception e) {
            return raw.trim();
        }
    }

    private static String baseContentType(String raw) {
        if (raw == null) return "application/octet-stream";
        int semi = raw.indexOf(';');
        return (semi >= 0 ? raw.substring(0, semi) : raw).trim().toLowerCase(Locale.ROOT);
    }

    // ------------------------------------------------------------------ ações

    private static Message[] byUids(IMAPFolder folder, long[] uids) throws MessagingException {
        Message[] found = folder.getMessagesByUID(uids);
        List<Message> out = new ArrayList<>();
        for (Message m : found) if (m != null) out.add(m);
        return out.toArray(new Message[0]);
    }

    /** Marca lido/não lido e/ou estrela. Use null para não mexer em um dos dois. */
    public void setFlags(MailAccount a, String folderPath, long[] uids, Boolean seen, Boolean flagged) throws MailException {
        if (uids == null || uids.length == 0) return;
        try {
            withStore(a, store -> {
                IMAPFolder folder = (IMAPFolder) store.getFolder(folderPath);
                folder.open(Folder.READ_WRITE);
                try {
                    Message[] msgs = byUids(folder, uids);
                    if (msgs.length == 0) return null;
                    if (seen != null) folder.setFlags(msgs, new Flags(Flags.Flag.SEEN), seen);
                    if (flagged != null) folder.setFlags(msgs, new Flags(Flags.Flag.FLAGGED), flagged);
                    return null;
                } finally {
                    closeQuietly(folder, false);
                }
            });
        } catch (Exception e) {
            throw new MailException(MailErrors.describe(e, "IMAP", a.imapHost, a.imapPort), e);
        }
    }

    /** Move mensagens de pasta (usa MOVE do servidor; sem ele, copia e apaga da origem). */
    public void moveMessages(MailAccount a, String fromPath, long[] uids, String toPath) throws MailException {
        if (uids == null || uids.length == 0 || fromPath.equals(toPath)) return;
        try {
            withStore(a, store -> {
                IMAPFolder from = (IMAPFolder) store.getFolder(fromPath);
                Folder to = store.getFolder(toPath);
                if (!to.exists()) throw new MailException("A pasta de destino não existe mais no servidor.");
                from.open(Folder.READ_WRITE);
                try {
                    Message[] msgs = byUids(from, uids);
                    if (msgs.length == 0) return null;
                    if (store.hasCapability("MOVE")) {
                        from.moveMessages(msgs, to);
                    } else {
                        from.copyMessages(msgs, to);
                        from.setFlags(msgs, new Flags(Flags.Flag.DELETED), true);
                        from.expunge(msgs);
                    }
                    return null;
                } finally {
                    closeQuietly(from, false);
                }
            });
        } catch (MailException e) {
            throw e;
        } catch (Exception e) {
            throw new MailException(MailErrors.describe(e, "IMAP", a.imapHost, a.imapPort), e);
        }
    }

    /**
     * Exclui mensagens: move para a Lixeira; se já estiverem na Lixeira (ou a conta não tiver
     * Lixeira), apaga de vez.
     */
    public void deleteMessages(MailAccount a, String folderPath, long[] uids, String trashPath) throws MailException {
        if (uids == null || uids.length == 0) return;
        if (trashPath != null && !trashPath.isEmpty() && !trashPath.equals(folderPath)) {
            moveMessages(a, folderPath, uids, trashPath);
            return;
        }
        try {
            withStore(a, store -> {
                IMAPFolder folder = (IMAPFolder) store.getFolder(folderPath);
                folder.open(Folder.READ_WRITE);
                try {
                    Message[] msgs = byUids(folder, uids);
                    if (msgs.length == 0) return null;
                    folder.setFlags(msgs, new Flags(Flags.Flag.DELETED), true);
                    folder.expunge(msgs);
                    return null;
                } finally {
                    closeQuietly(folder, false);
                }
            });
        } catch (Exception e) {
            throw new MailException(MailErrors.describe(e, "IMAP", a.imapHost, a.imapPort), e);
        }
    }

    // ------------------------------------------------------------------ envio

    /** Servidores que já guardam sozinhos a cópia em Enviados (evita duplicar). */
    static boolean serverSavesSentCopy(MailAccount a) {
        String host = a.smtpHost.toLowerCase(Locale.ROOT);
        return host.endsWith("gmail.com") || host.endsWith("googlemail.com")
                || host.endsWith("office365.com") || host.endsWith("outlook.com");
    }

    public SendResult send(MailAccount a, OutgoingMessage out) throws MailException {
        if (out.to.isEmpty() && out.cc.isEmpty() && out.bcc.isEmpty()) {
            throw new MailException("Informe ao menos um destinatário.");
        }
        Session session = Session.getInstance(smtpProperties(a));
        MimeMessage msg = new MimeMessage(session);
        try {
            msg.setFrom(new InternetAddress(a.email.trim(), a.displayName == null ? null : a.displayName.trim(), "UTF-8"));
            setRecipients(msg, Message.RecipientType.TO, out.to);
            setRecipients(msg, Message.RecipientType.CC, out.cc);
            setRecipients(msg, Message.RecipientType.BCC, out.bcc);
            msg.setSubject(out.subject == null ? "" : out.subject, "UTF-8");
            msg.setSentDate(new Date());
            if (out.inReplyTo != null && !out.inReplyTo.isEmpty()) msg.setHeader("In-Reply-To", out.inReplyTo);
            if (out.references != null && !out.references.isEmpty()) msg.setHeader("References", out.references);
            msg.setHeader("X-Mailer", "Anectta MAIL Mobile");
            String text = out.text == null ? "" : out.text;
            String html = out.html == null ? "" : out.html;
            if (!html.isEmpty()) {
                MimeMultipart alt = new MimeMultipart("alternative");
                MimeBodyPart plain = new MimeBodyPart();
                plain.setText(text, "UTF-8");
                MimeBodyPart rich = new MimeBodyPart();
                rich.setText(html, "UTF-8", "html");
                alt.addBodyPart(plain);
                alt.addBodyPart(rich);
                msg.setContent(alt);
            } else {
                msg.setText(text, "UTF-8");
            }
            msg.saveChanges();
        } catch (Exception e) {
            throw new MailException("Não foi possível montar a mensagem: " + MailErrors.rootMessage(e), e);
        }

        try {
            Transport t = session.getTransport(smtpProtocol(a));
            try {
                t.connect(a.smtpHost.trim(), a.smtpPort, a.loginUser(), a.password);
                t.sendMessage(msg, msg.getAllRecipients());
            } finally {
                try {
                    t.close();
                } catch (Exception ignored) {
                }
            }
        } catch (Exception e) {
            throw new MailException(MailErrors.describe(e, "SMTP", a.smtpHost, a.smtpPort), e);
        }

        SendResult result = new SendResult();
        try {
            result.messageId = safe(msg.getMessageID());
        } catch (MessagingException ignored) {
        }
        if (out.saveToSent && !serverSavesSentCopy(a)) {
            try {
                String sentPath = findFolderByRole(a, MailModels.ROLE_SENT);
                if (sentPath != null) {
                    msg.setFlag(Flags.Flag.SEEN, true);
                    withStore(a, store -> {
                        Folder sent = store.getFolder(sentPath);
                        sent.appendMessages(new Message[] {msg});
                        return null;
                    });
                    result.savedToSent = true;
                    result.sentFolderPath = sentPath;
                }
            } catch (Exception ignored) {
                // O e-mail já foi enviado; só a cópia em Enviados falhou.
            }
        }
        return result;
    }

    private static void setRecipients(MimeMessage msg, Message.RecipientType type, List<String> list)
            throws MessagingException {
        if (list == null || list.isEmpty()) return;
        List<InternetAddress> all = new ArrayList<>();
        for (String raw : list) {
            if (raw == null || raw.trim().isEmpty()) continue;
            Collections.addAll(all, InternetAddress.parse(raw.trim(), false));
        }
        if (!all.isEmpty()) msg.setRecipients(type, all.toArray(new InternetAddress[0]));
    }
}
