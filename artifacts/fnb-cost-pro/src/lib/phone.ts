export function formatPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  const limited = digits.slice(0, 10);

  if (limited.length === 0) return "";
  if (limited.length <= 3) return `(${limited}`;
  if (limited.length <= 6) return `(${limited.slice(0, 3)}) ${limited.slice(3)}`;
  return `(${limited.slice(0, 3)}) ${limited.slice(3, 6)}-${limited.slice(6)}`;
}

export function stripPhoneFormatting(value: string): string {
  return value.replace(/\D/g, "");
}

export function isValidPhone(value: string): boolean {
  if (!value || value.trim() === "") return true;
  const digits = value.replace(/\D/g, "");
  return digits.length === 10;
}

export const phoneValidation = (value: string | undefined) => {
  if (!value || value.trim() === "") return true;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 0) return true;
  if (digits.length !== 10) return "Phone number must be 10 digits";
  return true;
};
