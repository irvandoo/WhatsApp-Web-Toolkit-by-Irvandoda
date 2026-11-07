import { defineManifest } from '@crxjs/vite-plugin';

// Fixed public key => the SAME extension id no matter which folder it is loaded from (root, dist/full, unzipped release).
// The extension id owns the slot registry (IndexedDB 'wwt'); a different id would make saved accounts "disappear".
// Only the full build carries it; the Chrome Web Store assigns its own id and rejects nothing, but we keep it out of the store build.
const FULL_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxjTceT+SjthkaxQIhxia0Q3dKZgOmLXkDSwZbcmjyNDjj+NIujUiGBLrRNUE8nVFO8GXPbxWGcGURLbKjBGnl0N9/W/X65UntUGazea58+mDE39/oKzOEY7XF50PdSHRPx+g/hsw/J6xf4Wbn/D5xysF7/CuSa1/FY/2yJ2rmu0I+kP9Wlm6qyDt84QcDIm6Jd2PfzUMtMCPEW8IlbyjNgViQh+zGEGowE4b48Zloafk7s595sZFvbAbezOAnjKHQxHmzk90kvMbSoLbJ6aWejLdJUMla+zun1MIKKZNoEvixlteX/BAT5Cj3uiB6gXfi1cfT7gOmKqhaBbmKqN2FQIDAQAB';

export default defineManifest(({ mode }) => ({
  ...(mode === 'full' ? { key: FULL_KEY } : {}),
  manifest_version: 3,
  name: '__MSG_extName__',
  description: '__MSG_extDesc__',
  version: '0.1.0',
  default_locale: 'id',
  author: { email: 'irvando.d.a@gmail.com' },
  homepage_url: 'https://irvandoda.web.id',
  icons: { '16': 'public/icons/icon16.png', '48': 'public/icons/icon48.png', '128': 'public/icons/icon128.png' },
  action: { default_popup: 'popup/index.html' },
  options_page: 'options/index.html',
  background: { service_worker: 'background/index.ts', type: 'module' },
  permissions: ['storage', 'alarms', 'unlimitedStorage', 'notifications'],
  host_permissions: ['https://web.whatsapp.com/*'],
  web_accessible_resources: [
    { resources: ['dashboard/index.html', 'crm/index.html', 'templates/index.html', 'analytics/index.html', 'autoreply/index.html', 'groups/index.html', 'pos/index.html', 'blast/index.html', 'presets/index.html', 'quickstart/index.html', 'assets/*'], matches: ['https://web.whatsapp.com/*'] },
  ],
  content_scripts: [
    { matches: ['https://web.whatsapp.com/*'], js: ['content/index.ts'], run_at: 'document_idle' },
    { matches: ['https://web.whatsapp.com/*'], js: ['public/virtual-session.js'], run_at: 'document_start', world: 'MAIN', all_frames: false },
    { matches: ['https://web.whatsapp.com/*'], js: ['injected/wa-adapter.ts'], run_at: 'document_start', world: 'MAIN' },
  ],
}));
