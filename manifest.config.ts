import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: '__MSG_extName__',
  description: '__MSG_extDesc__',
  version: '0.1.0',
  default_locale: 'id',
  author: { email: 'irvando.d.a@gmail.com' },
  homepage_url: 'https://irvandoda.web.id',
  icons: { '16': 'public/icons/icon16.png', '48': 'public/icons/icon48.png', '128': 'public/icons/icon128.png' },
  action: { default_popup: 'src/popup/index.html' },
  options_page: 'src/options/index.html',
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  permissions: ['storage', 'alarms', 'scripting', 'unlimitedStorage', 'notifications'],
  host_permissions: ['https://web.whatsapp.com/*'],
  content_scripts: [
    { matches: ['https://web.whatsapp.com/*'], js: ['src/content/index.ts'], run_at: 'document_idle' },
    { matches: ['https://web.whatsapp.com/*'], js: ['src/injected/wa-adapter.ts'], run_at: 'document_start', world: 'MAIN' },
  ],
});
