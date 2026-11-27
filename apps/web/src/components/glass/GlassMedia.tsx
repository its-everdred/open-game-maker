import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { glassActivation } from './activation';
import './glass.css';

const classes = (...items: (string | undefined | false)[]) => items.filter(Boolean).join(' ');
type Accent = 'go' | 'create' | 'warn' | 'info' | 'danger' | 'live';

type OptionProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-pressed'> & {
  label: string;
  icon: ReactNode;
  selected: boolean;
  accent: Accent;
};

export function GlassOption({
  label,
  icon,
  selected,
  accent,
  className,
  type = 'button',
  onClick,
  ...props
}: OptionProps) {
  return (
    <button
      {...props}
      type={type}
      aria-pressed={selected}
      onClick={glassActivation(props['aria-disabled'], onClick)}
      className={classes('ogm-glass-option', `ogm-tone-${accent}`, className)}
    >
      <span className="ogm-option-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

type CoverProps = Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children'> & {
  title: string;
  image: string;
  imageAlt?: string;
  aspect?: 'wide' | 'phone';
  badges?: ReactNode;
};

export function GlassCover({ title, image, imageAlt = '', aspect = 'wide', badges, className, ...props }: CoverProps) {
  return (
    <div {...props} className={classes('ogm-glass-cover', `ogm-cover-${aspect}`, className)}>
      <img src={image} alt={imageAlt} />
      <span className="ogm-cover-shade" aria-hidden="true" />
      {badges && <div className="ogm-cover-badges">{badges}</div>}
      <div className="ogm-cover-meta">
        <span className="ogm-cover-name">{title}</span>
      </div>
    </div>
  );
}
