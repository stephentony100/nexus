import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

const { mockWriteBlob, MockWalrusClient } = vi.hoisted(() => {
  const mockWriteBlob = vi.fn()
  const MockWalrusClient = vi.fn().mockImplementation(function (this: any) {
    this.writeBlob = mockWriteBlob
  })
  return { mockWriteBlob, MockWalrusClient }
})

vi.mock('@mysten/walrus', () => ({ WalrusClient: MockWalrusClient }))

import { WalrusUploaderImpl } from './walrus.js'
import { WalrusClient } from '@mysten/walrus'

const SIGNER = Ed25519Keypair.generate()

describe('WalrusUploaderImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('constructs WalrusClient once with network from config (testnet)', () => {
    new WalrusUploaderImpl({ config: { network: 'testnet' }, signer: SIGNER })
    expect(WalrusClient).toHaveBeenCalledTimes(1)
    expect(WalrusClient).toHaveBeenCalledWith(expect.objectContaining({ network: 'testnet' }))
  })

  it('constructs WalrusClient with mainnet when config specifies mainnet', () => {
    new WalrusUploaderImpl({ config: { network: 'mainnet' }, signer: SIGNER })
    expect(WalrusClient).toHaveBeenCalledWith(expect.objectContaining({ network: 'mainnet' }))
  })

  it('does not construct a second WalrusClient on uploadJson call', async () => {
    const uploader = new WalrusUploaderImpl({ config: { network: 'testnet' }, signer: SIGNER })
    mockWriteBlob.mockResolvedValue({ blobId: 'abc123', blobObject: undefined })
    await uploader.uploadJson({ data: { foo: 'bar' } })
    expect(WalrusClient).toHaveBeenCalledTimes(1)
  })

  it('calls writeBlob with JSON-encoded data, default epochs=1, default deletable=false, and signer', async () => {
    const uploader = new WalrusUploaderImpl({ config: { network: 'testnet' }, signer: SIGNER })
    mockWriteBlob.mockResolvedValue({ blobId: 'abc123', blobObject: undefined })

    await uploader.uploadJson({ data: { amount: 100 } })

    expect(mockWriteBlob).toHaveBeenCalledWith({
      blob: new TextEncoder().encode(JSON.stringify({ amount: 100 })),
      epochs: 1,
      deletable: false,
      signer: SIGNER,
    })
  })

  it('propagates custom epochs and deletable to writeBlob', async () => {
    const uploader = new WalrusUploaderImpl({ config: { network: 'testnet' }, signer: SIGNER })
    mockWriteBlob.mockResolvedValue({ blobId: 'xyz', blobObject: undefined })

    await uploader.uploadJson({ data: {}, epochs: 5, deletable: true })

    expect(mockWriteBlob).toHaveBeenCalledWith(
      expect.objectContaining({ epochs: 5, deletable: true }),
    )
  })

  it('returns blobId and blobObjectId from writeBlob result', async () => {
    const uploader = new WalrusUploaderImpl({ config: { network: 'testnet' }, signer: SIGNER })
    mockWriteBlob.mockResolvedValue({ blobId: 'abc123', blobObject: { id: 'obj-1' } })

    const result = await uploader.uploadJson({ data: {} })

    expect(result).toEqual({ blobId: 'abc123', blobObjectId: 'obj-1' })
  })

  it('returns blobObjectId as undefined when blobObject is absent', async () => {
    const uploader = new WalrusUploaderImpl({ config: { network: 'testnet' }, signer: SIGNER })
    mockWriteBlob.mockResolvedValue({ blobId: 'abc123', blobObject: undefined })

    const result = await uploader.uploadJson({ data: {} })

    expect(result).toEqual({ blobId: 'abc123', blobObjectId: undefined })
  })
})
