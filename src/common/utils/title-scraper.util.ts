import { Logger } from '@nestjs/common';

export class TitleScraperUtil {
  private static readonly logger = new Logger('TitleScraperUtil');

  /**
   * Scrapes the HTML <head> of a target destination URL to extract the webpage title.
   * Priority:
   *  1. <meta property="og:title" content="...">
   *  2. <title>...</title>
   *  3. <meta name="twitter:title" content="...">
   *  4. Intelligent category / URL slug fallback
   */
  public static async scrapeTitle(targetUrl: string): Promise<string | null> {
    if (!targetUrl) return null;

    try {
      // 1. Attempt streaming HTTP fetch with full browser emulation & decompression
      const titleFromHtml = await this.fetchTitleViaStream(targetUrl);
      if (titleFromHtml) {
        // Sanitize out any cryptic filter hashes (e.g. "Cs Tj1hs5ycq5") if present
        const refinedTitle = this.sanitizeAndFormatTitle(titleFromHtml, targetUrl);
        return refinedTitle || titleFromHtml;
      }
    } catch (err: any) {
      this.logger.debug(`Streaming fetch failed for ${targetUrl}: ${err.message}`);
    }

    // 2. Fallback: Extract meaningful title from category path / URL slug
    const categoryTitle = this.extractCategoryTitleFromUrl(targetUrl);
    if (categoryTitle) {
      return categoryTitle;
    }

    return this.extractTitleFromUrlPath(targetUrl);
  }

