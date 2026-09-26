/**
 * Document encryption helpers — KYB service
 *
 * All business documents are encrypted with AES-256-GCM before storage.
 * A per-application encryption key is derived from a master secret so that
 * key rotation and per-SME key deletion are possible.
 *
 * Issue: #762
 */

import * as crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // bytes (256 bits)
const IV_LENGTH = 12;  // bytes (96 bits — recommended for GCM)
const TAG_LENGTH = 16; // bytes

/**
 * Derives a per-application encryption key using HKDF-SHA-256.
 *
 * @param masterSecret  A 32-byte master secret (from secrets manager).
 * @param applicationId The KYB application ID (used as HKDF info / salt).
 * @returns             A 32-byte derived key.
 */
export function deriveApplicationKey(
  masterSecret: Buffer,
  applicationId: string
): Buffer {
  const info = Buffer.from(`kora-kyb-doc-key:${applicationId}`, "utf8");
  // crypto.hkdfSync available since Node 15.
  return Buffer.from(
    crypto.hkdfSync("sha256", masterSecret, Buffer.alloc(0), info, KEY_LENGTH)
  );
}

/** Encrypted blob format: [iv (12 bytes)] + [tag (16 bytes)] + [ciphertext]. */
export interface EncryptedBlob {
  /** base64-encoded combined blob. */
  encoded: string;
  /** SHA-256 hex digest of the original plaintext. */
  contentHash: string;
}

/**
 * Encrypts `plaintext` with AES-256-GCM.
 *
 * @param plaintext  Document bytes to encrypt.
 * @param key        32-byte AES key (from `deriveApplicationKey`).
 * @returns          Encrypted blob + content hash.
 */
export function encryptDocument(plaintext: Buffer, key: Buffer): EncryptedBlob {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Key must be ${KEY_LENGTH} bytes`);
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  });

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Combined blob: iv || tag || ciphertext
  const blob = Buffer.concat([iv, tag, ciphertext]);
  const contentHash = crypto.createHash("sha256").update(plaintext).digest("hex");

  return { encoded: blob.toString("base64"), contentHash };
}

/**
 * Decrypts a blob produced by `encryptDocument`.
 *
 * @param blob  base64-encoded combined blob.
 * @param key   32-byte AES key.
 * @returns     Decrypted plaintext bytes.
 * @throws      If authentication tag verification fails.
 */
export function decryptDocument(blob: string, key: Buffer): Buffer {
  const raw = Buffer.from(blob, "base64");

  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  });
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
