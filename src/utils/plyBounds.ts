type PlyFormat = 'ascii' | 'binary_little_endian' | 'binary_big_endian' | 'unknown'

type PlyBounds = {
  center: [number, number, number]
  radius: number
  samples: number
  format: PlyFormat
}

type PlyScalarType =
  | 'int8'
  | 'uint8'
  | 'int16'
  | 'uint16'
  | 'int32'
  | 'uint32'
  | 'float32'
  | 'float64'

type PlyProperty = {
  name: string
  type: PlyScalarType
  offset: number
}

type PlyHeader = {
  format: PlyFormat
  vertexCount: number
  properties: PlyProperty[]
  headerByteLength: number
}

type HeaderResult = {
  headerText: string
  headerByteLength: number
  remainder: Uint8Array
  reader: ReadableStreamDefaultReader<Uint8Array> | null
}

const TYPE_SIZE: Record<PlyScalarType, number> = {
  int8: 1,
  uint8: 1,
  int16: 2,
  uint16: 2,
  int32: 4,
  uint32: 4,
  float32: 4,
  float64: 8,
}

const TYPE_ALIASES: Record<string, PlyScalarType> = {
  char: 'int8',
  int8: 'int8',
  uchar: 'uint8',
  uint8: 'uint8',
  short: 'int16',
  int16: 'int16',
  ushort: 'uint16',
  uint16: 'uint16',
  int: 'int32',
  int32: 'int32',
  uint: 'uint32',
  uint32: 'uint32',
  float: 'float32',
  float32: 'float32',
  double: 'float64',
  float64: 'float64',
}

const normalizeType = (type: string): PlyScalarType | null => {
  const normalized = TYPE_ALIASES[type]
  return normalized ?? null
}

const parseHeader = (headerText: string, headerByteLength: number): PlyHeader | null => {
  const lines = headerText.split(/\r?\n/)
  let format: PlyFormat = 'unknown'
  let vertexCount = 0
  let properties: PlyProperty[] = []
  let currentElement: string | null = null
  let vertexOffset = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('format ')) {
      const [, fmt] = trimmed.split(/\s+/)
      if (fmt === 'ascii') format = 'ascii'
      if (fmt === 'binary_little_endian') format = 'binary_little_endian'
      if (fmt === 'binary_big_endian') format = 'binary_big_endian'
      continue
    }
    if (trimmed.startsWith('element ')) {
      const [, name, count] = trimmed.split(/\s+/)
      currentElement = name
      if (name === 'vertex') {
        vertexCount = Number(count)
        properties = []
        vertexOffset = 0
      }
      continue
    }
    if (currentElement === 'vertex' && trimmed.startsWith('property ')) {
      if (trimmed.startsWith('property list')) {
        return null
      }
      const [, typeName, propName] = trimmed.split(/\s+/)
      const type = normalizeType(typeName)
      if (!type) return null
      properties.push({ name: propName, type, offset: vertexOffset })
      vertexOffset += TYPE_SIZE[type]
    }
  }

  if (!vertexCount || !properties.length) return null
  return { format, vertexCount, properties, headerByteLength }
}

const concatUint8 = (chunks: Uint8Array[]) => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

const findHeaderEnd = (text: string) => {
  const idx = text.indexOf('end_header')
  if (idx === -1) return -1
  const newlineIdx = text.indexOf('\n', idx)
  if (newlineIdx === -1) return -1
  return newlineIdx + 1
}

const readHeaderFromStream = async (response: Response): Promise<HeaderResult | null> => {
  const reader = response.body?.getReader()
  if (!reader) return null
  const decoder = new TextDecoder('ascii')
  let headerText = ''
  const chunks: Uint8Array[] = []
  let headerByteLength = 0

  while (true) {
    const { value, done } = await reader.read()
    if (value) {
      chunks.push(value)
      headerText += decoder.decode(value, { stream: true })
      const endIndex = findHeaderEnd(headerText)
      if (endIndex !== -1) {
        headerText = headerText.slice(0, endIndex)
        headerByteLength = headerText.length
        const combined = concatUint8(chunks)
        const remainder = combined.slice(headerByteLength)
        return { headerText, headerByteLength, remainder, reader }
      }
    }
    if (done) break
  }
  return null
}

