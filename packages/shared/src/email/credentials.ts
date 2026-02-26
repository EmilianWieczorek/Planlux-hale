/**
 * Abstrakcja magazynu haseł SMTP (Windows Credential Vault / macOS Keychain / Android Keystore / iOS Keychain).
 * Aplikacja NIGDY nie zapisuje haseł w Sheets ani w backendzie.
 */

export interface SmtpCredentials {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

export const CREDENTIAL_SERVICE = "planlux-hale-smtp" as const;

/**
 * Zapisz dane SMTP w systemowym sejfie (np. keytar.setPassword(CREDENTIAL_SERVICE, account, password)).
 * account może być np. user@planlux.pl (jeden wpis per użytkownik).
 */
export interface CredentialStore {
  get(account: string): Promise<SmtpCredentials | null>;
  set(account: string, credentials: SmtpCredentials): Promise<void>;
  delete(account: string): Promise<void>;
}
