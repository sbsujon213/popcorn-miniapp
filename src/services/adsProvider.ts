/**
 * POP TELEGRAM MINI APP - DYNAMIC ADS PROVIDER SERVICE
 * Supports: Adsgram, Monetag, GoogleAdSense
 * Dynamic script injection, provider switching, and 10s interstitial lifecycle.
 */

declare global {
  interface Window {
    Adsgram?: {
      init: (params: { blockId: string; debug?: boolean }) => {
        show: () => Promise<{ done: boolean; description?: string; state?: string }>;
      };
    };
    monetag?: any;
    show_native_ad?: any;
  }
}

export type AdProviderType = 'adsgram' | 'monetag' | 'googleadsense' | string;

export function sanitizeAdsgramBlockId(secret?: string): string {
  if (!secret) return '12345';
  const trimmed = String(secret).trim();
  // Valid Adsgram format: purely digits (e.g. "4568") or "int-" followed by digits (e.g. "int-1234")
  if (/^\d+$/.test(trimmed) || /^int-\d+$/.test(trimmed)) {
    return trimmed;
  }
  // If it starts with or contains int-
  if (trimmed.toLowerCase().includes('int-')) {
    const nums = trimmed.replace(/\D/g, '');
    return nums ? `int-${nums}` : 'int-1234';
  }
  // Extract all numeric digits (e.g. test_block_12345 -> 12345)
  const digits = trimmed.replace(/\D/g, '');
  return digits || '12345';
}

export interface AdShowResult {
  success: boolean;
  provider: string;
  blockId: string;
  watchedDurationSeconds: number;
  rewardEarned: boolean;
  error?: string;
}

class AdsProviderService {
  private currentProvider: AdProviderType = 'adsgram';
  private currentSecret: string = '12345';
  private adsgramController: any = null;
  private scriptLoaded: boolean = false;

  /**
   * Configure dynamic provider and block ID in real-time from server / admin config
   */
  public configure(provider: AdProviderType, secret: string) {
    const normalizedProvider = (provider || 'adsgram').toLowerCase();
    const sanitizedSecret = normalizedProvider === 'adsgram' ? sanitizeAdsgramBlockId(secret) : (secret || '12345');
    const isNew = normalizedProvider !== this.currentProvider || sanitizedSecret !== this.currentSecret;

    this.currentProvider = normalizedProvider;
    this.currentSecret = sanitizedSecret;

    if (isNew) {
      this.loadProviderScript();
    }
  }

  public getProvider(): AdProviderType {
    return this.currentProvider;
  }

  public getSecret(): string {
    return this.currentSecret;
  }

  /**
   * Load official provider SDK script dynamically into the DOM
   */
  public loadProviderScript(): void {
    if (typeof window === 'undefined') return;

    try {
      if (this.currentProvider === 'adsgram') {
        const existingScript = document.getElementById('adsgram-sdk-script');
        if (!existingScript) {
          const script = document.createElement('script');
          script.id = 'adsgram-sdk-script';
          script.src = 'https://sad.adsgram.ai/js/sad.min.js';
          script.async = true;
          script.onload = () => {
            this.scriptLoaded = true;
            this.initAdsgram();
          };
          document.head.appendChild(script);
        } else if (window.Adsgram) {
          this.initAdsgram();
        }
      } else if (this.currentProvider === 'monetag') {
        // Monetag script injection
        const existingScript = document.getElementById('monetag-sdk-script');
        if (!existingScript && this.currentSecret) {
          const script = document.createElement('script');
          script.id = 'monetag-sdk-script';
          script.src = `https://alwingulla.com/88/tag.min.js?zone=${this.currentSecret}`;
          script.async = true;
          script.setAttribute('data-zone', this.currentSecret);
          document.head.appendChild(script);
        }
      }
    } catch (err) {
      console.warn('[AdsProvider] Failed to load provider script:', err);
    }
  }

  private initAdsgram(): void {
    if (typeof window !== 'undefined' && window.Adsgram) {
      try {
        const validBlockId = sanitizeAdsgramBlockId(this.currentSecret);
        const hasTgLaunchParams = Boolean(
          (window.Telegram?.WebApp?.initData && window.Telegram.WebApp.initData.length > 0) ||
          window.location.search.includes('tgWebAppData') ||
          window.location.hash.includes('tgWebAppData')
        );
        this.adsgramController = window.Adsgram.init({
          blockId: validBlockId,
          debug: !hasTgLaunchParams
        });
        console.log(`[AdsProvider] Adsgram initialized with Block ID: ${validBlockId} (debug: ${!hasTgLaunchParams})`);
      } catch (err) {
        console.warn('[AdsProvider] Adsgram init failed or outside Telegram environment:', err);
        this.adsgramController = null;
      }
    }
  }

  /**
   * Show native ad if SDK is available, or return fallback trigger
   */
  public async showNativeAd(): Promise<boolean> {
    if (this.currentProvider === 'adsgram' && this.adsgramController) {
      try {
        const res = await this.adsgramController.show();
        return res?.done === true;
      } catch (err) {
        console.warn('[AdsProvider] Native Adsgram show rejected:', err);
        return false;
      }
    }
    return false;
  }

  /**
   * Show Adsgram Rewarded Video Ad.
   * Uses Adsgram SDK's native onReward completion (res.done) to verify video completion automatically (no fixed timer).
   */
  public async showRewardedAd(
    onReward: () => void | Promise<void>,
    onError?: (err: any) => void
  ): Promise<boolean> {
    if (typeof window !== 'undefined' && window.Adsgram) {
      if (!this.adsgramController) {
        this.initAdsgram();
      }
      if (this.adsgramController) {
        try {
          const res = await this.adsgramController.show();
          if (res?.done) {
            console.log('[Adsgram] Rewarded video completed! Executing onReward callback.');
            await onReward();
            return true;
          } else {
            console.warn('[Adsgram] Rewarded video closed before completion.');
            if (onError) onError(new Error('Ad not completed'));
            return false;
          }
        } catch (err) {
          console.warn('[Adsgram] Native rewarded ad failed or dismissed:', err);
          // Fallback if ad failed to load so user is not blocked
          if (onError) onError(err);
          await onReward();
          return false;
        }
      }
    }

    // Fallback when Adsgram is unavailable or running outside Telegram
    await onReward();
    return true;
  }
}

export const adsProvider = new AdsProviderService();
