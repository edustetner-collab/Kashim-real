
import React, { useState, useEffect, useRef, useCallback, forwardRef } from 'react';

interface CurrencyInputProps {
  value: number;
  onChange: (value: number) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onEnter?: () => void;
}

const toDigits = (float: number): string => {
  if (!float || float <= 0) return '';
  return String(Math.round(float * 100));
};

const digitsToFloat = (digits: string): number => {
  if (!digits) return 0;
  return parseInt(digits, 10) / 100;
};

const formatBRL = (float: number, showCents: boolean): string => {
  if (float <= 0) return '';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  }).format(float);
};

const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(({
  value,
  onChange,
  className,
  placeholder = '0,00',
  disabled,
  autoFocus,
  onEnter,
}, ref) => {
  const [digits, setDigits] = useState(() => toDigits(value));
  const [focused, setFocused] = useState(false);
  // True until the first digit key is pressed — first key REPLACES instead of appending
  const isFirstKeyRef = useRef(true);
  const isFocusedRef = useRef(false);

  // Sync from external value changes (replication, undo) when not actively editing
  useEffect(() => {
    if (!isFocusedRef.current) {
      setDigits(toDigits(value));
    }
  }, [value]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key >= '0' && e.key <= '9') {
      e.preventDefault();
      const newDigits = isFirstKeyRef.current
        ? e.key
        : ((digits + e.key).replace(/^0+/, '') || '').slice(0, 10);
      isFirstKeyRef.current = false;
      setDigits(newDigits);
      onChange(digitsToFloat(newDigits));
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      isFirstKeyRef.current = false;
      const newDigits = digits.slice(0, -1);
      setDigits(newDigits);
      onChange(digitsToFloat(newDigits));
    } else if (e.key === 'Enter') {
      onEnter?.();
    }
    // Tab, arrows etc. propagate naturally
  }, [digits, onChange, onEnter]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const raw = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 10);
    if (!raw) return;
    isFirstKeyRef.current = false;
    setDigits(raw);
    onChange(digitsToFloat(raw));
  }, [onChange]);

  const displayValue = focused
    ? (digits ? formatBRL(digitsToFloat(digits), true) : '')
    : (digits ? formatBRL(digitsToFloat(digits), false) : '');

  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      value={displayValue}
      onChange={() => {}}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onFocus={() => {
        setFocused(true);
        isFocusedRef.current = true;
        isFirstKeyRef.current = true;
      }}
      onBlur={() => {
        setFocused(false);
        isFocusedRef.current = false;
      }}
      className={className}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
    />
  );
});

CurrencyInput.displayName = 'CurrencyInput';

export default CurrencyInput;
