declare const __API_URL__: string;
declare const __SITE_SLUG__: string;

/** API pública externa (definida no build por VITE_API_URL). */
export const API_URL: string = __API_URL__;
/** Estacionamento da tela inicial (VITE_SITE_SLUG). */
export const SITE_PADRAO: string = __SITE_SLUG__;
