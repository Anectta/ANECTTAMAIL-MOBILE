package com.anectta.mail.engine;

import java.util.ArrayList;
import java.util.List;

/** Estruturas de dados trocadas entre o motor de e-mail e o app. */
public final class MailModels {

    private MailModels() {}

    /** Papel especial de uma pasta (identificado pelo servidor ou pelo nome). */
    public static final String ROLE_INBOX = "inbox";
    public static final String ROLE_SENT = "sent";
    public static final String ROLE_DRAFTS = "drafts";
    public static final String ROLE_TRASH = "trash";
    public static final String ROLE_JUNK = "junk";
    public static final String ROLE_ARCHIVE = "archive";
    public static final String ROLE_OTHER = "other";

    public static final class FolderInfo {
        public String path;
        public String name;
        public String role = ROLE_OTHER;
        public int total = -1;
        public int unread = -1;
        public boolean selectable = true;
    }

    public static final class Address {
        public String name = "";
        public String email = "";

        public Address() {}

        public Address(String name, String email) {
            this.name = name == null ? "" : name;
            this.email = email == null ? "" : email;
        }
    }

    public static final class MessageHeader {
        public long uid;
        public String messageId = "";
        public String inReplyTo = "";
        public String references = "";
        public Address from = new Address();
        public List<Address> to = new ArrayList<>();
        public List<Address> cc = new ArrayList<>();
        public String subject = "";
        public long dateMillis;
        public boolean seen;
        public boolean flagged;
        public boolean answered;
        public boolean hasAttachments;
        public int size;
    }

    public static final class HeaderPage {
        public String folderPath;
        public long uidValidity;
        public int total;
        public boolean hasMore;
        public List<MessageHeader> messages = new ArrayList<>();
    }

    public static final class AttachmentInfo {
        public String partId;
        public String name;
        public String contentType;
        public int size;
        public boolean inline;
        public String contentId = "";
    }

    public static final class MessageBody {
        public long uid;
        public String text = "";
        public String html = "";
        public List<AttachmentInfo> attachments = new ArrayList<>();
    }

    public static final class OutgoingMessage {
        public List<String> to = new ArrayList<>();
        public List<String> cc = new ArrayList<>();
        public List<String> bcc = new ArrayList<>();
        public String subject = "";
        public String text = "";
        public String html = "";
        public String inReplyTo = "";
        public String references = "";
        /** Guarda uma cópia na pasta Enviados (desligar para servidores que já fazem isso sozinhos). */
        public boolean saveToSent = true;
    }

    public static final class SendResult {
        public String messageId = "";
        public boolean savedToSent;
        public String sentFolderPath = "";
    }
}
