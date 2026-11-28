import type { ButtonHTMLAttributes, MouseEventHandler } from 'react';

/** ARIA-disabled controls stay focusable but must not activate or bubble a click. */
export function glassActivation(
  disabled: ButtonHTMLAttributes<HTMLButtonElement>['aria-disabled'],
  onClick?: MouseEventHandler<HTMLButtonElement>,
): MouseEventHandler<HTMLButtonElement> {
  return (event) => {
    if (disabled === true || disabled === 'true') {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  };
}
