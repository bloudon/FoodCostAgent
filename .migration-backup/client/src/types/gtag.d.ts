interface GtagEventParams {
  page_path?: string;
  page_location?: string;
  page_title?: string;
  [key: string]: string | number | boolean | undefined;
}

type GtagCommand = 'config' | 'event' | 'js' | 'set';

interface Window {
  dataLayer: unknown[];
  gtag: (command: GtagCommand, target: string | Date, params?: GtagEventParams) => void;
}
