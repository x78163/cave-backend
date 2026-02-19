import { useState } from 'react'

export default function StarRating({ value = 0, onChange, size = 'text-lg' }) {
  const [hoverValue, setHoverValue] = useState(0)
  const interactive = !!onChange
  const displayValue = interactive && hoverValue > 0 ? hoverValue : value

  return (
    <div className="star-rating" onMouseLeave={() => interactive && setHoverValue(0)}>
      {[1, 2, 3, 4, 5].map(i => (
        <span
          key={i}
          className={`star ${size} ${i <= displayValue ? 'filled' : 'empty'}`}
          onClick={() => onChange?.(i)}
          onMouseEnter={() => interactive && setHoverValue(i)}
          style={{ cursor: interactive ? 'pointer' : 'default' }}
        >
          ★
        </span>
      ))}
    </div>
  )
}
