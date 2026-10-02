import type { Annotation, Point } from '@pdf-atelier/core'

const pathD = (pts: Point[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')

function arrowHead(from: Point, to: Point, size: number) {
  const a = Math.atan2(to.y - from.y, to.x - from.x)
  const p = (da: number) => `${to.x - size * Math.cos(a + da)},${to.y - size * Math.sin(a + da)}`
  return `${to.x},${to.y} ${p(0.45)} ${p(-0.45)}`
}

/** Draws one domain annotation in page coordinates. */
export function Shape({ a }: { a: Annotation }) {
  const { color, fill, strokeWidth, opacity } = a.style
  const stroke = {
    stroke: color,
    strokeWidth,
    fill: 'none',
    opacity,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (a.type) {
    case 'highlight':
      return (
        <g opacity={opacity} style={{ mixBlendMode: 'multiply' }}>
          {a.rects.map((r, i) => (
            <rect key={i} x={r.x} y={r.y} width={r.width} height={r.height} fill={color} />
          ))}
        </g>
      )
    case 'underline':
    case 'strikeout':
      return (
        <g opacity={opacity} stroke={color}>
          {a.rects.map((r, i) => {
            const y = a.type === 'underline' ? r.y + r.height * 0.94 : r.y + r.height / 2
            return (
              <line
                key={i}
                x1={r.x}
                x2={r.x + r.width}
                y1={y}
                y2={y}
                strokeWidth={Math.max(1, r.height * 0.07)}
              />
            )
          })}
        </g>
      )
    case 'ink':
      return (
        <g {...stroke}>
          {a.paths.map((p, i) => (
            <path key={i} d={pathD(p)} />
          ))}
        </g>
      )
    case 'rect':
      return (
        <rect
          {...stroke}
          fill={fill ?? 'none'}
          x={a.rect.x}
          y={a.rect.y}
          width={a.rect.width}
          height={a.rect.height}
        />
      )
    case 'ellipse': {
      const { x, y, width, height } = a.rect
      return (
        <ellipse
          {...stroke}
          fill={fill ?? 'none'}
          cx={x + width / 2}
          cy={y + height / 2}
          rx={width / 2}
          ry={height / 2}
        />
      )
    }
    case 'line':
    case 'arrow':
      return (
        <g {...stroke}>
          <line x1={a.from.x} y1={a.from.y} x2={a.to.x} y2={a.to.y} />
          {a.type === 'arrow' && (
            <polygon points={arrowHead(a.from, a.to, 6 + strokeWidth * 3)} fill={color} />
          )}
        </g>
      )
    case 'freetext':
      return (
        <foreignObject
          x={a.rect.x}
          y={a.rect.y}
          width={a.rect.width}
          height={a.rect.height}
          opacity={opacity}
        >
          <div
            style={{
              fontSize: a.fontSize,
              color,
              lineHeight: 1.2,
              fontFamily: 'Helvetica, Arial, sans-serif',
            }}
            className="h-full w-full overflow-hidden px-0.5 break-words whitespace-pre-wrap"
          >
            {a.text}
          </div>
        </foreignObject>
      )
  }
}