  private static async fetchTitleViaStream(targetUrl: string): Promise<string | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4500);

    try {
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8',
          'sec-ch-ua': '"Chromium";v="123", "Not:A-Brand";v="8", "Google Chrome";v="123"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'none',
          'sec-fetch-user': '?1',
          'upgrade-insecure-requests': '1',
          'Cache-Control': 'no-cache',
        },
        redirect: 'follow',
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        return null;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let htmlChunk = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        htmlChunk += decoder.decode(value, { stream: true });

        const extracted = this.extractTitleFromHtml(htmlChunk);
        if (extracted) {
          try {
            reader.cancel();
          } catch {}
          return extracted;
        }

        // Limit stream read to 100KB to save memory & bandwidth
        if (htmlChunk.length > 102400) {
          try {
            reader.cancel();
          } catch {}
          break;
        }
      }

      return this.extractTitleFromHtml(htmlChunk);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private static extractTitleFromHtml(html: string): string | null {
    if (!html) return null;

    // 1. Check <meta property="og:title" content="..."> or <meta content="..." property="og:title">
    const ogMatch =
      html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
    if (ogMatch && ogMatch[1]?.trim()) {
      const cleaned = this.cleanTitle(ogMatch[1]);
      if (cleaned && !this.isGenericBlockTitle(cleaned)) {
        return cleaned;
      }
    }

    // 2. Check <title>...</title> tag
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch && titleMatch[1]?.trim()) {
      const cleaned = this.cleanTitle(titleMatch[1]);
      if (cleaned && !this.isGenericBlockTitle(cleaned)) {
        return cleaned;
      }
    }

    // 3. Check <meta name="twitter:title" content="...">
    const twitterMatch =
      html.match(/<meta[^>]*name=["']twitter:title["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:title["']/i);
    if (twitterMatch && twitterMatch[1]?.trim()) {
      const cleaned = this.cleanTitle(twitterMatch[1]);
      if (cleaned && !this.isGenericBlockTitle(cleaned)) {
        return cleaned;
      }
    }

    return null;
  }

  /**
   * Refines scraped titles to remove cryptic search/filter hashes (e.g. "Cs Tj1hs5ycq5")
   * and replace them with readable category paths (e.g. "Clothing and Accessories – Shirts | Flipkart.com").
   */
  private static sanitizeAndFormatTitle(title: string | null, targetUrl: string): string | null {
    if (!title) return null;

    // Check if the title contains cryptic filter/session tokens like "Cs Tj1hs5ycq5" or "~cs-"
    const hasGibberishToken =
      /\b[A-Za-z0-9]*\d+[a-z0-9]{4,}\b/i.test(title) ||
      /~?cs-[a-z0-9]+/i.test(title) ||
      /\b[0-9a-f]{8,}\b/i.test(title);

    if (hasGibberishToken) {
      const categoryTitle = this.extractCategoryTitleFromUrl(targetUrl);
      if (categoryTitle) {
        return categoryTitle;
      }
    }

    return title;
  }

  /**
   * Extracts clean category breadcrumb hierarchy from URL paths
   * e.g. "/clothing-and-accessories/topwear/shirts/~cs-tj1hs5ycq5/pr?..." -> "Clothing and Accessories – Shirts | Flipkart.com"
   */
  private static extractCategoryTitleFromUrl(targetUrl: string): string | null {
    try {
      const parsed = new URL(targetUrl);
      const host = parsed.hostname.replace(/^www\./i, '');
      const rawSegments = parsed.pathname.split('/').filter(Boolean);

      const cleanCategories: string[] = [];

      for (const seg of rawSegments) {
        // Skip filter tokens (~cs-...), route indicators (pr, p), and hexadecimal hashes
        if (
          seg.startsWith('~') ||
          seg === 'pr' ||
          seg === 'p' ||
          /^[0-9a-f]{8,}$/i.test(seg) ||
          /^[a-z0-9]{10,}$/i.test(seg) ||
          /^itm[a-z0-9]+/i.test(seg)
        ) {
          continue;
        }

        const words = seg
          .split('-')
          .filter((w) => w.length > 0 && !/^[0-9a-z]{8,}$/i.test(w))
          .map((w) => {
            if (/^(and|or|in|at|of|the|for|to)$/i.test(w)) return w.toLowerCase();
            if (/^(5g|4g|gb|ram|mb|pro|max|plus|ai|hd|usb|tv|ac)$/i.test(w)) return w.toUpperCase();
            return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
          });

        if (words.length > 0) {
          cleanCategories.push(words.join(' '));
        }
      }

      if (cleanCategories.length > 0) {
        // If 3+ categories (e.g. ["Clothing and Accessories", "Topwear", "Shirts"]), combine the root and leaf
        let combined: string;
        if (cleanCategories.length >= 3) {
          combined = `${cleanCategories[0]} – ${cleanCategories[cleanCategories.length - 1]}`;
        } else {
          combined = cleanCategories.join(' – ');
        }

        if (host.includes('flipkart')) {
          return `${combined} | Flipkart.com`;
        }
        if (host.includes('amazon')) {
          return `${combined} on Amazon`;
        }
        return `${combined} | ${host}`;
      }
    } catch {}
    return null;
  }

  /**
   * Filters out anti-bot block titles like "Robot Check", "Access Denied", "Just a moment...", etc.
   */
  private static isGenericBlockTitle(title: string): boolean {
    const lower = title.toLowerCase();
    return (
      lower.includes('robot check') ||
      lower.includes('access denied') ||
      lower.includes('just a moment') ||
      lower.includes('attention required') ||
      lower.includes('cloudflare') ||
      lower.includes('captcha')
    );
  }

  /**
   * Intelligently parses product and article names from URL slugs when websites block scrapers.
   * e.g., "https://www.flipkart.com/ai-nova-2-5g-purple-128-gb/p/itmc486..." -> "Ai Nova 2 5G Purple 128 Gb Online at Best Price On Flipkart.com"
   */
  private static extractTitleFromUrlPath(targetUrl: string): string | null {
    try {
      const parsed = new URL(targetUrl);
      const segments = parsed.pathname.split('/').filter(Boolean);
      const host = parsed.hostname.replace(/^www\./i, '');

      // E-commerce slug detection (Flipkart, Amazon, etc.)
      for (const seg of segments) {
        if (seg.includes('-') && seg.length > 5 && !seg.startsWith('itm') && !seg.startsWith('B0')) {
          const words = seg
            .split('-')
            .filter((w) => w.length > 0 && !/^[0-9a-f]{10,}$/i.test(w))
            .map((w) => {
              // Preserve common abbreviations
              if (/^(5g|4g|gb|ram|mb|pro|max|plus|ai|hd|usb)$/i.test(w)) {
                return w.toUpperCase();
              }
              return w.charAt(0).toUpperCase() + w.slice(1);
            });

          if (words.length >= 2) {
            const formattedName = words.join(' ');
            if (host.includes('flipkart')) {
              return `${formattedName} Online at Best Price On Flipkart.com`;
            }
            if (host.includes('amazon')) {
              return `${formattedName} on Amazon`;
            }
            return `${formattedName} - ${host}`;
          }
        }
      }
    } catch {}
    return null;
  }

  private static cleanTitle(raw: string): string | null {
    if (!raw) return null;
    const cleaned = raw
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
      .replace(/\s+/g, ' ')
      .trim();

    return cleaned.length > 0 ? cleaned : null;
  }
}
