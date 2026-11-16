/** Build-time URLs (vite --mode): production, development (localhost) or e2e. */
export const API_URL: string = import.meta.env.VITE_API_URL ?? 'https://api.orvyn.dubey.app';
export const WEB_URL: string = import.meta.env.VITE_WEB_URL ?? 'https://orvyn.dubey.app';
export const VERSION = '0.1.0';
