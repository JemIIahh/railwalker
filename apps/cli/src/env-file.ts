const assignment = (name: string) => new RegExp(`^(?!\\s*#)\\s*(?:export\\s+)?${name}\\s*=(.*)$`, 'm');

/** Whether `.env` content gives `name` a non-empty value. A commented-out line does not count. */
export function hasEnvValue(content: string, name: string): boolean {
  const m = assignment(name).exec(content);
  return m !== null && m[1]!.trim().replace(/^["']|["']$/g, '') !== '';
}

/** Sets `name=value`: in place if there is a line for it (blank or not), otherwise on a new last line. Everything else is left alone. */
export function setEnvVar(content: string, name: string, value: string): string {
  const line = `${name}=${value}`;
  const re = new RegExp(`^(?!\\s*#)\\s*(?:export\\s+)?${name}\\s*=.*$`, 'm');
  if (re.test(content)) return content.replace(re, line);
  const body = content === '' || content.endsWith('\n') ? content : `${content}\n`;
  return `${body}${line}\n`;
}
