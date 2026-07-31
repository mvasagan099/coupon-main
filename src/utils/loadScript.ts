export async function loadScript(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
    if (existing) {
      if ((existing as HTMLScriptElement).dataset.loaded === "true") {
        resolve(true);
        return;
      }
      existing.addEventListener("load", () => resolve(true), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve(true);
    };
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}
