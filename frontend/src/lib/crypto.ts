/**
 * FieldOps V4.0 -- Offline Data Encryption
 * Constitutional: Data-at-Rest Protection
 */

const ENCRYPTION_CONFIG = {
  PBKDF2_ITERATIONS: 100000,
  SALT_LENGTH: 16,
  IV_LENGTH: 12,
  KEY_LENGTH: 256,
} as const

export async function deriveKey(pin: string, deviceSecret: string): Promise<CryptoKey> {
  const salt = new TextEncoder().encode(deviceSecret)
  const pinData = new TextEncoder().encode(pin)

  const baseKey = await crypto.subtle.importKey(
    'raw',
    pinData as any,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as any,
      iterations: ENCRYPTION_CONFIG.PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: ENCRYPTION_CONFIG.KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encryptData<T>(data: T, key: CryptoKey): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(ENCRYPTION_CONFIG.IV_LENGTH))
  const plaintext = new TextEncoder().encode(JSON.stringify(data))

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as any },
    key,
    plaintext as any
  )

  return { ciphertext, iv }
}

export async function decryptData<T>(ciphertext: ArrayBuffer, iv: Uint8Array, key: CryptoKey): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as any },
    key,
    ciphertext as any
  )

  const decoded = new TextDecoder().decode(plaintext)
  return JSON.parse(decoded) as T
}

export function generateDeviceSecret(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(pin)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data as any)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function isKeyNonExtractable(key: CryptoKey): boolean {
  return !key.extractable
}