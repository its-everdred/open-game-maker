import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { GlassPane, GlassProgress, GlassRow, GlassStatus } from './Glass';
import { glassActivation } from './activation';

const classes = (...items: (string | undefined)[]) => items.filter(Boolean).join(' ');

export function GlassTag({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} className={classes('ogm-glass-tag', className)} />;
}

export function GlassMenuItem({
  className,
  type = 'button',
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      type={type}
      onClick={glassActivation(props['aria-disabled'], onClick)}
      className={classes('ogm-glass-row', 'ogm-glass-menu-item', className)}
    />
  );
}

type ResourceChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  minerals: number;
  gas: number;
  mineralIcon: ReactNode;
  gasIcon: ReactNode;
};
export function GlassResourceChip({
  minerals,
  gas,
  mineralIcon,
  gasIcon,
  className,
  type = 'button',
  onClick,
  ...props
}: ResourceChipProps) {
  const min = Math.max(0, Math.min(100, Number.isFinite(minerals) ? minerals : 0));
  const remainingGas = Math.max(0, Math.min(100, Number.isFinite(gas) ? gas : 0));
  const low = Math.min(min, remainingGas);
  return (
    <button
      {...props}
      type={type}
      onClick={glassActivation(props['aria-disabled'], onClick)}
      aria-label={props['aria-label'] ?? `Minerals ${min}%, Gas ${remainingGas}%`}
      className={classes('ogm-glass-resources', low === 0 ? 'ogm-out' : low <= 10 ? 'ogm-low' : undefined, className)}
    >
      <span aria-hidden="true">{mineralIcon}</span>
      <span>{min}</span>
      <span className="ogm-resource-separator" aria-hidden="true" />
      <span aria-hidden="true">{gasIcon}</span>
      <span>{remainingGas}</span>
    </button>
  );
}

export function GlassActivityBanner({
  className,
  type = 'button',
  children,
  endIcon,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { endIcon?: ReactNode }) {
  return (
    <button
      {...props}
      type={type}
      onClick={glassActivation(props['aria-disabled'], onClick)}
      className={classes('ogm-glass-banner', className)}
    >
      <span className="ogm-banner-pulse" aria-hidden="true" />
      <span className="ogm-banner-text">{children}</span>
      {endIcon != null && <span aria-hidden="true">{endIcon}</span>}
    </button>
  );
}

type ActivityRowProps = HTMLAttributes<HTMLDivElement> & {
  title: string;
  detail: string;
  progress: number;
  state: 'work' | 'you' | 'done' | 'fail' | 'wait' | 'soon';
  status: string;
};
export function GlassActivityRow({ title, detail, progress, state, status, children, ...props }: ActivityRowProps) {
  return (
    <GlassRow {...props}>
      <div className="ogm-activity-content" data-state={state}>
        <div className="ogm-activity-heading">
          <span>{title}</span>
          <span>{Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0))}%</span>
        </div>
        <GlassProgress
          label={`${title} progress`}
          value={progress}
          tone={state === 'you' ? 'you' : state === 'done' ? 'done' : 'work'}
        />
        <div className="ogm-activity-detail">
          <GlassStatus tone={state}>{status}</GlassStatus>
          <span>{detail}</span>
        </div>
      </div>
      {children}
    </GlassRow>
  );
}

type MessageProps = HTMLAttributes<HTMLDivElement> & { tone: 'agent' | 'self' | 'system' };
export function GlassChatMessage({ tone, className, ...props }: MessageProps) {
  return <div {...props} className={classes('ogm-glass-message', `ogm-message-${tone}`, className)} />;
}

/** Wraps the existing Aiur composer; it does not implement another composer. */
export function GlassComposerChrome({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={classes('ogm-glass-composer', className)} />;
}

export function GlassMenu({ label, className, ...props }: HTMLAttributes<HTMLDivElement> & { label: string }) {
  return (
    <GlassPane {...props} strong role="group" aria-label={label} className={classes('ogm-glass-menu', className)} />
  );
}

type ResourceMeterProps = HTMLAttributes<HTMLDivElement> & {
  resource: 'minerals' | 'gas';
  value: number;
  icon: ReactNode;
  detail: string;
};
export function GlassResourceMeter({ resource, value, icon, detail, className, ...props }: ResourceMeterProps) {
  const percent = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  const name = resource === 'minerals' ? 'Minerals' : 'Gas';
  return (
    <div
      {...props}
      className={classes(
        'ogm-glass-meter',
        percent === 0 ? 'ogm-out' : percent <= 10 ? 'ogm-low' : undefined,
        className,
      )}
    >
      <div className="ogm-meter-heading">
        <span className="ogm-meter-icon" aria-hidden="true">
          {icon}
        </span>
        <span>{name}</span>
        <strong>{percent}%</strong>
      </div>
      <GlassProgress label={`${name} remaining`} value={percent} tone={resource} />
      <span className="ogm-meter-detail">{detail}</span>
    </div>
  );
}

export function GlassToast({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <GlassPane {...props} strong role="status" className={classes('ogm-glass-toast', className)} />;
}
