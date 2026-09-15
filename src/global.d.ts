import type { ReflectoAPI } from "../preload/index";

declare global {
  interface Window {
    electron: ReflectoAPI;
    reflecto: ReflectoAPI;
  }
}

export {};
