function timestamp() {
  return new Date().toISOString();
}

// Log arguments can carry user-influenced text (query params, provider errors);
// flatten CR/LF in strings so a value cannot forge extra log lines.
const clean = (value) => (typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ') : value);

export const logger = {
  info: (...args) => console.log(`[${timestamp()}] INFO`, ...args.map(clean)),
  warn: (...args) => console.warn(`[${timestamp()}] WARN`, ...args.map(clean)),
  error: (...args) => console.error(`[${timestamp()}] ERROR`, ...args.map(clean)),
};
