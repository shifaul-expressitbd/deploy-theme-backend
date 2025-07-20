import { Client, ConnectConfig } from 'ssh2';
import fs from 'fs';

export interface SSHOptions {
  host: string;
  port?: number;
  username: string;
  privateKeyPath: string;
}

export async function runSSHCommand(command: string, options: SSHOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const privateKey = fs.readFileSync(options.privateKeyPath, 'utf8');
    const config: ConnectConfig = {
      host: options.host,
      port: options.port || 22,
      username: options.username,
      privateKey,
    };
    console.log('Connecting to SSH:', config);
    conn.on('ready', () => {
      console.log('SSH connection ready. Executing command:', command);
      conn.exec(command, (err: Error | undefined, stream: import('ssh2').ClientChannel) => {
        if (err) {
          console.log('SSH exec error:', err);
          conn.end();
          return reject(err);
        }
        let stdout = '';
        let stderr = '';
        stream.on('close', (code: number, signal: string) => {
          console.log('SSH command closed with code:', code, 'signal:', signal);
          conn.end();
          if (code === 0) {
            console.log('SSH command output:', stdout);
            resolve(stdout);
          } else {
            console.log('SSH command error output:', stderr);
            reject(stderr || `Command failed with code ${code}`);
          }
        }).on('data', (data: Buffer) => {
          stdout += data.toString();
        }).stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
      });
    }).on('error', (err) => {
      console.log('SSH connection error:', err);
      reject(err);
    })
      .connect(config);
  });
} 