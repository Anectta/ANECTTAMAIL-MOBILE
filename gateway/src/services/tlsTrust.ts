/**
 * Validação de confiança TLS para o Gateway Node.js.
 * Por padrão, todos os certificados TLS são validados (rejectUnauthorized: true).
 * Hosts internos/corporativos com certificado autoassinado podem ser autorizados
 * explicitamente via variável de ambiente TLS_TRUSTED_HOSTS (lista separada por vírgula).
 */
const envTrustedHosts = new Set(
  (process.env.TLS_TRUSTED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
);

export function isTlsHostTrusted(host?: string): boolean {
  if (!host) return false;
  return envTrustedHosts.has(host.trim().toLowerCase());
}
