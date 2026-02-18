export default function StarRating({ value = 0, onChange, size = 'text-lg' }) {
  return (
    <div className="star-rating">
      {[1, 2, 3, 4, 5].map(i => (
        <span
          key={i}
          className={`star ${size} ${i <= value ? 'filled' : 'empty'}`}
          onClick={() => onChange?.(i)}
          style={{ cursor: onChange ? 'pointer' : 'default' }}
        >
          ★
        </span>
      ))}
    </div>
  )
}
