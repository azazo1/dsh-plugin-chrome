/**
 * CRX container parsing (read-only, no signature verification).
 *
 * Chrome can neither launch a `.crx` from its command line nor install one
 * through the DevTools protocol: `Extensions.loadUnpacked` only takes an
 * unpacked directory. The plugin therefore unpacks the CRX payload itself.
 * Parsing the container gives two things the ZIP alone cannot:
 *
 *   - the publisher public key, written into `manifest.json` as `key` so the
 *     unpacked extension keeps the ID the CRX was signed for, and
 *   - the CRX id, used for diagnostics.
 *
 * Formats follow components/crx_file/crx3.proto and the legacy CRX2 layout.
 */
import { createHash } from 'node:crypto'

/** Magic number every CRX starts with. */
const CRX_MAGIC = 'Cr24'

/** Result of reading one CRX container. */
export interface CrxArchive {
  /** Container version: 2 (legacy) or 3. */
  version: 2 | 3
  /** The ZIP archive (the whole rest of the file after the header). */
  payload: Buffer
  /** Base64 X.509 SubjectPublicKeyInfo of the signing key, when present. */
  publicKeyBase64: string | null
  /** CRX id (also the extension id) as hex→a-p, when present. */
  crxId: string | null
}

/**
 * Read one CRX container.
 * @param bytes - whole file contents.
 * @returns the payload plus the identity facts the header carries.
 * @throws when the file is not a CRX or its header is truncated.
 */
export function parseCrx(bytes: Buffer): CrxArchive {
  if (bytes.length < 12 || bytes.subarray(0, 4).toString('latin1') !== CRX_MAGIC) {
    throw new Error('不是 CRX 文件 (缺少 Cr24 文件头)')
  }
  const version = bytes.readUInt32LE(4)
  if (version === 3) return parseCrx3(bytes)
  if (version === 2) return parseCrx2(bytes)
  throw new Error(`不支持的 CRX 版本: ${version}`)
}

/** Header facts common to both container versions. */
interface CrxIdentity {
  publicKeyBase64: string | null
  crxId: string | null
}

/** CRX3: magic, version, header length, protobuf header, ZIP. */
function parseCrx3(bytes: Buffer): CrxArchive {
  const headerSize = bytes.readUInt32LE(8)
  const headerStart = 12
  const payloadStart = headerStart + headerSize
  if (headerSize <= 0 || payloadStart > bytes.length) {
    throw new Error('CRX 文件头已损坏 (头部长度越界)')
  }
  const header = bytes.subarray(headerStart, payloadStart)
  const { publicKeyBase64, crxId } = readCrx3Header(header)
  const payload = bytes.subarray(payloadStart)
  if (!isZip(payload)) throw new Error('CRX 载荷不是 ZIP 归档')
  return { version: 3, payload, publicKeyBase64, crxId }
}

/** CRX2: magic, version, key length, signature length, key, signature, ZIP. */
function parseCrx2(bytes: Buffer): CrxArchive {
  const keySize = bytes.readUInt32LE(8)
  const signatureSize = bytes.readUInt32LE(12)
  const keyStart = 16
  const payloadStart = keyStart + keySize + signatureSize
  if (keySize <= 0 || payloadStart > bytes.length) {
    throw new Error('CRX 文件头已损坏 (公钥长度越界)')
  }
  const publicKey = bytes.subarray(keyStart, keyStart + keySize)
  const payload = bytes.subarray(payloadStart)
  if (!isZip(payload)) throw new Error('CRX 载荷不是 ZIP 归档')
  return {
    version: 2,
    payload,
    publicKeyBase64: publicKey.toString('base64'),
    crxId: extensionIdFromPublicKey(publicKey),
  }
}

/** Whether the buffer starts with the ZIP local-file signature. */
function isZip(payload: Buffer): boolean {
  return payload.length > 4 && payload.readUInt32LE(0) === 0x04034b50
}

/** Protobuf wire types this reader understands. */
const WIRE_VARINT = 0
const WIRE_BYTES = 2

/** One length-delimited protobuf field. */
interface ProtoField {
  number: number
  bytes: Buffer
}

/**
 * Walk one protobuf message, yielding its bytes-typed fields.
 *
 * Hand-rolled because the CRX header is the only protobuf this plugin reads:
 * a code generator or a runtime library would be far more machinery than two
 * small loops.
 * @param buffer - encoded message (fields the reader cannot size throw).
 * @returns the length-delimited fields, in wire order.
 * @throws when the encoding is malformed.
 */
