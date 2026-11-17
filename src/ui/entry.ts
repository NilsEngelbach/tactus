// Typing a value straight into a display: the readout turns into an input in place.
// Enter or leaving the field sets it; Escape keeps the old value.
import { h } from './dom';

export interface EntryOptions {
  /** The readout element the input temporarily replaces. */
  readout: HTMLElement;
  value: () => number;
  min: number;
  max: number;
  label: () => string;
  onCommit: (v: number) => void;
}

export function valueEntry(o: EntryOptions) {
  let input: HTMLInputElement | null = null;

  const close = (commit: boolean) => {
    if (!input) return;
    const field = input;
    input = null;
    const v = parseInt(field.value, 10);
    field.replaceWith(o.readout);
    if (commit && Number.isFinite(v)) o.onCommit(Math.min(o.max, Math.max(o.min, v)));
  };

  /** Opens the field; `first` starts it with a typed digit instead of the current value. */
  const open = (first?: string) => {
    if (input) {
      if (first) input.value += first;
      return;
    }
    const field = h('input', {
      class: `${o.readout.className} entry-input`,
      type: 'text',
      inputmode: 'numeric',
      pattern: '[0-9]*',
      maxlength: String(String(o.max).length),
      autocomplete: 'off',
      enterkeyhint: 'done',
      'aria-label': `${o.label()} (${o.min}–${o.max})`,
    });
    field.value = first ?? String(o.value());
    field.addEventListener('input', () => {
      field.value = field.value.replace(/\D/g, '');
    });
    field.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        close(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
      }
    });
    field.addEventListener('blur', () => close(true));
    input = field;
    o.readout.replaceWith(field);
    field.focus({ preventScroll: true });
    if (first) field.setSelectionRange(field.value.length, field.value.length);
    else field.select();
  };

  return { open, isOpen: () => input !== null };
}
