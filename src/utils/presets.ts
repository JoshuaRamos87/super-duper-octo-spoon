import { DEFAULT_EXPORT_SETTINGS, type CustomPreset, type ExportSettings, type PlatformPreset } from '../types/studio';

const CUSTOM_PRESETS_KEY = 'clipshrink_custom_presets_v1';

export const PLATFORM_PRESETS: PlatformPreset[] = [
  {
    id: 'discord-free',
    name: 'Discord',
    badge: '10 MB',
    targetMB: 10,
    description: 'Discord standard upload cap',
  },
  {
    id: 'github-issue',
    name: 'GitHub',
    badge: '10 MB',
    targetMB: 10,
    description: 'GitHub issues & PR video limit',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    badge: '16 MB',
    targetMB: 16,
    description: 'WhatsApp standard media limit',
  },
  {
    id: 'email',
    name: 'Email',
    badge: '25 MB',
    targetMB: 25,
    description: 'Gmail / standard attachment cap',
  },
  {
    id: 'discord-nitro',
    name: 'Nitro',
    badge: '50 MB',
    targetMB: 50,
    description: 'Discord Nitro Basic limit',
  },
  {
    id: 'slack-clip',
    name: 'Compact',
    badge: '8 MB',
    targetMB: 8,
    description: 'Legacy 8 MB / ultra-fast share',
  },
];

export function loadCustomPresets(): CustomPreset[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(CUSTOM_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is CustomPreset =>
          Boolean(item && typeof item.id === 'string' && typeof item.name === 'string' && item.settings)
      )
      .map((item) => ({
        ...item,
        settings: { ...DEFAULT_EXPORT_SETTINGS, ...item.settings },
      }));
  } catch {
    return [];
  }
}

export function saveCustomPreset(name: string, settings: ExportSettings): CustomPreset[] {
  const trimmed = name.trim();
  if (!trimmed) return loadCustomPresets();

  const existing = loadCustomPresets();
  const next: CustomPreset = {
    id: `preset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: trimmed,
    createdAt: Date.now(),
    settings: structuredClone(settings),
  };
  const updated = [next, ...existing].slice(0, 20);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(updated));
    }
  } catch {
    // Ignore storage quota errors
  }
  return updated;
}

export function deleteCustomPreset(id: string): CustomPreset[] {
  const updated = loadCustomPresets().filter((p) => p.id !== id);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(updated));
    }
  } catch {
    // Ignore storage quota errors
  }
  return updated;
}
