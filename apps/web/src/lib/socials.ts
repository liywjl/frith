// Which icon a profile/feed link gets, by hostname. Detection is cosmetic —
// any URL works, unknown hosts just get the globe.
import type { IconName } from '../components/Icon';

const RULES: { icon: IconName; host: RegExp }[] = [
  { icon: 'instagram', host: /(^|\.)instagram\.com$/ },
  { icon: 'youtube', host: /(^|\.)(youtube\.com|youtu\.be)$/ },
  { icon: 'twitter', host: /(^|\.)(twitter\.com|x\.com)$/ },
  { icon: 'github', host: /(^|\.)(github\.com|gitlab\.com|codeberg\.org)$/ },
  { icon: 'music', host: /(^|\.)(bandcamp\.com|soundcloud\.com|spotify\.com|tidal\.com)$/ },
  { icon: 'mail', host: /(^|\.)(substack\.com|buttondown\.email)$/ },
  { icon: 'camera', host: /(^|\.)(glass\.photo|vimeo\.com|flickr\.com|500px\.com)$/ },
  { icon: 'rss', host: /(^|\.)(wordpress\.com|blogspot\.com|medium\.com|ghost\.io|bearblog\.dev)$/ },
];

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function linkIcon(url: string): IconName {
  const host = hostnameOf(url);
  return (host && RULES.find((r) => r.host.test(host))?.icon) || 'globe';
}

export function linkDomain(url: string): string {
  return hostnameOf(url)?.replace(/^www\./, '') ?? url;
}
