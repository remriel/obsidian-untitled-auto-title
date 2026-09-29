import process from "node:process";

export function readApiKey(name: string): Promise<string | null> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return Promise.resolve(null);
  return Promise.resolve(process.env[name]?.trim() || null);
}
