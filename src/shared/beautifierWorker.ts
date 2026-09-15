import { renderBeautifierToDataURL } from "./beautifierRender";
import type { BeautifierConfig } from "./beautifierTypes";

declare global {
  interface Window {
    __reflectoBeautify: (dataUrl: string, config: BeautifierConfig) => Promise<string>;
  }
}

window.__reflectoBeautify = (dataUrl, config) => renderBeautifierToDataURL(dataUrl, config);
