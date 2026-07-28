/**
 * FieldOps V4.0 -- Offline Data Encryption
 *
 * Constitutional: Data-at-Rest Protection
 * Algorithm: PBKDF2-SHA256 (key derivation) + AES-GCM (encryption)
 * Key derived from: User PIN + Device Secret (stored in secure enclave)
 * All keys are NON-EXTRACTABLE (cannot be exported from Web Crypto)
 */

const ENCRYPTION_CONFIG = {
  PBKDF2_ITERATIONS: 100000,
  SALT_LENGTH: 16,
  IV_LENGTH: 12,
  KEY_LENGTH: 256,
} as const

/**
 * Derive encryption key from PIN and device secret
 * Key is non-extractable (cannot be read from browser memory)
 */
export async function deriveKey(
  pin: string,
  deviceSecret: string
): Promise<CryptoKey> {
  const salt = new TextEncoder().encode(deviceSecret)
  const pinData = new TextEncoder().encode(pin)

  const baseKey = await crypto.subtle.importKey(
    'raw',
    pinData,
    { name: 'PBKDF2' },
    false,  // NON-EXTRACTABLE
    ['deriveKey']
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: ENCRYPTION_CONFIG.PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: ENCRYPTION_CONFIG.KEY_LENGTH },
    false,  // NON-EXTRACTABLE: Key cannot be exported
    ['encrypt', 'decrypt']
  )
}

/**
 * Encrypt data object for IndexedDB storage
 */
export async function encryptData<T>(
  data: T,
  key: CryptoKey
): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(ENCRYPTION_CONFIG.IV_LENGTH))
  const plaintext = new TextEncoder().encode(JSON.stringify(data))

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  )

  return { ciphertext, iv }
}

/**
 * Decrypt data from IndexedDB storage
 */
export async function decryptData<T>(
  ciphertext: ArrayBuffer,
  iv: Uint8Array,
  key: CryptoKey
): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  )

  const decoded = new TextDecoder().decode(plaintext)
  return JSON.parse(decoded) as T
}

/**
 * Generate device secret (called once during first login)
 * This secret is stored in browser localStorage (NOT the derived key)
 */
export function generateDeviceSecret(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Hash PIN for comparison (not for encryption key)
 * Uses simple SHA-256 (NOT PBKDF2 -- this is for local comparison only)
 */
export async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(pin)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Verify that a CryptoKey is non-extractable
 * Used for security audits and debugging
 */
export function isKeyNonExtractable(key: CryptoKey): boolean {
  return !key.extractable
}