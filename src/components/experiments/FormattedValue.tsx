import React from 'react';
import { NotAvailable } from '../common';
import { isNotAvailable } from '../../lib/format';

/** Renders formatted text, or the styled "not available" placeholder when the value is absent (27.3). */
export const FormattedValue: React.FC<{ text: string; reason?: string }> = ({ text, reason }) =>
  isNotAvailable(text) ? <NotAvailable reason={reason} /> : <>{text}</>;
