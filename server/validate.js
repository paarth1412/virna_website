import { HttpError } from './auth.js';

export const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'];

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_RE = /^[6-9]\d{9}$/;
export const PIN_RE = /^\d{6}$/;

// Trimmed string, capped length; '' when missing.
export const text = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function required(value, message) {
  if (!value) throw new HttpError(400, message);
  return value;
}

export function email(v) {
  const e = text(v, 254).toLowerCase();
  if (!EMAIL_RE.test(e)) throw new HttpError(400, 'Enter a valid email address');
  return e;
}

export function password(v) {
  if (typeof v !== 'string' || v.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (v.length > 200) throw new HttpError(400, 'Password is too long');
  return v;
}

export function int(v, { min = 0, max = 1e9, name = 'Value' } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} must be a whole number between ${min} and ${max}`);
  return n;
}

export function address(a = {}) {
  const out = {
    firstName: required(text(a.firstName, 60), 'First name is required'),
    lastName: required(text(a.lastName, 60), 'Last name is required'),
    line1: required(text(a.line1, 200), 'Address is required'),
    line2: text(a.line2, 200),
    city: required(text(a.city, 80), 'City is required'),
    state: text(a.state, 80),
    pincode: text(a.pincode, 6)
  };
  if (!STATES.includes(out.state)) throw new HttpError(400, 'Select a valid state');
  if (!PIN_RE.test(out.pincode)) throw new HttpError(400, 'Enter a 6-digit PIN code');
  return out;
}
