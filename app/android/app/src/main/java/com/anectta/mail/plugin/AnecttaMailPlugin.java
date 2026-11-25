package com.anectta.mail.plugin;

import com.anectta.mail.engine.MailAccount;
import com.anectta.mail.engine.MailEngine;
import com.anectta.mail.engine.MailErrors;
import com.anectta.mail.engine.MailException;
import com.anectta.mail.engine.MailModels;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Ponte entre o app (React) e o motor de e-mail nativo.
 *
 * A senha de cada conta fica no {@link SecureVault}. O app só a envia uma vez (ao salvar a
 * conta ou ao testar a conexão); nas demais chamadas, o motor a lê direto do cofre.
 */
@CapacitorPlugin(name = "AnecttaMail")
public class AnecttaMailPlugin extends Plugin {

    private final MailEngine engine = new MailEngine();
    /** Uma operação de rede por vez: simples, previsível e sem disputa pela conexão IMAP. */
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private SecureVault vault;

    @Override
    public void load() {
        vault = new SecureVault(getContext());
    }

    @Override
    protected void handleOnDestroy() {
        io.execute(engine::closeAll);
        io.shutdown();
    }

    private static String pwdKey(String accountId) {
        return "pwd:" + accountId;
    }

    private interface Task {
        JSObject run() throws Exception;
    }

    private void runAsync(PluginCall call, Task task) {
        io.execute(() -> {
            try {
                JSObject result = task.run();
                call.resolve(result == null ? new JSObject() : result);
            } catch (MailException e) {
                call.reject(e.getMessage(), "MAIL_ERROR");
            } catch (Exception e) {
                call.reject("Erro inesperado: " + MailErrors.rootMessage(e), "UNEXPECTED");
            }
        });
    }

    // ------------------------------------------------------------------ conta e cofre

    private MailAccount accountFrom(PluginCall call) throws MailException {
        JSObject o = call.getObject("account");
        if (o == null) throw new MailException("Conta não informada.");
        MailAccount a = new MailAccount();
        a.email = o.getString("email", "");
        a.displayName = o.getString("displayName", "");
        a.username = o.getString("username", "");
        a.imapHost = o.getString("imapHost", "");
        a.imapPort = o.getInteger("imapPort", 993);
        a.imapSecurity = MailAccount.parseSecurity(o.getString("imapSecurity"), MailAccount.Security.SSL);
        a.smtpHost = o.getString("smtpHost", "");
        a.smtpPort = o.getInteger("smtpPort", 465);
        a.smtpSecurity = MailAccount.parseSecurity(o.getString("smtpSecurity"), MailAccount.Security.SSL);
        if (a.email.trim().isEmpty() || a.imapHost.trim().isEmpty()) {
            throw new MailException("Configure o e-mail e o servidor IMAP da conta.");
        }
        String typed = o.getString("password", "");
        if (typed != null && !typed.isEmpty()) {
            a.password = typed;
        } else {
            String saved = vault.get(pwdKey(o.getString("id", "")));
            if (saved == null) {
                throw new MailException("A senha desta conta não está salva neste aparelho. "
                        + "Abra a configuração da conta e informe a senha novamente.");
            }
            a.password = saved;
        }
        return a;
    }

    @PluginMethod
    public void saveAccountPassword(PluginCall call) {
        String id = call.getString("accountId", "");
        String password = call.getString("password", "");
        if (id.isEmpty() || password.isEmpty()) {
            call.reject("Conta ou senha não informada.");
            return;
        }
        runAsync(call, () -> {
            vault.put(pwdKey(id), password);
            return null;
        });
    }

    @PluginMethod
    public void removeAccountPassword(PluginCall call) {
        String id = call.getString("accountId", "");
        runAsync(call, () -> {
            vault.remove(pwdKey(id));
            engine.closeAll();
            return null;
        });
    }

    @PluginMethod
    public void hasAccountPassword(PluginCall call) {
        String id = call.getString("accountId", "");
        JSObject r = new JSObject();
        r.put("has", vault.has(pwdKey(id)));
        call.resolve(r);
    }

    // ------------------------------------------------------------------ e-mail

    @PluginMethod
    public void testConnection(PluginCall call) {
        runAsync(call, () -> {
            MailAccount a = accountFrom(call);
            JSObject r = new JSObject();
            r.put("message", engine.testConnection(a));
            return r;
        });
    }

    @PluginMethod
    public void listFolders(PluginCall call) {
        runAsync(call, () -> {
            JSArray list = new JSArray();
            for (MailModels.FolderInfo f : engine.listFolders(accountFrom(call))) {
                JSObject o = new JSObject();
                o.put("path", f.path);
                o.put("name", f.name);
                o.put("role", f.role);
                o.put("total", f.total);
                o.put("unread", f.unread);
                list.put(o);
            }
            JSObject r = new JSObject();
            r.put("folders", list);
            return r;
        });
    }

    @PluginMethod
    public void fetchHeaders(PluginCall call) {
        runAsync(call, () -> {
            MailModels.HeaderPage page = engine.fetchHeaders(
                    accountFrom(call),
                    call.getString("folder", "INBOX"),
                    call.getInt("limit", 40),
                    longOf(call.getData().opt("beforeUid")));
            JSArray msgs = new JSArray();
            for (MailModels.MessageHeader h : page.messages) msgs.put(headerJson(h));
            JSObject r = new JSObject();
            r.put("folder", page.folderPath);
            r.put("uidValidity", page.uidValidity);
            r.put("total", page.total);
            r.put("hasMore", page.hasMore);
            r.put("messages", msgs);
            return r;
        });
    }

