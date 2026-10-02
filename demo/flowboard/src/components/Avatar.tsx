import { initials } from '../lib/format'

interface AvatarProps {
  name: string
  size?: number
}

/** Deterministic colour per name, so a person looks the same everywhere. */
function hue(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 360
  return hash
}

export default function Avatar({ name, size = 24 }: AvatarProps) {
  const background = `hsl(${hue(name)} 42% 46%)`

  return (
    <span
      className="avatar"
      title={name}
      style={{ width: size, height: size, background, fontSize: Math.round(size * 0.42) }}
    >
      {initials(name)}
    </span>
  )
}
