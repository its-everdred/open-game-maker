import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react';

import { glassActivation } from './activation';
import './glass.css';

type Tone = 'glass' | 'go' | 'create' | 'warn' | 'info' | 'danger' | 'ghost' | 'glassy';
type Size = 'sm' | 'md' | 'lg';
const classes = (...items: (string | undefined | false)[]) => items.filter(Boolean).join(' ');

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: Tone;
  size?: Size;
  block?: boolean;
  embedded?: boolean;
  accent?: 'go' | 'create' | 'warn' | 'info' | 'danger' | 'live';
};
export function GlassButton({
  tone = 'glass',
  size = 'md',
  block,
  embedded,
  accent,
  className,
  type = 'button',
  onClick,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      onClick={glassActivation(props['aria-disabled'], onClick)}
      className={classes(
        'ogm-glass-button',
        `ogm-tone-${tone}`,
        `ogm-size-${size}`,
        block && 'ogm-block',
        embedded && 'ogm-embedded',
        tone === 'glassy' && accent && `ogm-accent-${accent}`,
        className,
      )}
    />
  );
}

type OrbProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  'aria-label': string;
  tone?: 'glass' | 'go' | 'create' | 'danger' | 'live';
  size?: Size | 'fab';
  badge?: ReactNode;
};
export function GlassOrb({
  tone = 'glass',
  size = 'md',
  badge,
  className,
  type = 'button',
  children,
  onClick,
  ...props
}: OrbProps) {
  if (!props['aria-label'].trim()) throw new Error('GlassOrb requires a non-empty aria-label');
  return (
    <button
      {...props}
      type={type}
      onClick={glassActivation(props['aria-disabled'], onClick)}
      className={classes('ogm-glass-orb', `ogm-tone-${tone}`, `ogm-size-${size}`, className)}
    >
      {children}
      {badge != null && (
        <span className="ogm-glass-badge" aria-hidden="true">
          {badge}
        </span>
      )}
    </button>
  );
}

type PaneProps = HTMLAttributes<HTMLDivElement> & {
  strong?: boolean;
  tint?: 'go' | 'create' | 'warn' | 'info' | 'danger' | 'live';
};
export function GlassPane({ strong, tint, className, ...props }: PaneProps) {
  return (
    <div
      {...props}
      className={classes(
        'ogm-glass-pane',
        strong && 'ogm-strong',
        tint && 'ogm-tint',
        tint && `ogm-tone-${tint}`,
        className,
      )}
    />
  );
}

export function GlassSheet({
  className,
  placement = 'inset',
  ...props
}: HTMLAttributes<HTMLDivElement> & { placement?: 'inset' | 'bottom' }) {
  return (
    <GlassPane
      {...props}
      strong
      className={classes('ogm-glass-sheet', placement === 'bottom' && 'ogm-bottom', className)}
    />
  );
}

type StatusProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  children: ReactNode;
  tone: 'work' | 'you' | 'done' | 'fail' | 'wait' | 'soon';
};
export function GlassStatus({ tone, className, ...props }: StatusProps) {
  return <span {...props} className={classes('ogm-glass-status', `ogm-status-${tone}`, className)} />;
}

export function GlassRow({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={classes('ogm-glass-row', className)} />;
}

type SwitchProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'role' | 'aria-checked' | 'onChange'> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};
export function GlassSwitch({ checked, onCheckedChange, className, type = 'button', onClick, ...props }: SwitchProps) {
  return (
    <button
      {...props}
      type={type}
      role="switch"
      aria-checked={checked}
      className={classes('ogm-glass-switch', className)}
      onClick={glassActivation(props['aria-disabled'], (event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange(!checked);
      })}
    />
  );
}

export function GlassInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={classes('ogm-glass-input', className)} />;
}

export function GlassTextarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={classes('ogm-glass-input', className)} />;
}

type ProgressProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  value: number;
  label: string;
  tone?: 'work' | 'you' | 'done' | 'minerals' | 'gas';
};
export function GlassProgress({ value, label, tone = 'work', className, ...props }: ProgressProps) {
  const percent = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div
      {...props}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={classes('ogm-glass-progress', `ogm-progress-${tone}`, className)}
    >
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}
