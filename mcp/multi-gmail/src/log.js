let passwords = [];

export function setRedactions(values) {
  passwords = values.flatMap((value) => [String(value), String(value).replace(/\s/g, '')]).filter(Boolean);
}

export function redact(value) {
  let text = value instanceof Error ? (value.stack || value.message) : String(value);
  for (const password of passwords) text = text.split(password).join('***');
  return text;
}

export function logError(error, prefix = '') {
  process.stderr.write(`${prefix}${redact(error)}\n`);
}
