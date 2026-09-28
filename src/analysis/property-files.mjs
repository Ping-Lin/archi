import { parseDocument } from 'yaml';

// Bounded Java properties syntax. ASCII input avoids silently guessing a file's
// UTF-8 versus ISO-8859-1 loading policy; Unicode escapes remain supported.
export function parseProperties(text) {
  if (typeof text !== 'string' || /[^\x00-\x7f]/.test(text))
    throw Error('Properties input must be ASCII; use Unicode escapes for non-ASCII values');
  const out = Object.create(null), lines = text.split(/\r\n|\n|\r/);
  const decode = value => value.replace(/\\(u[0-9a-fA-F]{4}|[\s\S])/g, (_, escaped) => {
    if (escaped[0] === 'u') {
      if (escaped.length !== 5) throw Error('Invalid Unicode escape');
      return String.fromCharCode(parseInt(escaped.slice(1), 16));
    }
    return ({t:'\t',r:'\r',n:'\n',f:'\f'})[escaped] ?? escaped;
  });
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/^[ \t\f]+/, '');
    if (/^[#!]---\s*$/.test(line)) throw Error('Multi-document properties require a config-data adapter');
    if (!line || /^[#!]/.test(line)) continue;
    while ((line.match(/\\+$/)?.[0].length ?? 0) % 2) {
      if (++i >= lines.length) throw Error('Unterminated properties continuation');
      line = line.slice(0, -1) + lines[i].replace(/^[ \t\f]+/, '');
    }
    let end = 0;
    while (end < line.length) {
      if (line[end] === '\\') { end += 2; continue; }
      if (/[=: \t\f]/.test(line[end])) break;
      end++;
    }
    let start = end;
    while (/[ \t\f]/.test(line[start] ?? '') && start < line.length) start++;
    if (line[start] === '=' || line[start] === ':') start++;
    while (/[ \t\f]/.test(line[start] ?? '') && start < line.length) start++;
    const key = decode(line.slice(0,end)), value = decode(line.slice(start));
    if (!key || Object.hasOwn(out,key)) throw Error('Empty or duplicate property key');
    out[key] = value;
  }
  return out;
}

export function flattenProperties(value, prefix = '', out = Object.create(null)) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Property source must be a mapping');
  for (const [key,item] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object' && !Array.isArray(item)) flattenProperties(item,full,out);
    else if (['string','number','boolean'].includes(typeof item)) {
      if (Object.hasOwn(out,full)) throw Error('Conflicting flattened property key');
      out[full] = String(item);
    } else throw Error('Unsupported property value');
  }
  return out;
}

export function parsePropertyFile(file, content) {
  if (file.endsWith('.properties')) return parseProperties(content);
  if (!/\.ya?ml$/.test(file)) throw Error('Expected .properties, .yaml or .yml input');
  const doc = parseDocument(content,{uniqueKeys:true});
  if (doc.errors.length) throw Error(doc.errors[0].message);
  return flattenProperties(doc.toJS({maxAliasCount:100}));
}