const readHeaderFromBuffer = (buffer: ArrayBuffer): HeaderResult | null => {
  const bytes = new Uint8Array(buffer)
  const endMarker = new TextEncoder().encode('end_header')
  for (let i = 0; i < bytes.length - endMarker.length; i += 1) {
    let matched = true
    for (let j = 0; j < endMarker.length; j += 1) {
      if (bytes[i + j] !== endMarker[j]) {
        matched = false
        break
      }
    }
    if (matched) {
      let newlineIdx = i + endMarker.length
      while (newlineIdx < bytes.length && bytes[newlineIdx] !== 10) {
        newlineIdx += 1
      }
      if (newlineIdx < bytes.length) {
        const headerByteLength = newlineIdx + 1
        const headerText = new TextDecoder('ascii').decode(bytes.slice(0, headerByteLength))
        const remainder = bytes.slice(headerByteLength)
        return { headerText, headerByteLength, remainder, reader: null }
      }
    }
  }
  return null
}

const readScalar = (view: DataView, offset: number, type: PlyScalarType, littleEndian: boolean) => {
  switch (type) {
    case 'int8':
      return view.getInt8(offset)
    case 'uint8':
      return view.getUint8(offset)
    case 'int16':
      return view.getInt16(offset, littleEndian)
    case 'uint16':
      return view.getUint16(offset, littleEndian)
    case 'int32':
      return view.getInt32(offset, littleEndian)
    case 'uint32':
      return view.getUint32(offset, littleEndian)
    case 'float32':
      return view.getFloat32(offset, littleEndian)
    case 'float64':
      return view.getFloat64(offset, littleEndian)
  }
}

const getProperty = (properties: PlyProperty[], name: string) =>
  properties.find((prop) => prop.name === name) ?? null

const sampleBinaryBlock = (
  buffer: ArrayBuffer,
  maxSamples: number,
  stride: number,
  xProp: PlyProperty,
  yProp: PlyProperty,
  zProp: PlyProperty,
  littleEndian: boolean,
  bounds: { min: [number, number, number]; max: [number, number, number] }
) => {
  const available = Math.floor(buffer.byteLength / stride)
  if (available <= 0 || maxSamples <= 0) return 0
  const count = Math.min(maxSamples, available)
  const view = new DataView(buffer)
  for (let i = 0; i < count; i += 1) {
    const sampleIndex = count === 1 ? 0 : Math.floor((i * (available - 1)) / (count - 1))
    const base = sampleIndex * stride
    const x = readScalar(view, base + xProp.offset, xProp.type, littleEndian)
    const y = readScalar(view, base + yProp.offset, yProp.type, littleEndian)
    const z = readScalar(view, base + zProp.offset, zProp.type, littleEndian)
    bounds.min[0] = Math.min(bounds.min[0], x)
    bounds.min[1] = Math.min(bounds.min[1], y)
    bounds.min[2] = Math.min(bounds.min[2], z)
    bounds.max[0] = Math.max(bounds.max[0], x)
    bounds.max[1] = Math.max(bounds.max[1], y)
    bounds.max[2] = Math.max(bounds.max[2], z)
  }
  return count
}

const sampleAsciiStream = async (
  reader: ReadableStreamDefaultReader<Uint8Array> | null,
  remainder: Uint8Array,
  header: PlyHeader,
  sampleCount: number,
  bounds: { min: [number, number, number]; max: [number, number, number] }
) => {
  const xProp = getProperty(header.properties, 'x')
  const yProp = getProperty(header.properties, 'y')
  const zProp = getProperty(header.properties, 'z')
  if (!xProp || !yProp || !zProp) return 0

  const decoder = new TextDecoder()
  let buffer = decoder.decode(remainder)
  let cursor = 0
  let samples = 0
  const xIndex = header.properties.indexOf(xProp)
  const yIndex = header.properties.indexOf(yProp)
  const zIndex = header.properties.indexOf(zProp)
  const maxIndex = Math.max(xIndex, yIndex, zIndex)

  const readLine = () => {
    const newlineIdx = buffer.indexOf('\n', cursor)
    if (newlineIdx === -1) return null
    const line = buffer.slice(cursor, newlineIdx)
    cursor = newlineIdx + 1
    return line
  }

  while (samples < sampleCount) {
    let line = readLine()
    if (line === null) {
      if (!reader) break
      const { value, done } = await reader.read()
      if (done) break
      buffer = buffer.slice(cursor) + decoder.decode(value, { stream: true })
      cursor = 0
      line = readLine()
      if (line === null) continue
    }
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split(/\s+/)
    if (parts.length <= maxIndex) continue
    const x = Number(parts[xIndex])
    const y = Number(parts[yIndex])
    const z = Number(parts[zIndex])
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    bounds.min[0] = Math.min(bounds.min[0], x)
    bounds.min[1] = Math.min(bounds.min[1], y)
    bounds.min[2] = Math.min(bounds.min[2], z)
    bounds.max[0] = Math.max(bounds.max[0], x)
    bounds.max[1] = Math.max(bounds.max[1], y)
    bounds.max[2] = Math.max(bounds.max[2], z)
    samples += 1
  }

  return samples
}

