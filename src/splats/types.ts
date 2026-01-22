export type CameraPose = {
  position: [number, number, number]
  target: [number, number, number]
}

export type SplatEntry = {
  id: string
  name: string
  file: string
  poster?: string | null
  poses?: CameraPose[] | null
}
