// "Lembrar de mim" — persiste e-mail + senha no localStorage.
//
// AVISO DE SEGURANÇA: a senha é cifrada com AES-GCM (Web Crypto), mas a chave é
// derivada de um segredo estático embutido no próprio bundle do front. Isso é
// OFUSCAÇÃO, não segurança real: quem tiver acesso ao dispositivo ou ao código
// consegue reverter. Serve apenas para não guardar a senha em texto puro.

const STORAGE_KEY = 'crm.remember';
const KEY_MATERIAL = 'crm-programeai::lembrar-de-mim::v1';
const SALT = new TextEncoder().encode('crm-programeai-remember-salt');
const IV_BYTES = 12;

type StoredCredentials = { email: string; pw: string };
export type RememberedCredentials = { email: string; password: string };

async function deriveKey(): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(KEY_MATERIAL),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: SALT, iterations: 100_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function encrypt(text: string): Promise<string> {
  const key = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(text),
  );
  const ct = new Uint8Array(ciphertext);
  const combined = new Uint8Array(iv.length + ct.length);
  combined.set(iv, 0);
  combined.set(ct, iv.length);
  return toBase64(combined);
}

async function decrypt(payload: string): Promise<string> {
  const key = await deriveKey();
  const combined = fromBase64(payload);
  const iv = combined.slice(0, IV_BYTES);
  const ct = combined.slice(IV_BYTES);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(plaintext);
}

export async function saveCredentials(email: string, password: string): Promise<void> {
  try {
    const stored: StoredCredentials = { email, pw: await encrypt(password) };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // se a criptografia falhar, não persiste nada em texto puro
    clearCredentials();
  }
}

export async function loadCredentials(): Promise<RememberedCredentials | null> {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as StoredCredentials;
    if (!stored?.email || !stored?.pw) return null;
    return { email: stored.email, password: await decrypt(stored.pw) };
  } catch {
    clearCredentials();
    return null;
  }
}

export function clearCredentials(): void {
  localStorage.removeItem(STORAGE_KEY);
}
