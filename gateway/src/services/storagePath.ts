import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Diretório efêmero para cache temporário de anexos durante o processamento stateless.
 * Configurável via variável de ambiente DATA_DIR (padrão: pasta temporária do SO).
 */
export function getDataStorageDir(): string {
  const dir = process.env.DATA_DIR || path.join(os.tmpdir(), 'anectta-mail-gateway');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
