export type PriorityLevel = 'high' | 'medium' | 'low';
export type MailFolder =
  | 'inbox'
  | 'favorites'
  | 'tasks'
  | 'reading_list'
  | 'important'
  | 'sent'
  | 'drafts'
  | 'archive'
  | 'snooze'
  | 'trash'
  | 'junk'
  | 'outbox'
  | 'search_folders'
  | (string & {});

export interface CustomFolder {
  id: string;
  name: string;
  accountId: string;
  parentFolder?: MailFolder;
  imapPath?: string;
  order?: number;
  createdAt: string;
}

export interface FavoriteFolder {
  accountId: string;
  folderId: MailFolder;
  label: string;
}

export type TimePeriod = 'today' | 'yesterday' | 'last_week' | 'older';

export interface RecipientReadStatus {
  name: string;
  email: string;
  status: 'delivered' | 'opened';
  openedAt?: string;
  openedDateStr?: string;
}

export interface EmailItem {
  id: string;
  accountId?: string;
  messageIdHeader?: string;
  inReplyToHeader?: string;
  sender: string;
  senderEmail: string;
  avatar?: string;
  recipient: string;
  subject: string;
  snippet: string;
  body: string;
  bodyHtml?: string;
  stationery?: string;
  draftAttachments?: Array<{ name: string; path: string; size: number }>;
  timestamp: string;
  dateStr?: string;
  period: TimePeriod;
  folder: MailFolder;
  priority: PriorityLevel;
  isRead: boolean;
  isStarred?: boolean;
  isTask?: boolean;
  isReadingList?: boolean;
  isImportant?: boolean;
  hasAttachment?: boolean;
  attachments?: Array<{
    id: string;
    name: string;
    size: number;
    contentType?: string;
    path?: string;
    isSignature?: boolean;
    isInline?: boolean;
  }>;
  category?: 'Finanças' | 'Clientes' | 'DevOps' | 'Jurídico' | 'Urgente';
  tags?: string[];
  trackingEnabled?: boolean;
  requestReadReceipt?: boolean;
  readReceiptRequestedBy?: string;
  readReceiptSent?: boolean;
  recipientTracking?: RecipientReadStatus[];
}

export interface AISummaryResult {
  summary: string;
  keyPoints: string[];
  actionRequired: boolean;
}

export interface UserAccount {
  name: string;
  email: string;
  role: string;
  avatar: string;
  status: 'online' | 'busy' | 'away';
}
