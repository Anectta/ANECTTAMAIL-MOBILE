import tls from 'tls';
import net from 'net';

export interface Pop3Options {
  host: string;
  port: number;
  tls: boolean;
  user: string;
  pass: string;
  timeout?: number;
  rejectUnauthorized?: boolean;
}

export class SimplePop3Client {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private buffer = '';

  constructor(private options: Pop3Options) {}

  public async connect(): Promise<string> {
    return new Promise((resolve, reject) => {
      const port = this.options.port || (this.options.tls ? 995 : 110);
      const host = this.options.host;
      const timeout = this.options.timeout || 15000;

      let connected = false;

      const onReady = () => {
        connected = true;
        this.readLine()
          .then((greeting) => {
            if (!greeting.startsWith('+OK')) {
              reject(new Error(`Servidor POP3 recusou conexão: ${greeting}`));
            } else {
              resolve(greeting);
            }
          })
          .catch(reject);
      };

      try {
        if (this.options.tls) {
          this.socket = tls.connect(
            {
              host,
              port,
              servername: host,
              rejectUnauthorized: this.options.rejectUnauthorized !== false,
            },
            onReady
          );
        } else {
          this.socket = net.connect({ host, port }, onReady);
        }

        this.socket.setEncoding('utf8');
        this.socket.setTimeout(timeout);

        this.socket.on('data', (chunk: string) => {
          this.buffer += chunk;
        });

        this.socket.on('error', (err) => {
          if (!connected) reject(err);
        });

        this.socket.on('timeout', () => {
          this.close();
          reject(new Error('Tempo limite esgotado ao conectar no servidor POP3.'));
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  public async login(): Promise<void> {
    const userRes = await this.sendCommand(`USER ${this.options.user}`);
    if (!userRes.startsWith('+OK')) {
      throw new Error(`Usuário POP3 não aceito: ${userRes}`);
    }
    const passRes = await this.sendCommand(`PASS ${this.options.pass}`);
    if (!passRes.startsWith('+OK')) {
      throw new Error(`Senha POP3 incorreta: ${passRes}`);
    }
  }

  public async stat(): Promise<{ count: number; octets: number }> {
    const res = await this.sendCommand('STAT');
    if (!res.startsWith('+OK')) {
      throw new Error(`Erro no comando STAT: ${res}`);
    }
    const parts = res.trim().split(/\s+/);
    return {
      count: parseInt(parts[1] || '0', 10),
      octets: parseInt(parts[2] || '0', 10),
    };
  }

  public async retr(msgNumber: number): Promise<string> {
    return await this.sendMultilineCommand(`RETR ${msgNumber}`);
  }

  public async dele(msgNumber: number): Promise<void> {
    await this.sendCommand(`DELE ${msgNumber}`);
  }

  public async quit(): Promise<void> {
    try {
      await this.sendCommand('QUIT');
    } catch {
      // ignore
    } finally {
      this.close();
    }
  }

  public close(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.buffer = '';
  }

  private async readLine(): Promise<string> {
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        const idx = this.buffer.indexOf('\r\n');
        if (idx !== -1) {
          clearInterval(interval);
          const line = this.buffer.slice(0, idx);
          this.buffer = this.buffer.slice(idx + 2);
          resolve(line);
        }
      }, 15);
    });
  }

  private async sendCommand(cmd: string): Promise<string> {
    if (!this.socket) throw new Error('Socket POP3 não conectado.');
    this.buffer = '';
    this.socket.write(`${cmd}\r\n`);
    return await this.readLine();
  }

  private async sendMultilineCommand(cmd: string): Promise<string> {
    if (!this.socket) throw new Error('Socket POP3 não conectado.');
    this.buffer = '';
    this.socket.write(`${cmd}\r\n`);

    const firstLine = await this.readLine();
    if (!firstLine.startsWith('+OK')) {
      throw new Error(`Erro POP3: ${firstLine}`);
    }

    return new Promise((resolve) => {
      const interval = setInterval(() => {
        const termIdx = this.buffer.indexOf('\r\n.\r\n');
        if (termIdx !== -1) {
          clearInterval(interval);
          const content = this.buffer.slice(0, termIdx);
          this.buffer = this.buffer.slice(termIdx + 5);
          resolve(content);
        } else if (this.buffer === '.\r\n' || this.buffer.startsWith('.\r\n')) {
          clearInterval(interval);
          this.buffer = this.buffer.slice(3);
          resolve('');
        }
      }, 20);
    });
  }
}
