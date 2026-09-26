/**
 * Synthetic extension fixtures: a minimal MV3 tree plus the CRX containers
 * around it, built in memory so the unpack path is exercised without shipping
 * a binary blob.
 *
 * The signing key is arbitrary bytes: the plugin only reads the public key out
 * of the CRX header to write `manifest.key`, and never verifies signatures.
 * Real Chrome would reject such a key, so the real-browser smoke test uses an
 * unpacked directory instead of a crx.
 */
import { zipSync, strToU8 } from 'fflate'

/** One generated extension tree: relative path → file bytes. */
export type ExtensionTree = Record<string, Uint8Array>

/** The public key bytes a generated crx claims (any bytes will do). */
export const FIXTURE_PUBLIC_KEY = Buffer.from('fixture-public-key-bytes', 'utf8')

/** The crx id bytes a generated crx claims (16 bytes, as Chrome expects). */
export const FIXTURE_CRX_ID = Buffer.from('0123456789abcdef', 'utf8')

/** Build one MV3 extension tree. */
export function extensionTree(manifest: Record<string, unknown> = {}): ExtensionTree {
  return {
    'manifest.json': strToU8(`${JSON.stringify({
      manifest_version: 3,
      name: 'Fixture extension',
      version: '1.2.3',
      // `storage` lets the real-browser test check that the extension's own
      // data survives a window relaunch; `onStartup` keeps its service worker
      // reachable right after a launch.
      permissions: ['storage'],
      background: { service_worker: 'background.js' },
      ...manifest,
    }, null, 2)}\n`),
    'background.js': strToU8(`chrome.runtime.onStartup.addListener(async () => {
  const { startups } = await chrome.storage.local.get('startups')
  await chrome.storage.local.set({ startups: (startups ?? 0) + 1 })
});
`),
    'nested/asset.txt': strToU8('nested asset\n'),
  }
}

/** Encode one protobuf varint. */
function varint(value: number): Uint8Array {
  const bytes: number[] = []
  let rest = value
  do {
    const byte = rest & 0x7f
    rest >>>= 7
    bytes.push(rest > 0 ? byte | 0x80 : byte)
  } while (rest > 0)
  return Uint8Array.from(bytes)
}

/** Encode one length-delimited protobuf field. */
function bytesField(number: number, payload: Uint8Array): Uint8Array {
  return Buffer.concat([Buffer.from(varint((number << 3) | 2)), Buffer.from(varint(payload.length)), Buffer.from(payload)])
}

/** Encode one AsymmetricKeyProof message holding just the public key. */
function keyProof(publicKey: Uint8Array): Uint8Array {
  return Buffer.from(bytesField(1, publicKey))
}

/** Encode one SignedData message holding the crx id. */
function signedData(crxId: Uint8Array): Uint8Array {
  return Buffer.from(bytesField(1, crxId))
}

/** Build one CRX3 file around an extension tree. */
export function crx3(tree: ExtensionTree, options: { publicKey?: Uint8Array; crxId?: Uint8Array } = {}): Buffer {
  const header = Buffer.concat([
    Buffer.from(bytesField(2, keyProof(options.publicKey ?? FIXTURE_PUBLIC_KEY))),
    Buffer.from(bytesField(10000, signedData(options.crxId ?? FIXTURE_CRX_ID))),
  ])
  const length = Buffer.alloc(4)
  length.writeUInt32LE(header.length, 0)
  return Buffer.concat([Buffer.from('Cr24', 'latin1'), Buffer.from([3, 0, 0, 0]), length, header, Buffer.from(zipSync(tree))])
}

/** Build one legacy CRX2 file around an extension tree. */
export function crx2(tree: ExtensionTree, options: { publicKey?: Uint8Array } = {}): Buffer {
  const publicKey = Buffer.from(options.publicKey ?? FIXTURE_PUBLIC_KEY)
  const signature = Buffer.alloc(8, 7)
  const keyLength = Buffer.alloc(4)
  keyLength.writeUInt32LE(publicKey.length, 0)
  const signatureLength = Buffer.alloc(4)
  signatureLength.writeUInt32LE(signature.length, 0)
  return Buffer.concat([
    Buffer.from('Cr24', 'latin1'),
    Buffer.from([2, 0, 0, 0]),
    keyLength,
    signatureLength,
    publicKey,
    signature,
    Buffer.from(zipSync(tree)),
  ])
}