const fetchRange = async (url: string, start: number, length: number) => {
  const end = start + length - 1
  const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } })
  if (response.status !== 206) return null
  return response.arrayBuffer()
}

export const estimateBoundsFromPLY = async (
  url: string,
  options: { sampleCount?: number; debug?: boolean } = {}
): Promise<PlyBounds | null> => {
  const sampleCount = options.sampleCount ?? 4096
  const debug = options.debug ?? false
  const bounds = {
    min: [Infinity, Infinity, Infinity] as [number, number, number],
    max: [-Infinity, -Infinity, -Infinity] as [number, number, number],
  }

  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`PLY fetch failed: ${response.status}`)
    const contentLength = Number(response.headers.get('content-length') ?? '0')

    let headerResult = response.body ? await readHeaderFromStream(response) : null
    if (!headerResult) {
      if (response.bodyUsed) return null
      const buffer = await response.arrayBuffer()
      headerResult = readHeaderFromBuffer(buffer)
      if (!headerResult) return null
      if (debug) console.log('PLY bounds fallback to arrayBuffer header parse')
    }

    const header = parseHeader(headerResult.headerText, headerResult.headerByteLength)
    if (!header) return null

    const xProp = getProperty(header.properties, 'x')
    const yProp = getProperty(header.properties, 'y')
    const zProp = getProperty(header.properties, 'z')
    if (!xProp || !yProp || !zProp) return null

    let samples = 0
    if (header.format === 'ascii') {
      samples = await sampleAsciiStream(
        headerResult.reader,
        headerResult.remainder,
        header,
        Math.min(sampleCount, header.vertexCount),
        bounds
      )
    } else if (header.format === 'binary_little_endian' || header.format === 'binary_big_endian') {
      headerResult.reader?.cancel()
      const stride = header.properties.reduce((sum, prop) => sum + TYPE_SIZE[prop.type], 0)
      const littleEndian = header.format === 'binary_little_endian'
      const remainderBuffer =
        headerResult.remainder.byteLength > 0
          ? (headerResult.remainder.buffer.slice(
              headerResult.remainder.byteOffset,
              headerResult.remainder.byteOffset + headerResult.remainder.byteLength
            ) as ArrayBuffer)
          : new ArrayBuffer(0)
      samples += sampleBinaryBlock(
        remainderBuffer,
        Math.min(sampleCount, header.vertexCount),
        stride,
        xProp,
        yProp,
        zProp,
        littleEndian,
        bounds
      )

      const remaining = Math.min(sampleCount, header.vertexCount) - samples
      if (remaining > 0 && contentLength > header.headerByteLength + stride) {
        const dataBytes = contentLength - header.headerByteLength
        const blocks = 4
        const samplesPerBlock = Math.ceil(remaining / blocks)
        const blockBytes = samplesPerBlock * stride
        for (let i = 1; i < blocks; i += 1) {
          const t = i / (blocks - 1)
          const start = header.headerByteLength + Math.floor((dataBytes - blockBytes) * t)
          const rangeBuffer = await fetchRange(url, start, blockBytes)
          if (!rangeBuffer) continue
          samples += sampleBinaryBlock(
            rangeBuffer,
            Math.min(samplesPerBlock, remaining - (i - 1) * samplesPerBlock),
            stride,
            xProp,
            yProp,
            zProp,
            littleEndian,
            bounds
          )
        }
      }
    } else {
      return null
    }

    if (!Number.isFinite(bounds.min[0]) || !Number.isFinite(bounds.max[0]) || samples <= 0) {
      return null
    }
    const center: [number, number, number] = [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    ]
    const radius = Math.hypot(
      bounds.max[0] - center[0],
      bounds.max[1] - center[1],
      bounds.max[2] - center[2]
    )

    if (debug) {
      console.log(
        `PLY bounds estimated center=${center.map((v) => v.toFixed(2)).join(',')} radius=${radius.toFixed(2)} samples=${samples} format=${header.format}`
      )
    }

    return { center, radius, samples, format: header.format }
  } catch (error) {
    if (debug) console.warn('PLY bounds estimate failed', error)
    return null
  }
}
