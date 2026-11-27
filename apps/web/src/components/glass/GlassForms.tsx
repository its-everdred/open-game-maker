import type { CSSProperties, InputHTMLAttributes, ReactNode } from 'react';
import './glass.css';

type Segment = { value: string; label: ReactNode; ariaLabel?: string; disabled?: boolean };
export function GlassSegmented({
  label,
  value,
  options,
  onValueChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: readonly Segment[];
  onValueChange(value: string): void;
  disabled?: boolean;
}) {
  return (
    <div className="ogm-glass-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled || option.disabled}
          aria-label={option.ariaLabel}
          aria-pressed={option.value === value}
          onClick={() => onValueChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

type SliderProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'min' | 'max'> & {
  value: number;
  min?: number;
  max?: number;
};
export function GlassSlider({ value, min = 0, max = 100, className, style, ...props }: SliderProps) {
  const low = Number.isFinite(min) ? min : 0;
  const high = Number.isFinite(max) && max > low ? max : low + 1;
  const bounded = Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : low;
  const requestedStep = Number(props.step);
  const step = Number.isFinite(requestedStep) && requestedStep > 0 ? requestedStep : 1;
  const current =
    props.step === 'any'
      ? bounded
      : Number(
          (low + Math.min(Math.round((bounded - low) / step), Math.floor((high - low) / step)) * step).toPrecision(15),
        );
  const fill = `${((current - low) / (high - low)) * 100}%`;
  return (
    <input
      {...props}
      type="range"
      min={low}
      max={high}
      value={current}
      className={['ogm-glass-slider', className].filter(Boolean).join(' ')}
      style={{ ...style, '--ogm-slider-fill': fill } as CSSProperties}
    />
  );
}

export function GlassField({ id, label, children }: { id: string; label: ReactNode; children: ReactNode }) {
  return (
    <div className="ogm-glass-field">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}