    @PluginMethod
    public void fetchBody(PluginCall call) {
        runAsync(call, () -> {
            MailModels.MessageBody b = engine.fetchBody(
                    accountFrom(call),
                    call.getString("folder", "INBOX"),
                    longOf(call.getData().opt("uid")),
                    Boolean.TRUE.equals(call.getBoolean("markSeen", true)));
            JSArray atts = new JSArray();
            for (MailModels.AttachmentInfo a : b.attachments) {
                JSObject o = new JSObject();
                o.put("partId", a.partId);
                o.put("name", a.name);
                o.put("contentType", a.contentType);
                o.put("size", a.size);
                o.put("inline", a.inline);
                atts.put(o);
            }
            JSObject r = new JSObject();
            r.put("uid", b.uid);
            r.put("text", b.text);
            r.put("html", b.html);
            r.put("attachments", atts);
            return r;
        });
    }

    @PluginMethod
    public void setFlags(PluginCall call) {
        runAsync(call, () -> {
            Boolean seen = call.getData().has("seen") ? call.getBoolean("seen") : null;
            Boolean flagged = call.getData().has("flagged") ? call.getBoolean("flagged") : null;
            engine.setFlags(accountFrom(call), call.getString("folder", "INBOX"), uidsOf(call), seen, flagged);
            return null;
        });
    }

    @PluginMethod
    public void moveMessages(PluginCall call) {
        runAsync(call, () -> {
            String to = call.getString("toFolder", "");
            if (to.isEmpty()) throw new MailException("Pasta de destino não informada.");
            engine.moveMessages(accountFrom(call), call.getString("folder", "INBOX"), uidsOf(call), to);
            return null;
        });
    }

    @PluginMethod
    public void deleteMessages(PluginCall call) {
        runAsync(call, () -> {
            engine.deleteMessages(accountFrom(call), call.getString("folder", "INBOX"), uidsOf(call),
                    call.getString("trashFolder", ""));
            return null;
        });
    }

    @PluginMethod
    public void sendMessage(PluginCall call) {
        runAsync(call, () -> {
            JSObject m = call.getObject("message");
            if (m == null) throw new MailException("Mensagem não informada.");
            MailModels.OutgoingMessage out = new MailModels.OutgoingMessage();
            out.to = stringList(m.optJSONArray("to"));
            out.cc = stringList(m.optJSONArray("cc"));
            out.bcc = stringList(m.optJSONArray("bcc"));
            out.subject = m.getString("subject", "");
            out.text = m.getString("text", "");
            out.html = m.getString("html", "");
            out.inReplyTo = m.getString("inReplyTo", "");
            out.references = m.getString("references", "");
            out.saveToSent = m.optBoolean("saveToSent", true);
            MailModels.SendResult res = engine.send(accountFrom(call), out);
            JSObject r = new JSObject();
            r.put("messageId", res.messageId);
            r.put("savedToSent", res.savedToSent);
            r.put("sentFolder", res.sentFolderPath);
            return r;
        });
    }

    // ------------------------------------------------------------------ conversões

    private static JSObject headerJson(MailModels.MessageHeader h) throws JSONException {
        JSObject o = new JSObject();
        o.put("uid", h.uid);
        o.put("messageId", h.messageId);
        o.put("inReplyTo", h.inReplyTo);
        o.put("references", h.references);
        o.put("from", addressJson(h.from));
        JSArray to = new JSArray();
        for (MailModels.Address a : h.to) to.put(addressJson(a));
        o.put("to", to);
        JSArray cc = new JSArray();
        for (MailModels.Address a : h.cc) cc.put(addressJson(a));
        o.put("cc", cc);
        o.put("subject", h.subject);
        o.put("date", h.dateMillis);
        o.put("seen", h.seen);
        o.put("flagged", h.flagged);
        o.put("answered", h.answered);
        o.put("hasAttachments", h.hasAttachments);
        o.put("size", h.size);
        return o;
    }

    private static JSObject addressJson(MailModels.Address a) {
        JSObject o = new JSObject();
        o.put("name", a.name);
        o.put("email", a.email);
        return o;
    }

    private static long longOf(Object v) {
        if (v instanceof Number) return ((Number) v).longValue();
        if (v instanceof String) {
            try {
                return Long.parseLong(((String) v).trim());
            } catch (NumberFormatException ignored) {
            }
        }
        return 0L;
    }

    private static long[] uidsOf(PluginCall call) throws MailException {
        JSONArray arr = call.getData().optJSONArray("uids");
        if (arr == null || arr.length() == 0) throw new MailException("Nenhuma mensagem informada.");
        long[] out = new long[arr.length()];
        for (int i = 0; i < arr.length(); i++) out[i] = longOf(arr.opt(i));
        return out;
    }

    private static List<String> stringList(JSONArray arr) {
        List<String> out = new ArrayList<>();
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            String s = arr.optString(i, "").trim();
            if (!s.isEmpty()) out.add(s);
        }
        return out;
    }
}
