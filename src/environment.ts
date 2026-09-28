import { execFile } from "node:child_process";
import process from "node:process";

function registryValue(path: string, name: string): Promise<string | null> {
  return new Promise(resolve => {
    execFile("reg.exe", ["query", path, "/v", name], {
      windowsHide: true, timeout: 3000, maxBuffer: 16384,
    }, (error, stdout) => {
      if (error) return resolve(null);
      const line = stdout.split(/\r?\n/).find(entry => /\sREG_(?:EXPAND_)?SZ\s/.test(entry));
      resolve(line?.split(/\s+REG_(?:EXPAND_)?SZ\s+/)[1]?.trim() || null);
    });
  });
}

export async function readApiKey(name: string): Promise<string | null> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null;
  const inherited = process.env[name]?.trim();
  if (inherited) return inherited;
  if (process.platform !== "win32") return null;
  return await registryValue("HKCU\\Environment", name)
    ?? await registryValue("HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment", name);
}