function readBytesFields(buffer: Buffer): ProtoField[] {
  const fields: ProtoField[] = []
  let offset = 0
  while (offset < buffer.length) {
    const key = readVarint(buffer, offset)
    offset = key.offset
    const number = key.value >>> 3
    const wireType = key.value & 0x07
    if (wireType === WIRE_VARINT) {
      offset = readVarint(buffer, offset).offset
      continue
    }
    if (wireType !== WIRE_BYTES) {
      throw new Error(`CRX 文件头包含不支持的 protobuf 字段类型 ${wireType}`)
    }
    const length = readVarint(buffer, offset)
    offset = length.offset
    const end = offset + length.value
    if (end > buffer.length) throw new Error('CRX 文件头已损坏 (字段长度越界)')
    fields.push({ number, bytes: buffer.subarray(offset, end) })
    offset = end
  }
  return fields
}

/** Read one varint at an offset. */
function readVarint(buffer: Buffer, start: number): { value: number; offset: number } {
  let value = 0
  let shift = 0
  let offset = start
  while (offset < buffer.length) {
    const byte = buffer[offset]
    offset += 1
    value += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) === 0) return { value, offset }
    shift += 7
    if (shift > 63) break
  }
  throw new Error('CRX 文件头已损坏 (varint 溢出)')
}

/** CrxFileHeader field numbers (components/crx_file/crx3.proto). */
const CRX3_RSA_PROOFS = 2
const CRX3_ECDSA_PROOFS = 3
const CRX3_SIGNED_HEADER_DATA = 10000

/** AsymmetricKeyProof.public_key. */
const PROOF_PUBLIC_KEY = 1

/** SignedData.crx_id. */
const SIGNED_DATA_CRX_ID = 1

/**
 * Extract the identity facts from a CRX3 protobuf header.
 * @param header - header bytes (without magic and length fields).
 * @returns the publisher key and CRX id when the header carries them.
 */
function readCrx3Header(header: Buffer): CrxIdentity {
  let publicKey: Buffer | null = null
  let crxIdBytes: Buffer | null = null
  try {
    for (const field of readBytesFields(header)) {
      if (field.number === CRX3_RSA_PROOFS || field.number === CRX3_ECDSA_PROOFS) {
        publicKey ??= readProofPublicKey(field.bytes)
      } else if (field.number === CRX3_SIGNED_HEADER_DATA) {
        crxIdBytes ??= readSignedDataCrxId(field.bytes)
      }
    }
  } catch {
    // A header this reader cannot walk still leaves a usable ZIP payload:
    // the extension then simply gets the ID Chrome derives from its path.
    return { publicKeyBase64: null, crxId: null }
  }
  return {
    publicKeyBase64: publicKey === null ? null : publicKey.toString('base64'),
    crxId: crxIdBytes === null ? null : extensionIdFromCrxId(crxIdBytes),
  }
}

/** Read `AsymmetricKeyProof.public_key` out of one proof message. */
function readProofPublicKey(proof: Buffer): Buffer | null {
  for (const field of readBytesFields(proof)) {
    if (field.number === PROOF_PUBLIC_KEY && field.bytes.length > 0) return Buffer.from(field.bytes)
  }
  return null
}

/** Read `SignedData.crx_id` out of the signed-header-data message. */
function readSignedDataCrxId(signedData: Buffer): Buffer | null {
  for (const field of readBytesFields(signedData)) {
    if (field.number === SIGNED_DATA_CRX_ID && field.bytes.length === 16) return Buffer.from(field.bytes)
  }
  return null
}

/** Chrome's extension-id alphabet: hex digits shifted into a-p. */
export function extensionIdFromCrxId(crxId: Buffer): string {
  return crxId.toString('hex').replace(/[0-9a-f]/gu, (digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)))
}

/**
 * Derive the extension id from a CRX2/RSA public key: the first 16 bytes of
 * its SHA-256, mapped into the a-p alphabet.
 * @param publicKey - X.509 SubjectPublicKeyInfo bytes.
 * @returns the 32 character extension id.
 */
export function extensionIdFromPublicKey(publicKey: Buffer): string {
  const digest = createHash('sha256').update(publicKey).digest().subarray(0, 16)
  return extensionIdFromCrxId(digest)
}
