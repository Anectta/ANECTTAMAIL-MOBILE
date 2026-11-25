import { useCallback, useEffect, useRef, useState } from 'react';
import { AnecttaMail, errorMessage } from '@/native/anecttaMail';
import { accountStore } from '@/services/accountStore';
import type { FolderRole, MailAccount, MailFolderInfo, MessageHeader } from '@/types/mail';

const PAGE_SIZE = 40;

/**
 * Estado da caixa de e-mail da conta ativa: pastas, mensagens da pasta aberta e ações.
 * Mostra primeiro o que está em cache (abre instantâneo) e atualiza do servidor em seguida.
 */
export function useMailbox(account: MailAccount | null, notify: (msg: string) => void) {
  const [folders, setFolders] = useState<MailFolderInfo[]>([]);
  const [folderPath, setFolderPath] = useState('INBOX');
  const [headers, setHeaders] = useState<MessageHeader[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accountRef = useRef(account);
  accountRef.current = account;
  const folderRef = useRef(folderPath);
  folderRef.current = folderPath;
  const headersRef = useRef(headers);
  headersRef.current = headers;

  const persist = useCallback((list: MessageHeader[]) => {
    const acc = accountRef.current;
    if (acc) void accountStore.saveHeaders(acc.id, folderRef.current, list);
  }, []);

  const applyHeaders = useCallback(
    (updater: (prev: MessageHeader[]) => MessageHeader[]) => {
      setHeaders((prev) => {
        const next = updater(prev);
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const fetchFirstPage = useCallback(async (acc: MailAccount, path: string) => {
    const page = await AnecttaMail.fetchHeaders({ account: acc, folder: path, limit: PAGE_SIZE });
    if (accountRef.current?.id !== acc.id || folderRef.current !== path) return;
    // Mantém trechos já conhecidos (vieram de mensagens abertas antes).
    const known = new Map(headersRef.current.map((h) => [h.uid, h.snippet]));
    const merged = page.messages.map((m) => ({ ...m, snippet: m.snippet || known.get(m.uid) }));
    setHeaders(merged);
    setHasMore(page.hasMore);
    persist(merged);
  }, [persist]);

  const refresh = useCallback(async () => {
    const acc = accountRef.current;
    if (!acc) return;
    setRefreshing(true);
    setError(null);
    try {
      const { folders: list } = await AnecttaMail.listFolders({ account: acc });
      if (accountRef.current?.id !== acc.id) return;
      setFolders(list);
      void accountStore.saveFolders(acc.id, list);
      const path = list.some((f) => f.path === folderRef.current) ? folderRef.current : 'INBOX';
      if (path !== folderRef.current) setFolderPath(path);
      folderRef.current = path;
      await fetchFirstPage(acc, path);
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível atualizar. Verifique a internet.'));
    } finally {
      setRefreshing(false);
    }
  }, [fetchFirstPage]);

  // Troca de conta: cache primeiro, servidor depois.
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    setFolderPath('INBOX');
    folderRef.current = 'INBOX';
    setHasMore(false);
    void (async () => {
      const [cachedFolders, cachedHeaders] = await Promise.all([
        accountStore.loadFolders(account.id),
        accountStore.loadHeaders(account.id, 'INBOX'),
      ]);
      if (cancelled) return;
      setFolders(cachedFolders);
      setHeaders(cachedHeaders);
      void refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectFolder = useCallback(
    async (path: string) => {
      const acc = accountRef.current;
      if (!acc) return;
      setFolderPath(path);
      folderRef.current = path;
      setHasMore(false);
      setError(null);
      setHeaders(await accountStore.loadHeaders(acc.id, path));
      setRefreshing(true);
      try {
        await fetchFirstPage(acc, path);
      } catch (err) {
        setError(errorMessage(err, 'Não foi possível abrir a pasta.'));
      } finally {
        setRefreshing(false);
      }
    },
    [fetchFirstPage]
  );

  const loadMore = useCallback(async () => {
    const acc = accountRef.current;
    if (!acc || loadingMore || headersRef.current.length === 0) return;
    const path = folderRef.current;
    const oldest = Math.min(...headersRef.current.map((h) => h.uid));
    setLoadingMore(true);
    try {
      const page = await AnecttaMail.fetchHeaders({ account: acc, folder: path, limit: PAGE_SIZE, beforeUid: oldest });
      if (folderRef.current !== path) return;
      applyHeaders((prev) => {
        const seen = new Set(prev.map((h) => h.uid));
        return [...prev, ...page.messages.filter((m) => !seen.has(m.uid))];
      });
      setHasMore(page.hasMore);
    } catch (err) {
      notify(errorMessage(err, 'Não foi possível carregar mais mensagens.'));
    } finally {
      setLoadingMore(false);
    }
  }, [applyHeaders, loadingMore, notify]);

  const folderByRole = useCallback(
    (role: FolderRole) => folders.find((f) => f.role === role)?.path,
    [folders]
  );

  const patchHeader = useCallback(
    (uid: number, patch: Partial<MessageHeader>) =>
      applyHeaders((prev) => prev.map((h) => (h.uid === uid ? { ...h, ...patch } : h))),
    [applyHeaders]
  );

  /** Ação otimista: muda a tela na hora e desfaz se o servidor recusar. */
  const optimistic = useCallback(
    async (change: () => void, undo: () => void, run: () => Promise<void>, failMsg: string) => {
      change();
      try {
        await run();
      } catch (err) {
        undo();
        notify(errorMessage(err, failMsg));
      }
    },
    [notify]
  );

  const setSeen = useCallback(
    async (h: MessageHeader, seen: boolean) => {
      const acc = accountRef.current;
      if (!acc || h.seen === seen) return;
      const path = folderRef.current;
      await optimistic(
        () => patchHeader(h.uid, { seen }),
        () => patchHeader(h.uid, { seen: h.seen }),
        () => AnecttaMail.setFlags({ account: acc, folder: path, uids: [h.uid], seen }),
        'Não foi possível marcar a mensagem.'
      );
    },
    [optimistic, patchHeader]
  );

  const toggleFlag = useCallback(
    async (h: MessageHeader) => {
      const acc = accountRef.current;
      if (!acc) return;
      const path = folderRef.current;
      await optimistic(
        () => patchHeader(h.uid, { flagged: !h.flagged }),
        () => patchHeader(h.uid, { flagged: h.flagged }),
        () => AnecttaMail.setFlags({ account: acc, folder: path, uids: [h.uid], flagged: !h.flagged }),
        'Não foi possível marcar a estrela.'
      );
    },
    [optimistic, patchHeader]
  );

  const removeFromList = useCallback(
    async (h: MessageHeader, run: () => Promise<void>, doneMsg: string, failMsg: string) => {
      const snapshot = headersRef.current;
      await optimistic(
        () => applyHeaders((prev) => prev.filter((x) => x.uid !== h.uid)),
        () => applyHeaders(() => snapshot),
        async () => {
          await run();
          notify(doneMsg);
        },
        failMsg
      );
    },
    [applyHeaders, notify, optimistic]
  );

  const archive = useCallback(
    async (h: MessageHeader) => {
      const acc = accountRef.current;
      const target = folderByRole('archive');
      if (!acc) return;
      if (!target) {
        notify('Esta conta não tem uma pasta de arquivo no servidor.');
        return;
      }
      const path = folderRef.current;
      await removeFromList(
        h,
        () => AnecttaMail.moveMessages({ account: acc, folder: path, uids: [h.uid], toFolder: target }),
        'Mensagem arquivada.',
        'Não foi possível arquivar.'
      );
    },
    [folderByRole, notify, removeFromList]
  );

  const remove = useCallback(
    async (h: MessageHeader) => {
      const acc = accountRef.current;
      if (!acc) return;
      const path = folderRef.current;
      const trash = folderByRole('trash');
      const permanent = !trash || trash === path;
      await removeFromList(
        h,
        () => AnecttaMail.deleteMessages({ account: acc, folder: path, uids: [h.uid], trashFolder: trash }),
        permanent ? 'Mensagem excluída definitivamente.' : 'Mensagem movida para a Lixeira.',
        'Não foi possível excluir.'
      );
    },
    [folderByRole, removeFromList]
  );

  const currentFolder = folders.find((f) => f.path === folderPath);

  return {
    folders,
    folderPath,
    currentFolder,
    headers,
    hasMore,
    refreshing,
    loadingMore,
    error,
    refresh,
    selectFolder,
    loadMore,
    patchHeader,
    setSeen,
    toggleFlag,
    archive,
    remove,
    folderByRole,
  };
}
