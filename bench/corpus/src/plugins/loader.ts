/** Load a plugin module by name at runtime. */
export async function loadPlugin(name: string): Promise<unknown> {
  const mod = await import(`./plugins/${name}`);
  const fixed = await import("./registry");
  return { mod, fixed };
}
