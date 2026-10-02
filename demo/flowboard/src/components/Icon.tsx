export type IconName =
  | 'board'
  | 'check-square'
  | 'clock'
  | 'download'
  | 'filter'
  | 'grip'
  | 'plus'
  | 'search'
  | 'sort'
  | 'square'
  | 'trash'
  | 'undo'
  | 'upload'
  | 'x'

const PATHS: Record<IconName, string> = {
  board: 'M3 4h5v16H3zM10 4h5v10h-5zM17 4h4v7h-4z',
  'check-square': 'M4 4h12v12H4zM7 10l2.2 2.2L13 7.6',
  clock: 'M8 1.8a6.2 6.2 0 100 12.4A6.2 6.2 0 008 1.8zM8 5v3.4l2.4 1.4',
  download: 'M8 2v8M4.6 7.2L8 10.6l3.4-3.4M3 13.4h10',
  filter: 'M2.6 4h10.8l-4.2 4.6v4.2l-2.4 1.4V8.6z',
  grip: 'M6 4.4h.01M6 8h.01M6 11.6h.01M10 4.4h.01M10 8h.01M10 11.6h.01',
  plus: 'M8 3.4v9.2M3.4 8h9.2',
  search: 'M7.2 2.6a4.6 4.6 0 100 9.2 4.6 4.6 0 000-9.2zM10.6 10.6L14 14',
  sort: 'M4 5h8M4 8h5M4 11h3',
  square: 'M4 4h8v8H4z',
  trash: 'M3.4 5h9.2M6.2 5V3.6h3.6V5M5 5l.6 9h4.8l.6-9',
  undo: 'M6 4.4L2.8 7.6 6 10.8M2.8 7.6H10a3.6 3.6 0 010 7.2H7',
  upload: 'M8 12V4M4.6 7.4L8 4l3.4 3.4M3 14h10',
  x: 'M4 4l8 8M12 4l-8 8',
}

interface IconProps {
  name: IconName
  size?: number
  /** Set when the icon is the only content of a control and the control has no label. */
  title?: string
}

export default function Icon({ name, size = 16, title }: IconProps) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  )
}
